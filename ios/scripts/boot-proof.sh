#!/usr/bin/env bash
#
# Build output is assumed present (the workflow runs build-for-testing first):
# this installs the app into a simulator, launches it and captures a screenshot
# as the proof that the shell boots, not merely compiles.
#
# The resolved simulator's udid arrives in SIMULATOR_UDID.
#
# Issue 285: the UI tests that run after this judge the screen by its pixels, so the screen
# this script hands them must be OURS. The simulator can raise a system surface over the app
# (a permission alert, the home screen), and the XCTest screenshot request then times out
# before a test reads a pixel, failing a page that never failed. So every simulator call and
# every wait here is bounded and names what it waited for, the app's permissions are granted
# before any capture so a system alert is not raised, and the capture is retried until it is
# a real PNG rather than trusted once.

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

# How long any single simulator call may take. Generous for a loaded runner and far below the
# step budget, so one stuck call names itself instead of hanging the job. macOS ships no GNU
# timeout, so it is provided here when it is absent: the call runs in the background and a
# watchdog kills it at the deadline.
if ! command -v timeout >/dev/null 2>&1; then
  timeout() {
    local secs="$1"; shift
    "$@" & local pid=$!
    ( sleep "$secs"; kill -TERM "$pid" 2>/dev/null ) & local watch=$!
    local rc=0
    wait "$pid" || rc=$?
    kill "$watch" 2>/dev/null || true
    return "$rc"
  }
fi

SIM_TIMEOUT="${CUATE_SIM_TIMEOUT:-180}"

simctl_bounded() { timeout "$SIM_TIMEOUT" xcrun simctl "$@"; }

# wait_for <attempts> <seconds between> <description> <test command...>
#
# A state change ends the wait; the count is only the failsafe. An exhausted wait is a
# failure carrying the description, never a silent fall-through to the next step.
wait_for() {
  local attempts="$1"; shift
  local pause="$1"; shift
  local what="$1"; shift
  local i
  for i in $(seq 1 "$attempts"); do
    if "$@" >/dev/null 2>&1; then
      echo "   $what (after $((i * pause))s)"
      return 0
    fi
    sleep "$pause"
  done
  echo "error: $what never happened; waited $((attempts * pause))s" >&2
  return 1
}

# The workflow starts the boot before the build so the two overlap, and names
# that boot's log in SIMULATOR_BOOT_LOG. Booting an already booting device is
# refused, which is fine: bootstatus joins the boot under way and returns once
# it is done. Run on its own (no log named) this boots the device itself.
echo "== waiting for the simulator $SIM to finish booting"
simctl_bounded boot "$SIM" 2>/dev/null || true
if ! timeout 600 xcrun simctl bootstatus "$SIM" -b; then
  echo "error: no simulator finished booting within 600s" >&2
  exit 1
fi
phase "the rest of the boot"
if [ -n "${SIMULATOR_BOOT_LOG:-}" ] && [ -f "${SIMULATOR_BOOT_LOG%.log}.start" ]; then
  echo "== the boot took $(( $(date +%s) - $(cat "${SIMULATOR_BOOT_LOG%.log}.start") ))s from its start, overlapping the build"
fi
if [ -n "${SIMULATOR_BOOT_LOG:-}" ] && [ -f "$SIMULATOR_BOOT_LOG" ]; then
  echo "== the background boot's own log ($(grep -c 'Waiting on Data Migration' "$SIMULATOR_BOOT_LOG" || true) data migration polls):"
  grep -v 'Waiting on Data Migration' "$SIMULATOR_BOOT_LOG" | tail -20 || true
  cp "$SIMULATOR_BOOT_LOG" "$PROOF/simulator-boot.log" || true
fi

echo "== installing a fresh copy"
simctl_bounded uninstall "$SIM" "$BUNDLE_ID" 2>/dev/null || true
simctl_bounded install "$SIM" "$APP"
phase "the install"

# The screen the UI tests judge must be ours, so a system surface is kept off it before any
# capture: the app's permissions are granted here, so a fresh install is not greeted by a
# permission alert that then covers the page. The simulator has no read-back for the grant,
# so it is applied and a surface that still reaches the screen is named by the UI tests' own
# guard rather than trusted away.
echo "== clearing a system surface before any capture"
if ! simctl_bounded privacy "$SIM" grant all "$BUNDLE_ID"; then
  echo "warning: the simulator refused the permission grant; a system alert could still be raised" >&2
fi

echo "== launching the app"
simctl_bounded launch "$SIM" "$BUNDLE_ID" | tee "$PROOF/launch.txt"
phase "the launch"

# The web view loads core's page and paints it; give that a real chance before
# the capture, so the screenshot is of the app rather than of its launch screen.
sleep 12

# The capture waits for the screen to be capturable as a real PNG, so a surface that makes
# the simulator return nothing names itself here in one line rather than after a bare
# screenshot (issue 285). The wait ends on the state, the count only bounds it.
echo "== waiting for the screen to be capturable"
capturable() {
  timeout "$SIM_TIMEOUT" xcrun simctl io "$SIM" screenshot "$PROOF/.capture-probe.png" >/dev/null 2>&1 || return 1
  [ -s "$PROOF/.capture-probe.png" ] && file -b "$PROOF/.capture-probe.png" | grep -q '^PNG image data'
}
if ! wait_for 12 2 "the screen can be captured as a PNG" capturable; then
  echo "error: the simulator never returned a readable screen; a system surface may be covering it" >&2
  timeout "$SIM_TIMEOUT" xcrun simctl io "$SIM" screenshot "$PROOF/capture-failure.png" >/dev/null 2>&1 || true
  cat "$PROOF/launch.txt" >&2 || true
  exit 1
fi
rm -f "$PROOF/.capture-probe.png"

echo "== capturing"
captured=0
for attempt in 1 2 3 4 5; do
  : > "$PROOF/ios-boot.png"
  timeout "$SIM_TIMEOUT" xcrun simctl io "$SIM" screenshot "$PROOF/ios-boot.png" >/dev/null 2>"$PROOF/capture-$attempt.err" || true
  if [ -s "$PROOF/ios-boot.png" ] && file -b "$PROOF/ios-boot.png" | grep -q "^PNG image data"; then
    captured=1
    break
  fi
  echo "capture attempt $attempt produced no PNG ($(wc -c < "$PROOF/ios-boot.png" | tr -d ' ') bytes, $(head -c 120 "$PROOF/capture-$attempt.err" | tr -d '\n')); trying again"
  sleep 5
done
rm -f "$PROOF"/capture-*.err

if [ "$captured" != "1" ]; then
  echo "error: no PNG after 5 captures; the simulator returned nothing readable, so a system surface may be covering it" >&2
  exit 1
fi

ls -l "$PROOF"

# An empty capture is a failed boot, so the size is asserted rather than assumed.
test -s "$PROOF/ios-boot.png"
echo "boot proof captured at $PROOF/ios-boot.png"
