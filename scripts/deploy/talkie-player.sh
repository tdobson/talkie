#!/usr/bin/env bash
# Deploy the Talkie drop player (sites/talkie-drop) to Cloudflare Pages: https://talkie.tdobson.net
#
# Usage, from the repo root:  scripts/deploy/talkie-player.sh [--no-build]
#
# Credentials: CLOUDFLARE_API_TOKEN (a token with Pages edit), or CLOUDFLARE_API_KEY plus
# CLOUDFLARE_EMAIL. If neither is set, the global key is read from ~/pw-cf for hello@tdobson.net.
set -euo pipefail
root="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$root"
export CLOUDFLARE_ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-347d70d0710dee549a35dab40e7d7ce7}"
if [[ -z "${CLOUDFLARE_API_TOKEN:-}" && -z "${CLOUDFLARE_API_KEY:-}" ]]; then
  [[ -r "$HOME/pw-cf" ]] || { echo "no Cloudflare credentials (see the header of this script)" >&2; exit 1; }
  CLOUDFLARE_API_KEY="$(tr -d '\n ' < "$HOME/pw-cf")"
  export CLOUDFLARE_API_KEY CLOUDFLARE_EMAIL="${CLOUDFLARE_EMAIL:-hello@tdobson.net}"
fi
if [[ "${1:-}" != "--no-build" ]]; then
  yarn build     # the player bundle
  yarn sample    # the sample film (fake voice, no network)
fi
sites/talkie-drop/build.sh
scripts/low wrangler pages deploy sites/talkie-drop/dist --project-name talkie-player --branch main --commit-dirty=true
code="$(curl -s -o /dev/null -w '%{http_code}' https://talkie.tdobson.net/)"
echo "https://talkie.tdobson.net/ -> $code"
[[ "$code" == 200 ]]
