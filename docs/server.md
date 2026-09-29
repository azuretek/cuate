# Running the server on a Mac

## What it needs

- macOS 14 or newer, signed in to Messages.
- Node 22.13 or newer, and pnpm to install the server's one dependency.
- The [`imsg`](https://github.com/openclaw/imsg) engine, from its install guide. The server runs it as `imsg rpc`.
- Permission for the program that starts the server to read the Messages database (**Full Disk Access**, wherever macOS enforces it), and **Automation for Messages** to send. macOS asks the first time; `doctor` says which is missing.

## Set it up

From a checkout of this repository:

```sh
pnpm install --frozen-lockfile --prod --filter server
node server/src/main.js init                          # engine imsg, port 7447, sending off
node server/src/main.js doctor
node server/src/main.js service install --tailscale   # runs it now, at every login and after a crash
node server/src/main.js token create --scope device --name "my laptop"
```

Switch sending on only once reading works from a device: `node server/src/main.js sending on`.

The data folder defaults to `~/Library/Application Support/<name>-server`; pass `--data DIR` to any command to use another. It holds `config.json`, the token and send records (`state.db`), a secret for attachment ids, and a `diagnostics` folder for crash records.

## Tokens

- `token create --scope device` for each phone or computer: it reads and sends.
- `token create --scope tooling` for scripts: it reads and cannot send.
- `token create --scope admin` for everything else.
- A token is printed once and stored hashed. `token list` shows ids, scopes and names, never tokens. `token revoke ID` stops one at once.
- `token create ... -- COMMAND [ARG...]` hands the new token to COMMAND on its standard input instead of printing it, so it can go straight into a password manager. `{id}`, `{scope}` and `{name}` in the arguments are filled in with the token's. If COMMAND fails, the token is revoked at once.

## Keep it running

`service install` checks with `doctor` first and installs nothing if a check fails. It then writes a LaunchAgent to `~/Library/LaunchAgents`, named for the server id in `core/spec/naming.json`, loads it, and waits until the new server says it is ready and answers. The LaunchAgent runs the `node` it finds on `PATH`, without resolving links, so a Node upgrade keeps working; pass `--node PATH` to choose another.

- `service status`: the LaunchAgent, whether the server answers, the sending switch it started with, its log file, and the tailnet entry.
- `service restart`: restart it and wait until the new run answers.
- `service update`: fast-forward this checkout to its upstream branch, install the dependency, and restart. A checkout with uncommitted changes, or with commits its upstream lacks, is left as it is.
- `service remove`: unload it, delete the LaunchAgent and withdraw the tailnet entry it published. The data folder and the code are kept.
- `sending on` and `sending off` restart a service that runs from that data folder, and read the switch back from the restarted server.

The server's output goes to one log file in `~/Library/Logs`, which `service status` names. launchd holds that file open for as long as the server runs, so rotate it by copying it and truncating it in place, never by renaming it: a renamed file keeps receiving the log.

## Reaching it from your other devices

The server listens on 127.0.0.1 only, on purpose. `service install --tailscale` publishes it with `tailscale serve` on port 443 of the Mac's tailnet name, and connects nothing else: other served ports are left alone, and if port 443 already serves something else, nothing is changed. Connect the apps to `https://<the Mac's tailnet name>`.

Never publish the server to the internet, so never with `tailscale funnel`: it can read every conversation on the Mac and send as you.

## Check it from anywhere

```sh
<print a tooling token> | node server/src/main.js check --url https://<the Mac's tailnet name>
```

`check` reads the token on standard input, never from an argument or the URL, and says whether the server answers, which versions and engine it runs, and whether it lists chats. Without `--url` it checks the server on this Mac.

## When something is wrong

- `service status`, then `doctor`, which checks Node, the tokens, the engine and the database permission, sending, and the attachments folder, and says what to fix.
- Logs are JSON lines. `LOG_LEVEL=debug` adds request timings. They never hold message text, handles or tokens.
- After a crash, `diagnostics/crash-*.json` holds the scrubbed stack and the last log lines, and `report-*.json` is Node's diagnostic report. `kill -USR2 <pid>` writes a report without stopping the server.
