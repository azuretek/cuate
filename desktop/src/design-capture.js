import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OVERLAYS, unexpectedOverlays } from './design-capture-guard.js';

// The design capture harness: run by desktop/scripts/smoke.mjs with SMOKE_DESIGN set, against the same fake-engine
// server the smoke boots. It draws the chats list, a conversation with the composer, the sort, filter and search
// menus, a notice, the thread view, a message menu and the emoji panel, in light and dark, at desktop and phone
// width, with the default palette and with an imported tweakcn theme, and reads the text contrast of every surface
// role the direction maps.
//
// Every capture starts from a clean page. A screenshot is only worth judging if it holds what its screen asked for
// and nothing else, so before each shot the harness resets EVERY panel to closed and then asserts, from the DOM, that
// only the overlays this screen wants are open (design-capture-guard.js). A panel left open by an earlier capture is
// what made the phone chats shot carry a stray emoji panel under a short drawer, so the guard fails the run instead
// of baking the leak into the next capture.
const PAIRS = [
  ['page text', '--role-page-fg', ['--role-page']],
  ['page muted text', '--role-page-muted', ['--role-page']],
  ['chat name on sidebar', '--role-sidebar-fg', ['--role-sidebar']],
  ['chat preview and time on sidebar', '--role-sidebar-muted', ['--role-sidebar']],
  ['row hover: name', '--role-row-hover-fg', ['--role-sidebar', '--role-row-hover']],
  ['row hover: preview', '--role-sidebar-muted', ['--role-sidebar', '--role-row-hover']],
  ['row press: name', '--role-row-hover-fg', ['--role-sidebar', '--role-row-press']],
  ['selected row: name', '--role-row-selected-fg', ['--role-sidebar', '--role-row-selected']],
  ['selected row: preview', '--role-row-selected-muted', ['--role-sidebar', '--role-row-selected']],
  ['avatar initials', '--role-avatar-fg', ['--role-sidebar', '--role-avatar']],
  ['search text', '--role-search-fg', ['--role-sidebar', '--role-search']],
  ['search placeholder', '--color-placeholder', ['--role-sidebar', '--role-search']],
  ['conversation header name', '--role-page-fg', ['--role-page', '--role-conv-head']],
  ['composer text', '--role-composer-field-fg', ['--role-page', '--role-composer-bar', '--role-composer-field']],
  ['composer placeholder', '--color-placeholder', ['--role-page', '--role-composer-bar', '--role-composer-field']],
  ['sent bubble', '--role-sent-fg', ['--role-page', '--role-sent']],
  ['received bubble', '--role-received-fg', ['--role-page', '--role-received']],
  ['notice text', '--role-notice-fg', ['--role-page', '--role-notice']],
  ['notice detail', '--role-notice-muted', ['--role-page', '--role-notice']],
  ['notice action', '--role-notice-action', ['--role-page', '--role-notice']],
  ['notice action hover', '--role-notice-action', ['--role-page', '--role-notice', '--role-notice-hover']],
  ['menu item', '--role-menu-fg', ['--role-sidebar', '--role-menu']],
  ['menu note', '--role-menu-muted', ['--role-sidebar', '--role-menu']],
  ['menu checked item', '--role-menu-checked', ['--role-sidebar', '--role-menu']],
  ['menu item hover', '--role-menu-hover-fg', ['--role-sidebar', '--role-menu', '--role-menu-hover']],
  ['menu item press', '--role-menu-hover-fg', ['--role-sidebar', '--role-menu', '--role-menu-press']],
  ['filter chip', '--role-chip-fg', ['--role-sidebar', '--role-menu', '--role-chip']],
  ['filter chip hover', '--role-chip-fg', ['--role-sidebar', '--role-menu', '--role-chip-hover']],
  ['filter chip on', '--role-chip-on-fg', ['--role-sidebar', '--role-menu', '--role-chip-on']],
  ['header icon, open', '--role-head-icon-open-fg', ['--role-sidebar', '--role-head-icon-open']],
  ['header icon, hover', '--role-head-icon-hover-fg', ['--role-sidebar', '--role-head-icon-hover']],
  ['primary button', '--role-button-fg', ['--role-page', '--role-button']],
  ['primary button hover', '--role-button-fg', ['--role-page', '--role-button-hover']],
  ['primary button press', '--role-button-fg', ['--role-page', '--role-button-press']],
];
const SEPARATIONS = [
  ['composer field vs composer bar', '--role-composer-field', ['--role-page', '--role-composer-bar']],
  ['notice vs page', '--role-notice', ['--role-page']],
  ['menu vs sidebar', '--role-menu', ['--role-sidebar']],
  ['menu border vs menu', '--role-menu-border', ['--role-sidebar', '--role-menu']],
  ['row divider vs sidebar', '--role-row-divider', ['--role-sidebar']],
];
const lin = (c) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [hi, lo] = [lum(a), lum(b)].sort((p, q) => q - p); return (hi + 0.05) / (lo + 0.05); };
const over = (top, under) => { const a = top[3]; return [0, 1, 2].map((i) => top[i] * a + under[i] * (1 - a)).concat(1); };

