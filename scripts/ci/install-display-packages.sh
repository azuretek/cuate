#!/usr/bin/env bash
# install-display-packages.sh: install the display and runtime packages a headless
# Linux runner needs, with every network call bounded.
#
# The flake this answers, measured on run 36888349385 (2026-10-01): the Linux x64
# packaging leg's "Virtual display" step started at 15:59:40 and was cancelled at
# 16:44:24, forty-four minutes and forty-four seconds later, at the job's own
# forty-five minute timeout. Every other packaging leg finished inside eight
# minutes. An apt-get that meets a stalled mirror has no deadline of its own, so
# the job timeout becomes the deadline: a change with nothing wrong in it burns
# forty-five minutes of runner time and turns its own gate red. This script gives
# every network call its own deadline and a retry, so the same stall fails the
# step in minutes and says why.
#
# Two things keep it quick and repeatable. First, a package the runner image
# already provides is never fetched: the image is the cache for the common case,
# and the log names what it supplied. Second, only the update is retried, because
# a mirror that drops one connection is the flaky case, and repeating a partial
# install tells us nothing new.
#
# Usage: install-display-packages.sh PACKAGE...
set -eo pipefail

UPDATE_TIMEOUT="${APT_UPDATE_TIMEOUT:-120}"
INSTALL_TIMEOUT="${APT_INSTALL_TIMEOUT:-300}"
UPDATE_ATTEMPTS="${APT_UPDATE_ATTEMPTS:-3}"
APT_NET_OPTS=(
  -o Acquire::Retries=3
  -o Acquire::http::Timeout=30
  -o Acquire::https::Timeout=30
)

if [ "$#" -eq 0 ]; then
  echo "::error::no packages named; nothing to install"
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive

# Ask dpkg first. On a runner image that already carries these, the common case
# becomes no network step at all, and the log states what was reused.
present=()
missing=()
for pkg in "$@"; do
  if dpkg-query -W -f='${Status}' "$pkg" 2>/dev/null | grep -q '^install ok installed$'; then
    present+=("$pkg")
  else
    missing+=("$pkg")
  fi
done

if [ "${#present[@]}" -gt 0 ]; then
  echo "provided by the runner image, not fetched: ${present[*]}"
fi

if [ "${#missing[@]}" -eq 0 ]; then
  echo "every package is already installed; no network step needed"
  exit 0
fi

echo "fetched from the mirror: ${missing[*]}"

# The update meets the network first, so it is the step retried: a mirror that
# fails one attempt is the flaky case, and each attempt carries its own deadline.
updated=0
for attempt in $(seq 1 "$UPDATE_ATTEMPTS"); do
  echo "apt-get update, attempt ${attempt}/${UPDATE_ATTEMPTS}, bounded to ${UPDATE_TIMEOUT}s"
  if timeout "$UPDATE_TIMEOUT" sudo apt-get update -qq "${APT_NET_OPTS[@]}"; then
    updated=1
    break
  fi
  echo "::warning::apt-get update did not finish inside ${UPDATE_TIMEOUT}s (attempt ${attempt}/${UPDATE_ATTEMPTS})"
done

if [ "$updated" -ne 1 ]; then
  echo "::error::apt-get update did not succeed in ${UPDATE_ATTEMPTS} bounded attempts; a stalled mirror is not something to guess past"
  exit 1
fi

echo "apt-get install, bounded to ${INSTALL_TIMEOUT}s: ${missing[*]}"
timeout "$INSTALL_TIMEOUT" sudo apt-get install -y -qq "${APT_NET_OPTS[@]}" "${missing[@]}"

echo "installed: ${missing[*]}"
