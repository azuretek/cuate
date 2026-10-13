// A phone allowed to show notifications registers for them with the app closed (issue 347, docs/push.md): the page asks
// its shell for the push token and key, sends them to its own server, and stops them on sign out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const ANDROID_BRIDGE = 'android/app/src/main/kotlin/' + naming.ids.android.replace(/\./g, '/') + '/HostBridge.kt';
const SLUG = naming.slug.toUpperCase();

test('every shell answers push.token: a phone its registration, a desktop null', () => {
  const spec = JSON.parse(read('core/spec/host-bridge.json'));
  assert.equal(spec.commands['push.token'].returns, 'PushToken?');
  assert.match(read('desktop/src/bridge-handlers.js'), /'push\.token': async \(\) => null/);
  assert.match(read('ios/' + naming.product + '/HostBridge.swift'), /case "push\.token":\n\s+\/\/[^\n]*\n\s+Push\.shared\.registration/);
  assert.match(read(ANDROID_BRIDGE), /"push\.token" ->/);
});

test('the page registers only once notifications are granted, and stops on sign out', () => {
  const root = read('core/app/components/app-root.js');
  assert.match(root, /this\.notifyPermission = state; this\.registerPush\(\);/);
  assert.match(root, /if \(!client \|\| this\.notifyPermission !== 'granted'\) return false;/);
  assert.match(root, /await client\.pushRegister\(reg\);/);
  assert.match(root, /async signOut\(reason\) \{\n[^]*?this\.client\.pushUnregister\(\)/);
  const api = read('core/kit/api.js');
  assert.match(api, /pushRegister: \(\{ token, platform, key \}\) => call\('POST', '\/api\/v1\/push'/);
  assert.match(api, /pushUnregister: \(\) => call\('DELETE', '\/api\/v1\/push'\)/);
});

test('a Firebase client config is never committed, and the release writes it from a secret', () => {
  const ignore = read('.gitignore');
  assert.match(ignore, /^GoogleService-Info\.plist$/m);
  assert.match(ignore, /^google-services\.json$/m);
  const wf = read('.github/workflows/ios.yml');
  assert.ok(wf.includes('secrets.' + SLUG + '_GOOGLE_SERVICE_INFO_PLIST'));
  assert.ok(wf.indexOf('Write the Firebase config') < wf.lastIndexOf('Generate the Xcode project'), 'written before the project is generated');
});

test('the iPhone opens a sealed notification in its extension with the key the app made', () => {
  const ext = read('ios/' + naming.product + 'Notify/NotificationService.swift');
  assert.match(ext, /AES\.GCM\.SealedBox\(combined: bytes\)/, 'nonce, ciphertext and tag, as the server seals it');
  assert.match(ext, /mutable\.userInfo\["chatId"\] = notice\.chatId/, 'a tap opens the conversation');
  assert.ok(read('ios/' + naming.product + 'Notify/' + naming.product + 'Notify.entitlements').includes('$(AppIdentifierPrefix)$(' + SLUG + '_APP_BUNDLE_ID)'));
  const project = read('ios/project.yml');
  assert.ok(project.includes(naming.product + 'Notify:\n    type: app-extension'));
  assert.match(project, /product: FirebaseMessaging/);
  for (const f of ['ios/' + naming.product + '/' + naming.product + '.entitlements', 'ios/' + naming.product + '/' + naming.product + 'Messaging.entitlements']) assert.match(read(f), /<key>aps-environment<\/key>/, f);
});
