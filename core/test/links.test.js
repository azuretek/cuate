// The links in a message's text (core/app/rules/links.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLinks, messageLinks, linkHref } from '../app/rules/links.js';

const links = (t) => splitLinks(t).filter((p) => p.href).map((p) => p.href);

test('a web address in a message is a link, and the text around it stays text', () => {
  assert.deepEqual(splitLinks('see https://example.com/a?b=1 now'), [{ text: 'see ' }, { text: 'https://example.com/a?b=1', href: 'https://example.com/a?b=1' }, { text: ' now' }]);
  assert.deepEqual(splitLinks('https://example.com'), [{ text: 'https://example.com', href: 'https://example.com/' }], 'a message that is only a link');
  assert.deepEqual(splitLinks('no links here'), [{ text: 'no links here' }]);
  assert.deepEqual(splitLinks(''), []);
  assert.deepEqual(links('one http://a.example and two https://b.example/x'), ['http://a.example/', 'https://b.example/x']);
});

test('a bare www. address opens as https', () => {
  assert.deepEqual(links('try www.example.org/page'), ['https://www.example.org/page']);
  assert.equal(splitLinks('try www.example.org/page')[1].text, 'www.example.org/page', 'it is shown as it was written');
});

test('punctuation that ends the sentence, and a bracket the link did not open, are not part of the link', () => {
  assert.deepEqual(links('Look at https://example.com.'), ['https://example.com/']);
  assert.deepEqual(links('is it https://example.com/x?'), ['https://example.com/x']);
  assert.deepEqual(links('(see https://example.com/a)'), ['https://example.com/a']);
  assert.deepEqual(links('https://en.wikipedia.org/wiki/Foo_(bar)'), ['https://en.wikipedia.org/wiki/Foo_(bar)'], 'a bracket the link opened stays');
  assert.deepEqual(links('"https://example.com/q",'), ['https://example.com/q']);
  const parts = splitLinks('Look at https://example.com.');
  assert.equal(parts.at(-1).text, '.', 'the full stop is still drawn, as text');
});

test('only web addresses are links: no other scheme, no address without a domain', () => {
  assert.deepEqual(links('javascript:alert(1) file:///etc/passwd mailto:a@b.example tel:5555550100'), []);
  assert.deepEqual(links('http://localhost:8080'), []);
  assert.equal(linkHref('ftp://example.com'), null);
  assert.equal(linkHref('www.example.com'), 'https://www.example.com/');
});

test("a message's links are those in its text, then its link card's address, each once", () => {
  assert.deepEqual(messageLinks({ text: 'a https://x.example b https://x.example', link: { url: 'https://card.example/p' } }), ['https://x.example/', 'https://card.example/p']);
  assert.deepEqual(messageLinks({ text: 'https://card.example/p', link: { url: 'https://card.example/p' } }), ['https://card.example/p']);
  assert.deepEqual(messageLinks({ text: 'nothing', link: null }), []);
  assert.deepEqual(messageLinks(null), []);
});

test('a clipboard that refuses the write falls back to the copy command, as an Android web view needs', async () => {
  const { copyToClipboard } = await import('../app/clipboard.js');
  const made = [];
  const doc = { body: { append: (n) => made.push(n) }, createElement: () => ({ value: '', setAttribute() {}, select() {}, remove() {} }), execCommand: (c) => c === 'copy' };
  assert.equal(await copyToClipboard('https://a.example/', { clipboard: { writeText: () => Promise.reject(new Error('NotAllowedError')) }, document: doc }), true);
  assert.equal(made[0].value, 'https://a.example/');
  assert.equal(await copyToClipboard('x', { clipboard: { writeText: () => { throw new Error('sync'); } }, document: doc }), true, 'a write that throws at once falls back too');
  assert.equal(await copyToClipboard('x', { clipboard: { writeText: () => Promise.reject(new Error('no')) }, document: { ...doc, execCommand: () => false } }), false, 'both refusing is a failure');
});
