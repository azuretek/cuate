// The privacy guard, and the point of the logging standard: it fails the build when a message body, a phone number,
// a handle, a contact name or an attachment path can reach a log record. The record's fields are declared in
// core/spec/log-events.json and free text is scrubbed (core/kit/rules/scrub.js), so this holds both halves: no
// declared field may carry what a person typed or who they are, every string field is either scrubbed free text or a
// code-controlled identifier listed here with its reason, and a chat id is scrubbed because the engine's GUID embeds
// the handle it belongs to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scrub } from '../kit/rules/scrub.js';
import { createLogger } from '../kit/log.js';

const spec = JSON.parse(readFileSync(new URL('../spec/log-events.json', import.meta.url), 'utf8'));

// Synthetic markers only. Never a real body, number, handle or path.
const BODY = 'Synthetic body: meet me at the usual place at seven';
const NUMBER = '+15555550123';
const DIGITS = '5555550123';
const HANDLE = 'synthetic.handle@example.invalid';
const HOME = ['', 'Users', 'synthetic'].join('/');

// A field name that names what a person typed, or who they are, may never be declared: a body must have nowhere to
// go, rather than being scrubbed after it arrives. The free-text sinks (error, line, problem, chat) are the exception
// and are scrubbed by the logger, which is why their names are not here.
const CONTENT_FIELD = /^(?:text|body|message|content|caption|snippet|subject|preview|phone|number|handle|address|email|contact|sender|recipient|filename|path)$/;

// A string field the logger does NOT scrub must be a code-controlled identifier, listed here with why. An unlisted
// one fails this test, so a new string field has to be classified (scrubbed free text, or a safe identifier) on the
// way in rather than by remembering.
const SAFE_STRINGS = new Map([
  ['engine', 'the engine kind, from the build spec'],
  ['host', 'the bind host the launcher set'],
  ['reason', 'a fixed code the server chose'],
  ['record', 'the file name of a crash record'],
  ['kind', 'a fixed engine kind'],
  ['version', 'a release version'],
  ['signal', 'a POSIX signal name'],
  ['method', 'an engine request method name'],
  ['route', 'a route id from core/spec/api.json'],
  ['code', 'an error code the server chose'],
  ['endpoint', 'a webhook endpoint id, never its url'],
  ['trigger', 'an event name from core/spec/log-events.json'],
  ['mode', 'a fixed export mode'],
  ['current', 'a release version the running server reports'],
  ['latest', 'a release version the feed names'],
  ['commit', 'a git commit sha'],
  ['from', 'a release version'],
  ['to', 'a release version'],
  ['backup', 'the directory a version switch kept'],
  ['state', 'a connection state the client chose'],
  ['where', 'a code location'],
  ['what', 'a fixed Mac-care action name'],
  ['name', 'the name of an event that was not declared'],
]);

const withFields = (event, fields) => {
  const lines = [];
  const log = createLogger({ spec, app: 'test', run: 'privacy', sink: (l) => lines.push(l), now: () => 0, level: 'debug' });
  log.emit(event, fields);
  return lines[0];
};

test('scrub removes a number, a handle and a home path wherever they sit', () => {
  const s = scrub('chat iMessage;-;' + NUMBER + ' from ' + HANDLE + ' at ' + HOME + '/Attachments/IMG_0001.heic');
  for (const bad of [NUMBER, DIGITS, HANDLE, HOME]) assert.ok(!s.includes(bad), bad + ' survived: ' + s);
});

test('a chat id is logged with the number inside it masked', () => {
  const rec = withFields('send.refused', { reason: 'sending_off', chat: 'iMessage;-;' + NUMBER });
  assert.equal(rec.chat, 'iMessage;-;[number]');
  assert.ok(!JSON.stringify(rec).includes(DIGITS), JSON.stringify(rec));
});

test('no log event declares a field that could carry a body or a contact', () => {
  for (const [name, def] of Object.entries(spec.events)) {
    for (const field of Object.keys(def.fields || {})) {
      assert.ok(!CONTENT_FIELD.test(field), name + ' declares a private field: ' + field);
    }
  }
});

test('every string field is either scrubbed free text or a classified identifier', () => {
  for (const [name, def] of Object.entries(spec.events)) {
    for (const [field, type] of Object.entries(def.fields || {})) {
      if (type.replace(/\?$/, '') !== 'string') continue;
      const rec = withFields(name, { [field]: 'x ' + NUMBER + ' ' + HANDLE + ' ' + HOME });
      const leaked = [DIGITS, HANDLE, HOME].some((bad) => JSON.stringify(rec).includes(bad));
      if (leaked) {
        assert.ok(SAFE_STRINGS.has(field), name + '.' + field + ' lets a number, a handle or a path into a record: declare it free text (scrubbed) or list it in SAFE_STRINGS with its reason');
      }
    }
  }
});

test('no declared event, given hostile values, carries a number, a handle or a path into a record', () => {
  for (const [name, def] of Object.entries(spec.events)) {
    const fields = {};
    for (const [field, type] of Object.entries(def.fields || {})) {
      if (SAFE_STRINGS.has(field)) continue; // a code-controlled identifier, not free text
      const base = type.replace(/\?$/, '');
      fields[field] = base === 'number' ? 1 : base === 'boolean' ? true : ('x ' + BODY + ' ' + NUMBER + ' ' + HANDLE + ' ' + HOME);
    }
    const text = JSON.stringify(withFields(name, fields));
    for (const bad of [DIGITS, HANDLE, HOME]) {
      assert.ok(!text.includes(bad), name + ' carried ' + bad + ' into a record: ' + text);
    }
  }
});
