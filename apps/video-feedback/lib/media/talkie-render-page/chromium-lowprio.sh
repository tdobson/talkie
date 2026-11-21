#!/bin/sh
# Starts Chromium for Talkie stills at the lowest CPU and IO priority. playwright-core is given
# this file as its browser, with the real one in TALKIE_CHROMIUM_BIN. Each step execs the next,
# so the process playwright-core started is Chromium itself: its pipes, its signals and its
# process group all stay as playwright-core expects.
if [ -z "$TALKIE_CHROMIUM_BIN" ]; then
  echo "chromium-lowprio.sh: TALKIE_CHROMIUM_BIN is not set" >&2
  exit 127
fi
if command -v ionice >/dev/null 2>&1; then
  exec ionice -c2 -n7 nice -n19 "$TALKIE_CHROMIUM_BIN" "$@"
fi
exec nice -n19 "$TALKIE_CHROMIUM_BIN" "$@"
