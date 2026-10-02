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

The data folder defaults to `~/Library/Application Support/<name>-server`; pass `--data DIR` to any command to use another. It holds `config.json`, the token and send records (`state.db`), a secret for attachment ids, an `uploads` folder holding a file a device sends until it has gone out (swept after a day), and a `diagnostics` folder for crash records.

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
- `hooks` changes are sent to a service that runs from that data folder with SIGHUP rather than a restart (see Hooks below).

The server's output goes to one log file in `~/Library/Logs`, which `service status` names. launchd holds that file open for as long as the server runs, so rotate it by copying it and truncating it in place, never by renaming it: a renamed file keeps receiving the log.

## Send the logs to a collector

The server can ship its own log lines to a syslog collector, so a deployment keeps them beside every other service's. Put the collector's address and port in `config.json` under `log.syslog` and restart the server:

```json
{ "log": { "syslog": { "host": "log.internal", "port": 514 } } }
```

It sends one JSON line per syslog message (RFC 5424) over TCP, framed with the octet count (RFC 6587), to an off the shelf rsyslog; the address and port are configuration, never hard coded. When a send fails, the line is kept in `log-spill.jsonl` in the data folder and `log.spilled` is written to the server's own log. Leave `log.syslog` out, or `null`, to keep the lines local only.

## Hooks

The server can send every event it publishes, the same ones a connected app hears, to any number of receivers. An event is a message (`message.new`, `reaction`) or an action the server takes or sees (`chat.read`, `settings.changed`, `mac.state`, `server.state`); a sent message arrives as `message.new` with `isFromMe`. Reading, listing, searching and exporting are not events. The list is `events` in `core/spec/api.json`, so an event added there can be hooked with no other change, and the OpenAPI document gives each one's data under `webhooks`.

```sh
node server/src/main.js hooks add tool https://tool.example/in --events message.new,chat.read
node server/src/main.js hooks add everything https://tool.example/all --events '*'
node server/src/main.js hooks list
node server/src/main.js hooks disable tool        # and enable, remove
node server/src/main.js hooks rotate tool         # a new secret and key; the old ones stay until --retire
node server/src/main.js hooks rotate tool --retire
```

`add` prints the endpoint's secret and its encryption key once, for the receiver to keep in its own secret store; they are in `config.json` (mode 0600) and never in a log or in `hooks list`. An event name the spec does not hold is refused, and so is an `http` URL that is not loopback. Every change is read by a running service on SIGHUP, which `hooks` sends and confirms from the service's log, so no app is disconnected.

Each delivery is one POST:

- The body is `{ "id", "event", "sentAt", "jwe" }`. The id and the event name are in the clear so a receiver can route and drop a repeat before decrypting; the event's data, where every message, handle and chat id lives, is the `jwe`: a compact JWE with `alg: dir`, `enc: A256GCM` and the key's `kid`, which any JOSE library decrypts with the key. `--plaintext` sends `data` instead, and is allowed only for a loopback URL, for development.
- `x-webhook-signature: t=<unix seconds>,v1=<hex>` is the HMAC-SHA256 of `<t>.<the exact body>` under the secret (its text, as UTF-8). While a secret is rotating there is one `v1` for each, so a receiver can switch at its own pace. Refuse a delivery whose `t` is more than five minutes away, so an old one cannot be replayed.
- A delivery that is not accepted is retried after 1, 2, 4 and 8 seconds, except a 4xx other than 408 and 429, which resending cannot change. Then it is given up on and logged as `webhook.gaveup` with its id. There is no queue on disk: a receiver that missed events reads them back through the messages API, which is the record.
- After 20 deliveries in a row are given up on, or a day passes with none delivered while some were tried, the endpoint is switched off in `config.json` with the reason and the last error, `webhook.disabled` is logged, and `doctor` names it. `hooks enable` switches it back on.

A receiver in plain Node, verifying first and decrypting second:

```js
import { createDecipheriv, createHmac, timingSafeEqual } from 'node:crypto';

export function open(headers, body, { secret, keys }) {
  const fields = headers['x-webhook-signature'].split(',');
  const t = Number(fields.find((f) => f.startsWith('t=')).slice(2));
  if (Math.abs(Date.now() / 1000 - t) > 300) throw new Error('too old');
  const want = createHmac('sha256', secret).update(t + '.' + body).digest();
  const ok = fields.filter((f) => f.startsWith('v1=')).some((f) => {
    const got = Buffer.from(f.slice(3), 'hex');
    return got.length === want.length && timingSafeEqual(got, want);
  });
  if (!ok) throw new Error('bad signature');
  const { id, event, jwe } = JSON.parse(body);
  const [h, , iv, ct, tag] = jwe.split('.');
  const { kid } = JSON.parse(Buffer.from(h, 'base64url'));
  const d = createDecipheriv('aes-256-gcm', Buffer.from(keys[kid], 'base64url'), Buffer.from(iv, 'base64url'));
  d.setAAD(Buffer.from(h, 'ascii'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  const data = JSON.parse(Buffer.concat([d.update(Buffer.from(ct, 'base64url')), d.final()]));
  return { id, event, data };
}
```

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
