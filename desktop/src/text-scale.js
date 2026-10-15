// The system's text size on a desktop (issue 369), as a percentage the page scales its type by. No Electron here, so
// node --test holds every platform's reading. Windows keeps the Accessibility Text size slider (100 to 225) in the
// registry; GNOME keeps its text scaling factor (1.0 is normal) in gsettings, and `gsettings monitor` prints each
// change, so a change reaches the page as an event. macOS has no system-wide text size an app can read, so it answers
// null and the page draws 100%.
import { execFile, spawn } from 'node:child_process';

export const WINDOWS_KEY = 'HKCU\\Software\\Microsoft\\Accessibility';
export const GNOME_SCHEMA = 'org.gnome.desktop.interface';
export const GNOME_KEY = 'text-scaling-factor';

// `reg query` prints the value as hex: "    TextScaleFactor    REG_DWORD    0x7d". No value means the slider was never
// moved, which is 100.
export function parseWindowsTextScale(out) {
  const m = String(out ?? '').match(/TextScaleFactor\s+REG_DWORD\s+0x([0-9a-f]+)/i);
  if (!m) return 100;
  const n = parseInt(m[1], 16);
  return Number.isFinite(n) && n > 0 ? n : 100;
}

// gsettings prints a float ("1.25"), and `gsettings monitor` prints "text-scaling-factor: 1.25".
export function parseGnomeTextScale(out) {
  const m = String(out ?? '').match(/(\d+(?:\.\d+)?)\s*$/m);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : null;
}

const run = (file, args) => new Promise((resolve) => {
  try {
    execFile(file, args, { timeout: 3000, windowsHide: true }, (err, stdout) => resolve(err ? null : String(stdout)));
  } catch { resolve(null); }
});

// The percentage now, or null where the platform has none or the read failed.
export async function readTextScale(platform = process.platform, exec = run) {
  if (platform === 'win32') {
    const out = await exec('reg', ['query', WINDOWS_KEY, '/v', 'TextScaleFactor']);
    // A missing value fails the query, which is the slider at 100.
    return out === null ? 100 : parseWindowsTextScale(out);
  }
  if (platform === 'linux') return parseGnomeTextScale(await exec('gsettings', ['get', GNOME_SCHEMA, GNOME_KEY]));
  return null;
}

// Calls onChange(percent) whenever the system's text size changes, and returns a stop function. Linux hears GNOME's
// own change stream; Windows has no change notice for this value an app can subscribe to without native code, so it is
// read again each time the window is focused (the person changed it in Settings, then came back); macOS has none.
export function watchTextScale({ platform = process.platform, onChange, onFocus, spawnImpl = spawn, read = readTextScale }) {
  let last;
  const tell = (p) => { if (p !== last) { last = p; onChange(p); } };
  if (platform === 'linux') {
    let child = null;
    try {
      child = spawnImpl('gsettings', ['monitor', GNOME_SCHEMA, GNOME_KEY], { stdio: ['ignore', 'pipe', 'ignore'] });
      child.on('error', () => {});
      child.stdout.on('data', (chunk) => { for (const line of String(chunk).split('\n')) { const p = parseGnomeTextScale(line); if (p !== null) tell(p); } });
    } catch { child = null; }
    return () => { try { child && child.kill(); } catch { /* already gone */ } };
  }
  if (platform === 'win32' && typeof onFocus === 'function') return onFocus(() => { read(platform).then(tell, () => {}); });
  return () => {};
}
