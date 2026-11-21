import { lstat, mkdir, readdir, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { remuxFaststart } from '@/lib/media/ops';
import { checkBrowserSafe, probe, probeContainer } from '@/lib/media/probe';
import { writeJsonAtomic } from '@/lib/storage/json';
import { ID_RE, inboxDir, sourcePath, versionDir, videoDir } from '@/lib/storage/paths';
import { createVideo, getVideo, saveVideo } from '@/lib/storage/repo';
import type { ImportRequest, ImportResult, InboxFile, ProbeInfo } from '@/lib/types';

const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov'];
const MAX_TITLE_LENGTH = 200;

const fail = (reason: string): ImportResult => ({ ok: false, reason });

function isCode(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === code;
}

function hasVideoExtension(filename: string): boolean {
  return VIDEO_EXTENSIONS.includes(extname(filename).toLowerCase());
}

/** A plain file name with a video extension: no path separators, no "..", not hidden. */
function isSafeInboxName(filename: unknown): filename is string {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    filename.length <= 255 &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('\0') &&
    !filename.includes('..') &&
    !filename.startsWith('.') &&
    hasVideoExtension(filename)
  );
}

/** Video files waiting in the inbox folder, newest first. */
export async function listInbox(): Promise<InboxFile[]> {
  let names: string[];
  try {
    names = await readdir(inboxDir());
  } catch (err) {
    if (isCode(err, 'ENOENT')) return [];
    throw err;
  }
  const files: InboxFile[] = [];
  for (const filename of names.filter(isSafeInboxName)) {
    try {
      const st = await lstat(join(inboxDir(), filename));
      if (!st.isFile()) continue;
      files.push({ filename, sizeBytes: st.size, modifiedAt: st.mtime.toISOString() });
    } catch (err) {
      // The file went away between the listing and the stat.
      if (!isCode(err, 'ENOENT')) throw err;
    }
  }
  return files.sort(
    (a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.filename.localeCompare(b.filename)
  );
}

// One import at a time per video, so two new versions cannot claim the same number.
const locks = new Map<string, Promise<unknown>>();

async function withVideoLock<T>(videoId: string, fn: () => Promise<T>): Promise<T> {
  const previous = locks.get(videoId) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  const settled = next.catch(() => {});
  locks.set(videoId, settled);
  try {
    return await next;
  } finally {
    if (locks.get(videoId) === settled) locks.delete(videoId);
  }
}

type Checked = { ok: true; src: string } | { ok: false; reason: string };

/** Checks that the inbox file exists and that a browser can play it. */
async function checkSource(filename: string): Promise<Checked> {
  const src = join(inboxDir(), filename);
  try {
    if (!(await lstat(src)).isFile()) return { ok: false, reason: 'That is not a regular file.' };
  } catch (err) {
    if (isCode(err, 'ENOENT')) return { ok: false, reason: 'That file is not in the inbox.' };
    throw err;
  }
  let info: ProbeInfo;
  let container: string;
  try {
    info = await probe(src);
    container = await probeContainer(src);
  } catch {
    return { ok: false, reason: 'The file could not be read as a video.' };
  }
  const safe = checkBrowserSafe(info, container);
  return safe.ok ? { ok: true, src } : { ok: false, reason: safe.reason };
}

/** Remuxes the inbox file in as the next version of the video. Call with the video lock held. */
async function addVersion(videoId: string, src: string, filename: string): Promise<ImportResult> {
  const video = await getVideo(videoId);
  if (video === null) return fail('Video not found.');
  const version = video.latestVersion + 1;
  const dir = versionDir(videoId, version);
  try {
    // Anything already here is left over from an import that died part way through.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    const dst = sourcePath(videoId, version);
    await remuxFaststart(src, dst);
    await writeJsonAtomic(join(dir, 'probe.json'), await probe(dst));
    await saveVideo({
      ...video,
      latestVersion: version,
      versions: [
        ...video.versions,
        { version, importedAt: new Date().toISOString(), originalFilename: filename },
      ],
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  // Only now, with the version fully in place, does the inbox copy go.
  await rm(src, { force: true });
  return { ok: true, videoId, version };
}

/**
 * Imports a file from the inbox as a new video or as the next version of an existing one.
 * On any failure the inbox file is left where it is.
 */
export async function importFromInbox(req: ImportRequest): Promise<ImportResult> {
  if (typeof req !== 'object' || req === null) return fail('Invalid import request.');
  if (req.mode !== 'new' && req.mode !== 'version') return fail('Invalid import request.');
  const { filename } = req;
  if (!isSafeInboxName(filename)) {
    return fail('Invalid filename. Use a plain .mp4, .m4v or .mov file name from the inbox.');
  }

  let title = '';
  if (req.mode === 'new') {
    title = typeof req.title === 'string' ? req.title.trim() : '';
    if (title === '') return fail('A title is needed for a new video.');
    if (title.length > MAX_TITLE_LENGTH) {
      return fail(`The title is too long. Keep it under ${MAX_TITLE_LENGTH} characters.`);
    }
  } else if (typeof req.videoId !== 'string' || !ID_RE.test(req.videoId)) {
    return fail('Video not found.');
  } else if ((await getVideo(req.videoId)) === null) {
    return fail('Video not found.');
  }

  try {
    const checked = await checkSource(filename);
    if (!checked.ok) return fail(checked.reason);

    if (req.mode === 'version') {
      const { videoId } = req;
      return await withVideoLock(videoId, () => addVersion(videoId, checked.src, filename));
    }

    const video = await createVideo(title);
    try {
      return await withVideoLock(video.videoId, () =>
        addVersion(video.videoId, checked.src, filename)
      );
    } catch (err) {
      // Do not leave a video with no versions behind.
      await rm(videoDir(video.videoId), { recursive: true, force: true });
      throw err;
    }
  } catch (err) {
    return fail(`The import failed: ${(err as Error).message}`);
  }
}
