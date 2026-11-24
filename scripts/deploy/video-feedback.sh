#!/usr/bin/env bash
# Deploy apps/video-feedback to geriatrix (https://video-feedback.tdobson.net).
#
# Builds here (geriatrix is too slow and too full to build), swaps in a sharp that runs on its old
# CPU and copies a new release next to the old ones. Then, with no downtime (blue/green):
#
#   1. The release starts on the idle slot (video-feedback@3001 or @3002) beside the live one.
#   2. It is checked on its own port. If it is not healthy it is stopped: the live site was
#      never touched.
#   3. The old slot is stopped. The proxy on port 3000 (video-feedback-proxy, a Caddy of its own;
#      the Cloudflare tunnel points at it) always lists both slots and sends traffic to the one
#      that is up, retrying a request the stopping slot cannot take, so nothing is dropped. Its
#      config never changes and it is never reloaded (this Caddy 2.6.2 panics on a reload).
#   4. The public site is checked. If that fails the old slot is started again and the new one
#      stopped.
#   5. The new slot takes over comment processing once the old one has stopped (only one server
#      processes at a time: lib/pipeline/leader.ts).
#
# Usage, from the repo root:
#   scripts/deploy/video-feedback.sh              build, then deploy
#   scripts/deploy/video-feedback.sh --no-build   deploy the build that is already there
#   scripts/deploy/video-feedback.sh --rollback   go back to the release the other slot holds
#   VF_DEPLOY_WAIT=0 scripts/deploy/...           do not wait for the processing queue
#
# Before the switch it waits (up to VF_DEPLOY_WAIT seconds, 900 by default) until no comment is
# being processed and no clip is waiting. A stopped server leaves such work pending anyway, and
# the new one carries on with it, so the wait only avoids redoing a step.
#
# Host layout (/srv/video-feedback is a symlink to /srv/data/video-feedback; the root disk is full):
#   releases/<stamp>/   one standalone build each; the newest three are kept
#   current             symlink to the live release (what the host's CLI tools run)
#   slot-3001, slot-3002  symlinks to the release each app slot runs
#   proxy/              the proxy's Caddyfile, admin socket and data
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

mode="${1:-}"
units=(video-feedback@.service video-feedback-proxy.service)

# The slot that is running, or nothing before the first blue/green deploy. If both are (a deploy
# was cut short), the one `current` points at.
live_slot() {
  ssh "$HOST" "a=; for p in 3001 3002; do systemctl is-active --quiet video-feedback@\$p && a=\"\$a \$p\"; done
    set -- \$a
    if [ \$# = 2 ]; then for p in 3001 3002; do [ \"\$(readlink $BASE/slot-\$p)\" = \"\$(readlink $BASE/current)\" ] && echo \$p && break; done
    else echo \$a; fi" || true
}
other_slot() { [[ "$1" == 3001 ]] && echo 3002 || echo 3001; }

# 0 once the app on this port answers / with 200 and the admin API with 401 (no Access token:
# the guard works), within 60 s.
healthy() {
  local port=$1 got
  for _ in $(seq 1 30); do
    got="$(ssh "$HOST" "curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/; echo -n ' '; curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:$port/api/admin/videos" || true)"
    [[ "$got" == "200 401" ]] && { echo "slot $port: / 200, admin API 401"; return 0; }
    sleep 2
  done
  echo "slot $port answered: $got (expect 200 401)"
  return 1
}

# 0 when the public site answers / with 200 and /admin with Access's 302.
public_ok() {
  local code admin
  for _ in $(seq 1 10); do
    code="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/")"
    admin="$(curl -s -o /dev/null -w '%{http_code}' "$PUBLIC_URL/admin")"
    echo "public / -> $code, /admin without a login -> $admin (expect 200 and 302)"
    [[ "$code" == 200 && "$admin" == 302 ]] && return 0
    sleep 2
  done
  return 1
}

# Hands traffic from slot $1 to slot $2, which is running and healthy: stop $1, and the proxy
# sends everything to $2 (a request $1 cannot take is retried there). Then the public check.
# If that fails, $1 (still on disk) is started again and $2 stopped.
hand_over() {
  local from=$1 to=$2
  say "stop the old slot $from: the proxy sends everything to $to"
  ssh "$HOST" "sudo systemctl stop video-feedback@$from"
  if ! public_ok; then
    say "public check FAILED: back to slot $from"
    ssh "$HOST" "sudo systemctl start video-feedback@$from"
    healthy "$from" || true
    ssh "$HOST" "journalctl -u video-feedback@$to -n 30 --no-pager || true; sudo systemctl stop video-feedback@$to"
    exit 1
  fi
  ssh "$HOST" "set -e
    sudo systemctl enable --quiet video-feedback@$to
    sudo systemctl disable --quiet video-feedback@$from
    ln -sfn \$(readlink $BASE/slot-$to) $BASE/current.new && mv -T $BASE/current.new $BASE/current"
}

if [[ "$mode" == "--rollback" ]]; then
  live="$(live_slot)"
  [[ -n "$live" ]] || { echo "no blue/green proxy yet: nothing to roll back to" >&2; exit 1; }
  back="$(other_slot "$live")"
  say "roll back: start slot $back ($(ssh "$HOST" "readlink $BASE/slot-$back"))"
  ssh "$HOST" "sudo systemctl start video-feedback@$back"
  healthy "$back" || { ssh "$HOST" "sudo systemctl stop video-feedback@$back"; echo "slot $back is not healthy: nothing changed" >&2; exit 1; }
  hand_over "$live" "$back"
  echo "rolled back to slot $back"
  exit 0
