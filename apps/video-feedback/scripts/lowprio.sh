#!/usr/bin/env bash
# Run a command at idle IO priority and lowest CPU priority.
set -euo pipefail
if command -v ionice >/dev/null 2>&1; then
  exec ionice -c2 -n7 nice -n19 "$@"
else
  exec nice -n19 "$@"
fi
