#!/bin/bash
# Builds Cuate Helper.app into OUT (default: build/). Signs it when SIGN_IDENTITY is set,
# from SIGN_KEYCHAIN when that is set too.
# Usage: VERSION=0.0.1 BUILD=1 COMMIT=abc ./build.sh
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${OUT:-$here/build}"
version="${VERSION:-0.0.0}"
build="${BUILD:-0}"
commit="${COMMIT:-unknown}"
app="$out/Cuate Helper.app"

rm -rf "$app"
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"

echo "== swift build (universal)"
xcrun swift build -c release --package-path "$here" --arch arm64 --arch x86_64
binary="$(xcrun swift build -c release --package-path "$here" --arch arm64 --arch x86_64 --show-bin-path)/cuate-helper"
[ -x "$binary" ] || { echo "missing built binary at $binary"; exit 1; }
cp "$binary" "$app/Contents/MacOS/cuate-helper"
chmod 755 "$app/Contents/MacOS/cuate-helper"
lipo -info "$app/Contents/MacOS/cuate-helper"

sed -e "s/@VERSION@/$version/" -e "s/@BUILD@/$build/" -e "s/@COMMIT@/$commit/" "$here/Info.plist.in" > "$app/Contents/Info.plist"
plutil -lint "$app/Contents/Info.plist"

if [ -n "${SIGN_IDENTITY:-}" ]; then
  kc=()
  if [ -n "${SIGN_KEYCHAIN:-}" ]; then kc=(--keychain "$SIGN_KEYCHAIN"); fi
  codesign --force --timestamp --options runtime "${kc[@]}" \
    --entitlements "$here/helper.entitlements" \
    --sign "$SIGN_IDENTITY" "$app"
  codesign --display --verbose=2 "$app" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Runtime|Timestamp)'
else
  codesign --force --sign - --options runtime --entitlements "$here/helper.entitlements" "$app"
fi
echo "built: $app ($version, $build)"
