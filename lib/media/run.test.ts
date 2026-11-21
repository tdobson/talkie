import { Readable } from 'node:stream';
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
});
