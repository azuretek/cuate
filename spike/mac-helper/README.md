# Spike: the signed Mac helper (issue #479, Phase 0a and 0c)

Throwaway. This branch never merges; it exists to measure two things before the helper is built for real.

- **0a.** A signed `Cuate Helper.app` (bundle id `com.azuretek.cuate.helper`), run by a per-user launchd agent, is the responsible process for its own privacy checks, while the same binary spawned by `node` is charged to `node`.
- **0c.** A GitHub Actions job signs the bundle with the Developer ID Application certificate, notarizes it with the App Store Connect API key, staples it, and verifies it.

## Pieces

| File | What it is |
|---|---|
| `Sources/main.swift` | The helper. Serves line-delimited JSON-RPC on a Unix socket, accepts only peers of its own user, and answers `hello` and `chatdb.count` (opens the Messages database read-only and counts `message` rows). `--count` runs the method once and prints the result. |
| `Info.plist.in`, `helper.entitlements` | The bundle's Info.plist template and its Hardened Runtime entitlements. |
| `build.sh` | Compiles and assembles `Cuate Helper.app`; signs it when `SIGN_IDENTITY` is set. |
| `agent.plist.in` | The per-user launchd agent template used for the measurement. |
| `client.mjs` | Calls one method over the socket from Node. |
| `control.mjs` | The control: Node spawns the same binary as a plain child and calls it the same way. |
| `../../.github/workflows/spike-mac-helper.yml` | Sign, notarize, staple and verify on a macOS runner. |
