#!/usr/bin/env python3
"""The release group check, driven against a fake App Store Connect.

`asc.py assign` is what decides whether the iOS release job may go green, and it
runs where the API must not be trusted: a failed call and a call for a build that
is in no group look the same unless the code reads carefully. These tests hold
the three things the release depends on:

- a VALID build in no group fails the job and names the group it expected;
- a build that is assigned passes only because the group's builds were read back,
  never because the assignment call returned success;
- a group that receives every build needs no assignment and is still confirmed.

Each test replaces the module's network call, its token and its POST with fakes,
so nothing here reaches Apple and no credential is read. Run it directly:

    python3 ios/scripts/test_asc.py
"""

import contextlib
import io
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import asc  # noqa: E402

BUILD_NUMBER = "28"
GROUP = "Internal"


class FakeAPI:
    """The handful of App Store Connect answers the group check reads."""

    def __init__(self, receives_every_build=False, group_name=GROUP, build_in_group=False):
        self.receives_every_build = receives_every_build
        self.group_name = group_name
        self.build_in_group = build_in_group
        self.posts = []

    def get(self, auth, path, params=None):
        if path == "/apps":
            return {"data": [{"id": "APP1"}]}
        if path == "/builds":
            return {
                "data": [
                    {
                        "id": "BUILD1",
                        "attributes": {"version": BUILD_NUMBER, "processingState": "VALID"},
                    }
                ]
            }
        if path == "/apps/APP1/betaGroups":
            return {
                "data": [
                    {
                        "id": "GRP1",
                        "attributes": {
                            "name": self.group_name,
                            "hasAccessToAllBuilds": self.receives_every_build,
                        },
                    }
                ]
            }
        if path == "/betaGroups/GRP1/builds":
            return {"data": [{"id": "BUILD1"}] if self.build_in_group else []}
        raise AssertionError("unexpected GET " + path)

    def post(self, auth, path, body):
        self.posts.append((path, body))
        return {"__status__": 204}


class GroupCheckTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeAPI()
        self.saved = {key: os.environ.get(key) for key in ("BUILD_NUMBER", "ASC_BETA_GROUP")}
        os.environ["BUILD_NUMBER"] = BUILD_NUMBER
        os.environ["ASC_BETA_GROUP"] = GROUP
        asc.api = self.fake.get
        asc.api_post = self.fake.post
        asc.Credential = lambda: "token"

    def tearDown(self):
        for key, value in self.saved.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def run_check(self):
        out = io.StringIO()
        err = io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            try:
                asc.assign()
                return 0, out.getvalue(), err.getvalue()
            except SystemExit as stopped:
                return stopped.code, out.getvalue(), err.getvalue()

    def test_a_valid_build_in_no_group_fails_and_names_the_group(self):
        self.fake.build_in_group = False
        code, _, err = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn(GROUP, err)
        self.assertEqual(len(self.fake.posts), 1, "the build is added to the group before the read back")

    def test_an_assigned_build_passes_only_from_the_read_back(self):
        self.fake.build_in_group = True
        code, out, err = self.run_check()
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        self.assertIn(GROUP, out)
        self.assertEqual(len(self.fake.posts), 1)

    def test_a_group_that_receives_every_build_is_confirmed_and_not_assigned(self):
        self.fake.receives_every_build = True
        self.fake.build_in_group = True
        code, out, err = self.run_check()
        self.assertEqual(code, 0)
        self.assertEqual(err, "")
        self.assertIn(GROUP, out)
        self.assertEqual(self.fake.posts, [], "a group that receives every build is not assigned")

    def test_an_unknown_group_fails_and_names_the_group_it_expected(self):
        self.fake.group_name = "Beta"
        code, _, err = self.run_check()
        self.assertEqual(code, 1)
        self.assertIn(GROUP, err)
        self.assertEqual(self.fake.posts, [])


if __name__ == "__main__":
    unittest.main()