async function runDesign(w, { nativeTheme, out, core, serverUrl, token, themeText, app }) {
  const wc = w.webContents;
  await new Promise((resolve) => wc.once('did-finish-load', resolve));
  const js = (code) => wc.executeJavaScript(code, true);
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  const waitFor = async (expr, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
      if (await js(expr)) return;
      if (Date.now() - t0 > ms) throw new Error('timed out waiting for ' + expr);
      await pause(200);
    }
  };
  const within = (p, ms) => Promise.race([p, pause(ms).then(() => null)]);
  const maybe = async (expr, ms = 1500) => { const t0 = Date.now(); for (;;) { try { if (await js(expr)) return true; } catch { /* not yet */ } if (Date.now() - t0 > ms) return false; await pause(150); } };
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3');
  const cdp = (m, p = {}) => wc.debugger.sendCommand(m, p);
  const shots = [];
  // The overlays on the page right now, by name, and the assertion that none is left. Both read the DOM, so the guard
  // sees what the screenshot will actually contain rather than what the harness believes it set.
  const overlaysPresent = '(' + JSON.stringify(OVERLAYS) + ').filter((p) => document.querySelector(p[1])).map((p) => p[0])';
  const overlaysClear = '(' + JSON.stringify(OVERLAYS) + ').every((p) => !document.querySelector(p[1]))';
  // A shot may also name the panel it is about: beside the full frame it writes a close crop of that panel and a
  // margin, so the caret and the panel edge read at size. The crop is the same page read back through CDP's own clip,
  // so it is the live pixels and never a second render.
  const shot = async (name, allowed = [], focus = '') => {
    const leaked = unexpectedOverlays(await js(overlaysPresent), allowed);
    if (leaked.length) throw new Error('overlay left open in ' + name + ': ' + leaked.join(', '));
    const r = await within(cdp('Page.captureScreenshot', { format: 'png' }), 8000);
    if (r && r.data) { writeFileSync(path.join(out, name), Buffer.from(r.data, 'base64')); shots.push(name); }
    if (!focus) return;
    const box = await js('(() => { const el = document.querySelector(' + JSON.stringify(focus) + '); if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; })()');
    if (!box || !(box.w > 0)) return;
    const m = 28;
    const clip = { x: Math.max(0, box.x - m), y: Math.max(0, box.y - m), width: box.w + m * 2, height: box.h + m * 2, scale: 2 };
    const c = await within(cdp('Page.captureScreenshot', { format: 'png', clip }), 8000);
    if (c && c.data) { const crop = name.replace(/\.png$/, '-crop.png'); writeFileSync(path.join(out, crop), Buffer.from(c.data, 'base64')); shots.push(crop); }
  };
  const auth = { authorization: 'Bearer ' + token, 'content-type': 'application/json' };
  const putSettings = (values) => fetch(serverUrl + '/api/v1/settings', { method: 'PUT', headers: auth, body: JSON.stringify({ values }) });
  await cdp('DOM.enable');
  await cdp('CSS.enable');
  const force = async (selector, classes) => {
    const { root } = await cdp('DOM.getDocument', { depth: -1 });
    const { nodeId } = await cdp('DOM.querySelector', { nodeId: root.nodeId, selector });
    if (nodeId) await cdp('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: classes });
    return Boolean(nodeId);
  };
  await waitFor("document.querySelector('app-root')?.dataset.state === 'ready' && document.querySelectorAll('.bubble-row').length > 0");
  await pause(600);
  const root = "document.querySelector('app-root')";
  const conv = "document.querySelector('app-conversation')";
  const threadRoot = await js('(() => { const c = ' + conv + '; const m = [...(c.messages || [])].reverse().find((x) => !x.fromMe && x.text); return m ? m.id : null; })()');
  if (threadRoot) {
    await js(root + ".send({ text: 'Corner table it is, I will grab it', replyTo: " + JSON.stringify(threadRoot) + ' }).then(() => true, () => false)');
    await pause(1500);
  }
  const { importTheme } = await import(pathToFileURL(path.join(core, 'app/rules/theme.js')).href);
  const elegant = importTheme(themeText).theme;
  const themes = [['default', null], ['elegant-luxury', elegant]];
  const contrast = {};
  const minimum = w.getMinimumSize();
  w.setMinimumSize(320, 400);
  for (const [themeId, theme] of themes) {
    await putSettings({ 'appearance.theme': theme });
    await pause(1200);
    for (const scheme of ['light', 'dark']) {
      nativeTheme.themeSource = scheme;
      await waitFor('document.documentElement.dataset.scheme === ' + JSON.stringify(scheme), 10000);
      await pause(500);
      contrast[themeId + '/' + scheme] = await measure(js);
      for (const [width, height, form] of [[1100, 720, 'desktop'], [390, 780, 'phone']]) {
        w.setSize(width, height);
        await pause(600);
        const tag = (n) => themeId + '--' + scheme + '--' + form + '--' + n + '.png';
        // Close every panel the harness can open, then wait until the DOM agrees none is left. The root owns the
        // menus and the notices, the conversation owns the message menu and the thread, and the composer owns the
        // emoji panel; leaving any one of them out is what leaked into the next capture.
        const resetState = async () => {
          await cdp('CSS.disable');
          await cdp('CSS.enable');
          await js('(() => { const r = ' + root + '; r.sortOpen = false; r.filterOpen = false; r.searchOpen = false; r.appNotices = []; const c = ' + conv + '; if (c) { if (c.replyingTo) c.closeThread(); if (c.pop) c.closePop(); c.reactFor = null; } const cmp = document.querySelector("app-composer"); if (cmp) { if (typeof cmp.closeEmoji === "function") cmp.closeEmoji(); cmp.emojiOpen = false; } document.activeElement?.blur(); return true; })()');
          await waitFor(overlaysClear, 5000);
          await pause(150);
        };
        const typed = "(() => { const t = document.querySelector('app-composer textarea'); if (!t) return false; t.value = 'Running ten minutes late, save me a seat'; t.dispatchEvent(new Event('input', { bubbles: true })); return true; })()";
        const listPane = async () => { if (form === 'phone') { await js('(() => { ' + root + '.listOpen = true; return true; })()'); await pause(700); } };
        const convPane = async () => { if (form === 'phone') { await js('(() => { ' + root + '.closeDrawer(); return true; })()'); await pause(700); } };
        await resetState();
        await listPane();
        await js(typed);
        await force('.chat-row:not(.selected)', ['hover']);
        await force('.conv-divider', ['hover']);
        await pause(250);
        await shot(tag('1-chats'), []);
        await resetState();
        await convPane();
        await js(typed);
        await shot(tag('2-conversation'), []);
        await listPane();
        await js("document.querySelector('.sidebar-head .sort-button').click()");
        await waitFor("Boolean(document.querySelector('.sort-menu:not(.search-menu)'))", 5000);
        await force('.sort-menu .sort-choice:not([aria-checked="true"])', ['hover']);
        await pause(250);
        await shot(tag('3-sort-menu'), ['sort menu'], '.sort-menu:not(.search-menu)');
        await resetState();
        await js("document.querySelector('.sidebar-head .filter-button').click()");
        await waitFor("Boolean(document.querySelector('.filter-menu'))", 5000);
        await force('.filter-menu .chip[aria-pressed="false"]', ['hover']);
        await pause(250);
        await shot(tag('4-filter-menu'), ['filter menu'], '.filter-menu');
        await resetState();
        await js("document.querySelector('.sidebar-head .search-mode-button')?.click()");
        await maybe("Boolean(document.querySelector('.search-menu'))", 1500);
        await force('.search-menu .sort-choice:not([aria-checked="true"])', ['hover']);
        await pause(250);
        await shot(tag('5-search-menu'), ['search menu'], '.search-menu');
        await resetState();
        await convPane();
        await js('(() => { ' + root + ".appNotices = [{ id: 'design-217', tone: 'info', message: 'Update 0.9 is ready to install', detail: 'It installs when you restart. Your conversations stay as they are.', action: { label: 'Restart now', command: 'design' }, percent: null, read: false }]; return true; })()");
        await waitFor("Boolean(document.querySelector('.app-notice'))", 5000);
        await pause(500);
        await force('.app-notice-action', ['hover']);
        await pause(200);
        await shot(tag('6-notice'), ['notice']);
        await resetState();
        if (threadRoot) {
          await convPane();
          await js('(() => { const c = ' + conv + '; const m = c.messages.find((x) => x.id === ' + JSON.stringify(threadRoot) + '); c.openThread(m); return true; })()');
          await waitFor("Boolean(document.querySelector('.thread-view'))", 5000);
          await pause(600);
          await shot(tag('7-thread'), ['thread view']);
          await resetState();
        }
        await convPane();
        await js('(() => { const c = ' + conv + '; const m = [...c.messages].find((x) => x.text); if (m) c.openMenu(m); return true; })()');
        await maybe("Boolean(document.querySelector('.message-menu'))", 1500);
        await pause(350);
        await shot(tag('8-message-menu'), ['message menu'], '.message-menu');
        await resetState();
        await convPane();
        await js('(() => { const cmp = document.querySelector("app-composer"); if (cmp) { cmp.emojiOpen = true; cmp.attachOpen = false; } return true; })()');
        await maybe("Boolean(document.querySelector('.emoji-picker'))", 1500);
        await pause(350);
        await shot(tag('9-emoji-panel'), ['emoji panel'], '.emoji-picker');
        await resetState();
        await convPane();
        await js('(() => { const cmp = document.querySelector("app-composer"); if (cmp) { cmp.emojiOpen = false; } return true; })()');
        await pause(350);
        await shot(tag('10-composer-tools'), [], '.composer-tools');
        await resetState();
      }
      w.setSize(1100, 720);
      await pause(300);
    }
  }
  w.setMinimumSize(minimum[0], minimum[1]);
  const failing = [];
  for (const [key, list] of Object.entries(contrast)) for (const row of list.text) if (row.ratio < 4.5) failing.push(key + ': ' + row.name + ' ' + row.ratio);
  writeFileSync(path.join(out, 'design-report.json'), JSON.stringify({ shots, contrast, failing }, null, 1));
  console.log('DESIGN ' + JSON.stringify({ shots: shots.length, failing }));
  app.exit(0);
}

