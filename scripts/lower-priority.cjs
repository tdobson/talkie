// Drops the process that loads this to the lowest CPU and IO priority, the same as scripts/low
// (nice 19, ionice best effort level 7). The test configs (Playwright, Vitest, Jest) call it, so a
// run started without scripts/low (a bare `npx playwright test`, say) still cannot hog the
// machine. Everything it then starts (browsers, the test server, ffmpeg, workers) inherits it.
// It only ever lowers priority, and does nothing where it cannot.
'use strict';
const { setPriority } = require('node:os');
const { spawnSync } = require('node:child_process');

function lowerPriority() {
  if (process.env.LOWER_PRIORITY_DONE === '1') return;
  process.env.LOWER_PRIORITY_DONE = '1';
  try {
    setPriority(0, 19);
  } catch {
    // Not allowed or not supported: carry on at the priority we have.
  }
  if (process.platform === 'linux') {
    spawnSync('ionice', ['-c2', '-n7', '-p', String(process.pid)], { stdio: 'ignore' });
  }
}

module.exports = { lowerPriority };
