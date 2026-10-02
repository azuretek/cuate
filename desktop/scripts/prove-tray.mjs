// Prove the tray (issue 115): the icon each platform shows, the menu it carries, and that menu as the platform draws it.
//
// Runs the real Electron on a runner (under xvfb-run on Linux) and never on a desktop a person is using. It builds the
// tray from the shell's own pieces (src/tray.js): the platform's icon file and the menu template, with commands that
// only record what was clicked. It then:
//
//   1. writes tray-menu.json, the menu as Electron resolved it (the label, type and id of every item), and fails when
//      the order is not Open, Settings, About, Check for updates, Quit;
//   2. pops the same menu up over a small window and captures the screen with the platform's own tool, so the PR can
//      show the menu as the platform draws it;
//   3. on macOS, captures the menu bar around the tray icon in the light appearance and then in the dark one, so the
//      template image is seen redrawn for each. Switching the appearance needs the runner to allow it; when it does
//      not, the step says so rather than passing a light capture off as a dark one.
//
// Captures are evidence: a platform with no capture tool, or one that refuses, is reported and does not fail the run.
// The menu's shape is the check, and it does.
//
//   xvfb-run -a node_modules/.bin/electron desktop/scripts/prove-tray.mjs [--shots DIR]
import { app, BrowserWindow, Menu, Tray, nativeImage, screen } from 'electron';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trayTemplate, trayIcon, trayLabels, TRAY_ITEMS } from '../src/tray.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CORE = path.resolve(HERE, '..', '..', 'core');
const naming = JSON.parse(fs.readFileSync(path.join(CORE, 'spec', 'naming.json'), 'utf8'));
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : path.join(os.tmpdir(), 'proof-tray');
fs.mkdirSync(SHOTS, { recursive: true });
app.setPath('userData', fs.mkdtempSync(path.join(os.tmpdir(), 'tray-proof-')));

const failures = [];
const notes = [];
const pass = (label) => console.log('OK   ' + label);
const fail = (label) => { console.log('FAIL ' + label); failures.push(label); };
const note = (label) => { console.log('NOTE ' + label); notes.push(label); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const scale = () => screen.getPrimaryDisplay().scaleFactor || 1;

// The whole screen, or a region of it, with the platform's own tool. Answers the file written, or null with a note.
function capture(name, region = null) {
  const file = path.join(SHOTS, name);
  try {
    if (process.platform === 'darwin') {
      execFileSync('screencapture', ['-x', ...(region ? ['-R' + [region.x, region.y, region.width, region.height].join(',')] : []), file], { timeout: 20000 });
    } else if (process.platform === 'win32') {
      // Screen pixels: the region is in points, so it is scaled by the display's factor first.
      const ps = [
        'Add-Type -AssemblyName System.Windows.Forms, System.Drawing',
        '$b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds',
        'if ($env:PROOF_REGION) { $r = $env:PROOF_REGION.Split(","); $b = New-Object System.Drawing.Rectangle ([int]$r[0]), ([int]$r[1]), ([int]$r[2]), ([int]$r[3]) }',
        '$i = New-Object System.Drawing.Bitmap $b.Width, $b.Height',
        '$g = [System.Drawing.Graphics]::FromImage($i)',
        '$g.CopyFromScreen($b.Location, [System.Drawing.Point]::Empty, $b.Size)',
        '$i.Save($env:PROOF_FILE, [System.Drawing.Imaging.ImageFormat]::Png)',
      ].join('; ');
      const scaled = region ? [region.x, region.y, region.width, region.height].map((n) => Math.round(n * scale())).join(',') : '';
      execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { timeout: 30000, env: { ...process.env, PROOF_FILE: file, PROOF_REGION: scaled } });
    } else {
      execFileSync('import', ['-window', 'root', ...(region ? ['-crop', region.width + 'x' + region.height + '+' + region.x + '+' + region.y, '+repage'] : []), file], { timeout: 20000 });
    }
  } catch (e) {
    note(name + ': no capture on this runner (' + String(e && e.message).split('\n')[0] + ')');
    return null;
  }
  if (!fs.existsSync(file) || fs.statSync(file).size === 0) { note(name + ': the capture tool wrote nothing'); return null; }
  pass(name + ' captured');
  return file;
}

// The macOS appearance, switched through System Events. Answers whether the switch took.
function setDark(on) {
  try {
    execFileSync('osascript', ['-e', 'tell application "System Events" to tell appearance preferences to set dark mode to ' + (on ? 'true' : 'false')], { timeout: 20000 });
    const now = execFileSync('osascript', ['-e', 'tell application "System Events" to tell appearance preferences to get dark mode'], { timeout: 20000, encoding: 'utf8' }).trim();
    return now === String(on);
  } catch (e) {
    note('the appearance could not be switched (' + String(e && e.message).split('\n')[0] + ')');
    return false;
  }
}

