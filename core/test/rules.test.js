import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderChats, chatTitle, chatPreview, initials, applyMessageToChats } from '../app/rules/chats.js';
import { mergeMessages, groupMessages, deliveryLabel, applyReaction, summarizeReactions } from '../app/rules/messages.js';
import { formatListTime, formatSeparator, daysAgo } from '../app/rules/time.js';
import { connectionSentence } from '../app/rules/connection.js';
import { settingsFields, settingsGroups, settingValue, coerceSetting, mergeSettings } from '../app/rules/settings.js';
import { NOTICE_TYPES, noticeEnabled, updateNotice } from '../app/rules/notifications.js';
import { mapChat, mapMessage, mapReaction } from '../app/rules/engine-imsg.js';
import { validate } from '../kit/rules/schema.js';
import { scrub } from '../kit/rules/scrub.js';
import { formatTraceparent, parseTraceparent, newTraceparent } from '../kit/rules/trace.js';
import { tokensCss } from '../kit/rules/tokens.js';
import { createLogger } from '../kit/log.js';

const spec = (p) => JSON.parse(readFileSync(new URL('../spec/' + p, import.meta.url), 'utf8'));
let n = 0;
const msg = (o) => ({ id: 'm' + n++, chatId: '1', fromMe: false, sender: '+15555550100', senderName: null, text: 'hi', sentAt: '2026-01-15T10:00:00.000Z', replyTo: null, read: null, attachments: [], reactions: [], ...o });

test('chats order newest first and read well', () => {
  const chats = [
    { id: '1', name: 'A', participants: [], lastMessageAt: '2026-01-01T00:00:00.000Z' },
    { id: '2', name: '', participants: ['x@example.com', 'y@example.com'], lastMessageAt: '2026-01-03T00:00:00.000Z' },
    { id: '3', name: 'C', participants: [], lastMessageAt: null },
  ];
  assert.deepEqual(orderChats(chats).map((c) => c.id), ['2', '1', '3']);
  assert.equal(chatTitle(chats[1]), 'x@example.com, y@example.com');
  assert.equal(chatPreview({ lastMessage: { text: '', fromMe: true, attachments: 2 } }), 'You: 2 attachments');
  assert.equal(chatPreview({ lastMessage: null }), '');
  assert.equal(initials('Avery Quinn'), 'AQ');
  assert.equal(initials('+15555550142'), '#');
  assert.equal(initials(''), '?');
});

test('a live message moves its chat up and counts unread only where it is not open', () => {
  const chats = [
    { id: '1', lastMessageAt: '2026-01-02T00:00:00.000Z', unread: 0, participants: [] },
    { id: '2', lastMessageAt: '2026-01-03T00:00:00.000Z', unread: 0, participants: [] },
  ];
  const r = applyMessageToChats(chats, msg({ chatId: '1', sentAt: '2026-01-04T00:00:00.000Z', text: 'new' }), { openChatId: '2' });
  assert.equal(r.known, true);
  assert.equal(r.chats[0].id, '1');
  assert.equal(r.chats[0].unread, 1);
  assert.equal(r.chats[0].lastMessage.text, 'new');
  assert.equal(applyMessageToChats(chats, msg({ chatId: '1', sentAt: '2026-01-04T00:00:00.000Z' }), { openChatId: '1' }).chats[0].unread, 0);
  assert.equal(applyMessageToChats(chats, msg({ chatId: '9' })).known, false);
  assert.equal(applyMessageToChats(chats, msg({ chatId: '2', sentAt: '2026-01-01T00:00:00.000Z' })).chats, chats);
});

test('messages merge by id in time order', () => {
  const a = msg({ id: 'a', sentAt: '2026-01-01T00:00:02.000Z' });
  const b = msg({ id: 'b', sentAt: '2026-01-01T00:00:01.000Z' });
  const merged = mergeMessages([a], [b, { ...a, text: 'edited' }]);
  assert.deepEqual(merged.map((m) => m.id), ['b', 'a']);
  assert.equal(merged[1].text, 'edited');
});

