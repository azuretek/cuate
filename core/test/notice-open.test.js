// Pressing a message notice opens its conversation at its message, on every platform (issue 331).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { messageTarget, noticeTarget, messageNotice } from '../app/rules/notifications.js';

const naming = JSON.parse(readFileSync(new URL('../spec/naming.json', import.meta.url), 'utf8'));
const IOS = 'ios/' + naming.product + '/';
const ANDROID = 'android/app/src/main/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/';
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');

test('a message notice carries its conversation and its message as string ids', () => {
  assert.deepEqual(messageTarget({ chatId: 7, id: 'm-9' }), { chatId: '7', messageId: 'm-9' });
  assert.deepEqual(messageTarget({ chatId: null, id: 'm-9' }), {});
  assert.deepEqual(messageTarget(null), {});
  // The notice's own words are unchanged by where it leads.
  assert.deepEqual(messageNotice('Sam', { text: 'hi', attachments: [] }), { title: 'Sam', body: 'hi' });
});

test('a pressed notice is read only as plain ids', () => {
  assert.deepEqual(noticeTarget({ chatId: '7', messageId: 'm-9' }), { chatId: '7', messageId: 'm-9' });
  assert.deepEqual(noticeTarget({ chatId: 7 }), { chatId: '7', messageId: null });
  assert.equal(noticeTarget(null), null);
  assert.equal(noticeTarget({}), null);
  assert.equal(noticeTarget({ chatId: '' }), null);
  assert.equal(noticeTarget({ chatId: { id: 1 } }), null);
  assert.equal(noticeTarget({ chatId: 'x'.repeat(201) }), null);
  assert.deepEqual(noticeTarget({ chatId: '7', messageId: ['m'] }), { chatId: '7', messageId: null });
});

test('the spec declares the press: notify carries the ids, notify.take hands them back, notify.opened says when', () => {
  const spec = JSON.parse(read('core/spec/host-bridge.json'));
  assert.equal(spec.commands.notify.args.chatId, 'string?');
  assert.equal(spec.commands.notify.args.messageId, 'string?');
  assert.deepEqual(spec.commands['notify.take'].args, {});
  assert.ok(spec.events['notify.opened'], 'the press is an event the page hears');
});

test('the page sends the target with a message notice, takes a press when told and once it is ready', () => {
  const root = read('core/app/components/app-root.js');
  assert.match(root, /this\.bridge\('notify', \{ \.\.\.messageNotice\(title, m\), \.\.\.messageTarget\(m\) \}\)/);
  assert.match(root, /window\.bridge\.on\('notify\.opened', \(\) => this\.takeNotice\(\)\)/);
  const ready = root.indexOf("this.dataset.state = 'ready';");
  const take = root.indexOf('this.takeNotice();', ready);
  assert.ok(ready > 0 && take > ready && take - ready < 400, 'the boot takes a press that launched the app');
  assert.match(root, /\.reveal=\$\{this\.revealing\}/);
});

test('every shell keeps the target with the notice and hands back the press once', () => {
  const desktop = read('desktop/src/bridge-handlers.js');
  assert.match(desktop, /notify: async \(\{ title, body, chatId, messageId \}\)/);
  assert.match(desktop, /'notify\.take': async \(\) => takeNotice\(\)/);
  const main = read('desktop/src/main.js');
  assert.match(main, /n\.on\('click', \(\) => \{ liveNotices\.delete\(n\); pressed\(\); \}\)/);
  assert.match(main, /webContents\.send\('bridge:event:notify\.opened', \{\}\)/);
  const android = read(ANDROID + 'HostBridge.kt');
  assert.match(android, /"notify\.take" -> success\(takeNotice\(\)\)/);
  assert.match(android, /setContentIntent\(PendingIntent\.getActivity\(/);
  assert.match(android, /emit\("notify\.opened", JSONObject\(\)\)/);
  const activity = read(ANDROID + 'MainActivity.kt');
  assert.match(activity, /override fun onNewIntent\(intent: Intent\)/);
  assert.match(activity, /if \(savedInstanceState == null\) HostBridge\.noticeFrom\(intent\)/);
  const ios = read(IOS + 'HostBridge.swift');
  assert.match(ios, /case "notify\.take":/);
  assert.match(ios, /content\.userInfo = target/);
  assert.match(ios, /on: function \(name, handler\)/);
  assert.match(read(IOS + 'NoticeRouter.swift'), /didReceive response: UNNotificationResponse/);
  assert.match(read(IOS + naming.product + 'App.swift'), /UNUserNotificationCenter\.current\(\)\.delegate = NoticeRouter\.shared/);
});
