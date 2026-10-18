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

rm -rf "$app" "$out/obj"
mkdir -p "$app/Contents/MacOS" "$out/obj"
for arch in arm64 x86_64; do
  xcrun swiftc -O -target "$arch-apple-macos13.0" -o "$out/obj/cuate-helper-$arch" "$here/Sources/main.swift"
done
lipo -create -output "$app/Contents/MacOS/cuate-helper" "$out/obj/cuate-helper-arm64" "$out/obj/cuate-helper-x86_64"
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
