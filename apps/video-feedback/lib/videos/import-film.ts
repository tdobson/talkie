import { randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { type Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { dotLottieManifest, packFilm, type TalkieFilm } from '@talkie/format';
import yauzl from 'yauzl';
import { limits } from '@/lib/limits';
import { writeJsonAtomic } from '@/lib/storage/json';
import { stagingDir } from '@/lib/storage/paths';
import type { ProbeInfo } from '@/lib/types';
import { FILM_JSON, FilmRefused, invalidFilm, listedPaths, parseFilm } from './film';

export { FilmRefused } from './film';

/** A packed film may carry the dotLottie manifest. It is not part of the unpacked film. */
const MANIFEST = 'manifest.json';
/** talkie.json is read into memory before anything else is trusted, so it has its own small cap. */
const FILM_JSON_MAX_BYTES = 5 * 1024 * 1024;

const tooLarge = () => {
  const mb = Math.floor(limits.filmUnpackedBytes / (1024 * 1024));
  return new FilmRefused(`This film is too large: it unpacks to more than ${mb} MB.`);
};
const tooMany = () =>
  new FilmRefused(`This film has too many files: the limit is ${limits.filmEntries}.`);
const missing = (path: string) => new FilmRefused(`This film is missing a file: ${path}`);
const unreadable = (err: unknown) =>
  new FilmRefused(`This is not a readable .lottie file: ${(err as Error).message}`);

function isCode(err: unknown, ...codes: string[]): boolean {
  return codes.includes((err as NodeJS.ErrnoException | null)?.code ?? '');
}

/**
 * Refuses a film that lists one path both as a file and as the folder of another file (`a` and
 * `a/b.json`). No disk can hold both, so it is turned down by name before anything is written.
 */
function refuseFileUnderFile(listed: string[]): void {
  const files = new Set(listed);
  for (const path of listed) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i += 1) {
      const parent = parts.slice(0, i).join('/');
      if (files.has(parent)) {
        throw new FilmRefused(
          `This film lists ${parent} both as a file and as a folder (${path}).`
        );
      }
    }
  }
}

/** A directory entry, as ordinary zip tools add for each folder. It holds nothing to unpack. */
const isDirEntry = (entry: yauzl.Entry) =>
  entry.fileName.endsWith('/') && entry.uncompressedSize === 0;

const inFilm = (filmOut: string, path: string) => join(filmOut, ...path.split('/'));

/** Bytes still allowed for the film being unpacked. One budget is shared by all of its files. */
export interface Budget {
  left: number;
}

/**
 * Streams `src` into the new file `dst`, taking every chunk off the budget as it passes. The
 * moment the budget runs out the copy stops with `FilmRefused` and the source is destroyed, so
 * a zip that declares a small size and then inflates for ever is cut off at the limit.
 */
export async function copyCapped(src: Readable, dst: string, budget: Budget): Promise<void> {
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      budget.left -= chunk.length;
      if (budget.left < 0) done(tooLarge());
      else done(null, chunk);
    },
  });
  await mkdir(dirname(dst), { recursive: true });
  // 'wx': a film never writes the same file twice.
  await pipeline(src, meter, createWriteStream(dst, { flags: 'wx' }));
}

// Packed films

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    // autoClose is off because entries are read again, by name, after the listing.
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) =>
      err ? reject(err) : resolve(zip)
    );
  });
}

/**
 * The central directory, read one entry at a time and given up on as soon as it passes the
 * limit. yauzl itself refuses absolute names and names with `..` in them. One entry more than
 * the limit is let through here, for manifest.json.
 */
function readEntries(zip: yauzl.ZipFile): Promise<yauzl.Entry[]> {
  return new Promise((resolve, reject) => {
    const most = limits.filmEntries + 1;
    if (zip.entryCount > most) {
      reject(tooMany());
      return;
    }
    const entries: yauzl.Entry[] = [];
    zip.on('error', reject);
    zip.on('end', () => resolve(entries));
    zip.on('entry', (entry: yauzl.Entry) => {
      entries.push(entry);
      if (entries.length > most) reject(tooMany());
      else zip.readEntry();
    });
    zip.readEntry();
  });
}

function entryStream(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream)));
  });
}

