import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { gunzip } from 'node:zlib';
import { FILM_JSON } from './film';

// How a Talkie version's film is kept on disk. Scene animations are Lottie JSON, which shrinks
// about thirty times when compressed, and a long film with soft shadows (drawn as many flat
// copies) unpacks to well over 500 MB of it. So the scenes are stored gzipped, as `<path>.gz`,
// and sent to the browser gzipped with `Content-Encoding: gzip`. Everything else (talkie.json,
// audio, captions, posters) is stored as itself. Films imported before this have plain scene
// files, and still work: a plain file is always used first.

export const GZIP_SUFFIX = '.gz';

const runGunzip = promisify(gunzip);

/** True for the files that are stored gzipped: the film's .json files other than talkie.json. */
export function storedGzipped(path: string): boolean {
  return path.endsWith('.json') && path !== FILM_JSON;
}

/** Where a film file is kept, `path` being as talkie.json lists it. */
export const filmFilePath = (dir: string, path: string) => join(dir, ...path.split('/'));

export interface StoredFilmFile {
  /** The file on disk. */
  file: string;
  /** True when `file` is the gzipped form. */
  gzipped: boolean;
  /** Its size on disk. */
  size: number;
}

/** Size of a regular file (a symbolic link is not one), or null when there is none. */
async function regularSize(path: string): Promise<number | null> {
  try {
    const info = await lstat(path);
    return info.isFile() ? info.size : null;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw err;
  }
}

/** The stored form of the listed film file `path` in `dir`, or null when it is not there. */
export async function locateFilmFile(dir: string, path: string): Promise<StoredFilmFile | null> {
  const plain = filmFilePath(dir, path);
  const plainSize = await regularSize(plain);
  if (plainSize !== null) return { file: plain, gzipped: false, size: plainSize };
  if (!storedGzipped(path)) return null;
  const gzSize = await regularSize(plain + GZIP_SUFFIX);
  return gzSize === null ? null : { file: plain + GZIP_SUFFIX, gzipped: true, size: gzSize };
}

/** The bytes of a film file, unzipped if it is stored gzipped. Throws ENOENT when it is not there. */
export async function readFilmFile(dir: string, path: string): Promise<Buffer> {
  const stored = await locateFilmFile(dir, path);
  if (stored === null) {
    throw Object.assign(new Error(`No such film file: ${path}`), { code: 'ENOENT' });
  }
  const data = await readFile(stored.file);
  return stored.gzipped ? runGunzip(data) : data;
}

/** True when an Accept-Encoding header allows gzip (and does not turn it off with q=0). */
export function acceptsGzip(header: string | null | undefined): boolean {
  for (const part of (header ?? '').split(',')) {
    const [name, ...params] = part.trim().split(';');
    const coding = name.trim().toLowerCase();
    if (coding !== 'gzip' && coding !== '*') continue;
    const q = params.map((p) => p.trim()).find((p) => p.toLowerCase().startsWith('q='));
    return q === undefined || Number(q.slice(2)) > 0;
  }
  return false;
}
