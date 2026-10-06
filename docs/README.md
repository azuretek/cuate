# Documentation

Shared documentation for Cuate. One product with several shells, so anything true of more than one is written once here.

| Document | Answers |
|---|---|
| [ANDROID.md](ANDROID.md) | The Android shell hosts core's own page in a WebView, evaluates the rules a shell needs with no page on screen in an embedded JavaScript engine, keeps |
| [APP-NOTICES.md](APP-NOTICES.md) | App update, download and progress events use floating cards. |
| [CONTRIBUTING.md](CONTRIBUTING.md) | - `pnpm install`, then `pnpm run hooks:install` once, so lint runs before each commit and the tests before each push. |
| [CONVENTIONS.md](CONVENTIONS.md) | Every design decision Cuate has made that still holds, written as a rule with its reason, where it came from and what holds it. |
| [DESIGN.md](DESIGN.md) | Cuate has two halves: a headless server on a Mac that already runs Messages, and a client that runs on every platform from one shared core. |
| [FEATURES.md](FEATURES.md) | What works today, and the test that proves each. |
| [MCP.md](MCP.md) | Both are generated from [core/spec/api.json](../core/spec/api.json), the one owner of the routes, the models and the events. |
| [OBSERVABILITY.md](OBSERVABILITY.md) | What Cuate measures, where the numbers can be read, and what it deliberately does not measure. |
| [READ-AND-TYPING.md](READ-AND-TYPING.md) | The engine interface, not a timer or a local read mark, determines what we can say about another person (issue #72). |
| [RELEASE.md](RELEASE.md) | A push to main that changes a shipped path produces a test build: the desktop apps, the server and the Android APK, one version, one GitHub prerelease |
| [ROTATION-TESTS.md](ROTATION-TESTS.md) | The existing iOS and Android PR pipelines run a populated conversation through portrait, landscape and portrait again. |
| [SERVER.md](SERVER.md) | - macOS 14 or newer, signed in to Messages. |
| [design/](design/) | evidence for the claims we make |
| [proof/](proof/) | evidence for the claims we make |
