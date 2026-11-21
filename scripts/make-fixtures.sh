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
# e2e-voice.wav is the fake microphone for Playwright. It has to be speech-like: real Chromium's
# audio processing flattens a steady sine to near-silence, so comments would be marked empty.
# The .v2 stamp forces a rebuild over the old sine fixture.
if [ ! -f e2e-voice.wav ] || [ ! -f e2e-voice.v2 ]; then
  if ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' flite '; then
    ff -f lavfi -i "flite=voice=slt:text='This bit here is not quite right. The title is too small and the colour looks wrong. Can we move this over to the left and make it bigger.'" \
      -ar 48000 -ac 1 e2e-voice-phrase.wav
    ff -stream_loop -1 -i e2e-voice-phrase.wav -af "volume=2.5,alimiter=limit=0.9" -t 60 -ar 48000 -ac 1 e2e-voice.wav
    rm -f e2e-voice-phrase.wav
  else
    # No libflite in this ffmpeg: fall back to loud band-limited noise in syllable-like bursts.
    ff -f lavfi -i "anoisesrc=color=pink:duration=60:amplitude=0.9:seed=7" \
      -af "highpass=f=200,lowpass=f=3400,tremolo=f=4:d=1,volume=3,alimiter=limit=0.9" -ar 48000 -ac 1 e2e-voice.wav
  fi
  touch e2e-voice.v2
fi
echo "fixtures ready in $OUT"
