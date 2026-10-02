// Pure: which surface the page shows when the shell asks for a screen over the bridge event app.open (the desktop's tray
// menu). The shell only names the screen and raises the window; this decides what the page does with it, so the routing
// is tested with no Electron and no DOM.
//
//   settings   the settings sheet
//   about      the about page, on the same sheet
//   updates    the main surface with no sheet over it, which is where the update banner reports a check's outcome
//
// The sheets exist only once the app is connected. Before then (the boot splash, or the first read), a request is held
// and answered once the app is ready; on the sign-in page there is no sheet to show, so the window raised by the shell
// is the answer and the request is dropped.

export const OPEN_SCREENS = ['settings', 'about', 'updates'];

// What the page does with a requested screen in its current phase: a view to show ('settings', 'about' or 'main'),
// 'hold' to answer it once the app is ready, or null to do nothing.
export function screenFor(screen, { phase }) {
  if (!OPEN_SCREENS.includes(screen)) return null;
  if (phase === 'boot' || phase === 'loading') return 'hold';
  if (phase !== 'ready') return null;
  return screen === 'updates' ? 'main' : screen;
}