test('a conversation groups into sender runs, with separators after a gap', () => {
  const t = (min) => new Date(Date.parse('2026-01-15T10:00:00.000Z') + min * 60000).toISOString();
  const items = groupMessages([msg({ id: '1', sentAt: t(0) }), msg({ id: '2', sentAt: t(1) }), msg({ id: '3', sentAt: t(2), fromMe: true, sender: null }), msg({ id: '4', sentAt: t(200) })]);
  const shape = items.map((i) => (i.kind === 'separator' ? 'sep' : i.message.id + (i.first ? 'F' : '') + (i.last ? 'L' : '')));
  assert.deepEqual(shape, ['sep', '1F', '2L', '3FL', 'sep', '4FL']);
});

test('delivery labels, and one tapback per person', () => {
  assert.equal(deliveryLabel(msg({ fromMe: false })), '');
  assert.equal(deliveryLabel(msg({ fromMe: true })), 'Sent');
  assert.equal(deliveryLabel(msg({ fromMe: true, state: 'uncertain' })), 'May not have sent');
  assert.equal(deliveryLabel(msg({ fromMe: true, state: 'failed' })), 'Not sent');
  let ms = [msg({ id: 't' })];
  ms = applyReaction(ms, { targetId: 't', type: 'like', add: true, fromMe: false, sender: 'a@example.com' });
  ms = applyReaction(ms, { targetId: 't', type: 'love', add: true, fromMe: false, sender: 'a@example.com' });
  ms = applyReaction(ms, { targetId: 't', type: 'laugh', add: true, fromMe: true, sender: null });
  assert.deepEqual(ms[0].reactions.map((r) => r.type).sort(), ['laugh', 'love']);
  ms = applyReaction(ms, { targetId: 't', type: 'laugh', add: false, fromMe: true, sender: null });
  assert.deepEqual(ms[0].reactions.map((r) => r.type), ['love']);
  assert.deepEqual(summarizeReactions([{ type: 'love' }, { type: 'love' }, { type: 'emoji', emoji: '\u2728' }]).map((r) => r.count), [2, 1]);
});

test('times read the way Messages writes them', () => {
  const o = { now: Date.parse('2026-01-15T18:00:00.000Z'), locale: 'en-US', timeZone: 'UTC' };
  assert.match(formatListTime('2026-01-15T09:05:00.000Z', o), /9:05/);
  assert.equal(formatListTime('2026-01-14T09:05:00.000Z', o), 'Yesterday');
  assert.equal(formatListTime('2026-01-12T09:05:00.000Z', o), 'Monday');
  assert.match(formatListTime('2025-12-01T09:05:00.000Z', o), /12\/1\/2025/);
  assert.match(formatSeparator('2026-01-15T09:05:00.000Z', o), /^Today 9:05/);
  assert.match(formatSeparator('2026-01-14T09:05:00.000Z', o), /^Yesterday /);
  assert.equal(formatListTime(null, o), '');
  assert.equal(daysAgo('2026-01-15T00:00:01.000Z', o), 0);
});

test('connection sentences', () => {
  assert.equal(connectionSentence('open'), '');
  assert.match(connectionSentence('reconnecting'), /Reconnecting/);
  assert.equal(connectionSentence('no such state'), '');
});

