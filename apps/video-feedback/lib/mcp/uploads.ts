import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import {
  type FileHandle,
  link,
  lstat,
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
} from 'node:fs/promises';
import { extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { config } from '@/lib/config';
import { limits } from '@/lib/limits';
import { readJson, writeJsonAtomic } from '@/lib/storage/json';
import { inboxDir } from '@/lib/storage/paths';
import { getVideo } from '@/lib/storage/repo';
import { importFromInbox } from '@/lib/videos/import';
import { reviewUrlOf } from './common';

// Uploads for agents on other machines. upload_film makes a record and a one-time link; the
// shell command it hands out sends the film to that link in parts (Cloudflare refuses a request
// body over 100 MB), then asks for it to be put together and imported from the inbox.
//
// <dataDir>/uploads/<uploadId>/upload.json   the record
// <dataDir>/uploads/<uploadId>/parts/<n>     the parts received so far
//
// The link is the credential: /api/upload/<uploadId>.<secret>. Only a hash of the secret is
// kept, so the data folder alone cannot be used to send a film.

const MiB = 1024 * 1024;
const HOUR = 60 * 60_000;

/** On one object so tests can lower them. */
export const uploadLimits = {
  /** Largest part accepted. The command sends 64 MiB; Cloudflare stops anything over 100 MB. */
  partMaxBytes: 100 * MiB,
  /** Part numbers run from 0 to one below this. */
  maxParts: 200,
  /** Largest film, all parts together. */
  totalMaxBytes: 4 * 1024 * MiB,
  /**
   * How long the link works after it is made, and after each part arrives: a slow uplink sending
   * a big film keeps it alive by making progress.
   */
  ttlMs: 2 * HOUR,
  /** However many parts arrive, the link stops working this long after it was made. */
  maxLifetimeMs: 24 * HOUR,
  /**
   * Upload folders nobody has touched for this long are removed when a new upload is made. Until
   * then an expired upload keeps its parts, so nothing is thrown away the moment a link lapses.
   */
  sweepAfterMs: 24 * HOUR,
  /** How long the finish request waits for the import before answering "still importing". */
  finishWaitMs: 60_000,
  /**
   * An import still running after this long, and not running in this process, was cut off (a
   * restart): it is marked failed. Short, so an agent is not left polling get_upload for an hour;
   * the in-process check keeps a slow import here from being called stale. The other slot of a
   * blue/green deploy can still be importing, which is why there is a time limit at all.
   */
  staleImportMs: 15 * 60_000,
};

/** What the command sends at a time: `blocks` blocks of `blockBytes`, so 64 MiB. */
export const PART_BLOCK_BYTES = MiB;
export const PART_BLOCKS = 64;

export type UploadState = 'waiting' | 'receiving' | 'importing' | 'done' | 'failed';
export type UploadMode = 'new' | 'version';

export interface UploadResult {
  videoId: string;
  version: number;
  reviewUrl: string;
}

export interface UploadRecord {
  uploadId: string;
  /** sha256 of the secret, hex. */
  secretHash: string;
  /** The name it is given in the inbox (a clash there adds -2, -3: see `inboxFile`). */
  filename: string;
  mode: UploadMode;
  title?: string;
  videoId?: string;
  /** The email of whoever made it, "service token", or null when admin auth is off. */
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  state: UploadState;
  receivedBytes: number;
  importStartedAt?: string;
  /** Where the film was put in the inbox, once the parts were joined. */
  inboxFile?: string;
  error?: string;
  result?: UploadResult;
}

export const UPLOAD_ID_RE = /^[a-z0-9]{16}$/;
const TOKEN_RE = /^([a-z0-9]{16})\.([A-Za-z0-9_-]{43})$/;
const PART_NAME_RE = /^\d{1,3}$/;
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function uploadsDir(): string {
  return join(config().dataDir, 'uploads');
}

function uploadDir(uploadId: string): string {
  if (!UPLOAD_ID_RE.test(uploadId)) throw new Error('Invalid upload id.');
  return join(uploadsDir(), uploadId);
}

const recordPath = (uploadId: string) => join(uploadDir(uploadId), 'upload.json');
const partsDir = (uploadId: string) => join(uploadDir(uploadId), 'parts');

function isCode(err: unknown, ...codes: string[]): boolean {
  return codes.includes((err as NodeJS.ErrnoException | null)?.code ?? '');
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// One change to a record at a time, so two parts arriving together cannot lose a count.
const locks = new Map<string, Promise<unknown>>();

async function withUploadLock<T>(uploadId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(uploadId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => {});
  locks.set(uploadId, settled);
  try {
    return await next;
  } finally {
    if (locks.get(uploadId) === settled) locks.delete(uploadId);
  }
}

export async function getUpload(uploadId: string): Promise<UploadRecord | null> {
  if (!UPLOAD_ID_RE.test(uploadId)) return null;
  return readJson<UploadRecord>(recordPath(uploadId));
}

async function saveUpload(record: UploadRecord): Promise<void> {
  await writeJsonAtomic(recordPath(record.uploadId), record);
}

/**
 * Removes upload folders nobody has touched for a day: abandoned parts would fill the disk. An
 * expired upload is left alone until then, so a part that raced the clock is not lost. Also
 * removes half-joined films an import left in the inbox when the server stopped part way. Run
 * when an upload is made, which is rare.
 */
async function sweep(now: number): Promise<void> {
  const old = async (path: string) => now - (await stat(path)).mtimeMs > uploadLimits.sweepAfterMs;
  for (const name of await readdirOrEmpty(uploadsDir())) {
    const dir = join(uploadsDir(), name);
    try {
      if (await old(dir)) await rm(dir, { recursive: true, force: true });
    } catch (err) {
      if (!isCode(err, 'ENOENT')) console.error('Could not sweep an old upload.', err);
    }
  }
  for (const name of await readdirOrEmpty(inboxDir())) {
    if (!/^\.upload-[a-z0-9]{16}\.tmp$/.test(name)) continue;
    const path = join(inboxDir(), name);
    try {
      if (await old(path)) await rm(path, { force: true });
    } catch (err) {
      if (!isCode(err, 'ENOENT')) console.error('Could not sweep a half-joined upload.', err);
    }
  }
}

async function readdirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (err) {
    if (isCode(err, 'ENOENT')) return [];
    throw err;
  }
}

function newUploadId(): string {
  let id = '';
  for (let i = 0; i < 16; i++) id += ID_ALPHABET[randomInt(ID_ALPHABET.length)];
  return id;
}

export interface NewUpload {
  filename: string;
  mode: UploadMode;
  title?: string;
  videoId?: string;
  createdBy: string | null;
}

/** Makes an upload record. The token (`<uploadId>.<secret>`) is only ever returned here. */
export async function createUpload(
  req: NewUpload,
  now = Date.now()
): Promise<{ record: UploadRecord; token: string }> {
  await sweep(now);
  const uploadId = newUploadId();
  const secret = randomBytes(32).toString('base64url');
  const record: UploadRecord = {
    uploadId,
    secretHash: sha256(secret),
    filename: req.filename,
    mode: req.mode,
    ...(req.title !== undefined ? { title: req.title } : {}),
    ...(req.videoId !== undefined ? { videoId: req.videoId } : {}),
    createdBy: req.createdBy,
    createdAt: new Date(now).toISOString(),
    expiresAt: expiryAt(now, now),
    state: 'waiting',
    receivedBytes: 0,
  };
  await mkdir(partsDir(uploadId), { recursive: true });
  await saveUpload(record);
  return { record, token: `${uploadId}.${secret}` };
}

export type Opened =
  | { status: 'ok'; record: UploadRecord }
  | { status: 'not-found' }
  | { status: 'expired'; record: UploadRecord };

export const isExpired = (record: UploadRecord, now = Date.now()) =>
  now > Date.parse(record.expiresAt);

/** When a link made at `createdAt` expires if it was last used at `now`: the sliding expiry. */
function expiryAt(createdAt: number, now: number): string {
  return new Date(
    Math.min(now + uploadLimits.ttlMs, createdAt + uploadLimits.maxLifetimeMs)
  ).toISOString();
}

/** The upload a token names. A wrong secret and an unknown id look the same to the caller. */
export async function openUpload(token: string, now = Date.now()): Promise<Opened> {
  const m = TOKEN_RE.exec(token);
  if (!m) return { status: 'not-found' };
  let record: UploadRecord | null;
  try {
    record = await getUpload(m[1]);
  } catch {
    return { status: 'not-found' };
  }
  if (record === null) return { status: 'not-found' };
  const given = Buffer.from(sha256(m[2]), 'hex');
  const stored = Buffer.from(record.secretHash, 'hex');
  if (given.length !== stored.length || !timingSafeEqual(given, stored)) {
    return { status: 'not-found' };
  }
  // A link expires only while it is waiting for parts. An import that runs past the expiry
  // still finishes, and a finished upload keeps answering with its result.
  const open = record.state === 'waiting' || record.state === 'receiving';
  if (open && isExpired(record, now)) return { status: 'expired', record };
  return { status: 'ok', record };
}

/** The parts on disk, by number, with their sizes. Half-written `.tmp` files are not parts. */
async function listParts(uploadId: string): Promise<{ n: number; size: number }[]> {
  let names: string[];
  try {
    names = await readdir(partsDir(uploadId));
  } catch (err) {
    if (isCode(err, 'ENOENT')) return [];
    throw err;
  }
  const parts: { n: number; size: number }[] = [];
  for (const name of names.filter((n) => PART_NAME_RE.test(n))) {
    try {
      parts.push({ n: Number(name), size: (await stat(join(partsDir(uploadId), name))).size });
    } catch (err) {
      if (!isCode(err, 'ENOENT')) throw err;
    }
  }
  return parts.sort((a, b) => a.n - b.n);
}

const total = (parts: { size: number }[]) => parts.reduce((sum, p) => sum + p.size, 0);

/** The imports this process is running, so one that is merely slow is never called stale. */
const importsRunning = new Set<string>();

/** Word for word what to call to import a film the upload left in the inbox. */
export function importFromInboxCall(record: UploadRecord, inboxFile: string): string {
  const target =
    record.mode === 'new'
      ? `mode "new" and title ${JSON.stringify(record.title ?? '')}`
      : `mode "version" and videoId "${record.videoId ?? ''}"`;
  return `call import_from_inbox with filename ${JSON.stringify(inboxFile)}, ${target}`;
}

/**
 * An import that has been running for longer than any import takes, and not in this process, was
 * cut off, most likely by a deploy restarting the server. With the film already in the inbox it
 * is marked failed, naming the file to import. Cut off while the parts were being joined, the
 * parts are all still there: it is opened again so the same command finishes it.
 */
async function settleStaleImport(record: UploadRecord, now: number): Promise<UploadRecord> {
  if (record.state !== 'importing' || importsRunning.has(record.uploadId)) return record;
  const started = Date.parse(record.importStartedAt ?? record.createdAt);
  if (now - started < uploadLimits.staleImportMs) return record;
  return withUploadLock(record.uploadId, async () => {
    const current = (await getUpload(record.uploadId)) ?? record;
    if (current.state !== 'importing' || importsRunning.has(current.uploadId)) return current;
    const settled: UploadRecord = current.inboxFile
      ? {
          ...current,
          state: 'failed',
          error: `The import was cut off, probably by a server restart. The film is in the inbox as ${JSON.stringify(current.inboxFile)}: ${importFromInboxCall(current, current.inboxFile)}.`,
        }
      : {
          ...current,
          state: 'receiving',
          expiresAt: expiryAt(Date.parse(current.createdAt), now),
          error:
            'Joining the parts was cut off, probably by a server restart. Run the same command again: it skips the parts already sent and finishes.',
        };
    await saveUpload(settled);
    return settled;
  });
}

/** The record as get_upload shows it: an import cut off by a restart is reported as failed. */
export async function readUpload(uploadId: string, now = Date.now()): Promise<UploadRecord | null> {
  const record = await getUpload(uploadId);
  return record === null ? null : settleStaleImport(record, now);
}

// Free disk space, read at most every few seconds: parts arrive one after another.
const DISK_CHECK_EVERY_MS = 5000;
type DiskProbe = () => Promise<number>;
let diskProbe: DiskProbe | null = null;
let diskChecked: { at: number; root: string; free: number } | null = null;

async function freeDiskBytes(): Promise<number> {
  if (diskProbe) return diskProbe();
  const root = config().dataDir;
  const now = Date.now();
  if (diskChecked && diskChecked.root === root && now - diskChecked.at < DISK_CHECK_EVERY_MS) {
    return diskChecked.free;
  }
  let free = Number.POSITIVE_INFINITY;
  try {
    await mkdir(root, { recursive: true });
    const fs = await statfs(root);
    free = fs.bavail * fs.bsize;
  } catch {
    // If the space cannot be read, the write itself will say what is wrong.
  }
  diskChecked = { at: now, root, free };
  return free;
}

/** Replaces the free-space reading. Pass null to read the real disk again. */
export function setUploadDiskProbeForTests(probe: DiskProbe | null): void {
  diskProbe = probe;
  diskChecked = null;
}

// HTTP answers. The part route answers in plain text, which the command shows on stderr when a
// part is refused (curl --fail-with-body); the finish route answers in JSON, which the command
// prints for the agent to read.

const NO_STORE = { 'Cache-Control': 'no-store' };

function text(body: string, status = 200): Response {
  return new Response(`${body}\n`, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

function json(body: unknown, status = 200): Response {
  return new Response(`${JSON.stringify(body, null, 2)}\n`, {
    status,
    headers: { ...NO_STORE, 'Content-Type': 'application/json' },
  });
}

const NOT_FOUND = 'not found';
const EXPIRED =
  'This upload link has expired (a link lasts 2 hours after the last part arrived, and 24 hours at most). Call upload_film again for a new command.';

/**
 * The part each upload is receiving right now, with the bytes held for it. One part at a time per
 * upload: the room a part may fill is worked out from the parts already stored, so two arriving
 * together could each be given the last of the room and go over the total between them. The bytes
 * held by every upload's arriving part also count against the free disk, which is only read every
 * few seconds.
 */
const arriving = new Map<string, number>();

/**
 * True unless the disk has `needed` bytes free over the floor every write keeps, after what the
 * parts arriving for other uploads may still write.
 */
async function shortOfDisk(uploadId: string, needed: number): Promise<boolean> {
  let held = 0;
  for (const [id, bytes] of arriving) if (id !== uploadId) held += bytes;
  return (await freeDiskBytes()) - held < limits.minFreeDiskBytes + needed;
}

const SHORT_OF_DISK = 'The server is short of disk space. Try again later, or tell Tim.';

class TooLarge extends Error {}

/** Streams a request body to `path`, giving up past `maxBytes`. Returns the bytes written. */
async function streamTo(body: ReadableStream<Uint8Array>, path: string, maxBytes: number) {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) done(new TooLarge());
      else done(null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(body as unknown as WebReadableStream<Uint8Array>),
    counter,
    createWriteStream(path, { flags: 'wx' })
  );
  return bytes;
}

const filmTooLarge = () =>
  text(`The film is too large: the most it can be is ${uploadLimits.totalMaxBytes} bytes.`, 413);

/**
 * GET (and HEAD) /api/upload/<token>/part/<n>: the size of part n as stored, or 404. The command
 * asks before sending each part, so running it again after a failure skips what already arrived.
 * Read only, so it answers for an expired link too.
 */
export async function handlePartSize(token: string, nParam: string): Promise<Response> {
  const opened = await openUpload(token);
  if (opened.status === 'not-found' || !PART_NAME_RE.test(nParam)) return text(NOT_FOUND, 404);
  try {
    const { size } = await stat(join(partsDir(opened.record.uploadId), String(Number(nParam))));
    return text(String(size));
  } catch (err) {
    if (isCode(err, 'ENOENT', 'ENOTDIR')) return text(NOT_FOUND, 404);
    throw err;
  }
}

/** PUT /api/upload/<token>/part/<n>: one part of the film, the raw bytes as the body. */
export async function handlePart(token: string, nParam: string, req: Request): Promise<Response> {
  const opened = await openUpload(token);
  if (opened.status === 'not-found') return text(NOT_FOUND, 404);
  // The parts stay until the daily sweep: deleting them here would gain nothing and lose the
  // film if the clock and a slow uplink disagree by a moment.
  if (opened.status === 'expired') return text(EXPIRED, 410);
  const { record } = opened;
  if (record.state !== 'waiting' && record.state !== 'receiving') {
    return text(
      `This upload is ${record.state}: it takes no more parts. Call get_upload with uploadId "${record.uploadId}" for where it got to.`,
      409
    );
  }
  if (!PART_NAME_RE.test(nParam) || Number(nParam) >= uploadLimits.maxParts) {
    return text(`The part number must be 0 to ${uploadLimits.maxParts - 1}.`, 400);
  }
  const n = Number(nParam);
  // Checked and taken with no await between, so two requests cannot both get in.
  if (arriving.has(record.uploadId)) {
    return text(
      'Another part of this upload is still arriving: parts go one at a time. If the command is running twice, stop one; otherwise wait a moment and run it again.',
      409
    );
  }
  arriving.set(record.uploadId, uploadLimits.partMaxBytes);
  try {
    return await receivePart(record, n, req);
  } finally {
    arriving.delete(record.uploadId);
  }
}

async function receivePart(record: UploadRecord, n: number, req: Request): Promise<Response> {
  const others = total((await listParts(record.uploadId)).filter((p) => p.n !== n));
  // The most this part may be: what a part can be, and what is left of the total. It is held
  // against the total (no other part of this upload can arrive meanwhile) and the disk.
  const room = Math.min(uploadLimits.partMaxBytes, uploadLimits.totalMaxBytes - others);
  arriving.set(record.uploadId, Math.max(room, 0));
  const tooLarge = () =>
    room < uploadLimits.partMaxBytes
      ? filmTooLarge()
      : text(`A part can be at most ${uploadLimits.partMaxBytes} bytes.`, 413);
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (room <= 0 || declared > room) return tooLarge();
  // Room for the biggest part there can be, not just the floor: a part is written in full
  // before anything looks at the disk again.
  if (await shortOfDisk(record.uploadId, uploadLimits.partMaxBytes)) {
    return text(SHORT_OF_DISK, 507);
  }
  if (req.body === null) return text('The part is empty.', 400);

  const dir = partsDir(record.uploadId);
  await mkdir(dir, { recursive: true });
  // A name of its own, so a retry of the same part cannot write into this one.
  const tmp = join(dir, `${n}.${randomBytes(6).toString('hex')}.tmp`);
  let bytes: number;
  try {
    bytes = await streamTo(req.body, tmp, room);
  } catch (err) {
    await rm(tmp, { force: true });
    if (err instanceof TooLarge) return tooLarge();
    throw err;
  }
  if (bytes === 0) {
    await rm(tmp, { force: true });
    return text('The part is empty.', 400);
  }

  return withUploadLock(record.uploadId, async () => {
    const current = await getUpload(record.uploadId);
    if (current === null || (current.state !== 'waiting' && current.state !== 'receiving')) {
      await rm(tmp, { force: true });
      return text(`This upload is ${current?.state ?? 'gone'}: it takes no more parts.`, 409);
    }
    const dst = join(dir, String(n));
    // A part sent again (curl --retry, or the command run twice) replaces the earlier one.
    await rename(tmp, dst);
    // Checked again with the part in place, in case anything got past the room worked out
    // before it arrived: a film over the total is never left on disk.
    const stored = total(await listParts(record.uploadId));
    if (stored > uploadLimits.totalMaxBytes) {
      await rm(dst, { force: true });
      await saveUpload({ ...current, receivedBytes: stored - bytes });
      return filmTooLarge();
    }
    const now = Date.now();
    await saveUpload({
      ...current,
      state: 'receiving',
      receivedBytes: stored,
      // Progress keeps the link alive, up to its last day.
      expiresAt: expiryAt(Date.parse(current.createdAt), now),
    });
    return text(`ok ${bytes}`);
  });
}

/** `film.mp4`, else `film-2.mp4`, `film-3.mp4`: the first name not taken in the inbox. */
async function placeInInbox(tmp: string, filename: string): Promise<string> {
  const ext = extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  for (let i = 1; i <= 1000; i++) {
    const name = i === 1 ? filename : `${stem}-${i}${ext}`;
    const dst = join(inboxDir(), name);
    try {
      // A hard link never replaces what is there, so two uploads cannot take the same name.
      await link(tmp, dst);
      await unlink(tmp);
      return name;
    } catch (err) {
      if (isCode(err, 'EEXIST')) continue;
      if (!isCode(err, 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS')) throw err;
      // A file system without hard links: check, then rename.
      try {
        await lstat(dst);
        continue;
      } catch (e) {
        if (!isCode(e, 'ENOENT')) throw e;
      }
      await rename(tmp, dst);
      return name;
    }
  }
  throw new Error('No free name for the film in the inbox.');
}

/** A write can be short: the rest is written until none is left. */
async function writeAll(out: FileHandle, chunk: Buffer): Promise<void> {
  let offset = 0;
  while (offset < chunk.length) {
    const { bytesWritten } = await out.write(chunk, offset, chunk.length - offset, null);
    offset += bytesWritten;
  }
}

/** Joins the parts, in order, into a hidden file in the inbox, then gives it its name. */
async function joinParts(record: UploadRecord): Promise<string> {
  await mkdir(inboxDir(), { recursive: true });
  // Hidden (a leading dot), so the inbox listing and import_from_inbox never see a half file.
  const tmp = join(inboxDir(), `.upload-${record.uploadId}.tmp`);
  await rm(tmp, { force: true });
  try {
    const out = await open(tmp, 'wx');
    try {
      for (const part of await listParts(record.uploadId)) {
        const stream = createReadStream(join(partsDir(record.uploadId), String(part.n)));
        for await (const chunk of stream) await writeAll(out, chunk as Buffer);
      }
    } finally {
      await out.close();
    }
    return await placeInInbox(tmp, record.filename);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** What an agent does once a film is in. The same words wherever an import ends. */
export function nextAfterImport(videoId: string): string {
  return `Give the review link to Tim, not to reviewers. Call wait_for_feedback with videoId "${videoId}" and no cursor: it answers at once with a cursor; call it again with that cursor to wait for comments.`;
}

function doneBody(result: UploadResult) {
  return { ok: true, state: 'done', ...result, next: nextAfterImport(result.videoId) };
}

function failedBody(record: UploadRecord) {
  return {
    ok: false,
    state: 'failed',
    reason: record.error ?? 'The import failed.',
    ...(record.inboxFile ? { inboxFile: record.inboxFile } : {}),
    next: failedNext(record),
  };
}

/** What to do about a failed upload: import the film left in the inbox, or start again. */
export function failedNext(record: UploadRecord): string {
  if (!record.inboxFile) return 'Run upload_film again for a new command.';
  return `The film stays in the inbox as ${JSON.stringify(record.inboxFile)}. Fix what the reason says (nothing, if the import was cut off) and ${importFromInboxCall(record, record.inboxFile)}; or fix the file and run upload_film again.`;
}

/** How an upload that has finished, one way or the other, is answered. */
function finishedResponse(record: UploadRecord): Response {
  if (record.state === 'done' && record.result) return json(doneBody(record.result));
  return json(failedBody(record), 422);
}

/**
 * Joins the parts into the inbox and imports the film. Never throws: whatever happens ends up
 * in the record, which get_upload reads.
 */
async function runImport(record: UploadRecord): Promise<UploadRecord> {
  importsRunning.add(record.uploadId);
  try {
    return await importParts(record);
  } finally {
    importsRunning.delete(record.uploadId);
  }
}

async function importParts(record: UploadRecord): Promise<UploadRecord> {
  let inboxFile: string;
  try {
    inboxFile = await joinParts(record);
  } catch (err) {
    // The parts are still there: the command can be run again.
    console.error('Could not join the parts of an upload.', err);
    const reopened: UploadRecord = {
      ...record,
      state: 'receiving',
      error: `The parts could not be joined: ${(err as Error).message}. Run the command again.`,
    };
    await saveUpload(reopened).catch(() => {});
    return reopened;
  }
  let current: UploadRecord = { ...record, inboxFile };
  try {
    await saveUpload(current);
    await rm(partsDir(record.uploadId), { recursive: true, force: true });
    const imported = await importFromInbox(
      record.mode === 'new'
        ? { filename: inboxFile, mode: 'new', title: record.title ?? '' }
        : { filename: inboxFile, mode: 'version', videoId: record.videoId ?? '' }
    );
    if (!imported.ok) {
      current = { ...current, state: 'failed', error: imported.reason };
    } else {
      const video = await getVideo(imported.videoId);
      if (video === null) throw new Error('the imported video went missing');
      const reviewUrl = reviewUrlOf(video, config().publicBaseUrl);
      const { error: _error, ...rest } = current;
      current = {
        ...rest,
        state: 'done',
        result: { videoId: imported.videoId, version: imported.version, reviewUrl },
      };
    }
  } catch (err) {
    console.error('An upload import failed.', err);
    current = {
      ...current,
      state: 'failed',
      error: `The import failed: ${(err as Error).message}`,
    };
  }
  await saveUpload(current).catch((err) => console.error('Could not save an upload.', err));
  return current;
}

const BYTES_RE = /^\d{1,13}$/;

/** POST /api/upload/<token>/finish?bytes=N: checks the parts add up, then imports the film. */
export async function handleFinish(token: string, bytesParam: string | null): Promise<Response> {
  const now = Date.now();
  const opened = await openUpload(token, now);
  if (opened.status === 'not-found') return json({ ok: false, reason: NOT_FOUND }, 404);
  if (opened.status === 'expired') return json({ ok: false, reason: EXPIRED }, 410);
  const record = await settleStaleImport(opened.record, now);
  // Asked again once it is over: the same answer, so running the command twice is harmless.
  if (record.state === 'done' || record.state === 'failed') return finishedResponse(record);
  if (record.state === 'importing') return stillImporting(record, 409);

  if (bytesParam === null || !BYTES_RE.test(bytesParam)) {
    return json({ ok: false, reason: '"bytes" must be the size of the film in bytes.' }, 400);
  }
  const bytes = Number(bytesParam);
  if (bytes > uploadLimits.totalMaxBytes) {
    return json(
      {
        ok: false,
        reason: `The film is too large: the most it can be is ${uploadLimits.totalMaxBytes} bytes.`,
      },
      413
    );
  }

  const started = await withUploadLock(record.uploadId, async () => {
    const current = await getUpload(record.uploadId);
    if (current === null) return json({ ok: false, reason: NOT_FOUND }, 404);
    if (current.state === 'done' || current.state === 'failed') return finishedResponse(current);
    if (current.state === 'importing') return stillImporting(current, 409);

    const parts = await listParts(current.uploadId);
    const problem = checkParts(parts, bytes);
    if (problem) {
      // Left open: the command can be run again, and sends the parts that did not arrive.
      return json({ ok: false, reason: problem, next: 'Run the same command again.' }, 400);
    }
    // Joining writes a second copy of the film before the parts are removed.
    if (await shortOfDisk(current.uploadId, bytes)) {
      return json({ ok: false, reason: SHORT_OF_DISK }, 507);
    }
    const importing: UploadRecord = {
      ...current,
      state: 'importing',
      importStartedAt: new Date().toISOString(),
    };
    await saveUpload(importing);
    return importing;
  });
  if (started instanceof Response) return started;

  // The import goes on after this request has been answered, if it takes that long. A big film
  // can take minutes, and Cloudflare gives up on a response that has not started after 100 s.
  const importing = runImport(started);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = await Promise.race([
    importing,
    new Promise<null>((resolve) => {
      timer = setTimeout(() => resolve(null), uploadLimits.finishWaitMs);
    }),
  ]);
  clearTimeout(timer);
  if (waited === null) return stillImporting(started, 202);
  if (waited.state === 'receiving') {
    return json({ ok: false, reason: waited.error, next: 'Run the same command again.' }, 500);
  }
  return finishedResponse(waited);
}

function stillImporting(record: UploadRecord, status: number): Response {
  return json(
    {
      state: 'importing',
      uploadId: record.uploadId,
      next: `The film is still being imported (a large one takes a few minutes). Call get_upload with uploadId "${record.uploadId}" until it says done: it then gives the review link.`,
    },
    status
  );
}

/** Null when parts 0..k are all there and add up to `bytes`, otherwise what is wrong. */
function checkParts(parts: { n: number; size: number }[], bytes: number): string | null {
  if (parts.length === 0) {
    return 'No parts have arrived. Check the file is there and not empty, and run the command again.';
  }
  const missing = parts.findIndex((p, i) => p.n !== i);
  if (missing !== -1) {
    return `Part ${missing} is missing: a part did not arrive. Run the same command again.`;
  }
  const got = total(parts);
  if (got !== bytes) {
    return `The parts add up to ${got} bytes but the film is ${bytes} bytes: a part did not arrive whole, or the file changed. If the film is unchanged, run the same command again; if it changed, call upload_film again for a new command.`;
  }
  return null;
}
