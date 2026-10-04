// A message's actions (issue 169): one menu, opened by a long press, a long click or a right click, that shows the
// message's received time, Reply in thread on other people's messages only and React, which opens the composer's own
// emoji panel. Replying fades every message outside the thread, and the composer repeats none of the message's text.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { threadIds, threadRoot, messageActions } from '../app/rules/messages.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-conversation.js');
const conversation = defined['app-conversation'].prototype;
const composer = defined['app-composer'].prototype;

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

const at = '2026-01-15T10:04:00.000Z';
const msg = (o) => ({ id: 'FAKE-0001', chatId: '1', fromMe: false, sender: '+15555550100', senderName: 'Avery Quinn', text: 'Unique body text', sentAt: at, replyTo: null, attachments: [], reactions: [], ...o });

test('the actions a message offers: React on any message that can be targeted, Reply in thread only on someone else\'s', () => {
  assert.deepEqual(messageActions(msg({}), { sending: true }), ['reply', 'react']);
  assert.deepEqual(messageActions(msg({ fromMe: true, sender: null }), { sending: true }), ['react'], 'a thread starts only by answering someone else');
  assert.deepEqual(messageActions(msg({}), { sending: false }), [], 'sending off on the server offers nothing to send');
  assert.deepEqual(messageActions(msg({ id: 'local:abc', state: 'sending', fromMe: true }), { sending: true }), [], 'nothing to target yet');
});

test('a thread is its first message and every reply that leads back to it, wherever in the thread the reply starts', () => {
  const list = [
    msg({ id: 'a' }), msg({ id: 'b' }), msg({ id: 'c', replyTo: 'a' }), msg({ id: 'd', replyTo: 'c' }), msg({ id: 'e', replyTo: 'b' }), msg({ id: 'f' }),
  ];
  assert.deepEqual([...threadIds(list, 'a')].sort(), ['a', 'c', 'd']);
  assert.deepEqual([...threadIds(list, 'd')].sort(), ['a', 'c', 'd'], 'answering a reply joins the same thread');
  assert.deepEqual([...threadIds(list, 'f')].sort(), ['f'], 'a message with no replies is a thread of one');
  const looped = [msg({ id: 'x', replyTo: 'y' }), msg({ id: 'y', replyTo: 'x' })];
  assert.ok(threadIds(looped, 'x').has('x'), 'a loop in the data ends rather than spinning');
  assert.deepEqual([...threadIds([msg({ id: 'r', replyTo: 'gone' })], 'r')].sort(), ['gone', 'r'], 'a parent not loaded still roots the thread');
});

const host = (o = {}) => ({ messages: [], chat: {}, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ...o });

test('the menu shows the received time, Reply in thread and React from the shared icon set on someone else\'s message', () => {
  const m = msg({});
  const markup = words(conversation.menu.call(host({ pop: { id: m.id, kind: 'menu', side: 'above' } }), m));
  assert.ok(markup.includes('class="message-time"') && markup.includes('datetime="' + at + '"'), 'the received time');
  assert.ok(markup.includes('aria-label="Reply in thread"') && markup.includes('data-icon="reply"'));
  assert.ok(markup.includes('aria-label="React"') && markup.includes('data-icon="smile-plus"'));
  assert.ok(!markup.includes('tapback'), 'no fixed tapback row');
  const glyphs = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url), 'utf8')).icons.glyphs;
  for (const name of ['reply', 'smile-plus']) assert.ok(glyphs[name] && glyphs[name]['sf-symbol'], name + ' is in the shared icon set');
});

test('your own message\'s menu shows its time and React, never Reply in thread', () => {
  const m = msg({ fromMe: true, sender: null });
  const markup = words(conversation.menu.call(host({ pop: { id: m.id, kind: 'menu', side: 'above' } }), m));
  assert.ok(markup.includes('class="message-time"'));
  assert.ok(markup.includes('aria-label="React"'));
  assert.ok(!/Reply/.test(markup), 'no Reply on your own message');
});

test('a message carries no action buttons of its own: every action is in the one menu', () => {
  const m = msg({});
  const markup = words(conversation.bubble.call(host({ messages: [m] }), { message: m, first: true, last: true }, null, false, 'list'));
  assert.ok(!markup.includes('message-actions'), 'no hover buttons beside the bubble');
  assert.ok(!markup.includes('data-icon="reply"'));
});

