// Turn the captured node tree into the Lottie scene files:
//   scene/<id>.json          the faithful port (camera null present, not moving)
//   scene/<id>-camera.json   the same scene with a slow camera ease added (100% to 106%), to show
//                            the camera parent working; the original scene has no camera move
// Usage: node proto/port.mjs [id]
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { emitLottie } from './emit.mjs';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'scene');
const id = process.argv[2] || 'g01-s01';
const scene = JSON.parse(fs.readFileSync(path.join(dir, `${id}.nodes.json`), 'utf8'));
const write = (name, opts) => {
  const { lottie, stats } = emitLottie(scene, opts);
  const text = JSON.stringify(lottie);
  fs.writeFileSync(path.join(dir, name), text);
  const br = zlib.brotliCompressSync(Buffer.from(text)).length;
  console.log(`${name}: ${text.length} bytes (${br} brotli), ${lottie.op} frames at ${lottie.fr} fps`, JSON.stringify(stats));
};
write(`${id}.json`, {});
write(`${id}-camera.json`, { camera: { from: 100, to: 106 } });
