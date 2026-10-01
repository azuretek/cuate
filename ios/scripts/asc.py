#!/usr/bin/env python3
"""Ask App Store Connect whether the build the iOS release just uploaded is
installable, and refuse to call the job green until it is.

The upload command's exit code is not evidence of an installable build.
`xcrun altool --upload-app` reports success when Apple's delivery service
accepted the bytes, which is BEFORE the build exists as a record anyone can see,
and the bytes then spend minutes in Processing. A test build published while the
phone's build is still Processing is a feed entry pointing the phone at a build
that is not there, so the iOS release job waits here and the platforms gate reads
its whole job list: green means the build reached VALID.

The two subcommands the release needs, in the order the job runs them:

    asc.py wait       after the upload, to prove the build reached VALID
    asc.py assign     after the wait, to prove the build reached the group a
                      tester installs from, adding it to that group when the
                      group does not receive every build

The upload command's exit code and the wait are each not evidence that a tester
can install the build: a build reaches VALID and can still sit in no group, which
is exactly how a group that does not receive every build behaves. `wait` reads
only. `assign` writes one relationship, the build into the group, and then reads
the group's builds back: App Store Connect answers that assignment the same way
whether or not the build was already in the group, so only the read says the
build is one a tester in the group can install.

Authentication is a JWT signed ES256 with the key at ASC_KEY_PATH, which is the
only algorithm App Store Connect accepts. The key is read from that file, passed
to openssl as a path and never as data in an argument, and never printed. The key
id and the issuer id do travel on the command line, because Apple's token format
puts them in the JWT header and claims; neither is a credential and both are
visible in the App Store Connect UI. The key itself is the secret.

Adapted from the sibling app's (chela) asc.py, which also drives preflight and
TestFlight group assignment.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
NAMING = os.path.join(HERE, "..", "..", "core", "spec", "naming.json")
API = "https://api.appstoreconnect.apple.com/v1"


def fail(message):
    print(f"error: {message}", file=sys.stderr)
    sys.exit(1)


def env(name, default=None):
    value = os.environ.get(name, default)
    if value is None or value == "":
        fail(f"{name} is not set")
    return value


def bundle_id():
    """The iOS bundle id, read from the one owner of the ids."""
    with open(NAMING, encoding="utf-8") as handle:
        return json.load(handle)["ids"]["ios"]


# --------------------------------------------------------------------------
# The JWT
# --------------------------------------------------------------------------

def b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def read_length(buf, i):
    first = buf[i]
    i += 1
    if first < 0x80:
        return first, i
    count = first & 0x7F
    return int.from_bytes(buf[i:i + count], "big"), i + count


def der_to_raw(der):
    """openssl's DER signature as the fixed width pair a JWT carries.

    OpenSSL returns a DER SEQUENCE of two INTEGERs, each a variable length
    signed value, so every signature comes back a different length. ES256 in a
    JWT is r || s, 32 bytes each, no length fields. A positive integer whose top
    bit is set comes back with a leading zero byte that has to go, and a short
    integer has to be left padded to exactly 32.
    """
    if len(der) < 8 or der[0] != 0x30:
        fail("openssl returned something that is not a DER signature")
    _, i = read_length(der, 1)
    parts = []
    for _ in range(2):
        if der[i] != 0x02:
            fail("openssl returned a DER signature with no INTEGER in it")
        length, i = read_length(der, i + 1)
        value = der[i:i + length]
        i += length
        value = value.lstrip(b"\x00")
        if len(value) > 32:
            fail(f"a signature component is {len(value)} bytes, longer than 32")
        parts.append(value.rjust(32, b"\x00"))
    return parts[0] + parts[1]


def token():
    key_id = env("ASC_KEY_ID")
    issuer = env("ASC_ISSUER_ID")
    key_path = env("ASC_KEY_PATH")

    now = int(time.time())
    header = json.dumps({"alg": "ES256", "kid": key_id, "typ": "JWT"}, separators=(",", ":"))
    # Apple rejects a token whose lifetime is over an hour; this one only has to
    # outlive the few calls in the step that mints it.
    claims = json.dumps(
        {"iss": issuer, "iat": now, "exp": now + 20 * 60, "aud": "appstoreconnect-v1"},
        separators=(",", ":"),
    )
    signing_input = f"{b64url(header.encode())}.{b64url(claims.encode())}"

    signed = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_path, "-binary"],
        input=signing_input.encode(),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if signed.returncode != 0:
        fail(f"openssl could not sign with the key at {key_path}: {signed.stderr.decode().strip()}")
    return f"{signing_input}.{b64url(der_to_raw(signed.stdout))}"


# A token is minted again once it is this old, well inside its 20 minute life,
# because the wait can outlast one token.
REFRESH_AFTER = 10 * 60


class Credential:
    def __init__(self):
        self._value = None
        self._minted_at = 0.0

    def __str__(self):
        now = time.time()
        if self._value is None or now - self._minted_at >= REFRESH_AFTER:
            self._value = token()
            self._minted_at = now
        return self._value


# --------------------------------------------------------------------------
# The API
# --------------------------------------------------------------------------

def error_body(error):
    """Apple's own words about a failed call, because they name the cause."""
    raw = error.read()
    try:
        parsed = json.loads(raw)
        detail = "; ".join(
            f"{e.get('title', 'error')}: {e.get('detail', '')}".strip()
            for e in parsed.get("errors", [])
        )
    except Exception:
        detail = raw.decode("utf-8", "replace")[:400]
    return {"__error__": f"{error.code} {error.reason}", "__detail__": detail, "__status__": error.code}