test('a long press with a finger or a long click with the mouse opens the menu, and moving first cancels it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const pointerType of ['touch', 'mouse']) {
      const h = host();
      h.openMenu = conversation.openMenu;
      const m = msg({});
      const e = { pointerType, button: 0, clientX: 10, clientY: 10, target: { closest: () => null } };
      conversation.pressStart.call(h, m, e);
      mock.timers.tick(499);
      assert.equal(h.pop, null, pointerType + ': not before the hold');
      mock.timers.tick(1);
      assert.deepEqual(h.pop, { id: m.id, kind: 'menu', side: 'above' }, pointerType + ' opens the menu');
      const moved = host();
      moved.openMenu = conversation.openMenu;
      moved.pressEnd = conversation.pressEnd;
      conversation.pressStart.call(moved, m, e);
      conversation.pressMove.call(moved, { clientX: 40, clientY: 10 });
      mock.timers.tick(600);
      assert.equal(moved.pop, null, pointerType + ': a drag is a scroll, not a press');
    }
    const right = host();
    right.openMenu = conversation.openMenu;
    conversation.pressStart.call(right, msg({}), { pointerType: 'mouse', button: 2, clientX: 0, clientY: 0, target: { closest: () => null } });
    mock.timers.tick(600);
    assert.equal(right.pop, null, 'a held right button is the context menu\'s, not a long click');
    let prevented = false;
    conversation.openMenu.call(right, msg({ fromMe: true }), { preventDefault() { prevented = true; } });
    assert.ok(prevented && right.pop, 'a right click opens the menu on any message, your own included');
  } finally { mock.timers.reset(); }
});

test('a long press swallows only the click its own release makes, never a later press in the menu', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const h = host();
    h.openMenu = conversation.openMenu;
    const m = msg({});
    const outside = { closest: () => null };
    const inMenu = { closest: (sel) => (sel === '.message-pop' ? {} : null) };
    const click = (target) => { const e = { target, stopped: false, preventDefault() {}, stopPropagation() { e.stopped = true; } }; conversation.swallow.call(h, e); return e.stopped; };
    conversation.pressStart.call(h, m, { pointerType: 'mouse', button: 0, clientX: 0, clientY: 0, target: outside });
    mock.timers.tick(500);
    conversation.pressEnd.call(h);
    assert.equal(click(outside), true, 'the release\'s own click presses nothing');
    assert.equal(click(outside), false, 'and the next click is a click');
    conversation.pressStart.call(h, m, { pointerType: 'touch', button: 0, clientX: 0, clientY: 0, target: outside });
    mock.timers.tick(500);
    conversation.pressEnd.call(h);
    mock.timers.tick(1);
    assert.equal(click(inMenu), false, 'a finger\'s release made no click, so Reply in the menu still presses');
    assert.equal(click(outside), false);
  } finally { mock.timers.reset(); }
});

test('React opens the composer\'s own emoji panel, and the emoji picked there is the reaction', () => {
  const m = msg({});
  const h = host({ messages: [m], pop: { id: m.id, kind: 'menu', side: 'above' } });
  conversation.openReact.call(h, m);
  assert.equal(h.pop, null, 'the menu closes');
  assert.equal(h.reactFor, m.id);
  // The composer opens its panel for the reaction, the one it draws for typing.
  const c = { emojiOpen: false, attachOpen: true, reactFor: m.id, staged: null, stageProblem: '', replyTo: null, frequent: [], preview: '', disabled: false, placeholder: '' };
  composer.willUpdate.call(c, new Map([['reactFor', null]]));
  assert.equal(c.emojiOpen, true);
  assert.equal(c.attachOpen, false);
  const markup = words(composer.render.call(c));
  assert.equal((markup.match(/<app-emoji-picker/g) || []).length, 1, 'the one emoji panel');
  // A pick in that panel is the reaction, not text in the field.
  const sent = [];
  let inserted = false;
  const p = { ...c, frequent: [], remember: (ch) => { p.frequent = [...p.frequent, ch]; }, insert: () => { inserted = true; }, dispatchEvent: (ev) => sent.push([ev.type, ev.detail]) };
  composer.pickEmoji.call(p, '\u{1F44D}');
  assert.deepEqual(sent, [['react-pick', '\u{1F44D}']]);
  assert.equal(inserted, false);
  assert.equal(p.emojiOpen, false, 'the panel closes once the reaction is chosen');
  assert.deepEqual(p.frequent, ['\u{1F44D}'], 'the reaction counts as recently used, in the same list');
  // The conversation sends it as the reaction on the message.
  const fired = [];
  const r = host({ messages: [m], reactFor: m.id, querySelector: () => null, querySelectorAll: () => [], fire: (name, detail) => { fired.push([name, detail]); return undefined; } });
  r.react = conversation.react;
  conversation.reactPicked.call(r, '\u{1F44D}');
  assert.deepEqual(fired, [['react', { messageId: m.id, emoji: '\u{1F44D}', remove: false }]]);
  assert.equal(r.reactFor, null);
});

