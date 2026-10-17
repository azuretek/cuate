import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { putNotice, dismissNotice, forgetRead, appUpdateNotice, noticeHoldMs, quietNotices, noticeState, noticeStateOf, withNoticeState, noticeQuiet, forgetNoticeState, noticeReadKey, sentNoticeRead, dropNoticeRead, noticeReadEcho, NOTICE_ECHO_LIMIT, NOTICE_READ_KEY } from '../app/rules/app-notices.js';

const download = (percent) => appUpdateNotice({ state: 'downloading', version: '1.2.3', percent });
test('duplicate events are silent and progress replaces one operation', () => {
  const first = putNotice([], download(0.1));
  assert.equal(putNotice(first, download(0.1)), first);
  const next = putNotice(first, download(0.7));
  assert.equal(next.length, 1);
  assert.equal(next[0].id, first[0].id);
  assert.equal(next[0].percent, 0.7);
});
test('dismissal suppresses repeated events and progress, but a new outcome is visible', () => {
  const read = dismissNotice(putNotice([], download(0.1)), 'app-update');
  assert.equal(putNotice(read, download(0.8))[0].read, true);
  const ready = putNotice(read, appUpdateNotice({ state: 'ready', version: '1.2.3' }));
  assert.equal(ready[0].read, false);
  assert.equal(ready[0].action.command, 'updates.install');
});
test('update notices clamp progress and reject unknown events', () => {
  assert.equal(download(-1).percent, 0);
  assert.equal(download(2).percent, 1);
  assert.equal(download(NaN).percent, null);
  assert.equal(appUpdateNotice({ state: 'chat.message' }), null);
  assert.equal(appUpdateNotice({ state: 'current' }).action, null);
});
test('a check in progress stays up for the min-visible floor; standing states and progress never wait', () => {
  const tokens = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url)));
  const floor = Number.parseInt(tokens.motion['min-visible'], 10);
  const checking = putNotice([], appUpdateNotice({ state: 'checking' }));
  const current = appUpdateNotice({ state: 'current', version: '1.2.3' });
  assert.equal(checking[0].transient, true);
  assert.equal(noticeHoldMs(checking, 'app-update', current, 1000, 1100, floor), floor - 100);
  assert.equal(noticeHoldMs(checking, 'app-update', null, 1000, 1100, floor), floor - 100);
  assert.equal(noticeHoldMs(checking, 'app-update', current, 1000, 1000 + floor, floor), 0);
  assert.equal(noticeHoldMs(checking, 'app-update', appUpdateNotice({ state: 'checking' }), 1000, 1100, floor), 0);
  assert.equal(noticeHoldMs(dismissNotice(checking, 'app-update'), 'app-update', current, 1000, 1100, floor), 0);
  const downloading = putNotice([], download(0.1));
  assert.equal(downloading[0].transient, false);
  assert.equal(noticeHoldMs(downloading, 'app-update', download(0.5), 1000, 1001, floor), 0);
});
test('notice glyphs come from the shared icon set, not inline SVG', () => {
  const src = readFileSync(new URL('../app/components/app-notices.js', import.meta.url), 'utf8');
  const tokens = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url)));
  assert.doesNotMatch(src, /<svg/);
  for (const name of ['check', 'alert-triangle', 'info']) {
    assert.ok(tokens.icons.glyphs[name], name);
    assert.ok(src.includes("'" + name + "'") || src.includes('"' + name + '"'), name);
  }
  // An error wears the warning triangle, never a circled X beside the close control's own X (issue 350).
  assert.match(src, /error: 'alert-triangle'/);
  assert.equal(src.includes("'circle-x'"), false);
  // The dismiss glyph is the shared close control's (issue 213).
  const close = readFileSync(new URL('../app/components/close-button.js', import.meta.url), 'utf8');
  assert.ok(tokens.icons.glyphs.x && close.includes('data-icon="x"') && src.includes("closeButtonHtml({ owner: 'notice'"), 'x');
});
test('notice geometry clears safe areas, controls and composer with directional reduced motion', () => {
  const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');
  const tokens = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url)));
  // The safe areas are the stylesheet's one set of insets (issue 175): env(safe-area-inset-*) on iOS, the shell's on Android.
  assert.match(css, /app-notices \{[^}]*top: calc\(var\(--inset-top\) \+ var\(--space-2\)\)/, 'on a phone the stack starts at the top edge, below the status bar');
  assert.match(css, /app-notices[^}]+var\(--inset-right\)[^}]+var\(--inset-left\)/);
  assert.match(tokens.size['notice-stack'], /var\(--inset-top\)[^)]*var\(--inset-bottom\)/);
  assert.match(tokens.size['notice-stack'], /size-composer-max/);
  assert.ok(css.includes('transform: translateX(100%)'));
  assert.ok(css.includes('@media (max-width: 640px) { .app-notice { animation-name: notice-down; } }'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce) { .app-notice { animation: none; } }'));
  assert.doesNotMatch(css, /.banner.update/);
});

