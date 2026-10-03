import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { putNotice, dismissNotice, appUpdateNotice } from '../app/rules/app-notices.js';

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
