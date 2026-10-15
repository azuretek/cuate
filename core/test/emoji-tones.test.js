// Skin tones take one slot, chosen by a long press, and emoji the device cannot draw are left out (issue 392). The
// grouping, the remembered tone and the support decision are pure (core/app/rules/emoji.js); the panel's long press and
// the storage of the chosen tones are the component's, driven here with a stand-in shell store and a fake clock.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMOJI } from '../app/rules/emoji-data.js';
import { emojiInCategory, searchEmoji, panelEmoji, toneBase, toneChoices, hasTones, chooseTone, tonedChar, cleanTones, glyphDrawn, emojiFallbackParts } from '../app/rules/emoji.js';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
globalThis.window = globalThis;
const { loadEmojiTones, rememberTone, encodeTones, decodeTones } = await import('../app/components/app-emoji-picker.js');
const picker = defined['app-emoji-picker'].prototype;

const WAVE = '\u{1F44B}';
const WAVE_MEDIUM = '\u{1F44B}\u{1F3FD}';
const WAVE_DARK = '\u{1F44B}\u{1F3FF}';
const THUMBS = '\u{1F44D}';
const THUMBS_LIGHT = '\u{1F44D}\u{1F3FB}';
const SMILE = '\u{1F600}';
const MELT = '\u{1FAE0}';
const TONE = /[\u{1F3FB}-\u{1F3FF}]/u;

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

test('an emoji with skin tones takes one slot in the panel, in the place the standard gives it', () => {
  const people = emojiInCategory('people');
  const slots = panelEmoji(people);
  assert.ok(people.some((e) => TONE.test(e.char)), 'the catalogue still carries every toned sequence');
  assert.equal(slots.filter((s) => s.base === WAVE).length, 1, 'the waving hand is one slot');
  assert.ok(slots.every((s) => !TONE.test(s.char)), 'with nothing chosen, every slot is the standard yellow');
  assert.equal(new Set(slots.map((s) => s.base)).size, slots.length, 'no emoji is offered twice');
  assert.ok(slots.find((s) => s.base === WAVE).toned, 'the slot says it has tones');
  assert.equal(slots.find((s) => s.base === SMILE), undefined, 'a smiley is not a person');
  assert.equal(panelEmoji(emojiInCategory('smileys')).find((s) => s.base === SMILE).toned, false, 'a smiley has no tones');
  // Every toned sequence in the catalogue folds onto an emoji the panel shows, so none is lost by the grouping.
  for (const e of EMOJI.filter((x) => TONE.test(x.char))) assert.ok(hasTones(toneBase(e.char)) && toneBase(e.char) !== e.char, e.name + ' has a yellow emoji');
  assert.deepEqual(toneChoices(WAVE_DARK).map((e) => e.char).slice(0, 2), [WAVE, '\u{1F44B}\u{1F3FB}'], 'the yellow one first, then the tones in order');
  assert.equal(toneChoices(WAVE).length, 6);
  assert.ok(toneChoices('\u{1F91D}').length > 6, 'a handshake offers each pair of tones');
});

test('a search folds the tones onto their emoji, so a tone finds the emoji once', () => {
  const slots = panelEmoji(searchEmoji('waving hand'));
  assert.deepEqual(slots.map((s) => s.base), [WAVE]);
  const byTone = panelEmoji(searchEmoji('medium skin tone'));
  assert.ok(byTone.length > 50 && new Set(byTone.map((s) => s.base)).size === byTone.length, 'each toned emoji once');
});

test('the chosen tone is remembered per emoji and drawn in its slot until another is chosen', () => {
  let chosen = chooseTone({}, WAVE_MEDIUM);
  assert.deepEqual(chosen, { [WAVE]: WAVE_MEDIUM });
  chosen = chooseTone(chosen, THUMBS_LIGHT);
  assert.equal(tonedChar(chosen, WAVE), WAVE_MEDIUM);
  assert.equal(tonedChar(chosen, THUMBS), THUMBS_LIGHT, 'each emoji keeps its own');
  const slots = panelEmoji(emojiInCategory('people'), { chosen });
  assert.equal(slots.find((s) => s.base === WAVE).char, WAVE_MEDIUM, 'the slot draws the remembered tone');
  chosen = chooseTone(chosen, WAVE_DARK);
  assert.equal(tonedChar(chosen, WAVE), WAVE_DARK, 'a new choice replaces the old one');
  chosen = chooseTone(chosen, WAVE);
  assert.equal(tonedChar(chosen, WAVE), WAVE, 'choosing the standard yellow goes back to it');
  assert.ok(!(WAVE in chosen), 'and forgets the choice');
  assert.deepEqual(chooseTone({}, SMILE), {}, 'an emoji with no tones is never filed');
  assert.deepEqual(cleanTones({ [WAVE]: THUMBS_LIGHT, [THUMBS]: THUMBS_LIGHT, x: 1 }), { [THUMBS]: THUMBS_LIGHT }, 'a tone filed under another emoji is dropped');
});

