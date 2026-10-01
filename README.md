# Cuate

Cuate is an iMessage client for every platform, and the small headless server it talks to on a Mac. The Mac keeps using Messages as it always has. The server reads and sends through an open-source engine, [`imsg`](https://github.com/openclaw/imsg), and the apps reach it over your own network.

**Status: the first working version.** The server serves chats, history, attachments, live events and sending, and the desktop app (macOS, Windows and Linux) shows your conversations, updates live and sends. The iPhone and Android apps are next. See [docs/features.md](docs/features.md) for what works today and what is planned.

## How it fits together

- `core/`: the one app. Every screen is a web component and every rule is plain JavaScript, so each platform runs the same code. `core/kit/` is the reusable framework and `core/app/` is this app. `core/spec/` holds the values everything else is checked against: the API contract, the log events, the design tokens, the host bridge and the names.
- `server/`: the headless server for the Mac. Node, one SQLite file for its own state, and the engine as a supervised child process.
- `desktop/`: the Electron shell that hosts core.
- `docs/`: [the design](docs/design.md), [running the server](docs/server.md), [features](docs/features.md), [the OpenAPI document and the MCP](docs/mcp.md) and [contributing](docs/contributing.md).

## Desktop test builds

[docs/release.md](docs/release.md) describes the desktop prerelease pipeline, installation, update channels and verification.

## Try it without a Mac

The server has a fake engine with made-up conversations, so the whole stack runs anywhere Node 22.13 or newer does.

```sh
pnpm install
node server/src/main.js init --engine fake --data /tmp/demo
node server/src/main.js token create --scope device --name laptop --data /tmp/demo
node server/src/main.js sending on --data /tmp/demo
node server/src/main.js run --data /tmp/demo
```

Then run `pnpm run desktop`, and connect to `http://127.0.0.1:7447` with the token the second command printed.

## Run it on your Mac

[docs/server.md](docs/server.md) covers the engine, the macOS permissions, tokens, and reaching the server from your other devices.

## License

MIT. The vendored Lit build is BSD-3-Clause (`core/kit/vendor/`).
