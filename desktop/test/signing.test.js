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
