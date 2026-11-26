import { lstat, mkdir, readdir, rename, rm } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { remuxFaststart } from '@/lib/media/ops';
import { checkBrowserSafe, probe, probeContainer } from '@/lib/media/probe';
import { writeJsonAtomic } from '@/lib/storage/json';
import { ID_RE, inboxDir, sourcePath, versionDir, videoDir } from '@/lib/storage/paths';
import { createVideo, getVideo, saveVideo } from '@/lib/storage/repo';
import type { ImportRequest, ImportResult, InboxFile, MediaKind, ProbeInfo } from '@/lib/types';
import { FILM_JSON, FilmRefused } from './film';
import { stageFilm } from './import-film';

const VIDEO_EXTENSIONS = ['.mp4', '.m4v', '.mov'];
const FILM_EXTENSION = '.lottie';
const MAX_TITLE_LENGTH = 200;
/** A film folder in the inbox is sized by walking it. The walk stops counting after this many files. */
const FOLDER_SIZE_MAX_FILES = 5000;

const fail = (reason: string): ImportResult => ({ ok: false, reason });

function isCode(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === code;
}

function hasVideoExtension(filename: string): boolean {
  return VIDEO_EXTENSIONS.includes(extname(filename).toLowerCase());
}

function isPackedFilm(filename: string): boolean {
  return extname(filename).toLowerCase() === FILM_EXTENSION;
}

/** A plain name for one entry of the inbox: no path separators, no "..", not hidden. */
function isSafeInboxName(filename: unknown): filename is string {
  return (
    typeof filename === 'string' &&
    filename.length > 0 &&
    filename.length <= 255 &&
    !filename.includes('/') &&
    !filename.includes('\\') &&
    !filename.includes('\0') &&
    !filename.includes('..') &&
    !filename.startsWith('.')
  );
}

/** What an inbox entry is, by what it is on disk: an MP4, a packed film, or a film folder. */
type InboxKind = 'mp4' | 'packed' | 'folder';

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch (err) {
    if (isCode(err, 'ENOENT') || isCode(err, 'ENOTDIR')) return false;
    throw err;
  }
}

type Classified = { ok: true; kind: InboxKind } | { ok: false; reason: string };

const INVALID_NAME =
  'Invalid filename. Use a plain .mp4, .m4v, .mov or .lottie file name, or a film folder, from the inbox.';

/**
 * Decides how an inbox entry is imported. A folder is a film if it holds a talkie.json, whatever
 * it is called. A file goes by its extension. Links and other special files are never followed.
 */
async function classify(filename: string): Promise<Classified> {
  const path = join(inboxDir(), filename);
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(path);
  } catch (err) {
    if (!isCode(err, 'ENOENT')) throw err;
    const known = hasVideoExtension(filename) || isPackedFilm(filename);
    return { ok: false, reason: known ? 'That file is not in the inbox.' : INVALID_NAME };
  }
  if (st.isDirectory()) {
    if (await isFile(join(path, FILM_JSON))) return { ok: true, kind: 'folder' };
    return { ok: false, reason: 'That folder is not a Talkie film: it has no talkie.json.' };
  }
  if (!hasVideoExtension(filename) && !isPackedFilm(filename)) {
    return { ok: false, reason: INVALID_NAME };
  }
  if (!st.isFile()) return { ok: false, reason: 'That is not a regular file.' };
  return { ok: true, kind: isPackedFilm(filename) ? 'packed' : 'mp4' };
}

/** Total size of the regular files under a film folder. */
async function folderSize(dir: string): Promise<number> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  let total = 0;
  for (const entry of entries.filter((e) => e.isFile()).slice(0, FOLDER_SIZE_MAX_FILES)) {
    try {
      total += (await lstat(join(entry.parentPath, entry.name))).size;
    } catch (err) {
      if (!isCode(err, 'ENOENT')) throw err;
    }
  }
  return total;
}

/**
 * What is waiting in the inbox folder, newest first: video files, packed films (`*.lottie`) and
 * film folders (any folder that holds a talkie.json).
 */
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
      const path = join(inboxDir(), filename);
      const st = await lstat(path);
      let sizeBytes: number;
      if (st.isFile() && (hasVideoExtension(filename) || isPackedFilm(filename))) {
        sizeBytes = st.size;
      } else if (st.isDirectory() && (await isFile(join(path, FILM_JSON)))) {
        sizeBytes = await folderSize(path);
      } else {
        continue;
      }
      files.push({ filename, sizeBytes, modifiedAt: st.mtime.toISOString() });
    } catch (err) {
      // The file went away between the listing and the stat.
      if (!isCode(err, 'ENOENT')) throw err;
    }
  }
  return files.sort(
    (a, b) => b.modifiedAt.localeCompare(a.modifiedAt) || a.filename.localeCompare(b.filename)
  );
}

