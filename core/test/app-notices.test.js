import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { putNotice, dismissNotice, appUpdateNotice, noticeHoldMs, quietNotices, noticeState, noticeStateOf, withNoticeState, noticeQuiet, NOTICE_READ_KEY, NOTICE_CLOSED_KEY } from '../app/rules/app-notices.js';

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
  for (const name of ['check', 'alert-triangle', 'circle-x', 'info']) {
    assert.ok(tokens.icons.glyphs[name], name);
    assert.ok(src.includes("'" + name + "'") || src.includes('"' + name + '"'), name);
  }
  // The dismiss glyph is the shared close control's (issue 213).
  const close = readFileSync(new URL('../app/components/close-button.js', import.meta.url), 'utf8');
  assert.ok(tokens.icons.glyphs.x && close.includes('data-icon="x"') && src.includes("closeButtonHtml({ owner: 'notice'"), 'x');
});
test('notice geometry clears safe areas, controls and composer with directional reduced motion', () => {
  const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');
  const tokens = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url)));
  // The safe areas are the stylesheet's one set of insets (issue 175): env(safe-area-inset-*) on iOS, the shell's on Android.
  assert.match(css, /app-notices[^}]+var\(--inset-top\)[^}]+size-header/);
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
  assert.match(root, /<app-notices data-dismiss-keep="sheet"/, 'a press on a notice never dismisses the sheet');
  // The card body runs its action and nothing else; the close control keeps its own press.
  const src = readFileSync(new URL('../app/components/app-notices.js', import.meta.url), 'utf8');
  assert.match(src, /@click=\$\{\(e\) => this\.onCard\(e, n\)\}/, 'the card body is a press');
  assert.match(src, /closest\('\.close-button'\)/, 'the close control is not the body press');
});

// Issue 191 (the layering half): a notice draws above every surface (sheets, About, Settings, the thread view, a
// confirm and the media viewer), so an update notice is always seen, and it never covers the desktop window controls.
test('the notice stack draws above every other surface and starts below the header and its window controls', () => {
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
  for (const r of rules.filter((x) => /app-notices$/.test(x.selector) && /(?:^|;)\s*top:\s*calc/.test(x.body))) {
    assert.match(r.body, /top:\s*calc\([^;]*var\(--size-header\)/, r.selector + ' starts below the header that carries the window controls');
  }
});

// Issue 191 (the close and mark-as-read half): a notice no one has acknowledged is visible; closing it remembers its
// revision on this device and marking it read remembers its revision on the server, and either keeps it quiet until
// the operation changes phase, so a new outcome may still announce itself.
test('a notice closed here or read through the server stays quiet until its operation changes', () => {
  const ready = appUpdateNotice({ state: 'ready', version: '1.2.3' });
  assert.equal(noticeQuiet(ready, {}, {}), false, 'an unacknowledged notice is visible');
  assert.equal(noticeQuiet(ready, { 'app-update': ready.revision }, {}), true, 'a revision read on the server is quiet');
  assert.equal(noticeQuiet(ready, {}, { 'app-update': ready.revision }), true, 'a revision closed here is quiet');
  assert.equal(noticeQuiet(ready, { 'app-update': 'downloading:1.2.3' }, {}), false, 'a different revision is not this one');
  assert.equal(quietNotices([ready], { 'app-update': ready.revision }, {})[0].read, true);
  assert.equal(quietNotices([ready], {}, { 'app-update': ready.revision })[0].read, true);
  const newer = appUpdateNotice({ state: 'ready', version: '1.2.4' });
  assert.notEqual(quietNotices([newer], { 'app-update': ready.revision }, {})[0].read, true, 'a new release announces itself');
});

test('the read and closed stores keep every id and tolerate a malformed device value', () => {
  assert.deepEqual(withNoticeState({ a: '1' }, 'app-update', 'ready:1.2.3'), { a: '1', 'app-update': 'ready:1.2.3' });
  assert.deepEqual(withNoticeState({ a: '1' }, 'app-update', null), { a: '1' }, 'no revision writes nothing');
  assert.deepEqual(noticeState('not json'), {}, 'a mangled device value reads as empty');
  assert.deepEqual(noticeState(JSON.stringify({ 'app-update': 'r' })), { 'app-update': 'r' });
  assert.deepEqual(noticeState({ 'app-update': 7 }), {}, 'only string revisions count');
  assert.equal(noticeStateOf({ 'app-update': 'r' }, 'app-update'), 'r');
  assert.equal(NOTICE_READ_KEY, 'notice.read');
  assert.equal(NOTICE_CLOSED_KEY, 'notice.closed');
});

test('every notice draws a mark-as-read control beside the shared close control', () => {
  const src = readFileSync(new URL('../app/components/app-notices.js', import.meta.url), 'utf8');
  assert.match(src, /class="app-notice-read"/, 'the card draws the mark-as-read control');
  assert.match(src, /new CustomEvent\('notice-read'/, 'it announces the read');
  assert.match(src, /closest\('\.app-notice-read'\)/, 'a press on it is never the body action');
  assert.match(src, /closeButtonHtml\(\{ owner: 'notice'/, 'the close control is still the shared one');
  const rules = readFileSync(new URL('../app/rules/app-notices.js', import.meta.url), 'utf8');
  assert.match(rules, /export const NOTICE_READ_KEY = 'notice\.read'/, 'the read state is a server setting');
  assert.match(rules, /export const NOTICE_CLOSED_KEY = 'notice\.closed'/, 'the closed state is this device\'s store');
});
