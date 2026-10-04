// The overlay registry the design capture harness guards against, and the pure rule that decides whether a shot is
// clean. A capture is only trustworthy if the page holds what that screen asked for and nothing else: a panel left
// open by an earlier capture (an emoji picker under a short drawer, a menu, a thread) would be baked into the next
// screenshot and quietly misjudge it. The harness closes every panel before each shot and then reads the DOM back
// through these selectors, failing the run when one the screen did not ask for is still present.
//
// Each entry is [the name a failure prints, the selector the app renders that panel under].
const OVERLAYS = [
  ['sort menu', '.sort-menu:not(.search-menu)'],
  ['filter menu', '.filter-menu'],
  ['search menu', '.search-menu'],
  ['message menu', '.message-pop'],
  ['thread view', '.thread-view'],
  ['emoji panel', '.emoji-picker'],
  ['attach menu', '.attach-menu'],
  ['notice', '.app-notice'],
];

// The overlays present on the page that the screen did not ask for. Pure, so the rule is tested without a browser.
function unexpectedOverlays(present, allowed) {
  const want = new Set(allowed);
  return present.filter((name) => !want.has(name));
}

export { OVERLAYS, unexpectedOverlays };
