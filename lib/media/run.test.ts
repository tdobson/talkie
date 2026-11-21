import { Readable } from 'node:stream';
import { limits } from '@/lib/limits';
import { lowPrioArgv, run, spawnLowPrio } from './run';

describe('run', () => {
  it('wraps commands in ionice and nice', () => {
    const [cmd, args] = lowPrioArgv('ffmpeg', ['-version']);
    expect([cmd, ...args].join(' ')).toMatch(
      /^(ionice -c2 -n7 nice -n19|nice -n19) ffmpeg -version$/
    );
  });

  it('captures stdout, stderr and the exit code', async () => {
    const r = await run('sh', ['-c', 'printf out; printf err >&2; exit 3']);
    expect(r.code).toBe(3);
    expect(r.stdout.toString()).toBe('out');
    expect(r.stderr).toBe('err');
  });

  it('really runs the child at nice 19', async () => {
    const r = await run('nice', []);
    expect(r.stdout.toString().trim()).toBe('19');
  });

  it('feeds a buffer or a stream to stdin', async () => {
    expect((await run('cat', [], { input: Buffer.from('hello') })).stdout.toString()).toBe('hello');
    const stream = Readable.from([Buffer.from('a'), Buffer.from('b')]);
    expect((await run('cat', [], { input: stream })).stdout.toString()).toBe('ab');
  });

  it('reports a non-zero code when the command does not exist', async () => {
    expect((await run('definitely-not-a-command-xyz', [])).code).not.toBe(0);
  });

  it('kills the child and rejects on timeout', async () => {
    await expect(run('sleep', ['5'], { timeoutMs: 100 })).rejects.toThrow(/timed out/);
  });

  it('spawns a low-priority child with pipes', async () => {
    const child = spawnLowPrio('cat', []);
    const chunks: Buffer[] = [];
    child.stdout?.on('data', (c: Buffer) => chunks.push(c));
    child.stdin?.end('piped');
    const code = await new Promise((resolve) => child.on('close', resolve));
    expect(code).toBe(0);
    expect(Buffer.concat(chunks).toString()).toBe('piped');
  });

  it('keeps only the end of a very long stderr, where the error is', async () => {
    const saved = limits.maxStderrBytes;
    limits.maxStderrBytes = 10;
    try {
      const r = await run('sh', ['-c', 'printf 0123456789abcdefghij >&2; exit 2']);
      expect(r.code).toBe(2);
      expect(r.stderr).toBe('abcdefghij');
    } finally {
      limits.maxStderrBytes = saved;
    }
  });

  it('kills a child that writes more to stdout than anything here should', async () => {
    const saved = limits.maxStdoutBytes;
    limits.maxStdoutBytes = 1024;
    try {
      await expect(run('sh', ['-c', 'yes | head -c 5000000; sleep 5'])).rejects.toThrow(
        /too much output/
      );
    } finally {
      limits.maxStdoutBytes = saved;
    }
  });
});
