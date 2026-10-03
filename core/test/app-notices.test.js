import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { putNotice, dismissNotice, appUpdateNotice, noticeHoldMs } from '../app/rules/app-notices.js';

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
  for (const name of ['check', 'alert-triangle', 'circle-x', 'info', 'x']) {
    assert.ok(tokens.icons.glyphs[name], name);
    assert.ok(src.includes("'" + name + "'") || src.includes('"' + name + '"'), name);
  }
});
test('notice geometry clears safe areas, controls and composer with directional reduced motion', () => {
  const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');
  const tokens = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url)));
  assert.match(css, /app-notices[^}]+safe-area-inset-top[^}]+size-header/);
  assert.match(css, /app-notices[^}]+safe-area-inset-right[^}]+safe-area-inset-left/);
  assert.match(tokens.size['notice-stack'], /safe-area-inset-bottom/);
  assert.match(tokens.size['notice-stack'], /size-composer-max/);
  assert.ok(css.includes('transform: translateX(100%)'));
  assert.ok(css.includes('@media (max-width: 640px) { .app-notice { animation-name: notice-down; } }'));
  assert.ok(css.includes('@media (prefers-reduced-motion: reduce) { .app-notice { animation: none; } }'));
  assert.doesNotMatch(css, /.banner.update/);
});
