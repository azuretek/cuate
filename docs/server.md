# Running the server on a Mac

## What it needs

- macOS 14 or newer, signed in to Messages.
- Node 22.13 or newer.
- The [`imsg`](https://github.com/openclaw/imsg) engine, from its install guide. The server runs it as `imsg rpc`.
- **Full Disk Access** for the program that starts the server, so the engine can read the Messages database, and **Automation for Messages** to send. macOS asks the first time; `doctor` says which is missing.

## Set it up

```sh
node server/src/main.js init                         # engine imsg, port 7447, sending off
node server/src/main.js token create --scope device --name "my laptop"
node server/src/main.js doctor
node server/src/main.js sending on                   # only once reading works
node server/src/main.js run
```

The data folder defaults to `~/Library/Application Support/cuate-server`; pass `--data DIR` to any command to use another. It holds `config.json`, the token and send records (`state.db`), a secret for attachment ids, and a `diagnostics` folder for crash records.

## Tokens

- `token create --scope device` for each phone or computer: it reads and sends.
- `token create --scope tooling` for scripts: it reads and cannot send.
- `token create --scope admin` for everything else.
- A token is printed once and stored hashed. `token list` shows ids and scopes, never tokens. `token revoke ID` stops one at once.

## Reaching it from your other devices

The server listens on 127.0.0.1 only, on purpose. Put a TLS front on the same Mac and connect the apps to that address. With Tailscale:

```sh
tailscale serve --bg 7447
```

Never publish the server to the internet: it can read every conversation on the Mac and send as you.

## Keep it running

A LaunchAgent in your user session starts it at login and again after a crash:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>local.messages-server</string>
  <key>ProgramArguments</key><array>
    <string>/opt/homebrew/bin/node</string>
    <string>/path/to/checkout/server/src/main.js</string>
    <string>run</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>StandardOutPath</key><string>/tmp/messages-server.log</string>
  <key>StandardErrorPath</key><string>/tmp/messages-server.log</string>
</dict></plist>
```

A signed server package, so the permissions belong to it rather than to Node, is on the way.

## When something is wrong

- `doctor` checks Node, the tokens, the engine and the database permission, sending, and the attachments folder, and says what to fix.
- Logs are JSON lines. `LOG_LEVEL=debug` adds request timings. They never hold message text, handles or tokens.
- After a crash, `diagnostics/crash-*.json` holds the scrubbed stack and the last log lines, and `report-*.json` is Node's diagnostic report. `kill -USR2 <pid>` writes a report without stopping the server.
