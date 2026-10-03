# Design

Cuate has two halves: a headless server on a Mac that already runs Messages, and a client that runs on every platform from one shared core. This page is the design as built; [features.md](features.md) tracks what is done.

## Goals

- Every Messages feature an iPhone has that a Mac can reach, on macOS, Windows, Linux, iPhone, iPad and Android.
- One codebase for every screen and rule, so a fix lands everywhere at once.
- A server small enough to read in an afternoon, that is safe to leave running: it cannot send until you switch sending on, it never retries a send it is unsure about, and it never puts your messages in its logs.
- A framework other apps can be built on: this repository is the second app on it, after its sibling, and the reusable half lives in `core/kit/`.

## The framework model

- **One app, all of it in core.** Every screen, component and rule lives once in `core/` and runs as JavaScript everywhere. A shell supplies a window or web view, secure storage, notifications and one host bridge, and nothing else.
- **`core/kit/` is the framework and `core/app/` is this app.** A test fails if anything in the kit imports from outside it.
- **Specs own values.** `core/spec/api.json` is the contract between client and server, `log-events.json` is the allowlist of log events, `tokens.json` owns every colour and size, `host-bridge.json` declares what a page may ask its shell, and `naming.json` owns the product's names and ids. Code reads them; tests hold both sides to them.
- **Rules are pure.** Modules under `rules/` do no I/O and read no clock, so they are tested directly and give the same answer on every platform.
- **Components are Lit web components**, vendored as ESM with no build step. They render into light DOM for now; shadow DOM is a later, measured decision.
- **Styles come from tokens.** `scripts/gen-tokens.mjs` writes `core/app/styles/tokens.css`, a test fails when it is stale, and a test fails on a literal colour or length in component CSS.
- **A theme is the client's look.** The palette is the Control UI's own, not the platform's: no system-blue accent, no platform font stack, no platform chrome. A theme the server holds under `appearance.theme` overrides the same token set on every client, so palette, spacing, radii, type scale and elevation come from the theme and a theme chosen once reaches every device without a rebuild. An imported tweakcn theme is converted into that set by `core/app/rules/theme.js`, which names what it accepts and what it refuses; a tweakcn page URL is read from tweakcn's registry and brings the theme's whole design language, its fonts included (fetched once by the server and served to the clients, since the pages load nothing from the network); the settings page takes a pasted export, says what it carried and what it refused, and writes the result to the server like any other setting, and Use default writes null to put every client back on the default tokens.

## Conventions every surface keeps

These hold on every client (desktop, iPhone, iPad, Android) and every surface, and a change is held to them in review and by the tests named in [contributing.md](contributing.md).

- **Every button says what it is doing.** One press behaviour in the kit, `core/kit/press.js`, is used by every button and button-like control. A press that starts work marks its control pending until the work settles (`aria-busy`, and a spinner in place of the label), so a double press never starts it twice; the control then shows success or failure for a moment and returns to idle. Repeat presses on an instant action (a toggle, a menu item, a tab) are coalesced, never queued; a control that is a key, such as an emoji, repeats. The look is tokens (`--motion-press-hold`, `--motion-press-coalesce`, `--size-press-spinner`, the accent and danger colours), so an imported theme styles it, and reduced motion keeps the states without the animation. A component never disables a button to show it is busy, and never writes its own busy label.
- **Resizing keeps your place.** Resizing the window, rotating a phone, opening or closing the sidebar or a sheet, or changing the text size keeps the scroll position of every scrolled view (the conversation, the chat list, settings, the emoji panel), the open conversation, the selection, the composer's text and caret, and any open menu or sheet. A conversation anchored to its latest message stays anchored; one scrolled back stays on the same message. Every scrolled view holds its place through the kit's `core/kit/scroll.js`, which anchors to an item rather than to a pixel offset, so a re-render, older messages loading above and a picture loading keep it too.
- **Nothing refreshes or shows a loading page.** No change of state (a resync, a reconnect, a settings change, a theme change, a server update, a new message, a sign-in that is already signed in) reloads the page, rebuilds a view from empty or shows a loading screen. Data is refreshed in place and replaced in one step, keeping what is on screen until the new data is ready; choosing another conversation marks it in the list at once and swaps the pane when its messages arrive. The only full-screen wait is the very first connection, before there is anything to show.

## The server