test('closing the panel without a pick ends the reaction, and the panel opened from the composer still types', () => {
  const sent = [];
  const c = { emojiOpen: true, attachOpen: false, reactFor: 'FAKE-0001', field: () => null, closeEmoji: composer.closeEmoji, dispatchEvent: (ev) => sent.push(ev.type) };
  composer.toggleEmoji.call(c);
  assert.equal(c.emojiOpen, false);
  assert.deepEqual(sent, ['react-cancel']);
  let inserted = null;
  const t = { reactFor: null, insert: (ch) => { inserted = ch; }, dispatchEvent: () => assert.fail('no reaction while typing') };
  composer.pickEmoji.call(t, '\u{1F389}');
  assert.equal(inserted, '\u{1F389}');
});

test('a thread is opened by its first message, one level deep, so a reply to a reply joins the same thread', () => {
  const root = msg({ id: 'FAKE-0001', text: 'Unique root body' });
  const reply = msg({ id: 'FAKE-0003', replyTo: 'FAKE-0001', fromMe: true, sender: null, text: 'First reply' });
  const deeper = msg({ id: 'FAKE-0004', replyTo: 'FAKE-0003', text: 'Reply to the reply' });
  const h = host({ messages: [root, msg({ id: 'FAKE-0002', text: 'Unrelated message' }), reply, deeper] });
  conversation.openThread.call(h, deeper);
  assert.deepEqual(h.replyingTo, { id: 'FAKE-0001' }, 'the thread is named by its first message, so a reply sent from it lands in it');
  assert.equal(threadRoot(h.messages, 'FAKE-0003'), 'FAKE-0001');
});

test('an open thread is its own conversation over the rest, which is blurred and inert, and the composer repeats none of it', () => {
  const root = msg({ id: 'FAKE-0001', text: 'Unique root body' });
  const other = msg({ id: 'FAKE-0002', text: 'Unrelated message', sentAt: '2026-01-15T10:05:00.000Z' });
  const reply = msg({ id: 'FAKE-0003', replyTo: 'FAKE-0001', fromMe: true, sender: null, text: 'First reply', sentAt: '2026-01-15T10:06:00.000Z' });
  const h = host({ messages: [root, other, reply], replyingTo: { id: 'FAKE-0001' }, chat: { id: '1', name: 'Avery Quinn', participants: ['+15555550100'], isGroup: false, service: 'iMessage' }, hasMore: false, windowControls: null, uploadMaxBytes: 1 });
  for (const k of ['bubble', 'threadView', 'menu', 'ghost', 'links', 'composerPlaceholder']) h[k] = conversation[k];
  const thread = words(conversation.threadView.call(h, false));
  assert.ok(thread.includes('Unique root body') && thread.includes('First reply'), 'the first message and its replies');
  assert.ok(thread.indexOf('Unique root body') < thread.indexOf('First reply'), 'in order');
  assert.ok(!thread.includes('Unrelated message'), 'nothing outside the thread');
  assert.ok(!/thread-line|thread-ghost/.test(thread), 'no thread marks inside the thread');
  const page = words(conversation.render.call(h));
  assert.match(page, /class=messages behind/);
  assert.ok(page.includes('class="thread-view"'));
  const closed = words(conversation.render.call({ ...h, replyingTo: null }));
  assert.ok(!closed.includes('thread-view') && !/messages behind/.test(closed), 'closed, the conversation is whole again');
  const c = { emojiOpen: false, attachOpen: false, reactFor: null, staged: null, stageProblem: '', replyTo: { id: root.id }, frequent: [], preview: '', disabled: false, placeholder: 'Reply' };
  const markup = words(composer.render.call(c));
  assert.ok(!markup.includes('Replying in thread') && !markup.includes('composer-thread'), 'no indicator row: the field reads Reply (issue 195)');
  assert.ok(!markup.includes('Unique root body') && !markup.includes('composer-reply'), 'no quote banner');
  const s = host({ replyingTo: { id: root.id }, fire: () => undefined });
  conversation.onSend.call(s, { text: 'x', replyTo: root.id });
  assert.equal(s.replyingTo, null, 'sending brings the whole conversation back');
});

test('the thread opens over a blur that reduced motion keeps without animation, reactions float, and the old surfaces are gone', () => {
  const css = readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8');
  assert.match(css, /\.messages\.behind \{[^}]*filter: blur\(var\(--size-scrim-blur\)\)/);
  const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join('\n');
  assert.match(reduced, /\.thread-view \{ animation: none; \}/);
  assert.match(reduced, /\.messages \{ transition: none; \}/);
  assert.match(css, /\.reactions \{ position: absolute; top: 0; right: 0;/);
  assert.match(css, /\.reaction \{ background: none;/);
  assert.ok(!/\.composer-reply|\.composer-thread|\.reply-mark|\.tapback-row|\.message-actions|\.reply-link|\.faded/.test(css), 'the old banner, indicator, per-message mark, tapback row, hover buttons, reply label and fade are gone');
});
