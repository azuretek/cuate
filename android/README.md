# Cuate for Android

The native Android shell for Cuate: a Kotlin root hosting core's own page in a
WebView, with the shared rules evaluated in an embedded engine, the device token
in the Android Keystore and Android's process-exit history reporting a crash on
the next launch.

Status: **in development**. This is phase 1d of the plan: the shell, its pipeline
and a signed APK. The design and phased plan live in the Projects database; this
directory fills in as the phases land.

## What lives here

- `app/` the app module: the activity and its web view host, the host bridge,
  the Keystore store, the embedded engine and the exit-reason reporter.
- `app/src/androidTest/` the parity tests: the values the shell reads at runtime
  are the repository's, and the fixtures answer as they do in Node.
- `scripts/boot-proof.sh` the capture the pipeline runs: build, install, launch,
  screenshot.
- `gradlew`, `gradle/wrapper/` the wrapper a builder needs, so no Gradle install
  is required.

Nothing about the app itself lives here. Every screen and rule is in `core/`,
which `app/build.gradle.kts` copies into the APK's assets, so the shell supplies
a web view, secure storage, notifications and one host bridge, and nothing else.
The bridge answers exactly the commands in `core/spec/host-bridge.json` and
refuses anything else, the same contract the desktop and the iOS shell implement.

## Building

From this directory:

```
./gradlew :app:assembleDebug
```

The instrumented tests need a running emulator (or a device):

```
./gradlew :app:connectedDebugAndroidTest
```

## The pipeline

`.github/workflows/android.yml` is the Android half. On every pull request it
builds the debug app, boots it in an emulator and captures
`android/proof/android-boot.png`, then runs the instrumented tests. A shell that
only compiles is not a shell that runs, so the boot is the acceptance rather than
the compile.

On a push to `main`, or a manual run, it additionally builds a signed release
APK. That job needs the repository secrets `ANDROID_KEYSTORE_BASE64`,
`ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`.
Until they are set, a pull request still builds and boots; only a release run is
blocked, and it says which of them is missing.

## The engine

The embedded engine and the measurement that chose it are recorded in
[docs/ANDROID.md](../docs/ANDROID.md).
