# Features

What works today, and the test that proves each. Planned work is at the end.

## The server

- Chats, newest first, each with a preview of its last message: `server/test/api.test.js`, "chats list newest first".
- The chat list and its previews held in memory from the start and kept current by live messages, so a chat list never waits on the engine: "the chat list and its previews are held from the start", "a live message moves its chat to the top".
- A chat's history, paged from newest to oldest: "history pages from newest to oldest".
- Message search through the engine's own history, newest first, narrowed to one chat when asked: "search finds messages through the fixture engine".
- Settings kept on the server, so a value written by one device is read back by the next device token, and a change streams to every connected client: "a setting written by one device is read back by another", "a settings change is broadcast".
- Attachments by id, only from inside the Messages attachments folder: "attachments are served by id".
- Marking a conversation read, so a chat read on one device clears on every device: "opening a conversation marks it read".
- Sending text and files, off until switched on, rate limited, once per client key, with uncertain outcomes never retried: the send tests.
- Live events over one WebSocket (new messages and tapbacks), resumed after a reconnect: "live messages stream", "tapbacks stream".
- Scoped tokens in the Authorization header only, stored hashed: "every other route needs a token", "a tooling token cannot send", `server/test/cli.test.js`.
- The engine restarted when it dies: "the engine is restarted when it dies".
- Declared, scrubbed log lines with no message text or tokens, even at debug: "no token or message text reaches a log line".
- `init`, `token`, `sending`, `doctor` and `run` on the command line: `server/test/cli.test.js`.

## The desktop app

- Connect with a server address and a device token, kept in the OS keychain: `desktop/test/bridge.test.js` and the desktop smoke.
- The chat list, a conversation with sender runs, time separators, photos, tapbacks and delivery state, and sending: the desktop smoke (`desktop/scripts/smoke.mjs`) and `core/test/rules.test.js`.
- Live updates without a refresh, and OS notifications for incoming messages: the desktop smoke.
- A notice when an update is available and one when it is downloaded and ready, both through the same bridge notice path the new message notices use, each with its own switch the server holds: `core/test/rules.test.js`, "every notice type has its own switch...", and the desktop smoke, which fires a notice and then silences one.
- A notifications section in settings, one switch per notice type, written to the server so every client sees it: `core/test/rules.test.js`, "the settings page draws the schema...".
- Automatic download and install, off until its own setting is turned on: when it is on a found release is fetched with no further prompt and applied on quit, and when it is off nothing is fetched: `core/test/updates.test.js`, "the download preference narrows the platform answer, both ways".
- The download's progress, drawn as an in-app banner while it runs because a native notice cannot show a moving bar, with the artifact verified before the install by the check named per platform and a failure reported rather than swallowed: `core/test/updates.test.js`, "the verification check is named per platform...", `desktop/test/updates.test.js`, and the desktop smoke, which draws a progress banner and clears it.
- Light and dark: the desktop smoke captures both.
- A settings page that reads and writes the settings the server holds, and redraws when a change made anywhere arrives on the event stream; an about page drawn from the server's info route; and, below phone width, one pane at a time with the list sliding in over the conversation and a way back: the desktop smoke.
- The settings page's schema, its defaults and what a control writes: `core/test/rules.test.js`, "the settings page draws the schema and writes the value a control gives".

## Planned

iPhone and Android apps; webhooks; export and backup; scheduled messages; the server looking after the Mac; metrics and tracing; the emoji engine and skins; rich content; replies, edits, unsend and typing where the engine offers them. [Read and typing](read-and-typing.md) records what the engine actually reports for read state and typing, and why the app draws no typing indicator on the surface the server uses.
