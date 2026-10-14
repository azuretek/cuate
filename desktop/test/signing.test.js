import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { packageMac } from '../scripts/package-mac.mjs';

test('signed packaging discovers its imported identity and removes the temporary notarization key', () => {
  const environment = { CSC_LINK: 'synthetic-certificate', CSC_KEY_PASSWORD: 'synthetic-password', APPLE_API_KEY_P8: 'synthetic-key', APPLE_API_KEY_ID: 'synthetic-id', APPLE_API_ISSUER: 'synthetic-issuer', CSC_IDENTITY_AUTO_DISCOVERY: 'false' };
  const calls = [];
  let key;
  packageMac('arm64', { environment, execute(command, args, options) {
    calls.push([command, args]);
    if (command === 'pnpm') {
      assert.equal(options.env.CSC_IDENTITY_AUTO_DISCOVERY, 'true');
      assert.equal(options.env.APPLE_API_KEY_P8, undefined);
      key = options.env.APPLE_API_KEY;
      assert.equal(readFileSync(key, 'utf8'), 'synthetic-key');
      assert.ok(args.includes('--config.forceCodeSigning=true'));
    }
  } });
  assert.equal(existsSync(key), false);
  assert.deepEqual(calls.map(([command]) => command), ['pnpm', 'codesign', 'spctl', 'xcrun']);
  assert.equal(environment.CSC_IDENTITY_AUTO_DISCOVERY, 'false');
});

// Apple's stapling service dropping the connection (Error 68) after notarization succeeded is packaged again; any other
// failure is thrown at once.
test('a notarized app whose ticket was not stapled is packaged again, a bounded number of times', () => {
  const environment = { CSC_LINK: 'c', CSC_KEY_PASSWORD: 'p', APPLE_API_KEY_P8: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' };
  const calls = [];
  let packs = 0;
  const pauses = [];
  packageMac('x64', { environment, pause: (ms) => pauses.push(ms), execute(command, args) {
    calls.push(command + (args[0] === 'stapler' ? ' validate' : ''));
    if (command === 'pnpm' && (packs += 1) === 1) throw new Error('Failed to staple your application with code: 68');
    if (command === 'xcrun' && packs === 1) throw new Error('does not have a ticket stapled');
  } });
  assert.equal(packs, 2);
  assert.deepEqual(pauses, [30000]);
  assert.deepEqual(calls, ['pnpm', 'spctl', 'xcrun validate', 'pnpm', 'codesign', 'spctl', 'xcrun validate']);
});

test('a packaging failure that is not an unstapled notarized app is thrown at once, and a stapling one gives up after the bound', async () => {
  const { STAPLE_ATTEMPTS } = await import('../scripts/package-mac.mjs');
  const environment = { CSC_LINK: 'c', CSC_KEY_PASSWORD: 'p', APPLE_API_KEY_P8: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' };
  let packs = 0;
  assert.throws(() => packageMac('arm64', { environment, pause: () => {}, execute(command) {
    if (command === 'pnpm') { packs += 1; throw new Error('signing failed'); }
    if (command === 'spctl') throw new Error('rejected');
  } }), /signing failed/);
  assert.equal(packs, 1, 'not signed and accepted, so not a stapling failure');
  packs = 0;
  assert.throws(() => packageMac('arm64', { environment, pause: () => {}, execute(command, args) {
    if (command === 'pnpm') { packs += 1; throw new Error('Failed to staple'); }
    if (command === 'xcrun' && args[0] === 'stapler') throw new Error('no ticket');
  } }), /Failed to staple/);
  assert.equal(packs, STAPLE_ATTEMPTS);
});

test('builder authenticates key partition access with the generated keychain password, not the certificate password', async (t) => {
  const require = createRequire(new URL('../package.json', import.meta.url));
  const builderRequire = createRequire(require.resolve('electron-builder'));
  const libRequire = createRequire(builderRequire.resolve('app-builder-lib'));
  const util = libRequire('builder-util');
  const certs = libRequire('./codeSign/codesign');
  const signing = libRequire('./codeSign/macCodeSign');
  const calls = [];
  t.mock.method(util, 'exec', async (command, args) => { calls.push(args); return ''; });
  t.mock.method(certs, 'importCertificate', async () => '/synthetic/cert.p12');
  const travis = process.env.TRAVIS;
  t.after(() => { if (travis === undefined) delete process.env.TRAVIS; else process.env.TRAVIS = travis; });
  process.env.TRAVIS = 'true';
  await signing.createKeychain({ tmpDir: {}, cscLink: 'synthetic', cscKeyPassword: 'certificate-password', currentDir: '/synthetic/app' });
  const created = calls.find((args) => args[0] === 'create-keychain');
  const imported = calls.find((args) => args[0] === 'import');
  const partition = calls.find((args) => args[0] === 'set-key-partition-list');
  assert.equal(imported[imported.indexOf('-P') + 1], 'certificate-password');
  assert.equal(partition[partition.indexOf('-k') + 1], created[created.indexOf('-p') + 1]);
  assert.notEqual(partition[partition.indexOf('-k') + 1], 'certificate-password');
});
