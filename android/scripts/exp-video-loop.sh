#!/usr/bin/env bash
# Temporary experiment: run VideoControlsTest repeatedly and classify each run.
set -u
mode="$1"
mkdir -p exp
adb install -r -t app/build/outputs/apk/debug/app-debug.apk > exp/install.txt 2>&1
adb install -r -t -g app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >> exp/install.txt 2>&1
adb shell settings put global hide_error_dialogs 1
out=/sdcard/Android/media/com.azuretek.cuate/out
pass=0; fail=0; lost=0; total=0
for i in 1 2 3 4; do
  total=$i
  timeout 150 adb shell am instrument -w -e class com.azuretek.cuate.VideoControlsTest -e additionalTestOutputDir "$out" com.azuretek.cuate.test/androidx.test.runner.AndroidJUnitRunner > "exp/run-$i.txt" 2>&1
  if ! timeout 15 adb shell true > /dev/null 2>&1; then lost=$((lost+1)); echo "iteration $i: device lost at $(date -u +%T)"; break; fi
  if grep -q '^OK (' "exp/run-$i.txt"; then pass=$((pass+1)); echo "iteration $i: pass"; else fail=$((fail+1)); echo "iteration $i: fail"; grep -m4 -E 'AssertionError|not in the|held video' "exp/run-$i.txt" | cut -c1-400; fi
done
timeout 60 adb logcat -d > exp/logcat.txt 2>&1
echo "summary viewer=$mode iterations=$total pass=$pass fail=$fail lost=$lost" | tee exp/summary.txt
