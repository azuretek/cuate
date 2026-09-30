# Desktop test releases

A push to main that changes a shipped path produces a test build. A manual workflow dispatch compares the snapshot with the most recent reachable dev tag and refuses if nothing ships. Documentation, Markdown, root scripts, workflow files, hooks, LICENSE, .gitignore and the server tree do not trigger a desktop release. Unknown paths ship by default. The sole classifier is scripts/release/changes.mjs.

## Snapshot and channels

The version is the root package's next patch followed by -dev.<commit-count>.<first-ten-SHA-characters>. The root version is not rewritten by CI. The exact version is embedded in the desktop package and returned by app.info. All jobs check out the event SHA.

A test build is one GitHub prerelease, tagged v<version>. Installed prereleases follow dev; a version without a prerelease identifier follows latest. The updater checks at launch and every four hours, downloads in the background, notifies when ready and installs on the next quit/restart. Development and smoke-test launches never contact the update service. No credentials are shipped in the app.

Full releases will select an exact snapshot through a separately designed process. This workflow deliberately has no stable/tag publication path. Desktop-only test builds are supported while the mobile ports do not exist; new platform pipelines must join the completeness gate when they land.

## What ships

- macOS arm64 and x64: DMG, ZIP and their external blockmaps. The application is Developer ID signed, notarized and stapled before packaging.
- Windows x64 and arm64: per-user NSIS installers and external blockmaps. No administrator prompt; Start menu and desktop shortcuts use the product name from the naming spec.
- Linux x86_64 and arm64: AppImage, with the differential blockmap embedded in the image.
- dev.yml, dev-mac.yml, dev-linux.yml and dev-linux-arm64.yml: update metadata. macOS and Windows feeds merge both native architectures rather than overwriting one leg with the other.

Every pull request runs all six native legs through the read-only reusable package workflow, regardless of changed paths. CI calls it without secrets, uses unsigned macOS builds and requires the packaging and merged-asset verdict in the existing sole gate check. It neither signs nor publishes. The same workflow builds signed macOS apps only for main-branch push/manual release events; a manual dispatch on any other ref is refused before building or receiving secrets. Checkout credentials are not persisted in packaging jobs.

All six native legs run lint, unit tests, build checks and the packaged smoke before uploading. PR verification also merges all six legs and checks feed completeness and hashes. The publisher independently verifies every expected asset and each feed's SHA-512, creates a draft, attaches the complete set, verifies GitHub's asset sizes and SHA-256 digests, then publishes. A failed partial draft is withdrawn. Published dev builds are pruned to the newest ten; stable releases are untouched. Builds never publish through electron-builder.

## Install

Download the asset matching your operating system and CPU from the repository's Releases page.

- macOS: open the DMG, drag the app to Applications and launch it there. ZIP is also the auto-update payload. Do not remove quarantine or bypass an unexpected signing warning; report it.
- Windows: run the matching EXE as your normal user. These installers are unsigned. SmartScreen may say Windows protected your PC / unrecognized app. After confirming the download came from this repository, choose More info, then Run anyway. Do not disable SmartScreen globally.
- Linux: mark the AppImage executable and run it from a writable location. Install your distribution's FUSE compatibility package if needed, or use APPIMAGE_EXTRACT_AND_RUN=1. Keep the AppImage writable for replacement by the updater.

Connect to your own server during onboarding. The server is not installed, reconfigured or enabled for sending by a desktop release.

## Build and verify locally

Use Node 24 and the pinned pnpm version. Run pnpm install --frozen-lockfile, pnpm run lint, pnpm run test and pnpm run build. Generate the placeholder artwork with pnpm --filter desktop icons; desktop/build/icon.svg is its only drawing source. PNG and ICO outputs are generated for the app window, installers and shortcuts.

Set BUILD_VERSION to the output of node scripts/release/version.mjs. Then run pnpm --filter desktop package --linux --x64 (or --win / --mac and the native architecture). Every package command uses --publish never. node desktop/scripts/smoke-packed.mjs runs the packaged app against an isolated fake-engine server and requires its app.info version to match BUILD_VERSION. Linux needs a virtual display, for example xvfb-run -a. SMOKE_SOFTWARE_RENDERING=1 selects software rendering.

Signed macOS CI requires CSC_LINK, CSC_KEY_PASSWORD, APPLE_API_KEY_P8, APPLE_API_KEY_ID and APPLE_API_ISSUER. The packaging wrapper requires all five, stages the notarization key in a private temporary file required by Apple's tooling, deletes it in finally, and refuses unsigned output. No value is logged.

Before declaring a release proven, download the published DMG and verify the contained app with codesign --verify --deep --strict, spctl --assess --type execute --verbose=2 (Notarized Developer ID), and xcrun stapler validate, then run its packaged smoke. Separately run the first published AppImage through an update to the second under a virtual display and compare the replaced file's SHA-512 to the published second asset. Unit tests and a locally packaged smoke do not substitute for those publication-time checks.