async function readFilmJson(zip: yauzl.ZipFile, entry: yauzl.Entry): Promise<string> {
  const parts: Buffer[] = [];
  let total = 0;
  const stream = await entryStream(zip, entry);
  try {
    for await (const part of stream as AsyncIterable<Buffer>) {
      total += part.length;
      if (total > FILM_JSON_MAX_BYTES) throw invalidFilm(['talkie.json is too large']);
      parts.push(part);
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(parts).toString('utf8');
}

async function unpack(zip: yauzl.ZipFile, filmOut: string): Promise<TalkieFilm> {
  const entries = await readEntries(zip);

  const byName = new Map<string, yauzl.Entry>();
  for (const entry of entries) {
    if (byName.has(entry.fileName)) {
      throw new FilmRefused(`This film holds the same file twice: ${entry.fileName}`);
    }
    byName.set(entry.fileName, entry);
  }

  const filmEntry = byName.get(FILM_JSON);
  if (filmEntry === undefined) throw invalidFilm(['talkie.json is missing from the .lottie']);
  const film = parseFilm(await readFilmJson(zip, filmEntry));

  // Every entry is checked against the list before the first byte is written.
  const listed = listedPaths(film);
  if (listed.length > limits.filmEntries) throw tooMany();
  refuseFileUnderFile(listed);
  const allowed = new Set(listed);
  let declared = 0;
  for (const entry of entries) {
    // Skipped here, but already counted toward the entry limit by readEntries.
    if (isDirEntry(entry)) continue;
    if (entry.fileName === MANIFEST && !allowed.has(MANIFEST)) continue;
    if (!allowed.has(entry.fileName)) {
      throw new FilmRefused(
        `This film holds a file that its talkie.json does not list: ${entry.fileName}`
      );
    }
    declared += entry.uncompressedSize;
  }
  for (const path of listed) if (!byName.has(path)) throw missing(path);
  // A shortcut only: declared sizes are the zip's own claim. copyCapped counts the real bytes.
  if (declared > limits.filmUnpackedBytes) throw tooLarge();

  const budget: Budget = { left: limits.filmUnpackedBytes };
  for (const path of listed) {
    const stream = await entryStream(zip, byName.get(path) as yauzl.Entry);
    await copyCapped(stream, inFilm(filmOut, path), budget);
  }
  return film;
}

async function stagePacked(src: string, out: string): Promise<TalkieFilm> {
  let zip: yauzl.ZipFile;
  try {
    zip = await openZip(src);
  } catch (err) {
    if (isCode(err, 'ENOENT')) throw new FilmRefused('That file is not in the inbox.');
    throw unreadable(err);
  }
  let film: TalkieFilm;
  try {
    film = await unpack(zip, join(out, 'film'));
  } catch (err) {
    // An error with a code came from the file system. The rest are yauzl's, about the zip.
    if (err instanceof FilmRefused || (err as NodeJS.ErrnoException).code !== undefined) throw err;
    throw unreadable(err);
  } finally {
    zip.close();
  }
  await copyFile(src, join(out, 'film.lottie'));
  return film;
}

// Film folders

/**
 * The real location of a listed file inside the folder. A file that is missing, is not a regular
 * file, or is reached through a symbolic link is refused: a link could point anywhere on the disk.
 */
async function folderFile(rootReal: string, path: string): Promise<string> {
  const wanted = inFilm(rootReal, path);
  let real: string;
  try {
    real = await realpath(wanted);
  } catch (err) {
    if (isCode(err, 'ENOENT', 'ENOTDIR')) throw missing(path);
    throw err;
  }
  if (real !== wanted) {
    throw new FilmRefused(`This film has a link where a file should be: ${path}`);
  }
  if (!(await lstat(real)).isFile()) throw missing(path);
  return real;
}

async function stageFolder(src: string, out: string): Promise<TalkieFilm> {
  let rootReal: string;
  try {
    rootReal = await realpath(src);
  } catch (err) {
    if (isCode(err, 'ENOENT')) throw new FilmRefused('That folder is not in the inbox.');
    throw err;
  }

  const filmJson = await folderFile(rootReal, FILM_JSON);
  if ((await lstat(filmJson)).size > FILM_JSON_MAX_BYTES) {
    throw invalidFilm(['talkie.json is too large']);
  }
  const film = parseFilm(await readFile(filmJson, 'utf8'));

  const listed = listedPaths(film);
  if (listed.length > limits.filmEntries) throw tooMany();
  refuseFileUnderFile(listed);
  const sources = new Map<string, string>();
  for (const path of listed) sources.set(path, await folderFile(rootReal, path));

  const budget: Budget = { left: limits.filmUnpackedBytes };
  const filmOut = join(out, 'film');
  for (const [path, file] of sources) {
    await copyCapped(createReadStream(file), inFilm(filmOut, path), budget);
  }

  // Pack what was copied, not the inbox folder, so film.lottie and film/ cannot differ.
  const files: Record<string, Uint8Array> = {
    [MANIFEST]: Buffer.from(`${JSON.stringify(dotLottieManifest(film), null, 2)}\n`),
  };
  for (const path of listed) files[path] = await readFile(inFilm(filmOut, path));
  await writeFile(join(out, 'film.lottie'), packFilm(files), { flag: 'wx' });
  return film;
}

/** probe.json for a Talkie version: from talkie.json, with the frame rate of the first scene. */
async function probeFilm(film: TalkieFilm, filmOut: string): Promise<ProbeInfo> {
  const first = film.scenes[0];
  let fps: unknown;
  try {
    const scene: unknown = JSON.parse(await readFile(inFilm(filmOut, first.src), 'utf8'));
    fps = (scene as { fr?: unknown } | null)?.fr;
  } catch {
    throw invalidFilm([`scenes[0].src: ${first.src} is not valid JSON`]);
  }
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps <= 0) {
    throw invalidFilm([`scenes[0].src: ${first.src} has no frame rate (fr)`]);
  }
  return {
    width: film.size[0],
    height: film.size[1],
    fps,
    frameDuration: 1 / fps,
    duration: film.duration,
    codec: 'talkie',
    pixFmt: 'vector',
    hasAudio: film.audio.length > 0,
  };
}

export interface StagedFilm {
  /** A complete version directory: `film.lottie`, `film/` and `probe.json`. */
  dir: string;
  film: TalkieFilm;
}

/**
 * Checks a film from the inbox and builds its whole version directory in the staging area.
 * Nothing is written anywhere else, and on any failure the staging directory is removed, so a
 * refused film leaves nothing behind. Throws `FilmRefused` with the reason to show the admin.
 * The caller moves `dir` into place, or removes it.
 */
export async function stageFilm(src: string, form: 'packed' | 'folder'): Promise<StagedFilm> {
  const dir = join(stagingDir(), randomUUID());
  await mkdir(dir, { recursive: true });
  try {
    const film = form === 'packed' ? await stagePacked(src, dir) : await stageFolder(src, dir);
    await writeJsonAtomic(join(dir, 'probe.json'), await probeFilm(film, join(dir, 'film')));
    return { dir, film };
  } catch (err) {
    await rm(dir, { recursive: true, force: true });
    throw err;
  }
}
