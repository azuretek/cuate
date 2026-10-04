// The link card is one cohesive object (issue 245), still drawing only what we hold (issue 238).
//
// It was a fixed wide box: the card stretched to the long URL's width, so a portrait preview sat in a wide box with
// dead space beside it, the site name stranded on its own line and the URL wrapping mid-token into a ragged block.
// The card now sizes to its content, the hairline border sits tight around the preview with one consistent inset and
// the media's own corner radius, and the site and the URL are one compact block under the image with the same padding
// on every side. No third-party page is fetched to decorate a message.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = () => readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = (src) => [...src.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({ sel: sel.trim(), body }));
const rule = (src, selector) => { const hit = rules(src).find((r) => r.sel === selector); return hit ? hit.body : null; };
const component = () => readFileSync(new URL('../app/components/app-link-card.js', import.meta.url), 'utf8');

test('the link card is sized to its content, never a fixed wide box', () => {
  const src = css();
  assert.match(rule(src, 'app-link-card'), /display:\s*inline-block/, 'the card element shrink-wraps its content');
  assert.match(rule(src, '.link-card'), /width:\s*fit-content/, 'the card follows its content rather than the column');
  const body = rule(src, '.link-card.has-image .link-card-body');
  assert.match(body, /width:\s*0/, 'with a picture, a long URL takes no width of its own');
  assert.match(body, /min-width:\s*100%/, 'the text block stretches back to the picture width');
  assert.match(component(), /'link-card' \+ \(l\.image \? ' has-image' : ''\)/, 'the component marks a card that carries a picture');
});

test('the card border sits tight around the preview with one inset and the media radius', () => {
  const src = css();
  const card = rule(src, '.link-card');
  assert.match(card, /border:\s*var\(--size-border\) solid var\(--color-border\)/, 'the hairline is the border role');
  assert.match(card, /padding:\s*var\(--space-1\);/, 'one consistent inset on every side');
  assert.match(card, /border-radius:\s*var\(--radius-lg\)/, 'the card carries its own corner radius');
  const media = rule(src, '.link-card-image .attachment-image, .link-card-image .attachment-preview');
  assert.match(media, /border-radius:\s*calc\(var\(--radius-lg\) - var\(--space-1\)\)/, 'the media nests inside the card radius, in from the inset');
  assert.doesNotMatch(media, /border-radius:\s*0/, 'the preview no longer squares off inside the card');
  assert.match(rule(src, '.link-card-image .attachment-preview'), /border:\s*0/, 'the preview adds no second border');
});

test('the site and the URL are one compact block, the same padding on every side', () => {
  const src = css();
  const body = rule(src, '.link-card-body');
  assert.ok(body, 'the text block is drawn');
  assert.match(body, /padding:\s*var\(--space-3\);/, 'the block pads every side the same');
  assert.match(rule(src, '.link-card-site'), /-webkit-line-clamp:\s*2/, 'the site name wraps to two lines before it truncates');
  const url = rule(src, '.link-card-url');
  assert.match(url, /text-overflow:\s*ellipsis/, 'the URL truncates at the end');
  assert.match(url, /white-space:\s*nowrap/, 'the URL never wraps mid-token');
  assert.doesNotMatch(url, /overflow-wrap:\s*anywhere/, 'the URL no longer wraps into a ragged block');
});

test('the card draws only what we hold, never a third-party page fetched to decorate a message', () => {
  const src = component();
  assert.doesNotMatch(src, /fetch\(|XMLHttpRequest|https?:\/\//, 'the card never reaches the network to decorate a message');
  assert.match(src, /l\.image\s*\?\s*html`<span class="link-card-image"><app-attachment/, 'the picture is our own stored attachment');
});
