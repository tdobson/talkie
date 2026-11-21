#!/usr/bin/env bash
# Deploy apps/video-feedback to geriatrix (https://video-feedback.tdobson.net).
#
# Builds here (geriatrix is too slow and too full to build), swaps in a sharp that runs on its old
# CPU, copies a new release next to the old ones, points /srv/video-feedback/current at it,
# restarts the service and smoke tests it. If the smoke test fails it switches back.
#
# Usage, from the repo root:
#   scripts/deploy/video-feedback.sh              build, then deploy
#   scripts/deploy/video-feedback.sh --no-build   deploy the build that is already there
#
# Host layout (/srv/video-feedback is a symlink to /srv/data/video-feedback; the root disk is full):
#   releases/<stamp>/   one standalone build each; the newest three are kept
#   current             symlink to the live release
#   data/               DATA_DIR: inbox, videos, sessions, comments (never touched here)
#   env                 secrets and settings (mode 600, never touched here except TALKIE_CHROMIUM_PATH)
#   ms-playwright/      Chromium for Talkie stills
# See docs/DEPLOY.md.
set -euo pipefail

HOST="${VF_HOST:-geriatrix}"
BASE=/srv/video-feedback
PUBLIC_URL="${VF_PUBLIC_URL:-https://video-feedback.tdobson.net}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
app="$root/apps/video-feedback"
low() { nice -n19 ionice -c2 -n7 "$@"; }
say() { printf '\n== %s\n' "$*"; }

if [[ "${1:-}" != "--no-build" ]]; then
  say "build"
  (cd "$root" && yarn vf build)
fi
[[ -f "$app/.next/standalone/apps/video-feedback/server.js" ]] || { echo "no build found" >&2; exit 1; }

say "stage"
stage="$(mktemp -d /tmp/vf-release.XXXXXX)"
trap 'rm -rf "$stage"' EXIT
low rsync -a --exclude playwright-report --exclude test-results --exclude e2e \
  "$app/.next/standalone/" "$stage/"
low rsync -a "$app/.next/static/" "$stage/apps/video-feedback/.next/static/"
low rsync -a "$app/public/" "$stage/apps/video-feedback/public/"
cp "$app/deploy/video-feedback.service" "$stage/video-feedback.service"

say "sharp for the old CPU"
"$root/scripts/deploy/sharp-old-cpu.sh"
sharp_cache="$HOME/.cache/video-feedback/sharp-old-cpu/node_modules"
rm -rf "$stage/node_modules/sharp" "$stage/node_modules/@img"/sharp-*
low rsync -a --exclude obj.target --exclude .deps "$sharp_cache/sharp/" "$stage/node_modules/sharp/"
for dep in color color-convert color-name color-string simple-swizzle is-arrayish detect-libc semver; do
  [[ -d "$stage/node_modules/$dep" ]] || low rsync -a "$sharp_cache/$dep/" "$stage/node_modules/$dep/"
done

say "Chromium for Talkie stills"
shell_rev="$(node -e "const b=require('$root/node_modules/playwright-core/browsers.json').browsers.find(b=>b.name==='chromium-headless-shell');console.log(b.revision)")"
shell_dir="chromium_headless_shell-$shell_rev"
chromium_bin="$BASE/ms-playwright/$shell_dir/chrome-headless-shell-linux64/chrome-headless-shell"
if ! ssh "$HOST" "test -x $chromium_bin"; then
  local_shell="$HOME/.cache/ms-playwright/$shell_dir"
  [[ -d "$local_shell" ]] || (cd "$root" && low yarn vf playwright-core install chromium-headless-shell)
  low rsync -a --bwlimit=30000 "$local_shell" "$HOST:$BASE/ms-playwright/"
fi
ssh "$HOST" "grep -q '^TALKIE_CHROMIUM_PATH=' $BASE/env \
  && sed -i 's#^TALKIE_CHROMIUM_PATH=.*#TALKIE_CHROMIUM_PATH=$chromium_bin#' $BASE/env \
  || echo 'TALKIE_CHROMIUM_PATH=$chromium_bin' >> $BASE/env"

say "upload"
stamp="$(date -u +%Y%m%d-%H%M%S)"
prev="$(ssh "$HOST" "readlink $BASE/current || true")"
ssh "$HOST" "mkdir -p $BASE/releases"
link_dest=()
[[ -n "$prev" ]] && link_dest=(--link-dest="$prev")
low rsync -a --delete "${link_dest[@]}" "$stage/" "$HOST:$BASE/releases/$stamp/"

say "check sharp loads on the host"
ssh "$HOST" "cd $BASE/releases/$stamp/apps/video-feedback && /usr/local/bin/node -e \"require('sharp')({create:{width:8,height:8,channels:3,background:'red'}}).png().toBuffer().then(b=>console.log('sharp ok',b.length))\""

say "switch"
ssh "$HOST" "set -e
  sudo cp /etc/systemd/system/video-feedback.service $BASE/video-feedback.service.prev 2>/dev/null || true
  ln -sfn $BASE/releases/$stamp $BASE/current.new && mv -T $BASE/current.new $BASE/current
  if ! cmp -s $BASE/current/video-feedback.service /etc/systemd/system/video-feedback.service; then
    sudo cp $BASE/current/video-feedback.service /etc/systemd/system/video-feedback.service
    sudo systemctl daemon-reload
  fi
  sudo systemctl restart video-feedback"

say "smoke test"
ok=1
for _ in $(seq 1 30); do
  code="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3000/" || true)"
  [[ "$code" == 200 ]] && { ok=0; break; }
  sleep 2
done
if [[ $ok -eq 0 ]]; then
  code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/")"
  admin="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/admin")"
  echo "public / -> $code, /admin without a login -> $admin (expect 200 and 302)"
  [[ "$code" == 200 && "$admin" == 302 ]] || ok=1
fi

if [[ $ok -ne 0 ]]; then
  say "smoke test FAILED, switching back to $prev"
  ssh "$HOST" "journalctl -u video-feedback -n 30 --no-pager || true"
  ssh "$HOST" "set -e
    if [ -n '$prev' ]; then ln -sfn '$prev' $BASE/current.new && mv -T $BASE/current.new $BASE/current; fi
    if [ -f $BASE/video-feedback.service.prev ]; then
      sudo cp $BASE/video-feedback.service.prev /etc/systemd/system/video-feedback.service
      sudo systemctl daemon-reload
    fi
    sudo systemctl restart video-feedback"
  exit 1
fi

say "tidy: keep the newest three releases"
ssh "$HOST" "cd $BASE/releases && ls -1 | sort | head -n -3 | xargs -r rm -rf"
echo "deployed $stamp to $HOST ($PUBLIC_URL)"
