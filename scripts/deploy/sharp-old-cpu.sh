#!/usr/bin/env bash
# Build sharp 0.33.5 from source against Debian trixie's libvips, for hosts whose CPU lacks SSE4
# (geriatrix: AMD Turion II). Prebuilt sharp needs x86-64-v2 and dies with SIGILL there, and the
# WebAssembly build needs Wasm SIMD, which that CPU cannot do either.
#
# The result is cached in ~/.cache/video-feedback/sharp-old-cpu/node_modules and reused.
# The host needs Debian's libvips at runtime: sudo apt-get install libvips42t64
#
# Usage: scripts/deploy/sharp-old-cpu.sh [--force]
set -euo pipefail
cache="$HOME/.cache/video-feedback/sharp-old-cpu"
if [[ -f "$cache/node_modules/sharp/src/build/Release/sharp-linux-x64.node" && "${1:-}" != "--force" ]]; then
  echo "sharp-old-cpu: cached in $cache"
  exit 0
fi
command -v docker >/dev/null || { echo "sharp-old-cpu: docker is needed to build sharp" >&2; exit 1; }
rm -rf "$cache"
mkdir -p "$cache"
cat > "$cache/build.sh" <<'IN'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends libvips-dev build-essential python3 pkg-config >/dev/null
cd /out && npm init -y >/dev/null
# node-addon-api 8 does not compile sharp 0.33 (std::string_view), so pin 7.
npm install --no-audit --no-fund node-addon-api@7 node-gyp@10 >/dev/null
npm install --no-audit --no-fund --build-from-source sharp@0.33.5
node -e "const s=require('sharp'); console.log('sharp-old-cpu: built', JSON.stringify(s.versions))"
chown -R "$HOST_UID:$HOST_GID" /out
IN
nice -n19 ionice -c2 -n7 docker run --rm --cpus 2 -e HOST_UID="$(id -u)" -e HOST_GID="$(id -g)" \
  -v "$cache:/out" node:24-trixie bash /out/build.sh
