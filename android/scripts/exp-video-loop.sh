#!/usr/bin/env bash
# Temporary experiment: run VideoControlsTest repeatedly and classify each run.
set -u
mode="$1"
mkdir -p exp
bash scripts/boot-proof.sh > exp/boot.txt 2>&1 || echo "boot-proof exited $?"
timeout 120 adb install -r -t -g app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk > exp/install.txt 2>&1
adb shell getprop | grep -i hwcodec | tee exp/props.txt
out=/sdcard/Android/media/com.azuretek.cuate/out
pass=0; fail=0; lost=0; total=0
for i in $(seq 1 20); do
  total=$i
  timeout 150 adb shell am instrument -w -e class com.azuretek.cuate.VideoControlsTest -e additionalTestOutputDir "$out" com.azuretek.cuate.test/androidx.test.runner.AndroidJUnitRunner > "exp/run-$i.txt" 2>&1
  if ! timeout 15 adb shell true > /dev/null 2>&1; then
    lost=$((lost+1)); echo "iteration $i: device lost"; tail -5 "exp/run-$i.txt"
    pgrep -a qemu-system > exp/qemu.txt 2>&1 || echo "the emulator process is gone" | tee -a exp/qemu.txt
    ls -la /tmp/android-runner 2>&1 | tee -a exp/qemu.txt
    break
  fi
  if grep -q '^OK (' "exp/run-$i.txt"; then pass=$((pass+1)); echo "iteration $i: pass"; else fail=$((fail+1)); echo "iteration $i: fail"; grep -m4 -E 'Error|not in the|failed' "exp/run-$i.txt"; fi
done
timeout 60 adb logcat -d > exp/logcat.txt 2>&1
grep -oE 'decoder name [^ ,]+' exp/logcat.txt | sort | uniq -c | tee exp/decoders.txt
echo "summary mode=$mode iterations=$total pass=$pass fail=$fail lost=$lost" | tee exp/summary.txt
