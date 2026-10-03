#!/usr/bin/env bash
# TEMPORARY proof for issue #66, removed before merge. A process holds the freshly
# mounted DMG volume for 45 seconds, as mds does for a shorter time on every build.
#  A. dmgbuild called the way unpatched electron-builder calls it (no
#     --detach-retries, so five attempts, about twenty seconds): expected to fail
#     with "Resource busy", the error of job 110981345359.
#  B. the patched electron-builder's own DMG call under the same hold: expected
#     to wait the hold out and succeed.
set -u
HOLD="${1:-45}"
OUT="$RUNNER_TEMP/probe"; mkdir -p "$OUT/bundle"
case "$(uname -m)" in arm64) arch=arm64 eb=arm64 sum=793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb;; *) arch=x86_64 eb=x64 sum=1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433;; esac
url="https://github.com/electron-userland/electron-builder-binaries/releases/download/dmg-builder@1.2.5/dmgbuild-bundle-$arch-75c8a6c.tar.gz"
curl -fsSL --retry 3 --max-time 300 -o "$OUT/bundle.tgz" "$url" || exit 1
echo "$sum  $OUT/bundle.tgz" | shasum -a 256 -c - || exit 1
tar xzf "$OUT/bundle.tgz" -C "$OUT/bundle"
real="$OUT/bundle/dmgbuild"
cat > "$OUT/capture" <<EOF
#!/bin/bash
echo "dmgbuild called with: \$*" > "$OUT/args.log"
cp "\$2" "$OUT/settings.json"
for a in "\$@"; do last2="\$last1"; last1="\$a"; done
echo "\$last2" > "$OUT/volname"
exec "$real" "\$@"
EOF
chmod +x "$OUT/capture"
eb() { (cd desktop && pnpm exec electron-builder --config electron-builder.mjs --publish never --mac dmg "--$eb" --config.mac.identity=null --config.mac.notarize=false --config.dmg.sign=false "$@"); }
hold() {
  local end=$(( $(date +%s) + 600 )) v=""
  while [ -z "$v" ] && [ "$(date +%s)" -lt "$end" ]; do v="$(ls -d /Volumes/Cuate* 2>/dev/null | head -1)"; [ -n "$v" ] || sleep 0.2; done
  [ -n "$v" ] || { echo "no image volume appeared"; return 1; }
  echo "$(date +%T) holding $v for $HOLD s"; (cd "$v" && sleep "$HOLD"); echo "$(date +%T) released $v"
}
echo "capture: the patched electron-builder's dmgbuild call"
CUSTOM_DMGBUILD_PATH="$OUT/capture" eb > "$OUT/capture.log" 2>&1 && echo "capture ok" || { echo "capture FAILED"; tail -20 "$OUT/capture.log"; exit 1; }
cat "$OUT/args.log"
grep -q -- '--detach-retries 12' "$OUT/args.log" && echo "PATCH APPLIED: electron-builder passes --detach-retries 12" || echo "PATCH MISSING"
vol="$(cat "$OUT/volname")"
echo "A. unpatched call, volume held $HOLD s"
hold & h=$!
t0=$(date +%s)
if "$real" -s "$OUT/settings.json" "$vol" "$OUT/a.dmg" > "$OUT/a.log" 2>&1; then echo "A: succeeded after $(( $(date +%s) - t0 )) s (hold did not reproduce)"; else echo "A: FAILED after $(( $(date +%s) - t0 )) s: $(grep -m1 -o 'Unable to detach.*' "$OUT/a.log")"; fi
wait "$h"
echo "B. patched electron-builder, volume held $HOLD s"
rm -f desktop/dist/*.dmg
hold & h=$!
t0=$(date +%s)
if eb > "$OUT/b.log" 2>&1; then echo "B: succeeded after $(( $(date +%s) - t0 )) s"; else echo "B: FAILED after $(( $(date +%s) - t0 )) s"; tail -15 "$OUT/b.log"; fi
wait "$h"
ls -la desktop/dist/*.dmg
exit 0