function describe(item) {
  return { id: item.id || null, label: item.label, type: item.type, enabled: item.enabled, visible: item.visible };
}

app.whenReady().then(async () => {
  // The proof captures the tray alone, so the window the menu pops over carries no application menu.
  Menu.setApplicationMenu(null);
  const clicked = [];
  const commands = Object.fromEntries(TRAY_ITEMS.map((id) => [id, () => clicked.push(id)]));
  const menu = Menu.buildFromTemplate(trayTemplate({ appName: naming.product, commands }));
  const resolved = menu.items.map(describe);
  fs.writeFileSync(path.join(SHOTS, 'tray-menu.json'), JSON.stringify({ platform: process.platform, electron: process.versions.electron, menu: resolved }, null, 2));
  const labels = trayLabels(naming.product);
  const order = resolved.filter((i) => i.type !== 'separator').map((i) => i.label);
  if (JSON.stringify(order) === JSON.stringify(TRAY_ITEMS.map((id) => labels[id]))) pass('the menu reads ' + order.join(', '));
  else fail('the menu reads ' + order.join(', '));
  for (const id of TRAY_ITEMS) menu.getMenuItemById(id).click();
  if (JSON.stringify(clicked) === JSON.stringify(TRAY_ITEMS)) pass('every item runs its own command');
  else fail('the items ran ' + clicked.join(', '));

  const icon = trayIcon(process.platform);
  const file = path.join(HERE, '..', 'src', 'assets', 'tray', icon.file);
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) fail('the tray icon ' + icon.file + ' loads');
  else pass('the tray icon ' + icon.file + ' loads at ' + JSON.stringify(image.getSize()));
  if (icon.template) {
    image.setTemplateImage(true);
    if (image.isTemplateImage()) pass('macOS draws the icon as a template image');
    else fail('macOS draws the icon as a template image');
  }
  const tray = new Tray(image);
  tray.setToolTip(naming.product);
  tray.setContextMenu(menu);
  await pause(1500);

  if (process.platform === 'darwin') {
    const b = tray.getBounds();
    if (b && b.width > 0) {
      const region = { x: Math.max(0, b.x - 120), y: 0, width: b.width + 240, height: Math.max(24, b.height + b.y) };
      const wasDark = execFileSync('osascript', ['-e', 'tell application "System Events" to tell appearance preferences to get dark mode'], { encoding: 'utf8', timeout: 20000 }).trim() === 'true';
      if (setDark(false)) { await pause(1500); capture('tray-menubar-light.png', region); }
      if (setDark(true)) { await pause(1500); capture('tray-menubar-dark.png', region); }
      setDark(wasDark);
    } else note('the tray reported no bounds, so the menu bar was not captured');
  }
  // Windows: the icon in the notification area, where the platform placed it (the overflow when the area is full).
  if (process.platform === 'win32') {
    const b = tray.getBounds();
    if (b && b.width > 0) capture('tray-icon-win32.png', { x: Math.max(0, b.x - 80), y: Math.max(0, b.y - 8), width: b.width + 160, height: b.height + 16 });
    else note('the tray reported no bounds, so the notification area was not captured');
  }

  // The menu as the platform draws it: the tray's own menu, popped up over a small window so it opens without a click
  // on the icon, which a runner cannot make.
  const win = new BrowserWindow({ width: 360, height: 260, x: 40, y: 80, show: true, backgroundColor: '#ffffff' });
  await win.loadURL('data:text/html,<body style="margin:0;background:#fff"></body>');
  await pause(500);
  menu.popup({ window: win, x: 16, y: 16 });
  await pause(1500);
  // Only the window and the menu over it: the rest of a runner's screen is the runner's, not the app's.
  const wb = win.getBounds();
  capture('tray-menu-' + process.platform + '.png', { x: Math.max(0, wb.x - 8), y: Math.max(0, wb.y - 8), width: wb.width + 16, height: wb.height + 16 });
  menu.closePopup(win);
  await pause(300);
  tray.destroy();
  fs.writeFileSync(path.join(SHOTS, 'tray-proof.json'), JSON.stringify({ platform: process.platform, failures, notes }, null, 2));
  console.log(failures.length ? 'tray proof failed: ' + failures.join('; ') : 'tray proof ok; captures in ' + SHOTS);
  app.exit(failures.length ? 1 : 0);
}).catch((e) => { console.error('tray proof failed: ' + (e && e.stack)); app.exit(1); });

// A deadline of its own, so a menu that never closes cannot hold the runner.
setTimeout(() => { console.error('tray proof timed out'); app.exit(1); }, 90000).unref();