def api(auth, path, params=None):
    """One GET. Returns the parsed body, or an object carrying Apple's words on
    failure, because that text says which of the several causes it was."""
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    request = urllib.request.Request(
        url,
        headers={"Authorization": f"Bearer {auth}", "Accept": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        return error_body(error)
    except urllib.error.URLError as error:
        fail(f"could not reach {url}: {error.reason}")
    return json.loads(raw) if raw else {}


def api_post(auth, path, body):
    """One POST of a relationship. The status is returned, never trusted to mean
    the relationship now exists: App Store Connect answers this call the same way
    when the build was already in the group, so the only proof is reading the
    group's builds back. A 204 is the success, a 409 is the build already there,
    and both leave the same state behind."""
    url = API + path
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {auth}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            response.read()
            return {"__status__": response.status}
    except urllib.error.HTTPError as error:
        return error_body(error)
    except urllib.error.URLError as error:
        fail(f"could not reach {url}: {error.reason}")


def describe(result):
    return f"{result.get('__error__')} ({result.get('__detail__') or 'no detail'})"


def fetch_app_id(auth, identifier):
    result = api(auth, "/apps", {"filter[bundleId]": identifier, "limit": 1, "fields[apps]": "name,bundleId"})
    if "__error__" in result:
        fail(f"looking up the app record for {identifier} failed: {describe(result)}")
    records = result.get("data", [])
    if not records:
        fail(
            f"no app record exists in App Store Connect for {identifier}, so the build has nothing "
            "to attach to. Create it once in App Store Connect (My Apps, then the + button, then "
            "New App) with this bundle id, a name and a SKU, then re-run."
        )
    return records[0]["id"]


def fetch_build(auth, app_id, build_number):
    """The build carrying this number, or None.

    Matched on the build number alone, which under this repo's scheme is the
    commit count and so increases with every commit: nothing else can carry the
    same number, and no second build can be confused for this one.
    """
    result = api(auth, "/builds", {
        "filter[app]": app_id,
        "sort": "-uploadedDate",
        "limit": 50,
        "fields[builds]": "version,processingState,uploadedDate,expired",
    })
    if "__error__" in result:
        fail(f"listing builds failed: {describe(result)}")
    for build in result.get("data", []):
        attributes = build.get("attributes", {})
        if str(attributes.get("version")) != str(build_number):
            continue
        return {
            "id": build["id"],
            "build_number": attributes.get("version"),
            "state": attributes.get("processingState"),
            "uploaded": attributes.get("uploadedDate"),
        }
    return None


def fetch_beta_group(auth, app_id, name):
    """The named test group of this app, or None.

    A test group that does not receive every build sees only the builds it was
    handed, so the group the release targets is named rather than assumed. The
    name comes from the job's environment, which is a repository variable, so
    which group the pipeline expects is visible outside this script.
    """
    result = api(auth, f"/apps/{app_id}/betaGroups", {
        "fields[betaGroups]": "name,hasAccessToAllBuilds,isInternalGroup",
        "limit": 200,
    })
    if "__error__" in result:
        fail(f"listing the test groups of app {app_id} failed: {describe(result)}")
    for group in result.get("data", []):
        attributes = group.get("attributes", {})
        if attributes.get("name") == name:
            return {
                "id": group["id"],
                "name": attributes.get("name"),
                "receives_every_build": bool(attributes.get("hasAccessToAllBuilds")),
            }
    return None


def group_has_build(auth, group_id, build_id):
    """Whether the group's own build list carries the build.

    This is the proof, not the assignment call's status: only a read of the
    group's builds says the build is one a tester in that group can install.
    """
    result = api(auth, f"/betaGroups/{group_id}/builds", {
        "fields[builds]": "version,processingState",
        "limit": 200,
    })
    if "__error__" in result:
        fail(f"reading the builds of group {group_id} back failed: {describe(result)}")
    return any(build.get("id") == build_id for build in result.get("data", []))


def add_build_to_group(auth, group_id, build_id):
    result = api_post(auth, f"/betaGroups/{group_id}/relationships/builds", {
        "data": [{"type": "builds", "id": build_id}],
    })
    if "__error__" in result:
        # A conflict is the build already being in the group, which the read back
        # in the caller confirms; any other refusal is real and stops the job.
        if result.get("__status__") == 409:
            print(f"build {build_id} is already in group {group_id}")
            return
        fail(f"adding build {build_id} to group {group_id} failed: {describe(result)}")


# --------------------------------------------------------------------------
# Commands
# --------------------------------------------------------------------------

def wait():
    """Prove the build reached VALID, not merely that the upload was accepted."""
    auth = Credential()
    identifier = bundle_id()
    app_id = fetch_app_id(auth, identifier)
    build_number = env("BUILD_NUMBER")
    wait_seconds = int(os.environ.get("WAIT_SECONDS", "2700"))
    poll_seconds = int(os.environ.get("POLL_SECONDS", "30"))
    deadline = time.time() + wait_seconds

    print(f"waiting for build {build_number} of {identifier} (app {app_id}) to reach VALID")
    build = None
    last_state = None
    while time.time() < deadline:
        build = fetch_build(auth, app_id, build_number)
        if build:
            if build["state"] != last_state:
                print(
                    f"build {build['build_number']} is {build['state']}, uploaded {build['uploaded']}"
                )
                last_state = build["state"]
            if build["state"] == "INVALID":
                fail(
                    "Apple processed the upload and rejected it, so the build arrived but cannot be "
                    "installed or tested. The reason is in App Store Connect under TestFlight, or in "
                    "the email its processing sent."
                )
            if build["state"] == "VALID":
                print(f"build {build['build_number']} is VALID and installable (id {build['id']})")
                return
        time.sleep(poll_seconds)

    if not build:
        fail(
            f"build {build_number} did not appear in App Store Connect within {wait_seconds // 60} "
            "minutes. The upload step may have reported success without delivering, so treat this "
            "build as NOT uploaded."
        )
    fail(
        f"build {build['build_number']} reached App Store Connect but is still {build['state']} after "
        f"{wait_seconds // 60} minutes, so it is not installable yet and nothing may publish. "
        "Processing usually finishes within half an hour; re-run this job once TestFlight shows the "
        "build ready."
    )


def assign():
    """Prove the build reached the group a tester installs from.

    After the wait the build is VALID, and this step says a tester can install
    it. A group that receives every build already has it, so there is nothing to
    add and the read below confirms it; every other group is handed this build,
    and Apple answers that assignment the same way whether or not the build was
    already there, so the pass comes from reading the group's builds back. Either
    way the group is named, and a build in no group fails the job rather than
    looking like a finished release.
    """
    auth = Credential()
    identifier = bundle_id()
    app_id = fetch_app_id(auth, identifier)
    build_number = env("BUILD_NUMBER")
    build = fetch_build(auth, app_id, build_number)
    if not build:
        fail(
            f"build {build_number} of {identifier} is not in App Store Connect, so it is in no "
            "tester group and nothing can install it"
        )
    if build["state"] != "VALID":
        fail(
            f"build {build_number} is {build['state']}, not VALID, so it cannot be handed to a "
            "tester group yet; the wait has to pass before this step runs"
        )

    group_name = env("ASC_BETA_GROUP")
    group = fetch_beta_group(auth, app_id, group_name)
    if not group:
        fail(
            f"the app {identifier} has no test group named {group_name!r}. The release path names "
            "the group it expects rather than assuming internal testers see every build, so create "
            "the group in App Store Connect or set the CUATE_BETA_GROUP variable to its name."
        )

    if group["receives_every_build"]:
        print(f"group {group['name']!r} receives every build, so there is nothing to add")
    else:
        print(f"adding build {build['build_number']} (id {build['id']}) to group {group['name']!r}")
        add_build_to_group(auth, group["id"], build["id"])

    if not group_has_build(auth, group["id"], build["id"]):
        fail(
            f"build {build_number} is not among the builds of group {group['name']!r}, so no "
            "tester in that group can install this build"
        )
    print(f"build {build_number} is in group {group['name']!r} and its testers can install it")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    if command == "wait":
        wait()
    elif command == "assign":
        assign()
    else:
        fail("usage: asc.py wait | asc.py assign")