test('the imsg mapping produces exactly the declared model', () => {
  const models = spec('api.json').models;
  const chat = mapChat({ id: 42, name: '+15555550100', display_name: '', contact_name: 'Avery Quinn', identifier: '+15555550100', guid: 'iMessage;-;+15555550100', service: 'iMessage', last_message_at: '2026-01-15T10:00:00Z', is_group: false, participants: ['+15555550100'], unread_count: 2 });
  assert.deepEqual(validate(chat, 'Chat', models), []);
  assert.equal(chat.id, '42');
  assert.equal(chat.name, 'Avery Quinn');
  assert.equal(chat.lastMessageAt, '2026-01-15T10:00:00.000Z');
  const seen = [];
  const m = mapMessage({ id: 7, chat_id: 42, guid: 'G-7', sender: '+15555550100', sender_name: 'Avery Quinn', is_from_me: false, text: 'hi', created_at: '2026-01-15T10:00:00Z', is_read: true, attachments: [{ filename: 'a.heic', transfer_name: 'IMG_1.HEIC', mime_type: 'image/heic', total_bytes: 10, is_sticker: false, missing: false, original_path: '/x/a.heic' }], reactions: [{ reaction_type: 'love', sender: '+15555550100', is_from_me: false }] }, { attachmentId: (a) => { seen.push(a.original_path); return 'att00000000001'; } });
  assert.deepEqual(validate(m, 'Message', models), []);
  assert.equal(m.id, 'G-7');
  assert.equal(m.attachments[0].name, 'IMG_1.HEIC');
  assert.deepEqual(seen, ['/x/a.heic']);
  assert.equal(m.reactions[0].type, 'love');
  const mine = mapMessage({ id: 8, chat_id: 42, is_from_me: true, sender: '', text: '', created_at: 'not a time', attachments: [] }, { attachmentId: () => 'x' });
  assert.equal(mine.sender, null);
  assert.equal(mine.id, 'row:8');
  assert.equal(mine.read, null);
  assert.deepEqual(validate(mine, 'Message', models), []);
  const r = mapReaction({ id: 9, chat_id: 42, is_reaction: true, reaction_type: 'like', is_reaction_add: false, reacted_to_guid: 'p:0/G-7', is_from_me: true });
  assert.deepEqual(validate(r, 'ReactionEvent', models), []);
  assert.equal(r.targetId, 'G-7');
  assert.equal(r.add, false);
  assert.equal(mapReaction({ id: 1, chat_id: 1 }), null);
});

test('the schema validator is strict', () => {
  const models = { A: { x: 'string', y: 'number?', z: 'B[]' }, B: { ok: 'boolean' } };
  assert.deepEqual(validate({ x: 'a', z: [{ ok: true }] }, 'A', models), []);
  assert.equal(validate({ x: 1, z: [] }, 'A', models).length, 1);
  assert.equal(validate({ x: 'a', z: [{ ok: true, extra: 1 }] }, 'A', models).length, 1);
  assert.equal(validate({ z: [] }, 'A', models).length, 1);
});

test('scrub removes tokens, contact details, home paths and secrets', () => {
  // Home paths are built from parts: the publish scan looks for real ones, and these are synthetic.
  const home = ['', 'Users', 'someone'].join('/');
  const winHome = ['C:', 'Users', 'someone'].join('\\');
  const s = scrub('Bearer abc.def tok_abcdefghijklmnop user@example.com +1 (555) 555-0100 ' + home + '/Library/x ' + winHome + '\\y https://h/p?token=zzz ' + 'A'.repeat(40));
  for (const bad of ['abc.def', 'tok_abcdefghijklmnop', 'user@example.com', '555-0100', home, 'someone\\y', 'zzz', 'A'.repeat(40)]) assert.ok(!s.includes(bad), bad + ' survived: ' + s);
  assert.equal(scrub('word '.repeat(100)).length, 301);
});

test('trace context round-trips and rejects bad headers', () => {
  const tp = formatTraceparent({ traceId: 'a'.repeat(32), spanId: 'b'.repeat(16) });
  assert.deepEqual(parseTraceparent(tp), { traceId: 'a'.repeat(32), spanId: 'b'.repeat(16), sampled: true });
  assert.equal(parseTraceparent('00-' + '0'.repeat(32) + '-' + 'b'.repeat(16) + '-01'), null);
  assert.equal(parseTraceparent('garbage'), null);
  assert.ok(parseTraceparent(newTraceparent((bytes) => 'c'.repeat(bytes * 2))));
});

