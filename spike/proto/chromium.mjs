// Find an already installed Playwright chromium-headless-shell, so the spike never downloads a browser.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(os.homedir(), '.cache', 'ms-playwright');
  const dirs = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().reverse() : [];
  for (const d of dirs) {
    const sub = path.join(cache, d);
    for (const inner of fs.readdirSync(sub)) {
      for (const bin of ['chrome-headless-shell', 'headless_shell']) {
        const p = path.join(sub, inner, bin);
        if (fs.existsSync(p)) return p;
      }
    }
  }
  throw new Error('No chromium-headless-shell found under ' + cache + '. Set CHROMIUM_PATH.');
}
