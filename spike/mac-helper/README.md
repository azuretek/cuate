# Spike: the signed Mac helper (issue #479, Phase 0a and 0c)

Throwaway. This branch never merges; it exists to measure the helper before the real one is built.

- **0a.** A signed `Cuate Helper.app` (bundle id `com.azuretek.cuate.helper`), run by a per-user launchd agent, is the responsible process for its own privacy checks, while the same binary spawned by `node` is charged to `node`.
- **0c.** A GitHub Actions job signs the bundle with the Developer ID Application certificate, notarizes it with the App Store Connect API key, staples it, and verifies it.
- **Permissions and menu bar.** The helper declares only the privacy keys it uses, has a setup screen a person starts, a menu bar item that reads the same capability object as the client, and tests that fail when a declared permission is missing from either.

## Pieces

| File | What it is |
|---|---|
| `Sources/CuateHelperCore/Capabilities.swift` | The one capability object: `sip`, `fullDiskAccess`, `contacts`, `automation`, and a reason plus action per missing field. Measured on every read, never cached. |
| `Sources/CuateHelperCore/SIPProbe.swift` | Parses `csrutil status`. Unknown is treated as enabled, the stricter case. |
| `Sources/CuateHelperCore/SetupModel.swift` | The setup screen's rows and the rule that setup never opens on launch. |
| `Sources/CuateHelperCore/MenuBarModel.swift` | The menu bar item's rows, badge and tooltip. The status item itself is AppKit. |
| `Sources/CuateHelper/SetupWindowController.swift` | The one screen, started by `--setup` or the menu item. Full Disk Access opens System Settings and offers Check Again; Automation and Contacts ask only from their buttons. |
| `Sources/CuateHelper/AppDelegate.swift` | The status item, its menu, restart and quit. It never activates the app unless the setup screen was started. |
| `Sources/CuateHelper/main.swift` | `--socket` runs the agent and its menu bar item; `--setup` shows the setup screen; `--capabilities`, `--setup-model` and `--menu-model` print the same models headlessly; `--count` is the old one-shot measurement. |
| `Info.plist.in`, `helper.entitlements` | The bundle's Info.plist template and its Hardened Runtime entitlements. Exactly two privacy keys. |
| `build.sh` | Builds a universal binary with SwiftPM and assembles `Cuate Helper.app`; signs it when `SIGN_IDENTITY` is set. |
| `test.sh` | `swift test`. No grants are changed and no prompt is shown. |
| `agent.plist.in` | The per-user launchd agent template. It loads into the Aqua session, because the menu bar item cannot initialize AppKit in a background session. |
| `client.mjs` | Calls one method over the socket from Node, with optional JSON params. |
| `control.mjs` | The control: Node spawns the same binary as a plain child and calls it the same way. |
| `../../.github/workflows/spike-mac-helper.yml` | Tests, signs, notarizes, staples and verifies on a macOS runner. |

## What the setup screen and menu bar read

Both read `Capabilities.current()`, which measures `csrutil status`, `CNContactStore.authorizationStatus` and `AEDeterminePermissionToAutomateTarget` with asking off. When SIP is disabled, `fullDiskAccess` is `notRequired`, because macOS enforces no file permission then. The same object is attached to every JSON-RPC reply and every error, so the menu badge and the client's message cannot disagree.

The tests cannot click a status item. They assert the menu model, every row's action and the setup model, and say so.
