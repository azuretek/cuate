#!/bin/bash
# Measures one installed build of the spike helper on a Mac. Run by an agent, never from Terminal
# (Terminal's own grants would be charged instead of the ones being measured).
# Usage: measure.sh <label> [helper.zip]
#   With a zip, installs it over ~/Applications/Cuate Helper.app first (the second-build test).
# Writes measure-<label>.txt and tcc-<label>.log into the spike's data folder.
set -uo pipefail
label="${1:?label}"
zip="${2:-}"
here="$(cd "$(dirname "$0")" && pwd)"
data="$HOME/.cuate-spike-479"
app="$HOME/Applications/Cuate Helper.app"
job="com.azuretek.cuate.spike479.helper"
domain="gui/$(id -u)"
mkdir -p "$data" && chmod 700 "$data"
mkdir -p "$data/run" && chmod 700 "$data/run"
exec > >(tee "$data/measure-$label.txt") 2>&1

wait_for() { # <seconds> <test...>: polls a state, bounded
  local until=$((SECONDS + $1)); shift
  until "$@"; do [ $SECONDS -ge $until ] && return 1; sleep 0.2; done
}
responsible() { sudo -n launchctl procinfo "$1" 2>&1 | grep -E '^responsible (pid|path) = '; }

start="$(date '+%Y-%m-%d %H:%M:%S')"
echo "== $label at $start"
if [ -n "$zip" ]; then
  launchctl bootout "$domain/$job" 2>/dev/null
  rm -rf "$app" && mkdir -p "$HOME/Applications" && ditto -x -k "$zip" "$HOME/Applications/"
  echo "installed $zip"
fi

echo "== verify"
codesign --verify --strict --deep --verbose=2 "$app"
spctl --assess --type execute --verbose=4 "$app"
xcrun stapler validate "$app"
codesign --display --verbose=2 "$app" 2>&1 | grep -E '^(Identifier|TeamIdentifier|CDHash)='
codesign --display --requirements - "$app" 2>&1 | grep designated
echo "version $(plutil -extract CFBundleShortVersionString raw "$app/Contents/Info.plist")"

echo "== launchd agent"
sed -e "s|@LABEL@|$job|" -e "s|@APP@|$app|" -e "s|@DATA@|$data|g" "$here/agent.plist.in" > "$data/agent.plist"
launchctl bootout "$domain/$job" 2>/dev/null
rm -f "$data/run/helper.sock"
launchctl bootstrap "$domain" "$data/agent.plist"
wait_for 10 test -S "$data/run/helper.sock" || echo "socket never appeared"
pid="$(launchctl print "$domain/$job" | awk '$1 == "pid" {print $3; exit}')"
launchctl print "$domain/$job" | grep -E '^\s+(program|pid|state) = '
echo "helper pid $pid"
responsible "$pid"
node "$here/client.mjs" "$data/run/helper.sock" hello
node "$here/client.mjs" "$data/run/helper.sock" chatdb.count

echo "== control: the same executable spawned by node"
rm -f "$data/run/control.sock" "$data/control.out"
HOLD_SECONDS=8 node "$here/control.mjs" "$app/Contents/MacOS/cuate-helper" "$data/run/control.sock" > "$data/control.out" 2>&1 &
control=$!
wait_for 10 grep -q '"count"' "$data/control.out" || echo "control never answered"
child="$(sed -n 's/.*"childPid":\([0-9]*\).*/\1/p' "$data/control.out")"
echo "control node pid $control, child pid $child"
responsible "$child"
cat "$data/control.out"
wait "$control"

echo "== TCC log since $start"
log show --start "$start" --style compact --predicate 'subsystem == "com.apple.TCC"' > "$data/tcc-$label.log" 2>&1
grep -E 'AUTHREQ_(ATTRIBUTION|RESULT)' "$data/tcc-$label.log" | grep -iE 'cuate|node|AllFiles' | head -40
echo "tcc lines: $(wc -l < "$data/tcc-$label.log")"

launchctl bootout "$domain/$job" 2>/dev/null && echo "agent stopped"
