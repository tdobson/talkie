import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_BASE_URL, E2E_DATA_DIR } from '../playwright.config';
import { FIXTURES, ROOT, STATE_FILE, type E2EState } from './paths';

/** Runs `yarn import` against the E2E data directory and returns what it printed. */
export function cliImport(file: string, opts: { title: string } | { video: string }): string {
  const args = [
    'import',
    file,
    ...('title' in opts ? ['--title', opts.title] : ['--video', opts.video]),
  ];
  return execFileSync('yarn', args, {
    cwd: ROOT,
    env: { ...process.env, DATA_DIR: E2E_DATA_DIR, PUBLIC_BASE_URL: E2E_BASE_URL },
    encoding: 'utf8',
  });
}

/** Copies a fixture under a unique name, so the inbox never holds two files with one name. */
export function uniqueCopy(fixture: string, label: string): string {
  const dir = join(E2E_DATA_DIR, '..', 'video-feedback-e2e-src');
  mkdirSync(dir, { recursive: true });
  const dest = join(dir, `${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`);
  copyFileSync(join(FIXTURES, fixture), dest);
  return dest;
}

export function parseImport(out: string): { videoId: string; version: number; reviewUrl: string } {
  const imported = /Imported \S+ as (\S+), version (\d+)\./.exec(out);
  const url = /Review URL: (\S+)/.exec(out);
  if (!imported || !url) throw new Error(`Unexpected import output:\n${out}`);
  return { videoId: imported[1], version: Number(imported[2]), reviewUrl: url[1] };
}

export default function globalSetup(): void {
  execFileSync('yarn', ['fixtures'], { cwd: ROOT, stdio: 'inherit' });
  rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  mkdirSync(E2E_DATA_DIR, { recursive: true });

  const v1 = parseImport(cliImport(uniqueCopy('h264.mp4', 'e2e-film'), { title: 'E2E film' }));
  const v2 = parseImport(cliImport(uniqueCopy('h264.mp4', 'e2e-film'), { video: v1.videoId }));
  const state: E2EState = {
    dataDir: E2E_DATA_DIR,
    baseUrl: E2E_BASE_URL,
    videoId: v1.videoId,
    version: v2.version,
    reviewUrl: v1.reviewUrl,
    token: v1.reviewUrl.split('/r/')[1],
  };
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}