test('a notice floats above every surface and takes its own press (issue 253)', () => {
  const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  // The notice is never placed in the flow, so appearing moves nothing under it.
  assert.doesNotMatch(css, /order:\s*-1/, 'the notices are never placed in the flow as a band');
  assert.doesNotMatch(css, /app-notices[^}]*position:\s*relative/, 'the stack stays a floating overlay');
  assert.match(css, /\.app-notice \{[^}]*pointer-events: auto;/, 'the card takes its own press');
  // A press on a notice is not an outside press for the sheet, so it never dismisses it.
  const root = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');
  assert.match(root, /<app-notices data-dismiss-keep="sheet about"/, 'a press on a notice never dismisses either sheet');
  // The card body runs its action and nothing else; the close control keeps its own press.
  const src = readFileSync(new URL('../app/components/app-notices.js', import.meta.url), 'utf8');
  assert.match(src, /@click=\$\{\(e\) => this\.onCard\(e, n\)\}/, 'the card body is a press');
  assert.match(src, /closest\('\.close-button'\)/, 'the close control is not the body press');
});

// Issue 191 (the layering half): a notice draws above every surface (sheets, About, Settings, the thread view, a
// confirm and the media viewer), so an update notice is always seen, and it never covers the desktop window controls.
test('the notice stack draws above every other surface and sits as high as it can without covering a window control (issue 342)', () => {
  const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({ selector: selector.trim(), body }));
  const z = (body) => { const m = /(?:^|;)\s*z-index:\s*(\d+)/.exec(body); return m ? Number(m[1]) : null; };
  const stack = rules.filter((r) => /^app-notices$/.test(r.selector) && z(r.body) !== null);
  assert.equal(stack.length, 1, 'one rule sets the stack\'s layer');
  const top = z(stack[0].body);
  for (const r of rules) {
    if (r.selector.includes('app-notices') || r.selector.includes('app-notice')) continue;
    const layer = z(r.body);
    if (layer !== null) assert.ok(layer < top, r.selector + ' (z-index ' + layer + ') would draw over the notices');
  }
  for (const surface of ['.sheet-scrim', '.sheet', '.confirm-scrim', '.viewer', '.thread-view']) assert.ok(rules.some((r) => r.selector.includes(surface) && z(r.body) !== null), surface + ' is a layered surface the test covers');
  // As high as the window allows without covering a window control (issue 342): below the controls the page draws on
  // Windows and Linux, and on macOS below the header, which is all drag strip there, so a card inside it would never
  // take its own press.
  const win = rules.find((r) => r.selector.includes('[data-platform="win32"] app-notices') && r.selector.includes('[data-platform="linux"] app-notices'));
  assert.ok(win, 'Windows and Linux place the stack themselves');
  assert.match(win.body, /top: calc\(var\(--inset-top\) \+ var\(--size-window-control-inset\) \+ var\(--size-window-control-h\) \+ var\(--space-2\)\)/, 'below the window controls');
  // A Mac's traffic lights are at the left, so the stack keeps the top edge a phone has and holds its left edge past them.
  assert.match(css, /\.app-window\[data-platform="darwin"\] app-notices \{ left: max\(var\(--inset-left\), var\(--size-window-lights\)\); \}/, 'a Mac window starts the stack at the top, clear of the traffic lights');
  assert.doesNotMatch(css, /\[data-platform="darwin"\] app-notices \{[^}]*top:/, 'nothing pushes the Mac stack below the header');
  assert.doesNotMatch(css, /^app-notices \{[^}]*size-header/m, 'a phone, Windows and Linux do not wait below the header');
});

