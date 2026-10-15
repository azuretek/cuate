# Android

The Android shell hosts core's own page in a WebView, evaluates the rules a
shell needs with no page on screen in an embedded JavaScript engine, keeps the
device token in the Android Keystore and reports its exit reasons the way the
iOS shell reads MetricKit. It is phase 1d of the plan: the shell, its pipeline
and a signed APK.

Build, run and signing instructions live in
[../android/README.md](../android/README.md). This page records the one decision
the phase asked to be made by measurement: which engine runs the rules a shell
needs before any page loads.

## The engine, chosen by measurement

A shell has two moments: the page (core's own app, which loads its own copy of
the rules as ES modules) and the time before it, when the shell needs rules with
no page at all. iOS evaluates `core/build/engine.js` in JavaScriptCore. Android
ships no JavaScriptCore, so the engine had to be chosen, and the choice was made
against the fixtures rather than by preference.

The bundle is the same one iOS runs: one IIFE defining the global `engine`,
about 19 KB, with no DOM and no Node builtin. The candidates were measured
against `core/fixtures/engine-cases.json`, which holds 22 cases across 12 rules.
The cases include the two that decide an engine: `time.days-ago` and
`time.list-time` call `Intl.DateTimeFormat`, and `validate.ok` and
`validate.problems` reach `Object.hasOwn`.

| Candidate | Runs the bundle? | Where it comes from |
|---|---|---|
| JavaScriptCore | yes, but iOS only | No maintained distribution for Android; the published Maven artifact stops at r174650 from 2015 |
| QuickJS (`app.cash.quickjs`) | no | No `Intl` and no `Object.hasOwn`, so the time and schema rules do not run and the fixtures fail on both |
| V8 in the platform WebView | yes | On every device, but a page host rather than an engine API |
| AndroidX JavaScriptEngine (`androidx.javascriptengine`) | yes | V8 in an isolate: an engine API with no page, stable at 1.1.1 |

**Chosen: AndroidX JavaScriptEngine.** It is the only candidate that both runs
the bundle and is an engine meant to be used with no page. It is V8, the engine
Node runs, so the fixtures answer as Node does by construction, and
JavaScriptCore's answers are held to the same file by `ios/CuateTests`. The shell
still boots when the engine cannot start: `Engine.open` returns null and the
page's own copy of the rules runs instead, the posture the iOS shell takes when
its JavaScriptCore context is nil.

The fixture suite runs in the emulator on every pull request
(`EngineFixturesTest`), and in Node and in JavaScriptCore beside it, so the
record below is re-measured on each run rather than asserted once:

- bundle: 19,927 bytes
- fixtures: 22 cases across 12 rules (scrub, formatTraceparent, parseTraceparent,
  orderChats, chatTitle, chatPreview, initials, connectionSentence, mapChat,
  validate, daysAgo, formatListTime)

## The pipeline

`.github/workflows/android.yml` is the Android half. On every pull request it
builds the debug app, boots it in an emulator, captures
`android/proof/android-boot.png` and runs the instrumented tests
(`connectedDebugAndroidTest`), which include the fixture parity above. A shell
that only compiles is not a shell that runs, so the boot is the acceptance rather
than the compile.

On a push to `main`, or a manual run, it additionally builds a signed release
APK and keeps it as an artifact. That job needs these repository secrets:

| Secret | What it is |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the release keystore (a .jks), base64 |
| `ANDROID_KEYSTORE_PASSWORD` | the keystore's password |
| `ANDROID_KEY_ALIAS` | the key's alias |
| `ANDROID_KEY_PASSWORD` | that key's password |

Until those are set the release job fails at its first step and names the missing
one, rather than publishing nothing in silence.

## What the platform cannot do

- Push without Google: Android's push route is UnifiedPush, with an embedded FCM
  distributor as the fallback (the plan's P2). It lands with the push track, not
  in this shell.
- A shared secure store: the device token and the cache key live in the Android
  Keystore rather than the Keychain, which is the same idea with a different
  store.
