#!/bin/sh
# Build the spike narration: the scene's two voice lines placed at their original start times
# (1.2 s and 14.438 s, with the per-line gains from the voice manifest), padded to the scene
# length (27.24 s), then encoded as Opus in WebM, Opus in Ogg and AAC in MP4.
# Also builds the sync harness track: the same narration repeated REPEATS times.
# Every ffmpeg call runs at the lowest CPU and IO priority.
set -eu
cd "$(dirname "$0")"
VOICE="${VOICE:-$HOME/dev/md-roofkit-films-media/gse/voice/g01-s01}"
REPEATS="${REPEATS:-20}"
LOW="nice -n19 ionice -c2 -n7"
FF="$LOW ffmpeg -v error -y"
mkdir -p audio out

$FF -i "$VOICE/g01-s01-a.wav" -i "$VOICE/g01-s01-b.wav" -filter_complex \
  "[0:a]aresample=48000,volume=2.4dB,adelay=1200:all=1[a];[1:a]aresample=48000,volume=1.7dB,adelay=14438:all=1[b];[a][b]amix=inputs=2:normalize=0,apad=whole_dur=27.24,atrim=0:27.24[m]" \
  -map "[m]" -ac 1 -ar 48000 -c:a pcm_s16le out/narration.wav

: > out/concat.txt
i=0
while [ "$i" -lt "$REPEATS" ]; do echo "file 'narration.wav'" >> out/concat.txt; i=$((i + 1)); done
$FF -f concat -safe 0 -i out/concat.txt -c copy "out/narration-x$REPEATS.wav"

for pair in "out/narration.wav:n" "out/narration-x$REPEATS.wav:n-x$REPEATS"; do
  src="${pair%%:*}"; name="${pair##*:}"
  $FF -i "$src" -c:a libopus -b:a 32k -ac 1 "audio/$name.webm"
  $FF -i "$src" -c:a libopus -b:a 32k -ac 1 "audio/$name.ogg"
  $FF -i "$src" -c:a aac -b:a 64k -ac 1 -movflags +faststart "audio/$name.m4a"
done
ls -l audio
