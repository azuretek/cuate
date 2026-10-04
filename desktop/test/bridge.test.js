import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandlers, createSecureStore, mimeFor } from '../src/bridge-handlers.js';

const spec = JSON.parse(readFileSync(new URL('../../core/spec/host-bridge.json', import.meta.url), 'utf8'));
const fs = { readFileSync, writeFileSync, existsSync, mkdirSync };
const safe = (on) => ({ isEncryptionAvailable: () => on, encryptString: (s) => Buffer.from('enc:' + s), decryptString: (b) => b.toString().replace(/^enc:/, '') });

test('the desktop shell implements exactly the declared bridge commands', () => {
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.deepEqual(Object.keys(h).sort(), Object.keys(spec.commands).sort());
});

test('the update download and install commands call through and answer what the shell did', async () => {
  const calls = [];
  const h = createHandlers({
    secure: {}, notify: () => true, info: () => ({}), openExternal: () => true,
    downloadUpdates: () => { calls.push('download'); return true; },
    installUpdate: () => { calls.push('install'); return false; },
  });
  assert.equal(await h['updates.download']({}), true);
  assert.equal(await h['updates.install']({}), false);
  assert.deepEqual(calls, ['download', 'install']);
});

test('with no updater the update commands answer false rather than throwing', async () => {
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.equal(await h['updates.download']({}), false);
  assert.equal(await h['updates.install']({}), false);
});

// Issue 171: About's Check for updates asks the shell for the tray's own check and draws the state it answers.
test('updates.check runs the tray\'s check and answers the state it reached', async () => {
  let checks = 0;
  const state = { state: 'checking', version: null, canInstall: true };
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true, checkUpdates: () => { checks += 1; return state; } });
  assert.deepEqual(await h['updates.check']({}), state);
  assert.equal(checks, 1, 'one press, one check');
});

test('with no check wired, updates.check answers null rather than throwing', async () => {
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.equal(await h['updates.check']({}), null);
});

// Issue 167: the app icon chosen in Settings is applied by the shell: the desktop sets the window's and the Dock's
// icon to the chosen picture and answers what it applied.
test('app.icon calls through with the chosen icon and answers what the shell applied', async () => {
  const asked = [];
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true, appIcon: (icon) => { asked.push(icon); return { applied: true, icon }; } });
  assert.deepEqual(await h['app.icon']({ icon: 'night' }), { applied: true, icon: 'night' });
  assert.deepEqual(asked, ['night']);
  assert.deepEqual(await h['app.icon']({}), { applied: true, icon: '' }, 'a missing id is passed on as empty, for the shell to refuse');
});

test('with no icon wired, app.icon answers that nothing was applied', async () => {
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.deepEqual(await h['app.icon']({ icon: 'night' }), { applied: false, icon: 'night' });
});

test('secure storage encrypts at rest and refuses bad keys and values', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
  const file = path.join(dir, 'store.json');
  try {
    const s = createSecureStore({ file: () => file, safeStorage: safe(true), fs });
    assert.equal(s.set('server.token', 'tok_secret_value'), true);
    assert.equal(s.get('server.token'), 'tok_secret_value');
    assert.ok(!readFileSync(file, 'utf8').includes('tok_secret_value'));
    assert.equal(s.delete('server.token'), true);
    assert.equal(s.get('server.token'), null);
    assert.throws(() => s.set('Bad Key', 'x'));
    assert.throws(() => s.set('ok.key', 'x'.repeat(9000)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('without a keychain, values stay in memory and never reach the disk', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'bridge-'));
  const file = path.join(dir, 'store.json');
  try {
    const s = createSecureStore({ file: () => file, safeStorage: safe(false), fs });
    assert.equal(s.set('server.url', 'https://mac.example.com'), false);
    assert.equal(s.get('server.url'), 'https://mac.example.com');
    assert.equal(existsSync(file), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('pages are served with the right content types', () => {
  assert.match(mimeFor('/a/b.js'), /javascript/);
  assert.match(mimeFor('/a/b.css'), /css/);
  assert.equal(mimeFor('/a/b.bin'), 'application/octet-stream');
});