// Issue 191 (the close and mark-as-read half): a notice no one has acknowledged is visible; marking it read remembers
// its revision on the server, which keeps it quiet on every device until the operation changes phase, so a new outcome
// may still announce itself. Closing a notice is the page's own dismissal (the dismissal test above), never a store.
test('a notice read through the server stays quiet until its operation changes', () => {
  const ready = appUpdateNotice({ state: 'ready', version: '1.2.3' });
  assert.equal(noticeQuiet(ready, {}), false, 'an unacknowledged notice is visible');
  assert.equal(noticeQuiet(ready, { 'app-update': ready.revision }), true, 'a revision read on the server is quiet');
  assert.equal(noticeQuiet(ready, { 'app-update': 'downloading:1.2.3' }), false, 'a different revision is not this one');
  assert.equal(quietNotices([ready], { 'app-update': ready.revision })[0].read, true);
  const newer = appUpdateNotice({ state: 'ready', version: '1.2.4' });
  assert.notEqual(quietNotices([newer], { 'app-update': ready.revision })[0].read, true, 'a new release announces itself');
});

test('a re-ask forgets a read revision so the same answer shows again', () => {
  const ready = appUpdateNotice({ state: 'ready', version: '1.2.3' });
  // A read revision stays quiet on a repeated event...
  assert.equal(quietNotices([ready], { 'app-update': ready.revision })[0].read, true);
  // ...but About's Check for updates forgets it on the server, so asking again shows the same answer.
  const read = forgetNoticeState({ 'app-update': ready.revision, other: 'x' }, 'app-update');
  assert.deepEqual(read, { other: 'x' });
  assert.equal(quietNotices([ready], read)[0].read, undefined);
  assert.deepEqual(forgetNoticeState({ 'app-update': ready.revision }, 'app-update'), {});
});

// Issue 422: the server tells every client about a settings write, the writer too. About's Check for updates pressed
// straight after its notice was closed forgets that mark and draws the answer, and only then hears the echo of the
// close. The packaged smoke's second press (its again wait) saw no notice for ten seconds on the release runs that
// failed. This walks the page's own sequence: the close, the re-ask, the answer, then the two echoes in the order the
// server sends them.
test('the echo of a close that a re-ask already forgot never hides the new answer (issue 422)', () => {
  const answer = appUpdateNotice({ state: 'unsupported', detail: 'no updater is running in this session' });
  // The answer is drawn, then closed: the read map is written (the first write).
  let notices = dismissNotice(putNotice([], answer), 'app-update');
  let read = withNoticeState({}, 'app-update', answer.revision);
  const closeWrite = read;
  let sent = sentNoticeRead([], read);
  // Asked again at once: the closed card and its mark are forgotten (the second write), and the same answer is drawn.
  notices = forgetRead(notices, 'app-update');
  read = forgetNoticeState(read, 'app-update');
  sent = sentNoticeRead(sent, read);
  notices = quietNotices(putNotice(notices, answer), read);
  assert.equal(notices[0].read, false, 'the answer to the re-ask is drawn');
  // What the page did before: every echo was news, so the close's echo marked the new answer read.
  assert.equal(quietNotices(notices, noticeState(closeWrite))[0].read, true, 'taken as news, the stale echo hides the answer');
  // The close's echo arrives: a later write of this page's own is still in flight, so it is not news.
  let echo = noticeReadEcho(sent, closeWrite);
  assert.equal(echo.stale, true);
  sent = echo.sent;
  if (!echo.stale) read = noticeState(closeWrite);
  notices = quietNotices(notices, read);
  assert.equal(notices[0].read, false, 'the answer stays up through the stale echo');
  // The re-ask's own echo arrives: nothing of this page's own is left in flight, so it is applied, and agrees.
  echo = noticeReadEcho(sent, {});
  assert.deepEqual(echo, { sent: [], stale: false });
  read = noticeState({});
  assert.equal(quietNotices(notices, read)[0].read, false);
});

