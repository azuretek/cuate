# Release rules

Adapted from Chela's desktop pipeline.

- No workflow path filters. scripts/release/changes.mjs owns whether a change ships; it never exempts a platform.
- CI calls package.yml on every PR without secrets, using unsigned macOS packages. Its six native smoke legs and merged-asset completeness job must pass the existing gate check. No second job is named gate.
- release.yml signs and publishes only on main push/manual events; non-main dispatches and PR events cannot publish. The publisher CLI separately rejects an untrusted apply.
- The platforms gate (platforms-gate.yml, its rules in scripts/release/gate.mjs) is the one gate a test build passes. A commit publishes only once EVERY job in every pipeline that builds a platform on it has concluded success, and the iOS pipeline's release job is the archive, the TestFlight upload and its wait for the build to reach VALID. No TestFlight claim is made by a desktop-only test release.
- Every pipeline that builds a platform must be named by the publishing gate call. desktop/test/gate.test.js fails when a workflow gains a push or a pull_request trigger without being named, so Android and the server package join the gate when their pipelines land rather than publishing silently.
- Only success passes. A missing run, a skipped job, a cancelled job and a timed-out job all refuse exactly as a failure does. A run whose legs were ALL cancelled by a newer run of the same workflow on the same branch stands down instead: the branch moved on, not a platform that broke.
- The gate's rules are tested rather than trusted. desktop/test/gate.test.js exercises each decision, and its guard test holds the platform list honest, because a gate that passes a commit it cannot see is the fault the gate exists to stop.
- One immutable event SHA and one computed version per run. No stable releases from this workflow.
- Package with --publish never. Only the final job gets contents: write and a publishing token.
- Test packaged applications, not just the source checkout. Upload installers only after the smoke succeeds.
- Merge architecture metadata deliberately. Check the complete expected asset set and feed hashes before creating a draft; verify uploaded bytes before publication.
- Never cancel a publishing run to start a newer one. Withdraw failed partial drafts; never replace published assets in place. Investigate and withdraw a draft left by a runner hard failure before rerunning that version.
- Keep ten published dev builds. Never prune a stable release or an unrelated prerelease.
- Branch protection and external publication approval are not changed by this workflow.
