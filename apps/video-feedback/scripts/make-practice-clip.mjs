#!/usr/bin/env node
// Makes public/practice/clip.mp4: the short clip a new reviewer practises on, so the practice
// never uses the film they are about to review. A house with solar panels, the sun, drifting
// clouds and a bird, 12 seconds that loop without a jump, no sound.
//
// Every frame is worked out from its number alone, so the same script gives the same clip.
// It renders video: run it on a render machine (xebit-dev1, xebit-dev3 or asterix), not on
// tragicomix. Needs sharp next to it and ffmpeg on the path:
//
//   node make-practice-clip.mjs <out.mp4>

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';

const W = 1280;
const H = 720;
const FPS = 25;
const SECONDS = 12;
const FRAMES = FPS * SECONDS;

const out = process.argv[2];
if (!out) {
  console.error('usage: node make-practice-clip.mjs <out.mp4>');
  process.exit(1);
}

/** A cloud: three circles on a flat base. */
function cloud(x, y, s) {
  return `<g transform="translate(${x.toFixed(2)} ${y}) scale(${s})" fill="#ffffff" opacity="0.92">
    <circle cx="0" cy="0" r="38"/><circle cx="44" cy="-18" r="48"/><circle cx="96" cy="0" r="36"/>
    <rect x="0" y="0" width="96" height="36" rx="18"/></g>`;
}

/** A bird: two arcs whose tips go up and down as it flaps. */
function bird(x, y, flap) {
  const tip = (-14 * flap).toFixed(2);
  return `<path transform="translate(${x.toFixed(2)} ${y.toFixed(2)})" fill="none" stroke="#33415c"
    stroke-width="5" stroke-linecap="round" d="M -26 ${tip} Q -12 -4 0 6 Q 12 -4 26 ${tip}"/>`;
}

function frame(i) {
  // 0..1 through the loop: anything periodic in p loops without a jump.
  const p = i / FRAMES;
  const turn = 2 * Math.PI * p;
  const sunX = 1010 + 40 * Math.sin(turn);
  const sunY = 150 - 30 * Math.cos(turn);
  const span = W + 400;
  const cloudA = ((p * span + 200) % span) - 250;
  const cloudB = ((p * span + 1000) % span) - 250;
  const birdX = -60 + p * (W + 120);
  const birdY = 230 + 25 * Math.sin(turn * 2);
  const flap = Math.sin(2 * Math.PI * (i / 10));
  // The panels catch the light as the sun moves.
  const shine = (0.25 + 0.2 * Math.sin(turn)).toFixed(3);

  const panels = [];
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < 4; c++) {
      const x = 470 + c * 62 + r * 22;
      const y = 395 + r * 44;
      panels.push(
        `<polygon points="${x},${y} ${x + 56},${y} ${x + 46},${y + 38} ${x - 10},${y + 38}" fill="#1d3557" stroke="#a8dadc" stroke-width="2"/>`,
        `<polygon points="${x + 4},${y + 3} ${x + 30},${y + 3} ${x + 24},${y + 18} ${x - 2},${y + 18}" fill="#ffffff" opacity="${shine}"/>`
      );
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7ec8f2"/><stop offset="1" stop-color="#d9f1fb"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0" stop-color="#fff3b0" stop-opacity="0.9"/>
      <stop offset="1" stop-color="#fff3b0" stop-opacity="0"/></radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <circle cx="${sunX.toFixed(2)}" cy="${sunY.toFixed(2)}" r="130" fill="url(#glow)"/>
  <circle cx="${sunX.toFixed(2)}" cy="${sunY.toFixed(2)}" r="62" fill="#ffd166"/>
  ${cloud(cloudA, 120, 1)}
  ${cloud(cloudB, 210, 0.7)}
  <path d="M 0 560 Q 320 500 640 545 T ${W} 530 L ${W} ${H} L 0 ${H} Z" fill="#8cc084"/>
  <path d="M 0 610 Q 400 570 800 605 T ${W} 600 L ${W} ${H} L 0 ${H} Z" fill="#6aa86a"/>
  <rect x="420" y="470" width="420" height="190" fill="#f4e3c1" stroke="#8d6e4a" stroke-width="4"/>
  <polygon points="400,475 520,350 760,350 860,475" fill="#b5523b" stroke="#7a3426" stroke-width="4"/>
  ${panels.join('\n  ')}
  <rect x="595" y="560" width="70" height="100" fill="#7a4f2e"/>
  <rect x="460" y="510" width="80" height="70" fill="#bde0fe" stroke="#8d6e4a" stroke-width="4"/>
  <rect x="720" y="510" width="80" height="70" fill="#bde0fe" stroke="#8d6e4a" stroke-width="4"/>
  ${bird(birdX, birdY, flap)}
  <rect x="32" y="28" width="250" height="54" rx="27" fill="#000000" opacity="0.55"/>
  <text x="157" y="64" text-anchor="middle" font-family="DejaVu Sans, Arial, sans-serif"
    font-size="26" font-weight="700" fill="#ffffff">Practice clip</text>
</svg>`;
}

const dir = mkdtempSync(join(tmpdir(), 'practice-clip-'));
try {
  for (let i = 0; i < FRAMES; i++) {
    const png = await sharp(Buffer.from(frame(i)))
      .png()
      .toBuffer();
    writeFileSync(join(dir, `f${String(i).padStart(4, '0')}.png`), png);
  }
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-loglevel',
      'error',
      '-framerate',
      String(FPS),
      '-i',
      join(dir, 'f%04d.png'),
      '-c:v',
      'libx264',
      '-preset',
      'slow',
      '-tune',
      'animation',
      '-crf',
      '26',
      '-pix_fmt',
      'yuv420p',
      '-profile:v',
      'high',
      '-level',
      '4.0',
      // One thread and no timestamps from the clock: the same frames give the same file.
      '-threads',
      '1',
      '-x264-params',
      'threads=1',
      '-fflags',
      '+bitexact',
      '-map_metadata',
      '-1',
      '-movflags',
      '+faststart',
      '-an',
      out,
    ],
    { stdio: 'inherit' }
  );
  if (ff.status !== 0) process.exit(ff.status ?? 1);
  console.log(`wrote ${out}: ${FRAMES} frames, ${SECONDS}s`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
