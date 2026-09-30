# Cuate for iOS

The native iOS shell for Cuate: SwiftUI hosting core's own page in a WKWebView,
with the shared rules evaluated in JavaScriptCore, the device token in the
Keychain and MetricKit reporting crashes and hangs on the next launch.

Status: **in development**. This is phase 1c of the plan: the shell, its
pipeline and TestFlight. The design and phased plan live in the Projects
database; this directory fills in as the phases land.

## What lives here

- `Cuate/` the app target: the SwiftUI root, the web view host over core's own
  page, the host bridge, the Keychain store, the JavaScriptCore engine bundle and
  the MetricKit reporter.
- `CuateTests/` the parity tests: the values the shell reads at runtime are the
  repository's, asserted rather than assumed.
- `project.yml` the Xcode project's one owner; `Cuate.xcodeproj` is generated
  output and is not committed.

Nothing about the app itself lives here. Every screen and rule is in `core/`,
which `project.yml` copies into the bundle beside the app, so the shell supplies
a web view, secure storage, notifications and one host bridge, and nothing else.
The bridge answers exactly the commands in `core/spec/host-bridge.json` and
refuses anything else, the same contract the desktop implements.

## Building

The Xcode project is generated, not committed:

```
cd ios && xcodegen generate
```

Then, from `ios/`:

```
xcodebuild -project Cuate.xcodeproj -scheme Cuate -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' CODE_SIGNING_ALLOWED=NO build
```

The unit tests run on a simulator:

```
xcodebuild test -project Cuate.xcodeproj -scheme Cuate \
  -destination 'platform=iOS Simulator,name=iPhone 17'
```

## The pipeline

`.github/workflows/ios.yml` is the iOS half. On every pull request it generates
the project, builds for the simulator, boots the app in a simulator and captures
`ios/proof/ios-boot.png`, then runs the unit tests. A shell that only compiles
is not a shell that runs, so the boot is the acceptance rather than the compile.

On a push to `main`, or a manual run, it additionally archives, signs and
uploads a TestFlight build. That job needs these repository secrets, all from the
Apple team's vault:

| Secret | What it is |
|---|---|
| `ASC_KEY_P8` | the App Store Connect API key, in .p8 form |
| `ASC_KEY_ID` | the key's id |
| `ASC_ISSUER_ID` | the issuer id |
| `CUATE_DIST_P12_BASE64` | the Apple Distribution certificate and its key, base64 |
| `CUATE_DIST_P12_PASSWORD` | that certificate's password |

Until those are set, a pull request still builds and boots; only a release run is
blocked, and it says which of them is missing.
