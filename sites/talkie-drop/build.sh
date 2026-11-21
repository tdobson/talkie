#!/usr/bin/env bash
# Assemble the Talkie drop player into sites/talkie-drop/dist.
# Needs `yarn build` (the player) and `yarn sample` (the sample film) first.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$here/dist"

rm -rf "$out"
mkdir -p "$out"
cp "$here/src/index.html" "$here/src/app.js" "$here/src/_headers" "$out/"
cp "$root/packages/player/dist/talkie-player.js" "$out/"
cp "$root/node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm" "$out/"
cp "$root/examples/sample-film/dist/film.lottie" "$out/sample.lottie"
ls -la "$out"
