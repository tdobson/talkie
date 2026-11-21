#!/usr/bin/env bash
set -euo pipefail
OUT="$(dirname "$0")/../test/fixtures/generated"; mkdir -p "$OUT"; cd "$OUT"
ff() { ffmpeg -hide_banner -loglevel error -y "$@"; }
[ -f h264.mp4 ] || ff -f lavfi -i testsrc2=size=640x360:rate=25:duration=4 -f lavfi -i sine=frequency=440:duration=4 \
  -c:v libx264 -pix_fmt yuv420p -g 25 -c:a aac -shortest h264.mp4
[ -f h264-nofaststart.mp4 ] || ff -i h264.mp4 -c copy -movflags -faststart h264-nofaststart.mp4
[ -f h264-10bit.mp4 ] || ff -f lavfi -i testsrc2=size=320x180:rate=25:duration=1 -c:v libx264 -pix_fmt yuv420p10le h264-10bit.mp4 || true
[ -f mpeg4.mp4 ] || ff -f lavfi -i testsrc2=size=320x180:rate=25:duration=1 -c:v mpeg4 mpeg4.mp4
[ -f speech-like.wav ] || ff -f lavfi -i "sine=frequency=300:duration=3" -af "volume=0.5" -ar 48000 -ac 1 speech-like.wav
[ -f silence.wav ] || ff -f lavfi -i anullsrc=r=48000:cl=mono -t 3 silence.wav
[ -f speech-like.webm ] || ff -i speech-like.wav -c:a libopus speech-like.webm
[ -f e2e-voice.wav ] || ff -f lavfi -i "sine=frequency=220:duration=60" -af "volume=0.6,apulsator=hz=1.5" -ar 48000 -ac 1 e2e-voice.wav
echo "fixtures ready in $OUT"
