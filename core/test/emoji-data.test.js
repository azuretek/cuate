// The emoji catalogue is derived, never typed (issue 231). These tests hold the generated file to the pinned
// sources and hold the seam with the reaction send path (#204): whatever the picker hands over is one character
// the server sends as itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EMOJI, EMOJI_CATEGORIES } from '../app/rules/emoji-data.js';
import { emojiDataText, OUT } from '../../scripts/gen-emoji.mjs';
import { deriveEmojiData } from '../../scripts/lib/emoji-source.mjs';
import { countGraphemes, insertEmoji, isEmoji, searchEmoji, frequentEmoji } from '../app/rules/emoji.js';
import { tapbackType, reactionGlyph } from '../app/rules/messages.js';

const read = (rel) => readFileSync(new URL('../../' + rel, import.meta.url), 'utf8');
const sources = () => ({
  emojiTest: read('core/spec/emoji/emoji-test.txt'),
  annotations: read('core/spec/emoji/cldr-annotations-en.xml'),
  derivedAnnotations: read('core/spec/emoji/cldr-annotations-derived-en.xml'),
});
const derived = () => deriveEmojiData(sources());

const TONE = '\u{1F44B}\u{1F3FD}';       // waving hand: medium skin tone
const ZWJ = '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}'; // family: man, woman, girl

test('the emoji data is fresh, so a hand edit to it fails pnpm run build', () => {
  assert.equal(readFileSync(OUT, 'utf8'), emojiDataText().text,
    'core/app/rules/emoji-data.js is stale: run pnpm run emoji');
});

test('the picker shows every group the standard defines, in its order, with its counts', () => {
  const { groups, entries } = derived();
  assert.deepEqual(EMOJI_CATEGORIES.map((c) => c.id), groups.map((g) => g.id), 'the standard group order');
  assert.ok(groups.length >= 9, 'every group the standard defines');
  for (const g of groups) {
    assert.equal(EMOJI.filter((e) => e.category === g.id).length, entries.filter((e) => e.category === g.id).length,
      g.group + ' carries every sequence the standard puts in it');
  }
  assert.equal(EMOJI.length, entries.length);
  assert.ok(EMOJI.every((e) => typeof e.name === 'string' && e.name.length > 0), 'every sequence has a name to search');
});

test('the picker reads the generated catalogue and keeps no literal of its own', () => {
  const picker = read('core/app/components/app-emoji-picker.js');
  assert.match(picker, /from '\.\.\/rules\/emoji-data\.js'/);
  const rules = read('core/app/rules/emoji.js');
  assert.doesNotMatch(rules, /export const EMOJI = \[/, 'no hand-written catalogue in the rules');
});

test('a skin-tone sequence and a ZWJ sequence are offered, insert as themselves, and reach the send path unchanged', () => {
  for (const [what, seq] of [['skin tone', TONE], ['ZWJ', ZWJ]]) {
    assert.ok(isEmoji(seq), what + ' is in the catalogue');
    assert.equal(countGraphemes(seq), 1, what + ' is one character');
    assert.deepEqual(insertEmoji('', 0, 0, seq), { text: seq, caret: seq.length }, what + ' inserts exactly');
    // Not a standard tapback, so the engine that advertises it sends the sequence as itself (#188/#204).
    assert.equal(tapbackType(seq), null, what + ' is sent as itself, not folded onto a tapback');
    assert.equal(reactionGlyph({ type: 'emoji', emoji: seq }), seq, what + ' is drawn as what was sent');
  }
});

// ★ The seam #204 landed: the picker hands a sequence to the reaction path, which sends and shows it unchanged.
test('every emoji the picker offers is one character and survives the reaction send path (#204)', () => {
  for (const e of EMOJI) {
    assert.equal(countGraphemes(e.char), 1, e.name + ' is one character');
    assert.equal(reactionGlyph({ type: 'emoji', emoji: e.char }), e.char, e.name + ' is sent as itself');
  }
});

test('a search for a known emoji name finds it, including one the hand-written list never carried', () => {
  const has = (query, char) => searchEmoji(query).some((e) => e.char === char);
  assert.ok(has('melting face', '\u{1FAE0}'), 'Emoji 14 melting face');
  assert.ok(has('shaking face', '\u{1FAE8}'), 'Emoji 15 shaking face');
  assert.ok(has('flag', '\u{1F1FA}\u{1F1F8}'), 'a flag');
  assert.ok(searchEmoji('flags').length + searchEmoji('flag').length >= 200, 'the flags are searchable');
});

test('a recently used emoji is the sequence itself, so it survives a data refresh', () => {
  const stored = [TONE, '\u{1FAE0}', TONE]; // what the shell saved, before any refresh
  const recent = frequentEmoji(stored);
  assert.deepEqual(recent, [TONE, '\u{1FAE0}']);
  // A refresh derives the catalogue again and may reorder every entry; a saved sequence still resolves.
  const known = new Set(derived().entries.map((e) => e.char));
  assert.ok(recent.every((c) => known.has(c)), 'a saved character is still in the refreshed catalogue');
});
