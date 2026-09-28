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