fi

if [[ "$mode" != "--no-build" ]]; then
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
for f in video-feedback@.service video-feedback-proxy.service Caddyfile; do cp "$app/deploy/$f" "$stage/$f"; done

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

say "wait for the processing queue to be empty"
wait_s="${VF_DEPLOY_WAIT:-900}"
busy() {
  ssh "$HOST" "cd $BASE/data/videos 2>/dev/null && find . -name status.json -path '*/comments/*' -print0 \
    | xargs -0 -r /usr/local/bin/node -e '
      let n = 0;
      for (const f of process.argv.slice(1)) {
        try {
          const s = JSON.parse(require(\"fs\").readFileSync(f, \"utf8\"));
          if (s.state === \"queued\" || s.state === \"processing\") n++;
          else if (s.state === \"done\" && s.steps && s.steps.stills === \"done\" && s.steps.clip === \"pending\") n++;
        } catch {}
      }
      console.log(n);' || echo unknown" \
    | awk '/^[0-9]+$/ { s += $1; seen = 1; next } { bad = 1 } END { print (bad || !seen) ? "unknown" : s }'
}
# Timed by the clock: each check itself can take a while on a busy server.
wait_from=$SECONDS
while :; do
  n="$(busy)"
  [[ "$n" == 0 ]] && { echo "queue empty"; break; }
  # A failed check counts as busy: never go ahead on a guess.
  waited=$(( SECONDS - wait_from ))
  if (( waited >= wait_s )); then
    echo "still $n comments or clips in the queue after ${waited}s: going ahead (they carry on after)"
    break
  fi
  echo "$n comments or clips still processing, waiting (${waited}s of ${wait_s}s)"
  sleep 15
done

say "install the units and the proxy config"
ssh "$HOST" "set -e
  mkdir -p $BASE/proxy/data $BASE/proxy/config
  changed=0
  for u in ${units[*]}; do
    if ! cmp -s $BASE/releases/$stamp/\$u /etc/systemd/system/\$u; then
      sudo cp $BASE/releases/$stamp/\$u /etc/systemd/system/\$u; changed=1
    fi
  done
  [ \$changed = 1 ] && sudo systemctl daemon-reload || true
  if ! cmp -s $BASE/releases/$stamp/Caddyfile $BASE/proxy/Caddyfile; then
    cp $BASE/releases/$stamp/Caddyfile $BASE/proxy/Caddyfile
    # A new proxy config means a restart (never a reload: this Caddy panics on one): a gap of
    # about a second, only when the Caddyfile itself changes.
    systemctl is-active --quiet video-feedback-proxy && sudo systemctl restart video-feedback-proxy || true
  fi
  rm -f $BASE/proxy/upstream.caddy"

live="$(live_slot)"
if [[ -z "$live" ]]; then
  # First blue/green deploy: the old single service owns port 3000. Bring the new release up on
  # 3001 first, then hand port 3000 from the old service to the proxy: a gap of a second or two,
  # once.
  say "first blue/green deploy: start slot 3001"
  ssh "$HOST" "ln -sfn $BASE/releases/$stamp $BASE/slot-3001 && sudo systemctl start video-feedback@3001"
  healthy 3001 || { ssh "$HOST" "journalctl -u video-feedback@3001 -n 30 --no-pager; sudo systemctl stop video-feedback@3001"; echo "slot 3001 is not healthy: nothing changed" >&2; exit 1; }
  say "hand port 3000 to the proxy"
  ssh "$HOST" "set -e
    sudo systemctl disable --quiet video-feedback 2>/dev/null || true
    sudo systemctl kill --signal=SIGKILL video-feedback 2>/dev/null || true
    sudo systemctl stop video-feedback 2>/dev/null || true
    sudo systemctl enable --quiet --now video-feedback-proxy
    sudo systemctl enable --quiet video-feedback@3001
    ln -sfn $BASE/releases/$stamp $BASE/current.new && mv -T $BASE/current.new $BASE/current"
  if ! public_ok; then
    say "public check FAILED after the first switch: back to the old service"
    ssh "$HOST" "sudo systemctl stop video-feedback-proxy video-feedback@3001; sudo systemctl disable --quiet video-feedback-proxy video-feedback@3001
      ln -sfn '$prev' $BASE/current.new && mv -T $BASE/current.new $BASE/current
      sudo systemctl enable --quiet --now video-feedback"
    exit 1
  fi
else
  next="$(other_slot "$live")"
  say "start the new release on slot $next (live is $live)"
  ssh "$HOST" "ln -sfn $BASE/releases/$stamp $BASE/slot-$next && sudo systemctl restart video-feedback@$next"
  if ! healthy "$next"; then
    say "slot $next is not healthy: stopping it. The live site was not touched."
    ssh "$HOST" "journalctl -u video-feedback@$next -n 30 --no-pager || true; sudo systemctl stop video-feedback@$next"
    exit 1
  fi
  hand_over "$live" "$next"
fi

say "tidy: keep the newest three releases, and any a slot still points at"
ssh "$HOST" "cd $BASE/releases && keep=\"\$(for l in $BASE/slot-3001 $BASE/slot-3002 $BASE/current; do basename \$(readlink \$l) 2>/dev/null; done)\"
  ls -1 | sort | head -n -3 | grep -v -x -F \"\$keep\" | xargs -r rm -rf"
echo "deployed $stamp to $HOST ($PUBLIC_URL), slot $(live_slot)"
