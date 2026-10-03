#!/usr/bin/env bash
# TEMPORARY probe for issue #66, removed before merge: how often macOS refuses
# dmgbuild's first detach of the freshly written image, and which process holds
# the volume when it does, with Spotlight indexing on and then off.
set -u
N="${1:-10}"
OUT="$RUNNER_TEMP/probe"; mkdir -p "$OUT/bundle"
case "$(uname -m)" in arm64) arch=arm64; sum=793404d0c96687e27d5ee40a668d498c92e36a64d6c2906df511031adb33cbeb;; *) arch=x86_64; sum=1664972f9cc2d6e8fce3b63e42cd30078aff602669c5856939c4519921200433;; esac
url="https://github.com/electron-userland/electron-builder-binaries/releases/download/dmg-builder@1.2.5/dmgbuild-bundle-$arch-75c8a6c.tar.gz"
curl -fsSL --retry 3 --max-time 300 -o "$OUT/bundle.tgz" "$url" || exit 1
echo "$sum  $OUT/bundle.tgz" | shasum -a 256 -c - || exit 1
tar xzf "$OUT/bundle.tgz" -C "$OUT/bundle"
real="$OUT/bundle/dmgbuild"
[ -x "$real" ] || { echo "no dmgbuild at $real"; exit 1; }
cat > "$OUT/capture" <<EOF
#!/bin/bash
# electron-builder calls: -s settings volname out.dmg
cp "\$2" "$OUT/settings.json"
echo "\$3" > "$OUT/volname"
exec "$real" "\$@"
EOF
chmod +x "$OUT/capture"
observe() {
  while [ ! -f "$OUT/stop" ]; do
    for v in /Volumes/*; do
      case "$v" in "/Volumes/Macintosh HD"*) continue;; esac
      [ -d "$v" ] || continue
      sudo lsof -n -- "$v" 2>/dev/null | awk -v t="$(date +%H:%M:%S)" 'NR>1{print t" "$1" "$2" "$3" "$4" "$9}' >> "$OUT/holders.log"
    done
    sleep 0.2
  done
}
observe & obs=$!
echo "capture: electron-builder's own DMG call, default detach attempts"
(cd desktop && CUSTOM_DMGBUILD_PATH="$OUT/capture" pnpm exec electron-builder --config electron-builder.mjs --publish never --mac dmg "--$( [ $arch = arm64 ] && echo arm64 || echo x64 )" --config.mac.identity=null --config.mac.notarize=false --config.dmg.sign=false) > "$OUT/capture.log" 2>&1 && echo "capture ok" || { echo "capture FAILED"; tail -20 "$OUT/capture.log"; }
python3 - "$OUT" <<'PY'
import json,sys,os
o=sys.argv[1]; s=json.load(open(o+'/settings.json'))
if s.get('icon') and not os.path.exists(s['icon']): s.pop('icon')
json.dump(s,open(o+'/settings2.json','w'))
print('settings:', {k:v for k,v in s.items() if k!='contents'})
PY
vol="$(cat "$OUT/volname")"
phase() {
  local name="$1" fails=0
  for i in $(seq 1 "$N"); do
    rm -f "$OUT/out.dmg"
    t0=$(date +%H:%M:%S)
    if "$real" --detach-retries 1 -s "$OUT/settings2.json" "$vol" "$OUT/out.dmg" > "$OUT/$name-$i.log" 2>&1; then echo "$t0 $name run $i: first detach accepted"
    else fails=$((fails+1)); echo "$t0 $name run $i: REFUSED at $(date +%H:%M:%S): $(grep -m1 -o 'Unable to detach.*' "$OUT/$name-$i.log")"; fi
  done
  echo "$name: first-detach refusals $fails of $N"
}
phase spotlight-on
sudo mdutil -a -i off >/dev/null 2>&1; mdutil -s / 2>&1 | tail -1
phase spotlight-off
touch "$OUT/stop"; wait "$obs"
echo "processes seen holding a mounted image volume (samples):"
awk '{print $2}' "$OUT/holders.log" | sort | uniq -c | sort -rn
echo "holder lines (first 120):"; head -120 "$OUT/holders.log"
exit 0
