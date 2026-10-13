#!/usr/bin/env python3
"""Set up what signing the app and its notification extension needs, through the
App Store Connect API (issue 347).

Push notifications need the Push Notifications capability on the app's bundle
id, a second bundle id for the notification service extension that opens each
sealed notification, and an App Store provisioning profile for each, made after
the capability so the app's profile carries aps-environment. This does all of
it and reads every change back, so a fork with its own team runs it once:

    signing.py status                 what exists, changing nothing
    signing.py apply --out DIR        create what is missing, then write both
                                      App Store profiles into DIR and print
                                      their names and UUIDs

Each step reads before it writes, so running apply again changes nothing that
is already right. The profiles name the one valid Apple Distribution
certificate; with more than one, pass --certificate <serial> to choose.

Authentication is asc.py's: ASC_KEY_ID, ASC_ISSUER_ID and ASC_KEY_PATH.
"""

import argparse
import base64
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from asc import API, Credential, api, bundle_id, describe, error_body, fail  # noqa: E402

PUSH = "PUSH_NOTIFICATIONS"
EXTENSION_SUFFIX = ".notify"


def send(auth, method, path, body):
    """One write, answering Apple's parsed body or its words on failure."""
    request = urllib.request.Request(
        API + path,
        data=json.dumps(body).encode("utf-8"),
        method=method,
        headers={"Authorization": f"Bearer {auth}", "Accept": "application/json", "Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else {"__status__": response.status}
    except urllib.error.HTTPError as error:
        return error_body(error)


def find_bundle(auth, identifier):
    result = api(auth, "/bundleIds", {"filter[identifier]": identifier, "limit": 20})
    if "__error__" in result:
        fail(f"looking up bundle id {identifier} failed: {describe(result)}")
    # filter[identifier] is a prefix match, so the exact one is picked here.
    return next((b for b in result.get("data", []) if b["attributes"]["identifier"] == identifier), None)


def ensure_bundle(auth, identifier, name, apply):
    found = find_bundle(auth, identifier)
    if found or not apply:
        return found
    made = send(auth, "POST", "/bundleIds", {"data": {"type": "bundleIds", "attributes": {"identifier": identifier, "name": name, "platform": "IOS"}}})
    if "__error__" in made:
        fail(f"creating bundle id {identifier} failed: {describe(made)}")
    return find_bundle(auth, identifier) or fail(f"bundle id {identifier} was created but does not read back")


def capabilities(auth, bundle):
    result = api(auth, f"/bundleIds/{bundle['id']}/bundleIdCapabilities")
    if "__error__" in result:
        fail(f"reading the capabilities of {bundle['attributes']['identifier']} failed: {describe(result)}")
    return {c["attributes"]["capabilityType"] for c in result.get("data", [])}


def ensure_push(auth, bundle, apply):
    if PUSH in capabilities(auth, bundle) or not apply:
        return PUSH in capabilities(auth, bundle)
    made = send(auth, "POST", "/bundleIdCapabilities", {"data": {"type": "bundleIdCapabilities", "attributes": {"capabilityType": PUSH}, "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}}}}})
    if "__error__" in made:
        fail(f"enabling push on {bundle['attributes']['identifier']} failed: {describe(made)}")
    if PUSH not in capabilities(auth, bundle):
        fail(f"push was enabled on {bundle['attributes']['identifier']} but does not read back")
    return True


def distribution_certificate(auth, serial):
    result = api(auth, "/certificates", {"filter[certificateType]": "DISTRIBUTION,IOS_DISTRIBUTION", "limit": 200})
    if "__error__" in result:
        fail(f"listing certificates failed: {describe(result)}")
    now = time.strftime("%Y-%m-%dT%H:%M:%S")
    valid = [c for c in result.get("data", []) if (c["attributes"].get("expirationDate") or "") > now]
    if serial:
        valid = [c for c in valid if c["attributes"].get("serialNumber", "").lower() == serial.lower()]
    if len(valid) != 1:
        listed = ", ".join(f"{c['attributes'].get('serialNumber')} ({c['attributes'].get('displayName')}, until {c['attributes'].get('expirationDate', '')[:10]})" for c in valid) or "none"
        fail(f"need exactly one valid distribution certificate, found: {listed}. Pass --certificate <serial>.")
    return valid[0]


def make_profile(auth, bundle, certificate, name, out):
    made = send(auth, "POST", "/profiles", {"data": {"type": "profiles", "attributes": {"name": name, "profileType": "IOS_APP_STORE"}, "relationships": {
        "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
        "certificates": {"data": [{"type": "certificates", "id": certificate["id"]}]},
    }}})
    if "__error__" in made:
        fail(f"creating profile {name!r} failed: {describe(made)}")
    attrs = made["data"]["attributes"]
    path = os.path.join(out, name.replace(" ", "_") + ".mobileprovision")
    with open(path, "wb") as handle:
        handle.write(base64.b64decode(attrs["profileContent"]))
    return {"name": attrs["name"], "uuid": attrs["uuid"], "path": path, "bundle": bundle["attributes"]["identifier"]}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["status", "apply"])
    parser.add_argument("--out", help="where apply writes the two profiles")
    parser.add_argument("--certificate", help="the distribution certificate's serial, when there is more than one")
    args = parser.parse_args()
    apply = args.command == "apply"
    if apply and not args.out:
        fail("apply needs --out DIR")
    auth = Credential()
    app_id = bundle_id()
    app = ensure_bundle(auth, app_id, "App", apply) or fail(f"bundle id {app_id} does not exist")
    extension = ensure_bundle(auth, app_id + EXTENSION_SUFFIX, "Notification extension", apply)
    push = ensure_push(auth, app, apply)
    certificate = distribution_certificate(auth, args.certificate)
    state = {"app": app_id, "push": push, "extension": bool(extension), "certificate": certificate["attributes"].get("serialNumber")}
    if apply:
        os.makedirs(args.out, exist_ok=True)
        stamp = time.strftime("%Y%m%d%H%M")
        state["profiles"] = [
            make_profile(auth, app, certificate, f"App Store {app_id} {stamp}", args.out),
            make_profile(auth, extension, certificate, f"App Store {app_id}{EXTENSION_SUFFIX} {stamp}", args.out),
        ]
    print(json.dumps(state, indent=2))


if __name__ == "__main__":
    main()
