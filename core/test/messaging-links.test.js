// The default messaging app's links (issue 333): every shell hands the platform's link to the page, which parses it
// with one rule and opens the conversation it names or starts one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseMessagingLink, linkTarget } from '../app/rules/chats.js';

const naming = JSON.parse(readFileSync(new URL('../spec/naming.json', import.meta.url), 'utf8'));
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const IOS = 'ios/' + naming.product + '/';
const ANDROID = 'android/app/src/main/kotlin/' + naming.ids.android.replaceAll('.', '/') + '/';

test('a messaging link names its people and maybe a body, and anything else is not one', () => {
  assert.deepEqual(parseMessagingLink('sms:+15555550100'), { addresses: ['+15555550100'], body: '' });
  assert.deepEqual(parseMessagingLink('smsto:+15555550100?body=On%20my%20way'), { addresses: ['+15555550100'], body: 'On my way' });
  assert.deepEqual(parseMessagingLink('sms://+15555550100,friend@example.com'), { addresses: ['+15555550100', 'friend@example.com'], body: '' });
  assert.deepEqual(parseMessagingLink('im:friend@example.com').addresses, ['friend@example.com']);
  assert.equal(parseMessagingLink('sms:'), null, 'a link naming nobody');
  assert.equal(parseMessagingLink('sms:hello'), null, 'not a number or an email');
  assert.equal(parseMessagingLink('https://example.com'), null);
  assert.equal(parseMessagingLink(null), null);
});

test('a link opens the conversation already held with exactly those people, or starts one', () => {
  const chats = [
    { id: '1', isGroup: false, participants: ['+15555550100'], lastMessageAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', isGroup: true, participants: ['+15555550100', 'friend@example.com'], lastMessageAt: '2026-01-02T00:00:00.000Z' },
  ];
  assert.deepEqual(linkTarget(chats, parseMessagingLink('sms:+15555550100')), { open: '1' });
  assert.deepEqual(linkTarget(chats, parseMessagingLink('sms:friend@example.com,+15555550100')), { open: '2' });
  assert.deepEqual(linkTarget(chats, parseMessagingLink('sms:+15555550199')), { compose: ['+15555550199'] });
  assert.equal(linkTarget(chats, null), null);
});

test('every shell holds the link for the page, and the page takes it when ready, when shown and when told', () => {
  const root = read('core/app/components/app-root.js');
  assert.match(root, /this\.bridge\('link\.take'\)/);
  assert.match(root, /window\.bridge\.on\('app\.link', \(\) => this\.takeLink\(\)\)/);
  assert.match(root, /client\.connect\(\);\n\s+this\.takeLink\(\);/);
  assert.match(root, /addEventListener\('visibilitychange', this\.onShownForLink\)/);
  const spec = JSON.parse(read('core/spec/host-bridge.json'));
  assert.ok(spec.commands['link.take'] && spec.events['app.link']);
  assert.match(read(IOS + 'HostBridge.swift'), /case "link\.take":/);
  assert.match(read(IOS + 'ShellView.swift'), /\.onOpenURL \{ url in model\.bridge\.pendingLink = url\.absoluteString \}/);
  assert.match(read(IOS + 'Info.plist'), /<key>CFBundleURLSchemes<\/key>\s*<array>\s*<string>im<\/string>/);
  assert.match(read(IOS + naming.product + 'Messaging.entitlements'), /com\.apple\.developer\.messaging-app<\/key>\s*<true\/>/);
  assert.match(read(ANDROID + 'HostBridge.kt'), /"link\.take" ->/);
  assert.match(read(ANDROID + 'MainActivity.kt'), /override fun onNewIntent[\s\S]{0,200}handOverLink\(intent\.dataString\)/);
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  for (const s of ['sms', 'smsto', 'mms', 'mmsto']) assert.match(manifest, new RegExp('<data android:scheme="' + s + '" />'));
  assert.match(read('desktop/src/bridge-handlers.js'), /'link\.take': async \(\) => takeLink\(\)/);
  const main = read('desktop/src/main.js');
  assert.match(main, /app\.on\('open-url'/);
  assert.match(main, /setAsDefaultProtocolClient\(s\)/);
  assert.match(read('desktop/electron-builder.mjs'), /schemes: \['sms', 'smsto', 'mms', 'mmsto', 'im', 'imessage'\]/);
});
