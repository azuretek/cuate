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

echo "== booting the simulator $SIM"
xcrun simctl boot "$SIM" 2>/dev/null || true
xcrun simctl bootstatus "$SIM" -b

# A fresh install, so what boots is the build just made rather than a copy left
# by an earlier run.
echo "== installing a fresh copy"
xcrun simctl uninstall "$SIM" "$BUNDLE_ID" 2>/dev/null || true
xcrun simctl install "$SIM" "$APP"

echo "== launching the app"
xcrun simctl launch "$SIM" "$BUNDLE_ID" | tee "$PROOF/launch.txt"

# The web view loads core's page and paints it; give that a real chance before
# the capture, so the screenshot is of the app rather than of its launch screen.
sleep 12

echo "== capturing"
xcrun simctl io "$SIM" screenshot "$PROOF/ios-boot.png" >/dev/null
ls -l "$PROOF"

# An empty capture is a failed boot, so the size is asserted rather than assumed.
test -s "$PROOF/ios-boot.png"
echo "boot proof captured at $PROOF/ios-boot.png"
