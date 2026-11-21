import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import yazl from 'yazl';

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');

/** The fixture film as a folder, and the same film packed. See scripts/make-talkie-fixture.ts. */
export const TALKIE_MINI_DIR = join(fixtures, 'talkie-mini');
export const TALKIE_MINI_LOTTIE = join(fixtures, 'talkie-mini.lottie');

/** Every file under `dir`, as forward-slash paths relative to it, sorted. */
export async function listFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((e) => e.isFile())
    .map((e) => relative(dir, join(e.parentPath, e.name)).split('\\').join('/'))
    .sort();
}

/** The fixture film's files, path to bytes. */
export async function talkieMiniFiles(): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  for (const path of await listFiles(TALKIE_MINI_DIR)) {
    files[path] = await readFile(join(TALKIE_MINI_DIR, path));
  }
  return files;
}

/** The fixture's talkie.json with some fields replaced, as file bytes. */
export async function talkieJsonWith(patch: Record<string, unknown>): Promise<Buffer> {
  const film = JSON.parse(await readFile(join(TALKIE_MINI_DIR, 'talkie.json'), 'utf8'));
  return Buffer.from(JSON.stringify({ ...film, ...patch }));
}

/** Zips a file map, in the order given. A path that ends in `/` becomes a directory entry. */
export function zipOf(files: Record<string, Buffer>): Promise<Buffer> {
  const zip = new yazl.ZipFile();
  for (const [path, bytes] of Object.entries(files)) {
    if (path.endsWith('/')) zip.addEmptyDirectory(path);
    else zip.addBuffer(bytes, path);
  }
  zip.end();
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    zip.outputStream.on('data', (part: Buffer) => parts.push(part));
    zip.outputStream.on('end', () => resolve(Buffer.concat(parts)));
    zip.outputStream.on('error', reject);
  });
}
