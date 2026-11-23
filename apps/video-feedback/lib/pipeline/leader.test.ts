import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { config, resetConfigForTests } from '@/lib/config';
import { withTmpData } from '@/test/helpers/tmpData';
import { holderAlive, LOCK_NAME, releaseLock, tryTakeLock } from './leader';

let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ cleanup } = await withTmpData());
  resetConfigForTests();
});
afterEach(async () => {
  resetConfigForTests();
  await cleanup();
});

const lock = () => join(config().dataDir, LOCK_NAME);

it('the first server takes the lock; a second waits while the first is running', async () => {
  // Another server: a real process that is still running.
  const other = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  try {
    expect(await tryTakeLock(other.pid)).toBe(true);
    expect(await tryTakeLock()).toBe(false);
    // Asking again as the holder is fine.
    expect(await tryTakeLock(other.pid)).toBe(true);
  } finally {
    other.kill();
  }
  await new Promise((resolve) => other.once('exit', resolve));
  // The holder has gone: the lock is taken over.
  expect(await tryTakeLock()).toBe(true);
  expect(JSON.parse(await readFile(lock(), 'utf8')).pid).toBe(process.pid);
});

it('a pid reused by an unrelated process does not hold the lock', async () => {
  // This very process, but "started" at another time: as after a reboot.
  await writeFile(lock(), JSON.stringify({ pid: process.pid, start: '1' }));
  expect(holderAlive({ pid: process.pid, start: '1' })).toBe(false);
  expect(holderAlive({ pid: process.pid, start: null })).toBe(true);
  expect(await tryTakeLock(process.pid + 0)).toBe(true);
});

it('clears an unreadable lock file', async () => {
  await writeFile(lock(), 'not json');
  expect(await tryTakeLock()).toBe(true);
});

it('gives the lock back only if it holds it', async () => {
  await writeFile(lock(), JSON.stringify({ pid: 1, start: null }));
  await releaseLock();
  expect(JSON.parse(await readFile(lock(), 'utf8')).pid).toBe(1);
  await writeFile(lock(), JSON.stringify({ pid: process.pid, start: null }));
  await releaseLock();
  await expect(readFile(lock(), 'utf8')).rejects.toThrow();
});