test('another device\u2019s read map is applied as it comes, and the echo of the newest own write is applied', () => {
  const sent = sentNoticeRead([], { 'app-update': 'unsupported::' });
  assert.deepEqual(noticeReadEcho(sent, { 'app-update': 'ready:1.2.3:' }), { sent, stale: false }, 'a map this page never wrote is news');
  assert.deepEqual(noticeReadEcho(sent, { 'app-update': 'unsupported::' }), { sent: [], stale: false }, 'the newest own write echoes back as itself');
  assert.deepEqual(noticeReadEcho([], { a: '1' }), { sent: [], stale: false }, 'with nothing in flight every map is news');
  assert.equal(noticeReadKey({ b: '2', a: '1' }), noticeReadKey(JSON.stringify({ a: '1', b: '2' })), 'key order and encoding do not matter');
  assert.deepEqual(dropNoticeRead(sentNoticeRead(sent, {}), noticeReadKey({})), sent, 'a refused write is no longer awaited');
  let many = [];
  for (let i = 0; i < NOTICE_ECHO_LIMIT + 3; i += 1) many = sentNoticeRead(many, { 'app-update': 'r' + i });
  assert.equal(many.length, NOTICE_ECHO_LIMIT, 'a write the server took without a change raises no echo, so the list is bounded');
  const root = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');
  assert.match(root, /const echo = noticeReadEcho\(this\.noticeReadSent, values\[NOTICE_READ_KEY\]\);/, 'settings.changed decides the read map against the page\u2019s own writes');
  assert.match(root, /if \(!echo\.stale\) this\.noticeRead = noticeState\(values\[NOTICE_READ_KEY\]\);/);
  assert.equal((root.match(/settingsWrite\(\{ \[NOTICE_READ_KEY\]/g) || []).length, 1, 'the read map is written in one place, which remembers it');
});

test('the read store keeps every id and tolerates a malformed value', () => {
  assert.deepEqual(withNoticeState({ a: '1' }, 'app-update', 'ready:1.2.3'), { a: '1', 'app-update': 'ready:1.2.3' });
  assert.deepEqual(withNoticeState({ a: '1' }, 'app-update', null), { a: '1' }, 'no revision writes nothing');
  assert.deepEqual(noticeState('not json'), {}, 'a mangled value reads as empty');
  assert.deepEqual(noticeState(JSON.stringify({ 'app-update': 'r' })), { 'app-update': 'r' });
  assert.deepEqual(noticeState({ 'app-update': 7 }), {}, 'only string revisions count');
  assert.equal(noticeStateOf({ 'app-update': 'r' }, 'app-update'), 'r');
  assert.equal(NOTICE_READ_KEY, 'notice.read');
});

test('a notice carries one control, its X, which closes it on every device (issue 342)', () => {
  const src = readFileSync(new URL('../app/components/app-notices.js', import.meta.url), 'utf8');
  assert.match(src, /closeButtonHtml\(\{ owner: 'notice'/, 'the close control is still the shared one');
  assert.match(src, /look: 'solid'/, 'drawn as the send button is');
  assert.match(src, /new CustomEvent\('notice-read'/, 'closing it is the one thing it announces, so every device clears it');
  assert.equal(/app-notice-read/.test(src), false, 'the mark-as-read control is gone');
  assert.equal(/notice-dismiss/.test(src), false, 'and the local-only dismissal with it');
  const root = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');
  assert.equal(/notice-dismiss/.test(root), false, 'the page keeps one handler, not two');
  assert.match(root, /onNoticeRead\(e\) \{/, 'and it writes the read revision to the server');
  assert.match(src, /class="action-button app-notice-action"/, 'the one action is a button in the card');
  assert.match(src, /notice\.action\) return/, 'a card with no action takes no press of its own');
  const rules = readFileSync(new URL('../app/rules/app-notices.js', import.meta.url), 'utf8');
  assert.match(rules, /export const NOTICE_READ_KEY = 'notice\.read'/, 'the read state is a server setting');
  assert.doesNotMatch(rules, /NOTICE_CLOSED_KEY/, 'close is the page\u2019s own dismissal, not a store');
});
