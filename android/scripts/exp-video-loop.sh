#!/usr/bin/env bash
# Temporary experiment: VideoControlsTest repeatedly, with the emulator process's memory before and after each run.
set -u
mode="$1"
mkdir -p exp
adb install -r -t app/build/outputs/apk/debug/app-debug.apk > exp/install.txt 2>&1
adb install -r -t -g app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk >> exp/install.txt 2>&1
adb shell settings put global hide_error_dialogs 1
adb logcat -b all -v threadtime > exp/live-logcat.txt 2>&1 &
qpid=$(pgrep -f qemu-system | head -1)
mem() { echo "$(date -u +%T) qemu rss=$(ps -o rss= -p "$qpid" 2>/dev/null)KB host free=$(free -m | awk '/Mem:/{print $7}')MB"; }
mem | tee -a exp/mem.txt
out=/sdcard/Android/media/com.azuretek.cuate/out
for i in 1 2 3 4 5 6 7 8; do
  timeout 150 adb shell am instrument -w -e class com.azuretek.cuate.VideoControlsTest -e additionalTestOutputDir "$out" com.azuretek.cuate.test/androidx.test.runner.AndroidJUnitRunner > "exp/run-$i.txt" 2>&1
  mem | tee -a exp/mem.txt
  if ! timeout 15 adb shell true > /dev/null 2>&1; then echo "iteration $i: device lost at $(date -u +%T)"; pgrep -a qemu-system > /dev/null || echo "the emulator process is gone"; break; fi
  if grep -q '^OK (' "exp/run-$i.txt"; then echo "iteration $i: pass"; else echo "iteration $i: fail"; grep -m2 -E 'AssertionError' "exp/run-$i.txt" | cut -c1-300; fi
done
