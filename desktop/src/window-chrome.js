// The desktop window's own chrome: the BrowserWindow options each platform needs, and the geometry of the macOS
// traffic lights whose strip the app leaves clear.
//
// This is the shell's half of the window chrome. Core runs the app's surfaces to the top edge and pushes the content
// down on macOS by the token size.window-strip, which desktop/test/window-chrome.test.js holds to WINDOW_STRIP_HEIGHT
// so the two cannot drift.

// The strip at the top of the window the macOS traffic lights float over, the value the token size.window-strip
// carries. The app's content starts below it so nothing sits under the lights.
export const WINDOW_STRIP_HEIGHT = 32;

// Where the traffic lights sit: they start at MAC_LIGHTS_X, and MAC_LIGHTS_PX is the size their vertical centre is
// derived from.
export const MAC_LIGHTS_X = 16;
export const MAC_LIGHTS_PX = 16;

// How far Windows and Linux set the app's own window controls in from the window's top edge and from its right edge,
// the one value both offsets share so the controls sit square in the corner. It is the token size.window-control-inset,
// which desktop/test/window-chrome.test.js holds to this, and the window-chrome proof measures it on the drawn page.
export const WINDOW_CONTROL_INSET = 6;

// The BrowserWindow options for a platform. macOS keeps its traffic lights, so it asks for the inset title bar and
// places them over the app's own surface; Windows and Linux draw no platform frame at all, because the app draws the
// window controls in its own header there.
export function windowOptions(platform = process.platform) {
  if (platform === 'darwin') {
    return {
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: MAC_LIGHTS_X, y: (WINDOW_STRIP_HEIGHT - MAC_LIGHTS_PX) / 2 },
    };
  }
  return { frame: false };
}
