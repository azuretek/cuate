#!/usr/bin/env bash
# state-cache.sh: say in the log whether a cache answered, and what the cached folder holds.
#
# Issue 66 asks for the cache hit to be STATED in the log rather than assumed. actions/cache reports a hit as
# its cache-hit output ("true" for the exact key, "false" for a restore from an older key, empty for a miss),
# which never reaches the log on its own, and a hit on a key says nothing about whether the folder holds what
# the build needs. So this names the outcome and counts the folder: run before the step that downloads and
# again after it, a miss that had to fetch shows as the difference, and a hit that still fetched does too.
#
# Usage: state-cache.sh LABEL CACHE_HIT DIRECTORY
set -eo pipefail

label="${1:?a label is required}"
hit="${2:-}"
dir="${3:?a directory is required}"

case "$hit" in
  true) outcome="hit (exact key)" ;;
  false) outcome="partial (restored from an older key)" ;;
  *) outcome="miss" ;;
esac

if [ -d "$dir" ]; then
  files=$(find "$dir" -type f | wc -l | tr -d ' ')
  kib=$(du -sk "$dir" | cut -f1)
  archives=$(find "$dir" -type f \( -name '*.zip' -o -name '*.7z' -o -name '*.tar.*' \) | wc -l | tr -d ' ')
else
  files=0; kib=0; archives=0
fi

echo "$label: $outcome; $files files, $archives archives, $kib KiB in the cached folder"
