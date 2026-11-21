import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

// Every child process (ffmpeg, ffprobe, ...) runs at low priority: IO best-effort level 7
// and nice +19. ionice and nice both exec the next command, so the spawned pid is the real one.

export interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

let ioniceAvailable: boolean | undefined;

function hasIonice(): boolean {
  ioniceAvailable ??= (process.env.PATH ?? '')
    .split(delimiter)
    .some((dir) => dir !== '' && existsSync(join(dir, 'ionice')));
  return ioniceAvailable;
}

export function lowPrioArgv(cmd: string, args: string[]): [string, string[]] {
  return hasIonice()
    ? ['ionice', ['-c2', '-n7', 'nice', '-n19', cmd, ...args]]
    : ['nice', ['-n19', cmd, ...args]];
}

export function spawnLowPrio(cmd: string, args: string[]): ChildProcess {
  const [bin, argv] = lowPrioArgv(cmd, args);
  return spawn(bin, argv, { stdio: ['pipe', 'pipe', 'pipe'] });
}

/**
 * Runs a command to completion at low priority. Resolves with the exit code whatever it is
 * (callers decide what a failure means); rejects only if the process cannot be spawned or
 * the timeout passes.
 */
export async function run(
  cmd: string,
  args: string[],
  opts: { input?: Buffer | NodeJS.ReadableStream; timeoutMs?: number } = {}
): Promise<RunResult> {
  return new Promise<RunResult>((resolve, reject) => {
    const child = spawnLowPrio(cmd, args);
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    let timedOut = false;
    const timer =
      opts.timeoutMs === undefined
        ? undefined
        : setTimeout(() => {
            timedOut = true;
            child.kill('SIGKILL');
          }, opts.timeoutMs);

    child.stdout?.on('data', (c: Buffer) => out.push(c));
    child.stderr?.on('data', (c: Buffer) => err.push(c));
    // The child may exit before reading all of its input (EPIPE); the exit code tells the story.
    child.stdin?.on('error', () => {});
    child.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${cmd} timed out after ${opts.timeoutMs}ms`));
        return;
      }
      resolve({
        code: code ?? (signal ? 128 : 1),
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString('utf8'),
      });
    });

    const { input } = opts;
    if (input === undefined) child.stdin?.end();
    else if (Buffer.isBuffer(input)) child.stdin?.end(input);
    else if (child.stdin) {
      input.on('error', () => child.stdin?.destroy());
      input.pipe(child.stdin);
    }
  });
}

/** Last few lines of stderr, for error messages. */
export function stderrTail(stderr: string, lines = 5): string {
  return stderr.trim().split('\n').slice(-lines).join('\n');
}

/** Runs a command and throws if it exits non-zero. */
export async function runOk(
  cmd: string,
  args: string[],
  opts?: Parameters<typeof run>[2]
): Promise<RunResult> {
  const r = await run(cmd, args, opts);
  if (r.code !== 0) throw new Error(`${cmd} failed (exit ${r.code}): ${stderrTail(r.stderr)}`);
  return r;
}
