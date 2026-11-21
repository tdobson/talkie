// Check 3 (size): the Talkie folder form against H.264 and H.265 video of the same material.
// The video files are encoded on asterix (see REPORT.md for the commands) into /tmp/talkie-spike;
// this script only reads their sizes over ssh, measures the local Talkie files, and does the sums.
// Pass: the Talkie folder form of the chapter is smaller than the H.265 export of the chapter.
// The chapter's Talkie figure is an ESTIMATE: only one scene of the chapter exists in Lottie.
// Usage: node sizes.mjs            (writes out/check3.json)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const SCENE_SECONDS = 27.24;
const size = (p) => fs.statSync(path.join(here, p)).size;
const r = (x, n = 1) => Math.round(x * 10 ** n) / 10 ** n;

// ---- Talkie, the scene
const raw = fs.readFileSync(path.join(here, 'scene/g01-s01.json'));
const brotli = zlib.brotliCompressSync(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 11, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } }).length;
const gzip = zlib.gzipSync(raw, { level: 9 }).length;
const scene = {
  seconds: SCENE_SECONDS,
  animationRaw: raw.length, animationBrotli: brotli, animationGzip: gzip,
  opusWebm: size('audio/n.webm'), opusOgg: size('audio/n.ogg'), aacM4a: size('audio/n.m4a'),
};
scene.talkieBrotliPlusOpusWebm = brotli + scene.opusWebm;   // what a browser that plays WebM Opus downloads
scene.talkieBrotliPlusAac = brotli + scene.aacM4a;          // what a browser on the AAC fallback downloads
scene.talkieGzipPlusOpusWebm = gzip + scene.opusWebm;       // a host that only does gzip

// ---- the video files on asterix
const remote = execFileSync('ssh', ['-o', 'BatchMode=yes', 'asterix', `
  cd /tmp/talkie-spike && for f in slice-h264 slice-h265 g01-h265; do
    echo "$f $(stat -c %s $f.mp4) $(ffprobe -v error -show_entries format=duration -of csv=p=0 $f.mp4) $(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,bit_rate -of csv=p=0 $f.mp4) $(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,bit_rate -of csv=p=0 $f.mp4)"
  done
  C=$HOME/dev/md-roofkit-films-media/gse/chapters/g01.mp4
  echo "g01-h264 $(stat -c %s $C) $(ffprobe -v error -show_entries format=duration -of csv=p=0 $C) $(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name,bit_rate -of csv=p=0 $C) $(ffprobe -v error -select_streams a:0 -show_entries stream=codec_name,bit_rate -of csv=p=0 $C)"
`], { encoding: 'utf8' });
const video = {};
for (const line of remote.trim().split('\n')) {
  const [name, bytes, seconds, v, a] = line.split(' ');
  video[name] = { bytes: +bytes, seconds: +seconds, video: v.split(',')[0], videoBitsPerSecond: +v.split(',')[1], audio: a.split(',')[0], audioBitsPerSecond: +a.split(',')[1] };
}

// ---- the chapter estimate: the scene's animation bytes per second, times the chapter length,
// plus Opus at 32 kbit/s for the chapter length (and the same with the measured WebM Opus rate)
const chapterSeconds = video['g01-h264'].seconds;
const animationBytesPerSecond = brotli / SCENE_SECONDS;
const chapter = {
  seconds: chapterSeconds,
  animationBytesPerSecond: r(animationBytesPerSecond),
  estimatedAnimationBrotli: Math.round(animationBytesPerSecond * chapterSeconds),
  opusAt32kbps: Math.round((32000 / 8) * chapterSeconds),
  opusAtMeasuredRate: Math.round((scene.opusWebm / SCENE_SECONDS) * chapterSeconds),
  aacAtMeasuredRate: Math.round((scene.aacM4a / SCENE_SECONDS) * chapterSeconds),
};
chapter.estimatedTalkie = chapter.estimatedAnimationBrotli + chapter.opusAt32kbps;
chapter.estimatedTalkieOnAacFallback = chapter.estimatedAnimationBrotli + chapter.aacAtMeasuredRate;
chapter.h264 = video['g01-h264'].bytes;
chapter.h265 = video['g01-h265'].bytes;
// how many times larger the animation could be per second before Talkie stopped winning
chapter.animationHeadroom = r((chapter.h265 - chapter.opusAt32kbps) / chapter.estimatedAnimationBrotli, 1);

const result = {
  scene, video, chapter,
  ratios: {
    sceneH265OverTalkie: r(video['slice-h265'].bytes / scene.talkieBrotliPlusOpusWebm, 2),
    sceneH264OverTalkie: r(video['slice-h264'].bytes / scene.talkieBrotliPlusOpusWebm, 2),
    chapterH265OverTalkieEstimate: r(chapter.h265 / chapter.estimatedTalkie, 2),
    chapterH264OverTalkieEstimate: r(chapter.h264 / chapter.estimatedTalkie, 2),
    chapterH265OverTalkieOnAacFallback: r(chapter.h265 / chapter.estimatedTalkieOnAacFallback, 2),
  },
  scenePass: scene.talkieBrotliPlusOpusWebm < video['slice-h265'].bytes,
  chapterPass: chapter.estimatedTalkie < chapter.h265,
};
result.pass = result.scenePass && result.chapterPass;
fs.writeFileSync(path.join(here, 'out', 'check3.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
console.log(result.pass ? 'check 3: PASS' : 'check 3: FAIL');
