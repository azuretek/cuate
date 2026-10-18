#!/usr/bin/env bash
# Temporary experiment: with nothing running, wait for the emulator to go away and say when and how.
set -u
mkdir -p exp
launched=$(ps -o lstart= -p "$(pgrep -f qemu-system | head -1)" 2>/dev/null)
echo "emulator process started: $launched; now $(date -u +%T)" | tee exp/times.txt
pgrep -a qemu-system | cut -c1-400 | tee exp/qemu-before.txt
timeout 900 adb wait-for-disconnect
echo "adb wait-for-disconnect ended with $? at $(date -u +%T)" | tee -a exp/times.txt
pgrep -a qemu-system > exp/qemu-after.txt 2>&1 || echo "the emulator process is gone at $(date -u +%T)" | tee -a exp/times.txt
