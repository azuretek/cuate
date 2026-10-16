// The desktop smoke's update-notice handling (issue 404): a notice that does not appear in time is a failed
// check with the value it read, never a crash. The renderer expressions are run here against a small stand-in
// document, so the same strings the smoke sends are what is tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { awaitNotice, dismissNotice } from '../src/smoke-notice.js';

const MAIN = fileURLToPath(new URL('../src/main.js', import.meta.url));

// A stand-in for the page: either no notice, or one notice with a close button that removes it.
function page(notice) {
  const doc = {
    notice,
    querySelector(sel) {
      if (sel === '.app-notice') return doc.notice;
      if (sel === '.app-notice .close-button') return doc.notice && doc.notice.close;
      return null;
    },
  };
  const js = async (code) => Function('document', 'return (' + code + ');')(doc);
  const waitFor = async (expr, ms = 0) => {
    if (await js(expr)) return;
    throw new Error('timed out after ' + ms + 'ms waiting for ' + expr);
  };
  return { doc, js, waitFor };
}

function notice(text) {
  const n = { textContent: text, close: null };
  return n;
}

test('a notice that never appears is a false check with what was measured, not a crash (issue 404)', async () => {
  const p = page(null);
  const read = await awaitNotice(p, "(document.querySelector('.app-notice')?.textContent || '').includes('does not update itself')", 10000);
  assert.equal(read.seen, false);
  assert.deepEqual(read.notice, { present: false, text: null, closable: false });
  assert.equal(typeof read.waitedMs, 'number');
  assert.match(read.error, /timed out/);
});

test('a notice that appears is a true check, and its text and close control are read (issue 404)', async () => {
  const p = page(notice('This build does not update itself'));
  p.doc.notice.close = { click() { p.doc.notice = null; } };
  const read = await awaitNotice(p, "(document.querySelector('.app-notice')?.textContent || '').includes('does not update itself')", 10000);
  assert.equal(read.seen, true);
  assert.deepEqual(read.notice, { present: true, text: 'This build does not update itself', closable: true });
  assert.equal(read.error, null);
});

test('dismissing with no notice on the page answers false and never throws (issue 404)', async () => {
  const p = page(null);
  // The press the smoke used to send: with no notice it throws, which ended the whole run.
  await assert.rejects(p.js("document.querySelector('.app-notice .close-button').click()"), TypeError);
  assert.equal(await dismissNotice(p), false);
});

test('dismissing a shown notice presses its close control (issue 404)', async () => {
  const p = page(notice('This build does not update itself'));
  let pressed = 0;
  p.doc.notice.close = { click() { pressed++; p.doc.notice = null; } };
  assert.equal(await dismissNotice(p), true);
  assert.equal(pressed, 1);
  assert.equal(p.doc.notice, null);
});

test('the smoke never presses a notice close button directly, and reads every About notice through awaitNotice (issue 404)', () => {
  const src = readFileSync(MAIN, 'utf8');
  const raw = src.split('\n').map((line, i) => [i + 1, line]).filter(([, line]) => line.includes(".app-notice .close-button').click()"));
  assert.deepEqual(raw.map(([n]) => n), [], 'press a notice close button through dismissNotice, which answers false when there is none');
  for (const key of ['aboutPhoneNotice', 'aboutCheckNotice', 'aboutCheckAgain']) {
    const line = src.split('\n').find((l) => l.includes('report.' + key + ' ='));
    assert.ok(line, key + ' is still recorded');
    assert.match(line, /\.seen\b/, key + ' is read from awaitNotice, so a missing notice is a measured false: ' + line.trim());
  }
});
