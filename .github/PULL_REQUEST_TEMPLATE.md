## What changed

## Why

## Conventions

<!-- For UI work: name each convention in docs/CONVENTIONS.md this change follows or changes. A change to a convention edits that page in this pull request, with its issue and the test or smoke check that holds it. Write "none" for a change with no UI. -->

## How it was verified

- [ ] `pnpm run lint`, `pnpm run test` and `pnpm run build` pass
- [ ] Fixtures, captures and logs hold synthetic data only
- [ ] Every platform behaves the same (docs/CONVENTIONS.md, #445). Each platform this change reaches is listed here with the test, capture or probe that proved it there, and each shell's twin of a shell change is changed too: iOS, Android, desktop on macOS, Windows and Linux, and the web. A platform it cannot reach yet names its open issue.
- [ ] For UI work: the conventions it follows or changes are named above, and docs/CONVENTIONS.md is updated where one changed
- [ ] For a design, style or token change: CI validated every platform, and each one is listed here with what it checked. The desktop smoke asserts the rendered tokens in both light and dark on macOS, Windows and Linux; the phone legs run in their own pipelines.
