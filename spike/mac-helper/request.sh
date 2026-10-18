#!/bin/bash
# Starts the helper under its launchd agent and asks for Contacts and Automation, so macOS shows
# its prompts. Run only while Abi is at the Mac to answer them. Leaves the agent running.
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
data="$HOME/.cuate-spike-479"
job="com.azuretek.cuate.spike479.helper"
domain="gui/$(id -u)"
app="$HOME/Applications/Cuate Helper.app"
mkdir -p "$data/run" && chmod 700 "$data" "$data/run"
sed -e "s|@LABEL@|$job|" -e "s|@APP@|$app|" -e "s|@DATA@|$data|g" "$here/agent.plist.in" > "$data/agent.plist"
launchctl bootout "$domain/$job" 2>/dev/null
rm -f "$data/run/helper.sock"
launchctl bootstrap "$domain" "$data/agent.plist"
until=$((SECONDS + 10))
until [ -S "$data/run/helper.sock" ]; do [ $SECONDS -ge $until ] && { echo "socket never appeared"; exit 1; }; sleep 0.2; done
TIMEOUT_MS=150000 node "$here/client.mjs" "$data/run/helper.sock" tcc.request
node "$here/client.mjs" "$data/run/helper.sock" tcc.preflight
