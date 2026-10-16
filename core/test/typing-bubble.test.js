// The other person typing (issue 390): an incoming bubble of three animated dots at the foot of the conversation, under
// the newest message, gone when typing stops or goes stale. Our own other device typing stays a quiet note in the
// header. The bubble moves through core/kit/motion.js, so reduced motion keeps it and stills its dots.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTyping, typingBubble, typingNote, typingPulse, TYPING_TTL_MS, TYPING_BUBBLE_LABEL } from '../app/rules/typing.js';
import { scrollFor } from '../kit/rules/scroll.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-conversation.js');
const conversation = defined['app-conversation'].prototype;

// The Lit template as the text it would draw, nested templates included, without a browser.
function words(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(words).join('');
  if (value?.strings) return value.strings.map((s, i) => s + words(value.values[i])).join('');
  return '';
}

const at = 1_000_000;
const sentAt = '2026-01-15T10:04:00.000Z';
const msg = (o) => ({ id: 'FAKE-0001', chatId: '1', fromMe: false, sender: '+15555550100', senderName: 'Avery Quinn', text: 'Synthetic fixture text', sentAt, replyTo: null, attachments: [], reactions: [], ...o });
const live = (kind) => ({ chatId: '1', kind, at: Date.now() });

function drawn(typing) {
  const host = Object.assign(Object.create(conversation), {
    chat: { id: '1', name: 'Fixture One', isGroup: false, participants: ['+15555550100'], service: 'iMessage' },
    messages: [msg({ id: 'FAKE-0001' }), msg({ id: 'FAKE-0002', fromMe: true, sender: null, text: 'Synthetic reply' })],
    hasMore: false, sending: true, pop: null, replyingTo: null, reactFor: null, reacting: null, note: null, ownNote: null, windowControls: null, typing,
  });
  return words(host.render());
}

test('the other person typing is a bubble of three dots, and our other device is a quiet note, never that bubble', () => {
  const contact = applyTyping(null, { chatId: '1', kind: 'contact', typing: true }, { chatId: '1', now: at });
  const device = applyTyping(null, { chatId: '1', kind: 'device', typing: true }, { chatId: '1', now: at });
  assert.equal(typingBubble(contact, at + 5), true);
  assert.equal(typingNote(contact, at + 5), '', 'the other person typing is never a header line');
  assert.equal(typingBubble(device, at + 5), false, 'our own other device is never drawn as the other person');
  assert.equal(typingNote(device, at + 5), "You're typing on another device");
  assert.equal(typingBubble(null, at), false);
});

test('the typing bubble clears when typing stops or goes stale', () => {
  const contact = applyTyping(null, { chatId: '1', kind: 'contact', typing: true }, { chatId: '1', now: at });
  assert.equal(typingBubble(contact, at + TYPING_TTL_MS - 1), true);
  assert.equal(typingBubble(contact, at + TYPING_TTL_MS), false, 'stale with no stop ever arriving');
  assert.equal(applyTyping(contact, { chatId: '1', kind: 'contact', typing: false }, { chatId: '1', now: at + 10 }), null, 'a stop clears it');
  assert.equal(applyTyping(null, { chatId: '2', kind: 'contact', typing: true }, { chatId: '1', now: at }), null, 'another conversation never draws it');
});

test('the conversation draws the typing bubble under the newest message, labelled typing, and no header line', () => {
  const markup = drawn(live('contact'));
  const row = markup.indexOf('class="typing-row"');
  assert.ok(row > 0, 'the bubble is drawn');
  assert.ok(row > markup.indexOf('data-id="FAKE-0002"'), 'under the newest message');
  assert.ok(row < markup.indexOf('<app-composer'), 'inside the conversation, at its foot');
  assert.match(markup, /class="bubble them typing-bubble" role="status" aria-label="?typing"?>/, 'an incoming bubble with an accessible label');
  assert.equal(TYPING_BUBBLE_LABEL, 'typing');
  assert.equal(markup.split('class="typing-dot"').length - 1, 3, 'three dots');
  assert.ok(!markup.includes('class="muted small typing"'), 'the header line it replaces is gone');
  assert.ok(!/class="typing-row[^"]*bubble-row/.test(markup), 'not a message row, so no message selector or scroll anchor takes it');

  const none = drawn(null);
  assert.ok(!none.includes('typing-row') && !none.includes('class="muted small typing"'), 'nothing while nobody types');

  const device = drawn(live('device'));
  assert.ok(!device.includes('typing-row'), 'our other device draws no bubble');
  assert.ok(device.includes("You're typing on another device"), 'it stays a quiet note');
});

