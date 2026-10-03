#!/usr/bin/env bash
#
# Build output is assumed present (the workflow runs build-for-testing first):
# this installs the app into a simulator, launches it and captures a screenshot
# as the proof that the shell boots, not merely compiles.
#
# The resolved simulator's udid arrives in SIMULATOR_UDID.

set -euo pipefail

BUNDLE_ID="com.azuretek.cuate"
APP="build/Build/Products/Debug-iphonesimulator/Cuate.app"
PROOF="proof"
SIM="${SIMULATOR_UDID:-}"

if [ -z "$SIM" ]; then
  echo "error: SIMULATOR_UDID is not set" >&2
  exit 1
fi

if [ ! -d "$APP" ]; then
  echo "error: $APP is missing; the build did not produce it" >&2
  exit 1
fi

mkdir -p "$PROOF"

# Each phase says how long it took, so a slow run names its slow phase in the
# log rather than leaving one step's total to be guessed apart (issue 66).
phase_start=$SECONDS
phase() { echo "== $1 took $((SECONDS - phase_start))s"; phase_start=$SECONDS; }

# The workflow starts the boot before the build so the two overlap, and names
# that boot's log in SIMULATOR_BOOT_LOG. Booting an already booting device is
# refused, which is fine: bootstatus joins the boot under way and returns once
# it is done. Run on its own (no log named) this boots the device itself.
echo "== waiting for the simulator $SIM to finish booting"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b
phase "the rest of the boot"
if [ -n "${SIMULATOR_BOOT_LOG:-}" ] && [ -f "${SIMULATOR_BOOT_LOG%.log}.start" ]; then
  echo "== the boot took $(( $(date +%s) - $(cat "${SIMULATOR_BOOT_LOG%.log}.start") ))s from its start, overlapping the build"
fi
if [ -n "${SIMULATOR_BOOT_LOG:-}" ] && [ -f "$SIMULATOR_BOOT_LOG" ]; then
  echo "== the background boot's own log ($(grep -c 'Waiting on Data Migration' "$SIMULATOR_BOOT_LOG" || true) data migration polls):"
  grep -v 'Waiting on Data Migration' "$SIMULATOR_BOOT_LOG" | tail -20 || true
  cp "$SIMULATOR_BOOT_LOG" "$PROOF/simulator-boot.log" || true
fi

# A fresh install, so what boots is the build just made rather than a copy left
# by an earlier run.
echo "== installing a fresh copy"
xcrun simctl uninstall "$SIM" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$SIM" "$APP"
phase "the install"

echo "== launching the app"
xcrun simctl launch "$SIM" "$BUNDLE_ID" | tee "$PROOF/launch.txt"
phase "the launch"

# The web view loads core's page and paints it; give that a real chance before
# the capture, so the screenshot is of the app rather than of its launch screen.
sleep 12

echo "== capturing"
xcrun simctl io "$SIM" screenshot "$PROOF/ios-boot.png" >/dev/null
ls -l "$PROOF"

# An empty capture is a failed boot, so the size is asserted rather than assumed.
test -s "$PROOF/ios-boot.png"
echo "boot proof captured at $PROOF/ios-boot.png"
