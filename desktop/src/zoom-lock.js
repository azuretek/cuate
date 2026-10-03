// The desktop window never zooms (issue 180): only the media viewer zooms, inside the page, and text size is the
// text-size setting's. Electron's own pinch (visual zoom) is held at 1 where the window is made, and the zoom keys
// are refused here before Chromium or a menu sees them, so ctrl or cmd with +, = or - and 0 leave the page at 1.
// Kept free of Electron imports so it is tested in Node.
const KEYS = new Set(['+', '=', '-', '_', '0']);

export function blocksZoomKey(input) {
  if (!input || input.type !== 'keyDown') return false;
  return Boolean(input.control || input.meta) && KEYS.has(String(input.key));
}

// Applies the lock to one window's web contents.
export function lockZoom(webContents) {
  webContents.setVisualZoomLevelLimits(1, 1);
  webContents.on('before-input-event', (event, input) => { if (blocksZoomKey(input)) event.preventDefault(); });
  // A ctrl-wheel or a pinch asks through this event; nothing applies it, and any zoom that did land is put back.
  webContents.on('zoom-changed', () => { if (webContents.getZoomFactor() !== 1) webContents.setZoomFactor(1); });
}