test('the dots pulse in turn through the kit, and stand still under reduced motion while the bubble still shows', () => {
  const frames = [0, 1, 2].map((i) => typingPulse(i, 3, 4));
  const peaks = frames.map((f) => f.find((k) => k.opacity === 1));
  assert.deepEqual(peaks.map((p) => p.translate), ['0px -4px', '0px -4px', '0px -4px']);
  assert.ok(peaks[0].offset < peaks[1].offset && peaks[1].offset < peaks[2].offset, 'one after another');
  for (const f of frames) {
    assert.equal(f[0].offset, 0);
    assert.equal(f.at(-1).offset, 1);
    for (let i = 1; i < f.length; i++) assert.ok(f[i].offset >= f[i - 1].offset, 'offsets in order');
  }

  const vars = { '--motion-typing': '1200ms', '--motion-spring': '730ms', '--motion-ease': 'ease-out', '--motion-spring-ease': 'ease-out', '--space-1': '4px', '--space-4': '16px' };
  globalThis.getComputedStyle = () => ({ getPropertyValue: (n) => vars[n] || '' });
  const el = () => ({ played: [], animate(k, o) { this.played.push(o); return { finished: Promise.resolve() }; } });
  const dots = [el(), el(), el()];
  const bubble = el();
  const row = { querySelector: () => bubble, querySelectorAll: () => dots };
  const host = Object.assign(Object.create(conversation), { querySelector: () => row, typingRow: null });

  globalThis.matchMedia = () => ({ matches: false });
  host.animateTyping();
  assert.equal(bubble.played.length, 1, 'the bubble rises in');
  assert.ok(dots.every((d) => d.played.length === 1 && d.played[0].iterations === Infinity && d.played[0].duration === 1200), 'each dot pulses on the typing token for as long as it is up');
  host.animateTyping();
  assert.equal(bubble.played.length, 1, 'a re-render of the same bubble does not start it again');

  globalThis.matchMedia = () => ({ matches: true });
  const still = [el(), el(), el()];
  const host2 = Object.assign(Object.create(conversation), { querySelector: () => ({ querySelector: () => bubble, querySelectorAll: () => still }), typingRow: null });
  bubble.played = [];
  host2.animateTyping();
  assert.equal(bubble.played.length + still.reduce((n, d) => n + d.played.length, 0), 0, 'reduced motion plays nothing');
  delete globalThis.matchMedia;
  delete globalThis.getComputedStyle;
});

test('the bubble coming or going keeps a view at its end there and leaves a reader scrolled up where they were', () => {
  const items = [{ key: 'a', top: 0, bottom: 100 }, { key: 'b', top: 100, bottom: 200 }, { key: 'c', top: 200, bottom: 300 }];
  const before = { scrollTop: 50, scrollHeight: 340, clientHeight: 120, items };
  const after = { ...before, scrollHeight: 400 };
  const upAnchor = { key: 'b', offset: 50 };
  assert.equal(scrollFor(upAnchor, before), scrollFor(upAnchor, after), 'a reader scrolled up is not moved');
  assert.equal(scrollFor({ end: true }, after), after.scrollHeight - after.clientHeight, 'a view at its end follows the bubble in');
  assert.equal(scrollFor({ end: true }, before), before.scrollHeight - before.clientHeight, 'and back when it goes');
});