// One import (or other change to video.json) at a time per video, so two new versions cannot
// claim the same number.
const locks = new Map<string, Promise<unknown>>();

export async function withVideoLock<T>(videoId: string, fn: () => Promise<T>): Promise<T> {
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

/** What goes into a new version's directory, and what kind of media that makes it. */
interface VersionSource {
  /** The inbox entry, removed once the version is in place. */
  src: string;
  filename: string;
  mediaKind: MediaKind;
  /** Fills the (empty, existing) version directory, `probe.json` included. */
  fill: (videoId: string, version: number, dir: string) => Promise<void>;
}

const mp4Source = (src: string, filename: string): VersionSource => ({
  src,
  filename,
  mediaKind: 'mp4',
  async fill(videoId, version, dir) {
    const dst = sourcePath(videoId, version);
    await remuxFaststart(src, dst);
    await writeJsonAtomic(join(dir, 'probe.json'), await probe(dst));
  },
});

/** A film that `stageFilm` has already checked and laid out: it only has to be moved in. */
const filmSource = (src: string, filename: string, staged: string): VersionSource => ({
  src,
  filename,
  mediaKind: 'talkie',
  async fill(_videoId, _version, dir) {
    // Staging is on the same disk, so this is one rename: the version appears whole or not at all.
    await rename(staged, dir);
  },
});

/** Adds the next version of the video from `source`. Call with the video lock held. */
async function addVersion(videoId: string, source: VersionSource): Promise<ImportResult> {
  const { src, filename } = source;
  const video = await getVideo(videoId);
  if (video === null) return fail('Video not found.');
  const version = video.latestVersion + 1;
  const dir = versionDir(videoId, version);
  try {
    // Anything already here is left over from an import that died part way through.
    await rm(dir, { recursive: true, force: true });
    await mkdir(dir, { recursive: true });
    await source.fill(videoId, version, dir);
    await saveVideo({
      ...video,
      latestVersion: version,
      versions: [
        ...video.versions,
        {
          version,
          importedAt: new Date().toISOString(),
          originalFilename: filename,
          // Left off MP4 versions, so their records read exactly as they did before Talkie.
          ...(source.mediaKind === 'talkie' ? { mediaKind: source.mediaKind } : {}),
        },
      ],
    });
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
  // Only now, with the version fully in place, does the inbox copy go.
  await rm(src, { recursive: true, force: true });
  return { ok: true, videoId, version };
}

/**
 * Imports a file or a film folder from the inbox as a new video or as the next version of an
 * existing one. The kind of media is decided by what was imported: an MP4, a packed Talkie film
 * (`.lottie`) or a Talkie film folder. On any failure the inbox entry is left where it is.
 */
export async function importFromInbox(req: ImportRequest): Promise<ImportResult> {
  if (typeof req !== 'object' || req === null) return fail('Invalid import request.');
  if (req.mode !== 'new' && req.mode !== 'version') return fail('Invalid import request.');
  const { filename } = req;
  if (!isSafeInboxName(filename)) return fail(INVALID_NAME);

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

  let staged: string | null = null;
  try {
    const classified = await classify(filename);
    if (!classified.ok) return fail(classified.reason);

    // Everything that can refuse the import runs before a video or a version is created.
    let source: VersionSource;
    if (classified.kind === 'mp4') {
      const checked = await checkSource(filename);
      if (!checked.ok) return fail(checked.reason);
      source = mp4Source(checked.src, filename);
    } else {
      const src = join(inboxDir(), filename);
      staged = (await stageFilm(src, classified.kind)).dir;
      source = filmSource(src, filename, staged);
    }

    if (req.mode === 'version') {
      const { videoId } = req;
      return await withVideoLock(videoId, () => addVersion(videoId, source));
    }

    const video = await createVideo(title);
    try {
      return await withVideoLock(video.videoId, () => addVersion(video.videoId, source));
    } catch (err) {
      // Do not leave a video with no versions behind.
      await rm(videoDir(video.videoId), { recursive: true, force: true });
      throw err;
    }
  } catch (err) {
    if (err instanceof FilmRefused) return fail(err.message);
    return fail(`The import failed: ${(err as Error).message}`);
  } finally {
    // Gone already if the film was moved into place. Otherwise this is what is left of it.
    if (staged !== null) await rm(staged, { recursive: true, force: true });
  }
}
