import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHandlers, createSecureStore, createFileOpener, openName, mimeFor } from '../src/bridge-handlers.js';

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
  assert.deepEqual(await h['app.icon']({ icon: 'rosa' }), { applied: true, icon: 'rosa' });
  assert.deepEqual(asked, ['rosa']);
  assert.deepEqual(await h['app.icon']({}), { applied: true, icon: '' }, 'a missing id is passed on as empty, for the shell to refuse');
});

test('with no icon wired, app.icon answers that nothing was applied', async () => {
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.deepEqual(await h['app.icon']({ icon: 'rosa' }), { applied: false, icon: 'rosa' });
});

// Issue 219: a document pressed in a conversation is offered for saving under its real name.
test('file.save hands the shell the file\'s name, type and bytes and answers what it did', async () => {
  const saves = [];
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true, saveFile: (file) => { saves.push(file); return true; } });
  assert.equal(await h['file.save']({ name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERi0=' }), true);
  assert.deepEqual(saves, [{ name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERi0=' }]);
  assert.equal(await h['file.save']({ name: 'booking.pdf', data: 12 }), true, 'a non-string data is emptied rather than trusted');
  assert.deepEqual(saves[1], { name: 'booking.pdf', mime: '', data: '' });
});

// Issue 374: Open in hands the shell the file's name, type and bytes, and the desktop writes a temporary copy, opens it
// in the system's default app and removes every copy when the app quits.
test('file.open hands the shell the file\'s name, type and bytes and answers what it did', async () => {
  const opens = [];
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true, openFile: (f) => { opens.push(f); return true; } });
  assert.equal(await h['file.open']({ name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERi0=' }), true);
  assert.deepEqual(opens, [{ name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERi0=' }]);
  assert.equal(await h['file.open']({ name: 'x'.repeat(400), data: 12 }), true);
  assert.deepEqual(opens[1], { name: 'x'.repeat(255), mime: '', data: '' }, 'the name is bounded and a non-string data is emptied rather than trusted');
  const none = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.equal(await none['file.open']({ name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERi0=' }), false, 'with nothing to open it in, it answers false');
});

test('the desktop writes each opened file to a folder of its own under its temporary folder, opens it, and removes them all on quit', async () => {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'open-test-'));
  const root = path.join(tmp, 'run');
  const opened = [];
  try {
    const opener = createFileOpener({ root, fs: { mkdirSync, mkdtempSync, writeFileSync, rmSync }, openPath: async (f) => { opened.push(f); return ''; } });
    assert.equal(opener.cleanup(), false, 'nothing written, nothing to remove');
    assert.equal(await opener.open({ name: 'booking.pdf', data: Buffer.from('%PDF-1.4').toString('base64') }), true);
    assert.equal(await opener.open({ name: '../../booking.pdf', data: Buffer.from('second').toString('base64') }), true);
    assert.equal(opened.length, 2);
    assert.equal(path.basename(opened[0]), 'booking.pdf', 'the copy keeps its real name');
    assert.notEqual(path.dirname(opened[0]), path.dirname(opened[1]), 'two files with one name never meet');
    for (const f of opened) assert.ok(f.startsWith(root + path.sep), 'every copy stays under the run\'s own folder: ' + f);
    assert.equal(readFileSync(opened[0], 'utf8'), '%PDF-1.4');
    assert.equal(readFileSync(opened[1], 'utf8'), 'second');
    assert.equal(await opener.open({ name: 'empty.pdf', data: '' }), false, 'no bytes, nothing opened');
    const failing = createFileOpener({ root, fs: { mkdirSync, mkdtempSync, writeFileSync, rmSync }, openPath: async () => 'No application knows how to open it' });
    assert.equal(await failing.open({ name: 'a.xyz', data: 'eA==' }), false, 'a copy the system could not open answers false');
    assert.equal(opener.cleanup(), true);
    assert.equal(existsSync(root), false, 'quitting removes every copy');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('a file is written under its own name, never outside its folder and never as nothing', () => {
  assert.equal(openName('booking.pdf'), 'booking.pdf');
  assert.equal(openName('../../etc/passwd'), 'passwd');
  assert.equal(openName('C:\\Users\\x\\notes.txt'), 'notes.txt');
  assert.equal(openName('a:b?.txt'), 'a_b_.txt');
  assert.equal(openName('CON.txt'), '_CON.txt', 'a name Windows reserves is not taken as the device');
  assert.equal(openName(''), 'Attachment');
  assert.equal(openName('..'), 'Attachment');
  assert.equal(openName(null), 'Attachment');
});

test('with no save wired, file.save answers false rather than throwing', async () => {
  const h = createHandlers({ secure: {}, notify: () => true, info: () => ({}), openExternal: () => true });
  assert.equal(await h['file.save']({ name: 'booking.pdf', mime: 'application/pdf', data: 'JVBERi0=' }), false);
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
