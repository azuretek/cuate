# Release rules

Adapted from Chela's desktop pipeline.

- No workflow path filters. scripts/release/changes.mjs owns whether a change ships; it never exempts a platform.
- Every existing desktop platform and architecture must pass before publication. iOS and Android join this gate when implemented. No TestFlight claim is made by a desktop-only test release.
- One immutable event SHA and one computed version per run. No stable releases from this workflow.
- Package with --publish never. Only the final job gets contents: write and a publishing token.
- Test packaged applications, not just the source checkout. Upload installers only after the smoke succeeds.
- Merge architecture metadata deliberately. Check the complete expected asset set and feed hashes before creating a draft; verify uploaded bytes before publication.
- Never cancel a publishing run to start a newer one. Withdraw failed partial drafts; never replace published assets in place. Investigate and withdraw a draft left by a runner hard failure before rerunning that version.
- Keep ten published dev builds. Never prune a stable release or an unrelated prerelease.
- Branch protection and external publication approval are not changed by this workflow.
