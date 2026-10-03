# App notices

App update, download and progress events use floating cards. Chat message notifications keep their existing native route and never enter this surface.

The reference is the sibling application's `core/ui/banner.js`, `core/ui/banner.css`, `core/spec/banner.json` and `core/spec/tokens.json` at commit `cc91effb65ac64dfd5ed9a55fb9b108569620781`. The card keeps its stroke tone icon, message, separate detail, native progress, action and dismiss control. Width (370px) and corners (12px) come from that source; palette, spacing and motion use this application's current shared tokens. Shared-token integration is a merge-time follow-up, not a stacked branch.

Desktop cards enter from the right beneath the header and window controls. Phone-width cards enter from above with safe-area insets. The stack reserves the maximum composer height, is bounded by the dynamic viewport and does not claim transparent clicks. Sheets remain above notices. Reduced motion disables arrival animation.

An operation has a stable identity and a revision naming its phase/version. Repeated events do nothing; progress changes the existing card. Dismiss marks that revision read without cancelling the operation. Further progress stays read; a ready, stalled or failed outcome can announce itself. No expiry timer steals an actionable notice. The full-width update banner has been removed.

Verification: `core/test/app-notices.test.js` tests identity, progress, dismissal and geometry contracts. The supported desktop smoke exercises actual DOM identity, bridge actions, dismissal and captures synthetic light, dark and mobile layouts. Platform CI remains the release gate.
