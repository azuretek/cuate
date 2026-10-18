#!/bin/bash
# Runs the capability, declaration, setup and menu model tests. No grants are
# changed and no prompt is shown, so this is safe headlessly.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
exec xcrun swift test --package-path "$here"
