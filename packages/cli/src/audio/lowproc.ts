import { spawn } from 'node:child_process';

/** Run a command at nice 19 / ionice class 2 level 7; resolve stdout and stderr, reject on a non-zero exit. */
export function runLow(
  cmd: string,
  args: string[],
  opts: { input?: Uint8Array } = {}
): Promise<{ stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn('nice', ['-n', '19', 'ionice', '-c', '2', '-n', '7', cmd, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const out: Buffer[] = [];
    let err = '';
    p.stdout.on('data', (d: Buffer) => out.push(d));
    p.stderr.on('data', (d: Buffer) => {
      err += d.toString();
    });
    p.on('error', reject);
    // a command that exits without reading its input must not crash us with EPIPE
    p.stdin.on('error', () => {});
    p.on('close', (code) =>
      code === 0
        ? resolve({ stdout: Buffer.concat(out), stderr: err })
        : reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`))
    );
    if (opts.input) {
      p.stdin.end(opts.input);
    } else {
      p.stdin.end();
    }
  });
}
