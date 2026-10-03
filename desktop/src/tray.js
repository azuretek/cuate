// The tray and the window's lifecycle, with no Electron in it, so one `node --test` run holds every platform's answer.
//
// Closing the window hides it: the app keeps running in the tray (the menu bar on macOS, the notification area on
// Windows and Linux), so the page keeps its connection to the server, notices keep firing and a send in flight
// finishes. Quitting is the one way out, and it is an explicit act: the tray's Quit, or a quit the platform itself
// asks for (the Dock's Quit, a log out, an update's restart), which Electron reports as before-quit. Nothing else ends
// the app.
//
// The tray's items open screens inside the app rather than separate dialogs. Each raises the window first, restoring it
// when it was minimised and showing it when it was hidden, then tells the page which screen to show over the bridge
// event app.open. The page decides what that screen is (core/app/rules/screens.js), so this file only routes: About,
// for one, opens Settings at its last section, About (issue 134), and there is no separate About page.

// The items the tray carries, in order. Separators are layout, not commands.
export const TRAY_ITEMS = ['show', 'settings', 'about', 'checkUpdates', 'quit'];

// The screens the shell may ask the page for, the values of app.open's screen. core/spec/host-bridge.json declares the
// same list and desktop/test/tray.test.js holds the two together.
export const SCREENS = ['settings', 'about', 'updates'];

// The labels, one per command, so the tray and anything else that offers the same command cannot word it differently.
export function trayLabels(appName) {
  return {
    show: 'Open ' + appName,
    settings: 'Settings\u2026',
    about: 'About ' + appName,
    checkUpdates: 'Check for updates\u2026',
    quit: 'Quit ' + appName,
  };
}

// The tray menu as a template for Menu.buildFromTemplate. `commands` maps each item to its click.
export function trayTemplate({ appName, commands }) {
  const labels = trayLabels(appName);
  const item = (id) => {
    if (typeof commands[id] !== 'function') throw new Error('no tray command "' + id + '"');
    return { id, label: labels[id], click: () => commands[id]() };
  };
  const sep = { type: 'separator' };
  return [item('show'), sep, item('settings'), item('about'), item('checkUpdates'), sep, item('quit')];
}

// The application menu. Windows and Linux carry none (issue 109): the window draws its own bar. macOS keeps the least
// its menu bar needs, because that is where Cmd+Q, Cmd+, and the text shortcuts live there: with no menu Cmd+Q does
// nothing, and copy and paste stop working in the text fields. Its About, Settings and Quit are the tray's own
// commands, so the menu bar's Quit and the tray's Quit are one function and quit the same way.
export function appMenuTemplate({ platform, appName, commands }) {
  if (platform !== 'darwin') return null;
  const labels = trayLabels(appName);
  const item = (id, accelerator) => {
    if (typeof commands[id] !== 'function') throw new Error('no app menu command "' + id + '"');
    return accelerator ? { id, label: labels[id], accelerator, click: () => commands[id]() } : { id, label: labels[id], click: () => commands[id]() };
  };
  const sep = { type: 'separator' };
  return [
    { label: appName, submenu: [item('about'), sep, item('settings', 'Command+,'), sep, item('quit', 'Command+Q')] },
    // The standard Edit menu: undo, redo, cut, copy, paste and select all, with their usual shortcuts.
    { role: 'editMenu' },
  ];
}

// The tray's image per platform, as a file under desktop/src/assets/tray. macOS takes a template image, a black
// silhouette the menu bar redraws light or dark to suit itself (the name ends in Template, which is how Electron knows,
// and the @2x file beside it serves Retina). Windows takes an ICO carrying every size the notification area asks for at
// each scaling, and Linux a PNG sized for the panel, both in the app's own colours.
export function trayIcon(platform) {
  if (platform === 'darwin') return { file: 'trayTemplate.png', template: true };
  if (platform === 'win32') return { file: 'tray.ico', template: false };
  return { file: 'tray.png', template: false };
}

// The window's lifecycle. `getWindow` answers the window or null, `createWindow` makes one, `send` hands an event to
// the page, `quitApp` ends the process and `checkUpdates` runs the update check the app already runs on its schedule.
export function createLifecycle({ getWindow, createWindow, send, quitApp, checkUpdates }) {
  let quitting = false;
  // A screen asked for while the page is still loading is handed over once it has loaded, or the event would be lost.
  let pending = null;

  const live = () => {
    const w = getWindow();
    return w && !w.isDestroyed() ? w : null;
  };

  // Raise the window: made again if it was gone, restored if minimised, shown if hidden, and given focus.
  const show = () => {
    const w = live() || createWindow();
    if (w.isMinimized()) w.restore();
    w.show();
    w.focus();
    return w;
  };

  const open = (screen) => {
    if (!SCREENS.includes(screen)) throw new Error('no screen "' + screen + '"');
    const w = show();
    if (w.webContents.isLoading()) pending = screen;
    else send(w, 'app.open', { screen });
    return screen;
  };

  const quit = () => {
    quitting = true;
    quitApp();
  };

  return {
    get quitting() { return quitting; },
    // A quit the platform asked for (before-quit), or one the shell is about to start (an update's restart): every
    // close from here on is a real close.
    markQuitting() { quitting = true; },
    // The window's close event. Closing hides the window unless the app is quitting; the answer says which happened.
    onClose(event) {
      if (quitting) return 'close';
      event.preventDefault();
      const w = live();
      if (w) w.hide();
      return 'hide';
    },
    // The page finished loading: hand over a screen asked for while it was on its way.
    loaded() {
      const w = live();
      if (!pending || !w) return null;
      const screen = pending;
      pending = null;
      send(w, 'app.open', { screen });
      return screen;
    },
    show,
    open,
    quit,
    // The tray's commands. Check for updates raises the window and puts the page on the surface where the update
    // banner is seen, then runs the existing check, whose outcome arrives as an update state like the scheduled one.
    commands() {
      return {
        show: () => { show(); },
        settings: () => { open('settings'); },
        about: () => { open('about'); },
        checkUpdates: () => { open('updates'); checkUpdates(); },
        quit,
      };
    },
  };
}
