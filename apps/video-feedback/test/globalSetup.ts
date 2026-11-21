import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Generates the media fixtures once per test run. The script skips files that already exist,
// and `yarn fixtures` runs it at low priority.
export default function setup(): void {
  const root = fileURLToPath(new URL('..', import.meta.url));
  execFileSync('yarn', ['fixtures'], { cwd: root, stdio: 'inherit' });
}