async function measure(js) {
  const names = [...new Set([...PAIRS, ...SEPARATIONS].flatMap(([, fg, stack]) => [fg, ...stack]))];
  const rgba = await js(`(() => {
    const probe = document.createElement('span'); document.body.append(probe);
    const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    const out = {};
    for (const n of NAMES) {
      probe.style.setProperty('color', 'var(' + n + ')');
      const c = getComputedStyle(probe).color;
      g.clearRect(0, 0, 1, 1); g.fillStyle = c; g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      out[n] = { css: c, rgba: [d[0], d[1], d[2], d[3] / 255] };
    }
    probe.remove();
    return out;
  })()`.replace('NAMES', JSON.stringify(names)));
  const flatten = (stack) => stack.reduce((under, n) => over(rgba[n].rgba, under || [255, 255, 255, 1]), null);
  const text = PAIRS.map(([name, fg, stack]) => { const bg = flatten(stack); return { name, fg, on: stack.at(-1), ratio: Math.round(ratio(over(rgba[fg].rgba, bg), bg) * 100) / 100 }; });
  const surfaces = SEPARATIONS.map(([name, top, stack]) => { const bg = flatten(stack); return { name, ratio: Math.round(ratio(over(rgba[top].rgba, bg), bg) * 100) / 100 }; });
  return { text, surfaces, resolved: Object.fromEntries(Object.entries(rgba).map(([k, v]) => [k, v.css])) };
}

export { runDesign };
