# Contributing

## The loop

- `pnpm install`, then `pnpm run hooks:install` once, so lint runs before each commit and the tests before each push.
- `pnpm run lint`, `pnpm run test` and `pnpm run build` must pass. `pnpm run smoke` boots the desktop app against a fake server; it needs a display.
- `pnpm run build` also checks that every generated icon (desktop, tray, About, iOS and Android) matches what the Flor de muerto masters in `core/spec/icon` and the default theme's tokens draw. Regenerate them with `pnpm --filter desktop icons`. [Release instructions](release.md) cover packaged smoke tests.
- A design, style or token change is validated on every platform, not only the one it was written on. `pnpm run smoke` renders the app and asserts that the tokens the page RESOLVES match `core/spec/tokens.json` in both light and dark; CI runs it once per desktop platform (macOS, Windows, Linux), and the phone shells run their own legs, which the platforms gate requires. The platform list is `core/spec/platforms.json`, and `desktop/test/desktop-platforms.test.js` fails when a platform it names has no leg or a stated reason.
- New UI work names, in its pull request, the conventions in [conventions.md](conventions.md) it follows or changes. A change to a convention edits that page in the same pull request, citing its issue and the test or smoke check that holds it; `core/test/guards.test.js` fails when the page cites a test or smoke check that does not exist.
- Every change lands as a pull request and merges when CI is green. Commits follow Conventional Commits, and the message says why.
- The platforms gate decides what publishes: a test build goes out only when every pipeline that builds a platform on the commit is green, the iOS build reaching VALID in TestFlight and reaching the tester group it targets included, and a missing or skipped leg refuses. The rule lives in `scripts/release/gate.mjs` and `desktop/test/gate.test.js` holds it, so a new platform pipeline fails a test until it joins the gate rather than publishing silently.

## The rules, and the test that holds each

- A value several places must agree on lives in one spec under `core/spec/`, and the rest read it (`core/test/guards.test.js`).
- The server keeps no copy of code `core/` owns: a server function with the same name and body as a core one, or a longer one with a core function's body under another name, fails `core/test/shared-code.test.js`. Export the core function and import it.
- Code never carries the product's name; it reads `core/spec/naming.json` ("the product name lives only where naming.json says").
- Framework code in `core/kit/` imports only from the kit ("framework code in core/kit imports only from core/kit").
- Modules under `rules/` do no I/O and read no clock ("rule modules do no I/O").
- Every custom element is defined in core ("every custom element is defined in core").
- Component CSS takes every colour and length from the tokens ("component CSS carries no literal colours or lengths").
- Every log event and field is declared in `core/spec/log-events.json`, and nothing private is logged (the strict logger in the server's tests, and the leak test).
- Fixtures and captures hold synthetic data only (`server/test/fixtures.test.js`).
- No em dashes, in code, docs or commit messages ("no em dash anywhere in the repository").
- Every button goes through the kit's press behaviour, `press()` from `core/kit/press.js`, and draws no busy state or busy disabling of its own ("every button in core/app goes through the kit press behaviour"; the behaviour itself is `core/test/press.test.js`). Work a press starts is returned from its handler, or answered with `respond()` by the component that does it, so the control shows it.
- A press outside a panel closes it and does nothing else: every popover, menu and modal panel registers with `dismissable()` from `core/kit/dismiss.js`, marks its root `data-dismiss` and its trigger `data-dismiss-keep`, and keeps no outside-press, scrim-click or Escape dismissal of its own ("every popover and modal panel dismisses through the kit"; the behaviour itself is `core/test/dismiss.test.js`). The desktop smoke opens each panel at desktop and phone width, presses outside over a real control, and fails if the panel stays open, the control receives the press, or Escape leaves it open. On a phone Settings is a page that fills the screen, so its check presses the page's own back strip instead, which must close it and reach nothing underneath.
- Resizing keeps your place: every scroll container in the stylesheet keeps its position with `keepScroll()` from `core/kit/scroll.js` ("every scrolled view keeps its place through the kit"; `core/test/scroll.test.js`). The desktop smoke resizes the window and changes the text size with the conversation and the chat list scrolled back, and checks each stays on the same message. The Android shell handles rotation, split-screen resizing, the keyboard and dark mode itself, so none of them recreates its page ("the Android shell keeps its page through rotation and resizing").
- Nothing refreshes or shows a loading page: no code reloads the page or the window, and no component empties a list and then waits for its replacement ("nothing reloads the page or clears a list before its replacement arrives"). The desktop smoke reconnects, resyncs and changes the theme and a setting, and fails if a view ever drops to empty or a loading state appears. The conventions themselves are in [design.md](design.md#conventions-every-surface-keeps).