test('the logger emits declared events only, scrubbed, and keeps a flight recorder', () => {
  const lines = [];
  const logSpec = spec('log-events.json');
  const log = createLogger({ spec: logSpec, app: 'test', run: 'r1', sink: (l) => lines.push(l), now: () => 0, level: 'notice' });
  log.emit('server.ready', { port: 1, host: '127.0.0.1' });
  log.emit('http.request', { route: 'chats', status: 200, ms: 3 });
  log.emit('engine.error', { method: 'status', error: 'failed for user@example.com with tok_abcdefghijklmnopqrstu', secret: 'nope' });
  log.emit('made.up', { x: 1 });
  assert.deepEqual(lines.map((l) => l.event), ['server.ready', 'engine.error', 'log.undeclared']);
  assert.equal(lines[0].ts, '1970-01-01T00:00:00.000Z');
  assert.equal(lines[0].msg, 'server ready');
  assert.ok(!JSON.stringify(lines).includes('user@example.com'));
  assert.ok(!('secret' in lines[1]));
  assert.equal(log.recorder().length, 4);
  assert.equal(log.recorder()[1].event, 'http.request');
  const strict = createLogger({ spec: logSpec, app: 'test', run: 'r2', sink: () => {}, now: () => 0, strict: true });
  assert.throws(() => strict.emit('made.up', {}));
  assert.throws(() => strict.emit('server.ready', { port: 'x', host: 'h' }));
});

test('the token stylesheet comes from the token spec', () => {
  const css = tokensCss(spec('tokens.json'));
  assert.match(css, /--color-bg: #ffffff;/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--space-4: 16px;/);
});

test('the settings page draws the schema and writes the value a control gives', () => {
  const fields = settingsFields();
  assert.deepEqual(fields.slice(0, 3).map((f) => f.key), ['appearance.skin', 'appearance.textSize', 'appearance.density']);
  assert.deepEqual(settingsGroups().map((g) => g.id), ['appearance', 'notifications'], 'the page draws one section per group');
  assert.deepEqual(settingsGroups()[1].fields.map((f) => f.key), ['notifications.newMessage', 'notifications.updateAvailable', 'notifications.updateReady', 'notifications.errors'], 'every notice type has its own row');
  const skin = fields.find((f) => f.key === 'appearance.skin');
  const size = fields.find((f) => f.key === 'appearance.textSize');
  assert.deepEqual(skin.options, ['system', 'light', 'dark']);
  assert.equal(settingValue(skin, {}), 'system', 'an unset key draws the schema default');
  assert.equal(settingValue(skin, { 'appearance.skin': 'dark' }), 'dark', 'the server value wins');
  assert.equal(coerceSetting(size, '16'), 16, 'a number control sends a number, not a string');
  assert.equal(coerceSetting(skin, 'dark'), 'dark');
  assert.deepEqual(mergeSettings({ 'appearance.textSize': 18 }), { 'appearance.skin': 'system', 'appearance.textSize': 18, 'appearance.density': 'comfortable', 'notifications.newMessage': true, 'notifications.updateAvailable': true, 'notifications.updateReady': true, 'notifications.errors': true });
});

test('every notice type has its own switch and a notice only fires when it is on', () => {
  const all = { 'notifications.newMessage': true, 'notifications.updateAvailable': true, 'notifications.updateReady': true, 'notifications.errors': true };
  for (const type of Object.keys(NOTICE_TYPES)) assert.equal(noticeEnabled({}, type), true, type + ' defaults on');
  assert.equal(noticeEnabled({ ...all, 'notifications.newMessage': false }, 'newMessage'), false, 'a type turned off produces no notice');
  assert.equal(noticeEnabled({ ...all, 'notifications.updateAvailable': false }, 'updateAvailable'), false);
  assert.equal(noticeEnabled({ ...all, 'notifications.newMessage': false }, 'updateReady'), true, 'one switch leaves the others alone');
  assert.equal(noticeEnabled(all, 'nope'), false, 'an unknown type raises nothing');
});

test('an update state carries the notice it raises, and a state with none raises nothing', () => {
  assert.deepEqual(updateNotice('available', '1.2.3'), { type: 'updateAvailable', title: 'Update available', body: 'Version 1.2.3 is available to download.' });
  assert.equal(updateNotice('available', null).type, 'updateAvailable');
  assert.equal(updateNotice('ready', '1.2.3').type, 'updateReady');
  assert.equal(updateNotice('error').type, 'error');
  assert.equal(updateNotice('checking'), null);
});