- **Headless.** A Node process started by a LaunchAgent in the logged-in session, because Messages only runs there. A config file in its data folder, a command line (`init`, `token`, `sending`, `doctor`, `run`) and JSON log lines on stdout and stderr.
- **The engine adapter.** One interface over `imsg rpc` (JSON-RPC 2.0 over stdio), supervised with a backoff and resumed after the last row it saw. A fake engine answers the same methods over synthetic data, so the same adapter code runs in every test and in the desktop smoke.
- **The API** (`core/spec/api.json`, version 1): server info, chats newest first with a preview, a chat's history paged from newest to oldest, message search, attachments by id, sending text and files, threaded replies and tapbacks, and settings read and written. One WebSocket carries live events (new messages, tapbacks, server state, settings changes) and resumes after a reconnect from the last event the client saw, or tells the client to reload when it cannot.
- **Routes and commands are modules.** Each route is one module under `server/src/routes/` and each command one under `server/src/commands/`, mounted by the route id in the spec or the command name it declares, so a new route or command is a file rather than another branch in `app.js` or `main.js`.
- **The chat list is held in memory.** It and its previews are read as soon as the engine is ready. A live message moves its chat to the top, and the list is read again when a message arrives in a chat it does not hold, when it is five minutes old, or when a client asks for more chats than it holds. Page sizes live in `core/spec/api.json` under `paging`.
- **Unread is the engine's own read state, never a client's idea.** A chat's `unread` count is read from the engine and held with the list. Opening a conversation marks it read with `POST /api/v1/chats/:chatId/read`, which calls the engine's `read`; that marks every message read on the Mac, which is also what sends the read receipt, and the server tells every client through the `chat.read` event so the count agrees everywhere. The engine's read path runs through its IMCore bridge, so the Mac needs that bridge running (`imsg launch`, SIP disabled) for a read to clear.
- **Tokens and scopes.** Every route but the health check needs a bearer token in the Authorization header, never in a URL. A device token reads and sends, a tooling token reads, and an admin token does everything. Tokens are stored hashed.
- **Sending is the dangerous half.** It is off until switched on, rate limited, done at most once per client key, and an outcome the engine cannot vouch for is reported as uncertain and never retried. A reaction and a threaded reply are sends too, under the same switch and window; both ride the engine's bridge, so a Mac without it running refuses them cleanly rather than sending a reply outside its thread, and only the six standard tapbacks can be sent as a reaction.
- **Attachments** are served by an opaque id, only from inside the Messages attachments folder; HEIC photos are converted to JPEG with macOS's own `sips` when a client asks.
- **Loopback only.** The server never binds another address. To reach it from other devices, put a TLS front in front of it on the same Mac, such as `tailscale serve`.

## Logs, diagnostics and crashes

- Every log line is one JSON object whose event and fields are declared in `core/spec/log-events.json`; an undeclared event or field never reaches a sink. Fields are ids, counts, durations and states, and the only free text, an error message, is scrubbed of tokens, contact details and home paths.
- The default level logs failures, warnings and lifecycle changes, never the success path. Debug adds request timings.
- A flight recorder keeps the most recent lines at every level in memory. An uncaught error writes a crash record (the scrubbed stack and the recorder) and a Node diagnostic report to the diagnostics folder, then exits so the LaunchAgent starts it again. `SIGUSR2` writes a diagnostic report on demand.
- A test runs the whole API at debug with known tokens and message text, and fails if either reaches a log line.

## The client

- It speaks only the server's API: HTTP for reads and sends, one WebSocket for live events. fetch and WebSocket are injected, so the same client library runs in every shell and in the server's tests.
- The device token lives only in the shell's secure storage (Electron's safeStorage on desktop), handed to the page through the host bridge.
- The look is a theme the server holds: `appearance.skin` chooses light, dark or the system's scheme, the page writes the scheme and the theme's tokens onto the root as custom properties, and a change made on any device arrives on the event stream and redraws every client. The themes on offer are held under `appearance.themes` (one imported by URL is fetched by the server, never by the client), the one in force is a copy under `appearance.theme`, and `appearance.textScale` scales the type tokens by a percentage, writing nothing at 100%.
- Screens today: connect, the chat list, a conversation with sender runs, time separators, photos, tapbacks and delivery state, and the composer; a settings page that reads and writes the settings the server holds and redraws from the event stream, ending with an About section drawn from the shell's and the server's build reports. It arrives as a sheet: a card only as wide as its content needs, a top strip that is itself the back control, and a press on the backdrop outside the card as a second way back. Below phone width one pane shows at a time, the list sliding in over the conversation with a way back. A sent message shows at once and is replaced by the confirmed one when the server reports it.

## Testing

- The server's suite runs against the fake engine: auth and scopes, loopback binding, paging, search, settings kept on the server, sending (off, rate limited, duplicate, uncertain, failed), attachments, the event stream with resume, engine restarts, and the log leak test.
- Guard tests hold the framework's rules: the kit boundary, pure rules, custom elements only in core, no literal style values, the product name only where naming.json allows, fresh tokens, the pinned Lit build, the specs' consistency, and no em dash anywhere.
- CI runs the suites on Linux, macOS and Windows, and boots the desktop app under a virtual display against a real server over the fake engine, capturing what it drew.
- Fixtures are synthetic: handles in the fictional 555-555-01xx range or at example.com, and text written in the fixture file. A test asserts it.

## Next

The iPhone and Android shells and the release pipeline; settings kept on the server; webhooks, export and backup; message search; scheduled messages; the server looking after the Mac (staying awake, a Messages watchdog); metrics and tracing; the emoji engine and skins; and rich content (previews, Live Photos, contact and location cards). Each lands with its own tests.
