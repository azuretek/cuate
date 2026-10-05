# Test releases

A push to main that changes a shipped path produces a test build: the desktop apps, the server and the Android APK, one version, one GitHub prerelease. A manual workflow dispatch compares the snapshot with the most recent reachable dev tag and refuses if nothing ships. Documentation, Markdown, root scripts, workflow files, hooks, LICENSE and .gitignore do not trigger a release. A server-only change does: the server ships with the clients. Unknown paths ship by default. The sole classifier is scripts/release/changes.mjs.

## Stable releases: the tag lane

A real release is cut only by a `vX.Y.Z` tag, never automatically. The tag is produced by release-please (`release-please-config.json`, `.release-please-manifest.json`, `.github/workflows/release-please.yml`), which watches `main`, keeps ONE pull request open that carries the next version bump and its `CHANGELOG.md` entry together, and, when that pull request merges, bumps every file that carries the version and creates the tag. It is mirrored from chela. The settings that make the tag lane work, missing from the first attempt here (pull request #278), are `draft: true` and `force-tag-creation: true`, beside `include-v-in-tag: true` and `include-component-in-tag: false`.

No personal access token is needed for the release path. The tag is created through the GitHub API with `GITHUB_TOKEN`, and GitHub raises no workflow event for anything pushed with that token, so `release.yml`'s `push: tags` trigger would never fire for it. `workflow_dispatch` IS exempt from that restriction, so `release-please.yml` starts `release.yml` on the new tag with `gh workflow run release.yml --ref <tag>`.

`release.yml` then builds every platform on the tag, attaches the assets to the draft release-please opened, and publishes only once the whole asset set is present. The draft is release-please's and carries the changelog that is the release body, so the publisher keeps it and attaches to it rather than deleting it (`scripts/release/release.mjs`). Two invariants hold before anything is built or uploaded: the tag must agree with every file that owns the version, refused loudly and before the build when it does not, and every required platform must be green on the commit, through the same sole `platforms` gate call the test build uses. Exactly one gate call carries `purpose: publish`; the tag lane folds into it rather than adding a second tagger.

Where cuate differs from chela, and why:

- chela publishes one release carrying a desktop interface and a mobile one; cuate's release carries the desktop apps, the server artifact and the signed Android APK beside a TestFlight build, so the asset checks are cuate's own (`scripts/release/assets.mjs`, `scripts/release/server-artifact.mjs`, `scripts/release/android-artifact.mjs`).
- cuate's extra-files set is five files (`core/spec/version.json`, `desktop/package.json`, `server/package.json`, `ios/project.yml`, `android/app/build.gradle.kts`), where chela's is one; the tag-versus-files check reads the same five.
- chela installs iOS over the air from an ad-hoc manifest (`core/release.js`); cuate reaches iOS testers through TestFlight and has no ad-hoc OTA path yet. Chela's model is the model for cuate's own update path, not something mirrored now. cuate's phone update path is `core/app/rules/updates.js` over `core/spec/releases.json`.
- The dev lane is unchanged; the tag lane is added beside it.

## Per platform, what a test build reaches

| Platform | Test destination | Exists today |
|---|---|---|
| Desktop (macOS, Windows, Linux) | the `dev` update channel in the GitHub prerelease: the installers plus their `dev*.yml` metadata | yes |
| iOS | TestFlight, proven to reach VALID and the tester group it targets, through the platforms gate | yes |
| Android | the signed APK and its manifest on the same GitHub prerelease, for the app's own updater | yes |
| Android | a Play Console internal track | no: no Play publishing credential is configured, so nothing is uploaded there |
| Desktop stable | a `latest*.yml` stable update channel | no: the packaging leg writes and uploads `dev*.yml` only; widening it to a stable channel is follow-up work, named here rather than left silent |
| macOS, Windows stores | a signed store submission | no: macOS installers are Developer ID signed and Windows installers are unsigned, not store submissions |

The release lane publishes the GitHub release assets (the durable copy) and, where a store destination exists, the store. The destinations that do not exist are named above.


## Snapshot and channels

The version is the root package's next patch followed by -dev.<commit-count>.<first-ten-SHA-characters>. The root version is not rewritten by CI. The exact version is embedded in the desktop package and returned by app.info. All jobs check out the event SHA.

scripts/release/version.mjs is the one producer of that version. The desktop packages take it as BUILD_VERSION, the iOS archive as CUATE_BUILD_VERSION, the Android APK as its versionName, and the server as its stamp (scripts/gen-server-stamp.mjs, which refuses a BUILD_VERSION that differs from what version.mjs derives for the commit). desktop/test/one-version.test.js fails when any of them is wired to anything else or when the server stamp and the desktop package would name different versions for one commit.

A test build is one GitHub prerelease, tagged v<version>. Installed prereleases follow dev; a version without a prerelease identifier follows latest. The updater checks at launch and every four hours, downloads in the background, notifies when ready and installs on the next quit/restart. Development and smoke-test launches never contact the update service. No credentials are shipped in the app.

Full releases will select an exact snapshot through a separately designed process. This workflow deliberately has no stable/tag publication path. A test build publishes only once the platforms gate is satisfied: every job in every pipeline that builds a platform on that commit has concluded success, the iOS release job included, and that job is the archive, the TestFlight upload, its wait for the build to reach VALID and its proof that the build reached the tester group it targets. A red, skipped, cancelled or missing leg on any platform refuses, so nothing publishes from a commit whose other platform did not build and test. A pipeline that lands later joins the gate by being named in the publishing gate call, which a test enforces.

## What ships

The server, built by `.github/workflows/server-artifact.yml` from the same commit and the same `BUILD_VERSION` as the desktop packages:

- `<slug>-server-<version>.tar.gz`: every tracked file under `core/` and `server/` except their tests, LICENSE, `server/stamp.json` written by `scripts/gen-server-stamp.mjs --root` into the staged copy, and the server's production dependencies copied out of the workspace install as plain files under `server/node_modules`. It is plain ustar, written by `server/src/artifact.js` with every file owned by 0:0 and dated the commit's time, so one commit builds the same bytes on any runner. It holds regular files only.
- `<slug>-server-<version>.manifest.json`: the version, the commit, the Node range (the root package's `engines.node`) and the path, size and SHA-256 of every file in the tarball.
- `<slug>-server-<version>.tar.gz.sha256`: the tarball's SHA-256, in the format `sha256sum -c` reads.

The Android APK (issue 192), signed with the release keystore by `.github/workflows/android.yml` from the same commit:

- `<slug>-android-<version>.apk`: the signed APK.
- `<slug>-android-<version>.manifest.json`: the version, the commit, the file, its size and SHA-256, and the SHA-256 of the certificate that signed it, written by `scripts/release/android-artifact.mjs build` from the signer `apksigner` reads back out of the APK. The release job fetches both from the android run for the commit (the platforms gate has already required it to succeed), and the publisher verifies them with the rest.

## Phone updates

The phones check the repository's public release feed (`releases.atom`, named in `core/spec/releases.json`), with no credential in the app; the page decides with `phoneUpdate` in `core/app/rules/updates.js` whether the newest release on the build's channel is newer than the running build. Every published test build passed the platforms gate, so it is in TestFlight and carries its APK. A check runs at launch (silent unless a newer build exists) and from About's Check for updates.

- iOS: the notice and About's button offer Open TestFlight, which opens TestFlight's own `itms-beta://` scheme and falls back to TestFlight's App Store page.
- Android: Download fetches the release's manifest and APK, checks the size and SHA-256 against the manifest and the APK's signer against both the manifest and the installed app, then Install hands it to Android's installer, which asks the person to confirm. The first time, the app says why it needs to install apps and opens Android's setting for it; the install continues when the person comes back.

The server leg runs the server's own tests, builds the three files, verifies them, then unpacks the verified bytes into a scratch folder, boots them over the fake engine and requires the health route to answer with the manifest's version and commit. CI runs the same leg on every pull request and push as `server artifact`, which the sole gate check needs. The release workflow runs it again for the release, and the publisher needs it, so a server that fails its tests, its build or its boot holds the whole release. The platforms gate covers it a second time: it names `ci`, whose test leg runs `server/test` and whose server leg builds this artifact.

The desktop apps:

- macOS arm64 and x64: DMG, ZIP and their external blockmaps. The application is Developer ID signed, notarized and stapled before packaging.
- Windows x64 and arm64: per-user NSIS installers and external blockmaps. No administrator prompt; Start menu and desktop shortcuts use the product name from the naming spec.
- Linux x86_64 and arm64: AppImage, with the differential blockmap embedded in the image.
- dev.yml, dev-mac.yml, dev-linux.yml and dev-linux-arm64.yml: update metadata. macOS and Windows feeds merge both native architectures rather than overwriting one leg with the other.

Every pull request runs all six native legs through the read-only reusable package workflow, regardless of changed paths. CI calls it without secrets, uses unsigned macOS builds and requires the packaging and merged-asset verdict in the existing sole gate check. The same gate also reads the iOS pipeline's whole job list through platforms-gate.yml, so a pull request that breaks the iOS leg fails the gate there as well as blocking the release. It neither signs nor publishes. The same workflow builds signed macOS apps only for main-branch push/manual release events; a manual dispatch on any other ref is refused before building or receiving secrets. Checkout credentials are not persisted in packaging jobs.

All six native legs run lint, unit tests, build checks and the packaged smoke before uploading. PR verification also merges all six legs and checks feed completeness and hashes. The publisher independently verifies every expected asset and each feed's SHA-512, and the server's three assets with the checks in `server/src/artifact.js`: the digest file names the tarball and matches its SHA-256; the manifest names this version and the commit being published, and a Node range; the tarball holds exactly the files the manifest lists, each with its size and SHA-256, nothing else, and no link, device or path outside its folder; and the stamp inside agrees with the manifest. Any failure stops the run before GitHub is reached. It then creates a draft, attaches the complete set, verifies GitHub's asset sizes and SHA-256 digests, then publishes. A failed partial draft is withdrawn; an abandoned draft for the publisher's own tag is cleared before re-uploading over it, and a rerun against a published release leaves it alone. Published dev builds are pruned to the newest ten; stable releases and unrelated prereleases are untouched. Workflow artifacts expire as fast as GitHub allows (retention-days: 1) because the release, not the artifact, is the durable copy. Builds never publish through electron-builder.

## Install

Download the asset matching your operating system and CPU from the repository's Releases page.

- macOS: open the DMG, drag the app to Applications and launch it there. ZIP is also the auto-update payload. Do not remove quarantine or bypass an unexpected signing warning; report it.
- Windows: run the matching EXE as your normal user. These installers are unsigned. SmartScreen may say Windows protected your PC / unrecognized app. After confirming the download came from this repository, choose More info, then Run anyway. Do not disable SmartScreen globally.
- Linux: mark the AppImage executable and run it from a writable location. Install your distribution's FUSE compatibility package if needed, or use APPIMAGE_EXTRACT_AND_RUN=1. Keep the AppImage writable for replacement by the updater.

Connect to your own server during onboarding. The server is not installed, reconfigured or enabled for sending by a desktop release.

The server artifact is published beside the desktop assets. The explicit `service install --release` command installs verified dev releases; installed servers auto-update unless paused in Settings or with `service update --pause`. To check a download by hand, run `sha256sum -c <slug>-server-<version>.tar.gz.sha256` beside the tarball, then `node scripts/release/server-artifact.mjs verify <folder> <version> [<commit>]` from a checkout, which runs every check the publisher ran, and `node scripts/release/server-artifact.mjs smoke <folder> <version>`, which boots the verified files over the fake engine. The installed updater runs these same checks from `server/src/artifact.js`, also requiring the digest recorded by GitHub. It switches only after draining work and taking a backup, holds writes through health probation, and rolls back on failure. See [server operations](server.md#installed-releases-and-safe-updates) for code/data separation, pause, rollback and recovery. Production migration remains a separate step after a released update and forced rollback are proven on the target Mac.

## Build and verify locally

Use Node 24 and the pinned pnpm version. Run pnpm install --frozen-lockfile, pnpm run lint, pnpm run test and pnpm run build. Generate the icons with pnpm --filter desktop icons; the Flor de muerto masters in core/spec/icon and the default theme's tokens are their only sources. PNG and ICO outputs are generated for the app window, installers, shortcuts and the tray, and the iOS and Android icon sets beside them.

Set BUILD_VERSION to the output of node scripts/release/version.mjs. `node scripts/release/server-artifact.mjs build <out>` builds the server's three assets from the committed tree, refusing a BUILD_VERSION the stamp does not derive. Then run pnpm --filter desktop package --linux --x64 (or --win / --mac and the native architecture). Every package command uses --publish never. node desktop/scripts/smoke-packed.mjs runs the packaged app against an isolated fake-engine server and requires its app.info version to match BUILD_VERSION. Linux needs a virtual display, for example xvfb-run -a. SMOKE_SOFTWARE_RENDERING=1 selects software rendering. When a smoke step fails, the run retains a bounded, sanitized `failure.json` (the surface state that explains it: the phase, the view, the sheet element and the animation it is running, and the update banner) and a `failure.png` screenshot beside the captures, uploaded even on failure; nothing is kept when the smoke passes.

Signed macOS CI requires CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY_P8, APPLE_API_KEY_ID and APPLE_API_ISSUER. The packaging wrapper requires all five, stages the notarization key in a private temporary file required by Apple's tooling, deletes it in finally, and refuses unsigned output. No value is logged.

Before declaring a release proven, download the published DMG and verify the contained app with codesign --verify --deep --strict, spctl --assess --type execute --verbose=2 (Notarized Developer ID), and xcrun stapler validate, then run its packaged smoke. Separately run the first published AppImage through an update to the second under a virtual display and compare the replaced file's SHA-512 to the published second asset. Unit tests and a locally packaged smoke do not substitute for those publication-time checks.
