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

// Apple's ticket service dropping the connection (Error 68) after notarization succeeded: the app is signed and carries
// no stapled ticket, the ticket is stapled here until that works, and the packaging runs again. Gatekeeper's
// assessment asks the same service, so it is not what decides (the release run that dropped the connection read the
// notarized app as unnotarized and gave up at once).
const signingInputs = { CSC_LINK: 'c', CSC_KEY_PASSWORD: 'p', APPLE_API_KEY_P8: 'k', APPLE_API_KEY_ID: 'i', APPLE_API_ISSUER: 's' };
const named = (command, args) => command + (command === 'xcrun' ? ' ' + args[1] : '');

test('a notarized app whose ticket was not stapled is stapled until that works, then packaged again', () => {
  const calls = [];
  const pauses = [];
  let packs = 0;
  let staples = 0;
  packageMac('x64', { environment: signingInputs, pause: (ms) => pauses.push(ms), ticketed: () => false, execute(command, args) {
    calls.push(named(command, args));
    if (command === 'pnpm' && (packs += 1) === 1) throw new Error('Failed to staple your application with code: 68');
    if (command === 'spctl' && packs === 1) throw new Error('rejected source=Unnotarized Developer ID');
    if (command === 'xcrun' && args[1] === 'staple' && (staples += 1) === 1) throw new Error('The staple and validate action failed! Error 68.');
  } });
  assert.equal(packs, 2);
  assert.equal(staples, 2, 'the staple is asked again after the dropped connection');
  assert.deepEqual(pauses, [30000]);
  assert.deepEqual(calls, ['pnpm', 'codesign', 'xcrun staple', 'xcrun staple', 'pnpm', 'codesign', 'spctl', 'xcrun validate']);
});

test('a packaging failure that is not an unstapled signed app is thrown at once, and one Apple never tickets gives up after the bound', async () => {
  const { STAPLE_ATTEMPTS, PACKAGE_ATTEMPTS } = await import('../scripts/package-mac.mjs');
  let packs = 0;
  assert.throws(() => packageMac('arm64', { environment: signingInputs, pause: () => {}, ticketed: () => false, execute(command) {
    if (command === 'pnpm') { packs += 1; throw new Error('signing failed'); }
    if (command === 'codesign') throw new Error('not signed');
  } }), /signing failed/);
  assert.equal(packs, 1, 'not signed, so not a stapling failure');
  packs = 0;
  assert.throws(() => packageMac('arm64', { environment: signingInputs, pause: () => {}, ticketed: () => true, execute(command) {
    if (command === 'pnpm') { packs += 1; throw new Error('disk image failed'); }
  } }), /disk image failed/);
  assert.equal(packs, 1, 'already stapled, so the failure came after stapling');
  // Notarization rejected: no ticket exists, so stapling fails every time and the packaging is not run again.
  packs = 0;
  let staples = 0;
  assert.throws(() => packageMac('arm64', { environment: signingInputs, pause: () => {}, ticketed: () => false, execute(command, args) {
    if (command === 'pnpm') { packs += 1; throw new Error('notarization failed'); }
    if (command === 'xcrun' && args[1] === 'staple') { staples += 1; throw new Error('Record not found'); }
  } }), /notarization failed/);
  assert.equal(packs, 1);
  assert.equal(staples, STAPLE_ATTEMPTS);
  // Stapling works each time but the packaging keeps failing: it gives up after the bound with the packaging's error.
  packs = 0;
  assert.throws(() => packageMac('arm64', { environment: signingInputs, pause: () => {}, ticketed: () => false, execute(command) {
    if (command === 'pnpm') { packs += 1; throw new Error('Failed to staple'); }
  } }), /Failed to staple/);
  assert.equal(packs, PACKAGE_ATTEMPTS);
});

test('the checks after packaging that ask Apple are asked again, bounded; the signature check is not', async () => {
  const { CHECK_ATTEMPTS } = await import('../scripts/package-mac.mjs');
  const calls = [];
  const pauses = [];
  let validates = 0;
  packageMac('x64', { environment: signingInputs, pause: (ms) => pauses.push(ms), execute(command, args) {
    calls.push(named(command, args));
    if (command === 'xcrun' && args[1] === 'validate' && (validates += 1) < CHECK_ATTEMPTS) throw new Error('The validate action failed! Error 68.');
  } });
  assert.deepEqual(calls, ['pnpm', 'codesign', 'spctl', ...Array(CHECK_ATTEMPTS).fill('xcrun validate')]);
  assert.deepEqual(pauses, [30000, 60000]);
  let assessments = 0;
  assert.throws(() => packageMac('x64', { environment: signingInputs, pause: () => {}, execute(command) {
    if (command === 'spctl') { assessments += 1; throw new Error('rejected'); }
  } }), /rejected/);
  assert.equal(assessments, CHECK_ATTEMPTS);
  let signatures = 0;
  assert.throws(() => packageMac('x64', { environment: signingInputs, pause: () => {}, execute(command) {
    if (command === 'codesign') { signatures += 1; throw new Error('invalid signature'); }
  } }), /invalid signature/);
  assert.equal(signatures, 1);
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
