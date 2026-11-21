import { randomBytes } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

function isCode(err: unknown, ...codes: string[]): boolean {
  return codes.includes((err as NodeJS.ErrnoException | null)?.code ?? '');
}

/**
 * Writes JSON so readers only ever see the old file or the complete new one:
 * a uniquely named tmp file in the same directory, fsync, then rename over the target.
 */
export async function writeJsonAtomic(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    const handle = await open(tmp, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify(data, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmp, path);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

/** Reads and parses a JSON file. Returns null if it does not exist; throws if it is corrupt. */
export async function readJson<T>(path: string): Promise<T | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch (err) {
    if (isCode(err, 'ENOENT', 'ENOTDIR')) return null;
    throw err;
  }
  return JSON.parse(text) as T;
}
