// The window controls' side and order, per platform, for the app's own bar in the contact header.
//
// Pure, so the page, the stylesheet's tests and the proof all read one answer. The platform arrives as data from the
// shell (host-bridge app.info); nothing here touches the platform or the OS.
//
// The controls are the ones the shell's window commands act on: minimize, toggleMaximize (the middle button) and
// close. macOS keeps its own traffic lights at the top left, so the app draws no controls there and leaves them room.

export const WINDOW_CONTROLS = ['minimize', 'maximize', 'close'];

// What the app draws for a platform: the side the controls sit on, the order they read in, and whether they are drawn
// at all. Windows and Linux put our controls at the top right of the contact header, close last. macOS is the one
// platform the app leaves alone, so its lights stay whatever the OS draws.
export function controlLayout({ platform } = {}) {
  const os = String(platform || '').toLowerCase();
  if (os === 'win32' || os === 'linux') return { side: 'right', order: WINDOW_CONTROLS.slice(), drawn: true };
  return { side: 'left', order: [], drawn: false };
}
