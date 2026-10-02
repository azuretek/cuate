// Generated from core/spec/build.json by scripts/gen-build-spec.mjs. Edit the spec, not this file.
export const BUILD_SPEC = {
  "description": "The one owner of the build report the About page draws, and which half owns every value. The page renders one row per field from the half that owns it: the client's own build from the shell, the server's from the server. The desktop shell and the server each read this file, and the page reads its generated mirror, so a value is never written twice and a value can never come from the wrong half. core/test/build.test.js fails when either happens.",
  "versionFile": "core/spec/version.json",
  "halves": {
    "client": {
      "owner": "shell",
      "source": "app.info",
      "fields": [
        {
          "key": "version",
          "label": "Client version"
        },
        {
          "key": "channel",
          "label": "Channel"
        },
        {
          "key": "build",
          "label": "Build"
        },
        {
          "key": "commit",
          "label": "Commit"
        },
        {
          "key": "builtAt",
          "label": "Built"
        },
        {
          "key": "electron",
          "label": "Electron"
        },
        {
          "key": "chromium",
          "label": "Chromium"
        },
        {
          "key": "node",
          "label": "Node"
        },
        {
          "key": "platform",
          "label": "Platform"
        },
        {
          "key": "arch",
          "label": "Architecture"
        },
        {
          "key": "packaged",
          "label": "Packaged"
        },
        {
          "key": "installSource",
          "label": "Installed from"
        },
        {
          "key": "updateChannel",
          "label": "Update channel"
        }
      ]
    },
    "server": {
      "owner": "server",
      "source": "GET /api/v1/info",
      "fields": [
        {
          "key": "serverVersion",
          "label": "Server version"
        },
        {
          "key": "serverChannel",
          "label": "Server channel"
        },
        {
          "key": "serverBuild",
          "label": "Server build"
        },
        {
          "key": "serverCommit",
          "label": "Server commit"
        },
        {
          "key": "serverBuiltAt",
          "label": "Server built"
        },
        {
          "key": "engine.kind",
          "label": "Engine"
        },
        {
          "key": "engine.version",
          "label": "Engine version"
        },
        {
          "key": "serverPlatform",
          "label": "Server platform"
        },
        {
          "key": "apiVersion",
          "label": "API version"
        }
      ]
    }
  }
};
