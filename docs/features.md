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
- A theme the server holds, applied by every client without a rebuild, with light and dark both drawn from it and a skin that follows the system by default: `core/test/rules.test.js`, "a theme turns into custom properties for the scheme in force" and "a tweakcn theme is imported..."; the desktop smoke asserts the theme reaches the page in both schemes.
- A tweakcn theme converted into the token set, with every name it cannot carry refused and named: `core/test/rules.test.js`, "a tweakcn theme is imported, and every name it cannot carry is refused out loud".
- A settings page that reads and writes the settings the server holds, and redraws when a change made anywhere arrives on the event stream; an about page drawn from the server's info route; and, below phone width, one pane at a time with the list sliding in over the conversation and a way back: the desktop smoke.
- The settings page's schema, its defaults and what a control writes: `core/test/rules.test.js`, "the settings page draws the schema and writes the value a control gives".
- The chat list sorted by activity, unread first, name or a stored manual order, and filtered by unread, a named group, direct or group conversations and a text search, with the arrangement and the person-made groups held on the server: `core/test/rules.test.js`, "the list sorts by activity, unread, name and the manual order the server holds", "filters compose, clear one at a time, and search names and last messages", "groups keep their own order, draw as sections, and never lose an ungrouped chat"; `server/test/api.test.js`, "a chat arrangement is held on the server and read back on a reconnect".

## Planned

iPhone and Android apps; webhooks; export and backup; scheduled messages; the server looking after the Mac; metrics and tracing; the emoji engine and skins; rich content; replies, edits, unsend and typing where the engine offers them. [Read and typing](read-and-typing.md) records what the engine actually reports for read state and typing, and why the app draws no typing indicator on the surface the server uses.
