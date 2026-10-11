// Notifications are asked for once the person has signed in, on every platform (issue 327).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const naming = JSON.parse(readFileSync(new URL('../spec/naming.json', import.meta.url), 'utf8'));
const IOS = 'ios/' + naming.product + '/HostBridge.swift';
const ANDROID = 'android/app/src/main/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/HostBridge.kt';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('signing in asks every shell for notifications, and every shell answers where it stands', () => {
  const root = read('core/app/components/app-root.js');
  const ready = root.indexOf("this.phase = 'ready';");
  const ask = root.indexOf("this.bridge('notify.permission', { request: true })");
  assert.ok(ready > 0 && ask > ready && ask - ready < 600, 'the page asks right after it is ready');
  const spec = JSON.parse(read('core/spec/host-bridge.json'));
  assert.deepEqual(spec.commands['notify.permission'].args, { request: 'boolean' });
  assert.match(read(IOS), /case "notify\.permission":[\s\S]{0,120}notifyPermission\(id: id, request:/);
  assert.match(read(IOS), /requestAuthorization\(options: \[\.alert, \.sound, \.badge\]\)/);
  assert.match(read(ANDROID), /"notify\.permission" -> success\(notifyPermission\(args\.optBoolean\("request"\)\)\)/);
  assert.match(read(ANDROID), /requestPermissions\(arrayOf\(android\.Manifest\.permission\.POST_NOTIFICATIONS\)/);
  assert.match(read('desktop/src/bridge-handlers.js'), /'notify\.permission': async \(\) => notifyPermission\(\)/);
});