test('the chosen tones survive a restart in the text every shell stores', async () => {
  window.bridge = shellStore();
  assert.deepEqual(await loadEmojiTones(), {});
  await rememberTone(await rememberTone({}, WAVE_MEDIUM), THUMBS_LIGHT);
  assert.equal(typeof window.bridge.saved.get('emoji.tones'), 'string', 'stored as text');
  assert.deepEqual(await loadEmojiTones(), { [WAVE]: WAVE_MEDIUM, [THUMBS]: THUMBS_LIGHT }, 'read back after the app starts again');
  assert.deepEqual(decodeTones('not json'), {});
  assert.deepEqual(decodeTones('["a"]'), {});
  assert.deepEqual(decodeTones(encodeTones({ [WAVE]: WAVE_DARK })), { [WAVE]: WAVE_DARK });
  let all = {};
  for (const e of EMOJI.filter((x) => TONE.test(x.char))) all = chooseTone(all, e.char);
  all = chooseTone(all, WAVE_DARK);
  const text = encodeTones(all);
  assert.ok(new TextEncoder().encode(text).length <= 8192, 'a tone chosen for every emoji still fits the smallest shell');
  assert.equal(decodeTones(text)[WAVE], WAVE_DARK, 'trimmed from the oldest choice, so the newest is kept');
  assert.ok(Object.keys(decodeTones(text)).length > 100, 'most choices are kept, measured ' + Object.keys(decodeTones(text)).length);
  window.bridge = undefined;
  assert.deepEqual(await loadEmojiTones(), {}, 'a page with no shell starts with no choice');
});

test('a glyph the device did not draw is left out, decided by what was measured', () => {
  const missing = ['10:42'];
  assert.equal(glyphDrawn({ width: 24, reference: 24, signature: '900:7', missing }), true, 'drawn as one emoji');
  assert.equal(glyphDrawn({ width: 24, reference: 24, signature: '10:42', missing }), false, 'the box a font draws for what it lacks');
  assert.equal(glyphDrawn({ width: 0, reference: 24, blank: true }), false, 'nothing drawn');
  assert.equal(glyphDrawn({ width: 48, reference: 24, signature: '1800:3', missing }), false, 'a sequence drawn as its parts');
  assert.equal(glyphDrawn({}), true, 'a measurement that could not be taken hides nothing');
  const drawable = (c) => c !== MELT && c !== WAVE_MEDIUM;
  const smileys = panelEmoji(emojiInCategory('smileys'), { drawable });
  assert.ok(!smileys.some((s) => s.char === MELT), 'an emoji the device cannot draw is not offered');
  assert.ok(smileys.some((s) => s.char === SMILE));
  const wave = panelEmoji(emojiInCategory('people'), { chosen: { [WAVE]: WAVE_MEDIUM }, drawable }).find((s) => s.base === WAVE);
  assert.equal(wave.char, WAVE, 'a remembered tone the device cannot draw falls back to the yellow one');
});

test('a message shows the name of an emoji the device cannot draw, rather than an empty box', () => {
  const drawable = (c) => c !== MELT;
  assert.deepEqual(emojiFallbackParts('so hot ' + MELT + ' today ' + SMILE, drawable), [
    { text: 'so hot ' }, { emoji: MELT, name: 'melting face' }, { text: ' today ' + SMILE },
  ]);
  assert.deepEqual(emojiFallbackParts('plain words', () => false), [{ text: 'plain words' }], 'text with no emoji is untouched');
  assert.deepEqual(emojiFallbackParts(SMILE + WAVE_MEDIUM), [{ text: SMILE + WAVE_MEDIUM }], 'what the device draws stays as sent');
  const conversation = readFileSync(new URL('../app/components/app-conversation.js', import.meta.url), 'utf8');
  assert.match(conversation, /emojiFallbackParts\(text, canDrawEmoji\)/, 'the bubble text goes through the fallback');
  assert.match(conversation, /class="emoji-fallback" role="img" aria-label=\$\{p\.name\}/, 'the fallback is named for a screen reader too');
});

// The panel's own press handling, on a stand-in for the component: a long rest or a right click opens the tones, the
// release that ends a long press is not also a pick, a short press picks the remembered tone, and a drift cancels.
function fakePicker() {
  const host = Object.create(picker);
  Object.assign(host, { tones: {}, toneFor: null, hold: null, held: null, picked: [] });
  host.pick = (c) => host.picked.push(c);
  return host;
}
const pointer = (cell, o = {}) => ({ button: 0, clientX: 10, clientY: 10, currentTarget: cell, preventDefault() { this.prevented = true; }, ...o });

test('a long press or a right click on a toned emoji opens its tones, and the release is not a pick', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const host = fakePicker();
    const cell = { isConnected: true };
    host.holdStart(pointer(cell), WAVE);
    mock.timers.tick(499);
    assert.equal(host.toneFor, null, 'not before the rest is long enough');
    mock.timers.tick(1);
    assert.equal(host.toneFor, WAVE, 'a long press opens the tones');
    const release = pointer(cell);
    host.pressCell(release, WAVE);
    assert.deepEqual(host.picked, [], 'the release that ended the long press inserts nothing');
    host.pressCell(pointer(cell), WAVE);
    assert.deepEqual(host.picked, [WAVE], 'a short press after it is a pick');

    const right = fakePicker();
    const e = pointer(cell, { button: 2 });
    right.contextTones(e, THUMBS);
    assert.equal(right.toneFor, THUMBS, 'a right click opens the tones');
    assert.ok(e.prevented, 'in place of the system menu');

    const scroll = fakePicker();
    scroll.holdStart(pointer(cell), WAVE);
    scroll.holdMove(pointer(cell, { clientY: 40 }));
    mock.timers.tick(600);
    assert.equal(scroll.toneFor, null, 'a finger that moves is scrolling, not choosing');
  } finally {
    mock.timers.reset();
  }
});

test('choosing a tone remembers it and inserts it', async () => {
  window.bridge = shellStore();
  const host = fakePicker();
  host.toneFor = WAVE;
  await host.pickTone(WAVE_DARK);
  assert.deepEqual(host.picked, [WAVE_DARK]);
  assert.equal(host.toneFor, null, 'the tones close');
  assert.deepEqual(host.tones, { [WAVE]: WAVE_DARK });
  assert.equal(host.results.call(Object.assign(Object.create(host), { query: 'waving hand' }))[0].char, WAVE_DARK, 'the slot draws it from now on');
  window.bridge = undefined;
});
