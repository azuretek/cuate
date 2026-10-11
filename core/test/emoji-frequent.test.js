// The most used emoji survive a restart (issue 301). Every shell's storage holds text only: the desktop encrypts the
// value as a string, iOS refuses anything that is not a string under 8 KB, and Android stores it as a string and hands a
// string back. The stand-in here behaves the same way, and a fresh load stands for the app starting again.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
globalThis.window = globalThis;
const { loadRecentEmoji, rememberEmoji } = await import('../app/components/app-emoji-picker.js');

// A shell store as every platform has one: text in, text out, at most 8 KB, and anything else refused.
const shellStore = () => {
  const saved = new Map();
  return {
    saved,
    async call(name, { key, value } = {}) {
      if (name === 'storage.get') return saved.has(key) ? saved.get(key) : null;
      if (name === 'storage.set') {
        if (typeof value !== 'string' || new TextEncoder().encode(value).length > 8192) throw new Error('storage takes text only');
        saved.set(key, value);
        return true;
      }
      return null;
    },
  };
};

test('the emoji used are still the most used after the app starts again', async () => {
  window.bridge = shellStore();
  let list = await loadRecentEmoji();
  assert.deepEqual(list, []);
  for (const c of ['👍', '😂', '👍', '❤️', '👍', '😂']) list = await rememberEmoji(list, c);
  // The app starts again: nothing held in memory, only what the shell kept.
  const after = await loadRecentEmoji();
  assert.deepEqual(after, ['👍', '😂', '👍', '❤️', '👍', '😂']);
});

test('a long history of wide emoji still fits what every shell will store', async () => {
  window.bridge = shellStore();
  let list = [];
  const family = '👨‍👩‍👧‍👦';
  for (let i = 0; i < 400; i += 1) list = await rememberEmoji(list, i % 2 ? family : '🏳️‍🌈');
  const after = await loadRecentEmoji();
  assert.ok(after.length > 50, 'most of the history is kept, measured ' + after.length);
  assert.equal(after.at(-1), family, 'the newest use is the one kept last');
  assert.ok(new TextEncoder().encode(window.bridge.saved.get('emoji.frequent')).length <= 8192);
});

test('a value from before this fix, or one that is not a list, reads as empty rather than failing', async () => {
  window.bridge = shellStore();
  window.bridge.saved.set('emoji.frequent', '👍,😂');
  assert.deepEqual(await loadRecentEmoji(), []);
  window.bridge.saved.set('emoji.frequent', '{"a":1}');
  assert.deepEqual(await loadRecentEmoji(), []);
  window.bridge = undefined;
  assert.deepEqual(await loadRecentEmoji(), []);
  assert.deepEqual(await rememberEmoji([], '👍'), ['👍'], 'a page with no shell keeps the list for the page');
});

// The desktop's own store, the real code over a real file, with a stand-in keychain: the app saves, quits, and a new
// store opened on the same file is the app starting again.
test('on the desktop, the most used emoji are read back from the store file after a restart', async () => {
  const { createSecureStore, createHandlers } = await import('../../desktop/src/bridge-handlers.js');
  const fs = await import('node:fs');
  const os = await import('node:os');
  const path = await import('node:path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'emoji-frequent-'));
  const file = () => path.join(dir, 'secure-store.json');
  const safeStorage = { isEncryptionAvailable: () => true, encryptString: (s) => Buffer.from('k:' + s, 'utf8'), decryptString: (b) => b.toString('utf8').slice(2) };
  const shell = () => {
    const handlers = createHandlers({ secure: createSecureStore({ file, safeStorage, fs }), notify() {}, info: () => ({}), openExternal() {} });
    return { call: (name, args) => handlers[name](args) };
  };
  try {
    window.bridge = shell();
    let list = await loadRecentEmoji();
    for (const c of ['🎉', '🎉', '🙏']) list = await rememberEmoji(list, c);
    window.bridge = shell();
    assert.deepEqual(await loadRecentEmoji(), ['🎉', '🎉', '🙏']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
