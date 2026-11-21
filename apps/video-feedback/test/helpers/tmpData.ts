import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetConfigForTests } from '@/lib/config';

export async function withTmpData(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'vf-'));
  process.env.DATA_DIR = dir;
  resetConfigForTests();
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}
