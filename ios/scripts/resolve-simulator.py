#!/usr/bin/env python3
"""Print the udid of the newest available iPhone simulator, for the ios workflow.

The simulator is resolved from the runner's own list rather than named: the
image's simulator set differs from any development machine's, so a hardcoded
name is the classic way the job fails. iPhone only, because the project targets
iPhone, and the newest iOS runtime wins.

With --runtime-build UDID it prints instead the build of the runtime that
device runs, which the workflow's simulator cache key names (issue 66).
"""
import json
import re
import subprocess
import sys

raw = subprocess.run(
    ["xcrun", "simctl", "list", "devices", "available", "--json"],
    check=True,
    capture_output=True,
    text=True,
).stdout

devices = json.loads(raw)["devices"]

if len(sys.argv) == 3 and sys.argv[1] == "--runtime-build":
    udid = sys.argv[2]
    runtime = next((identifier for identifier, entries in devices.items()
                    if any(device["udid"] == udid for device in entries)), None)
    if runtime is None:
        print("no available simulator " + udid, file=sys.stderr)
        sys.exit(1)
    runtimes = json.loads(subprocess.run(
        ["xcrun", "simctl", "list", "runtimes", "--json"],
        check=True,
        capture_output=True,
        text=True,
    ).stdout)["runtimes"]
    build = next((entry.get("buildversion") for entry in runtimes if entry["identifier"] == runtime), None)
    if not build:
        print("no build version for the runtime " + runtime, file=sys.stderr)
        sys.exit(1)
    print(build)
    sys.exit(0)

best = None
for identifier, entries in devices.items():
    match = re.search(r"SimRuntime\.iOS-([0-9-]+)$", identifier)
    if not match:
        continue
    version = tuple(int(part) for part in match.group(1).split("-"))
    for device in entries:
        if device.get("isAvailable") and device["name"].startswith("iPhone"):
            if best is None or version > best[0]:
                best = (version, device["udid"])
            break

if best is None:
    print("no available iPhone simulator on this runner", file=sys.stderr)
    sys.exit(1)
print(best[1])
