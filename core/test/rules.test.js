import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderChats, chatTitle, chatPreview, initials, applyMessageToChats, sortChats, filterChats, groupSections, emptyFilters, manualOrder, moveChat, addGroup, renameGroup, moveGroup, placeChat, chatSearchText, matchesSearch, SORT_ORDERS, UNGROUPED } from '../app/rules/chats.js';
import { EMOJI, EMOJI_CATEGORIES, graphemes, countGraphemes, insertEmoji, deleteGrapheme, searchEmoji, emojiInCategory, frequentEmoji, isEmoji } from '../app/rules/emoji.js';
import { mergeMessages, groupMessages, deliveryLabel, applyReaction, summarizeReactions } from '../app/rules/messages.js';
import { formatListTime, formatSeparator, daysAgo } from '../app/rules/time.js';
import { connectionSentence } from '../app/rules/connection.js';
import { SETTINGS_SCHEMA, settingsFields, settingsGroups, settingValue, coerceSetting, mergeSettings } from '../app/rules/settings.js';
import { NOTICE_TYPES, NOTICE_UPDATE_STATES, SILENT_UPDATE_STATES, noticeEnabled, updateNotice, updateNoticeKey } from '../app/rules/notifications.js';
import { resolveScheme, themeVars, themeName, importTweakcn, cssVarName } from '../app/rules/theme.js';
import { mapChat, mapMessage, mapReaction, NO_CHAT_ID } from '../app/rules/engine-imsg.js';
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
  assert.equal(chatTitle(chats[1]), 'x@example.com and y@example.com');
  // A group nobody has named arrives with the chat identifier as its name, and read as a machine string in the list
  // instead of the people in it (issue #80). A named group keeps its name.
  assert.equal(chatTitle({ id: 'x', name: 'chat323392484988469066', isGroup: true, participants: ['Rafael Renhart', 'Evelyn Renhart', 'Kylie Brief'] }), 'Rafael Renhart, Evelyn Renhart and 1 other');
  assert.equal(chatTitle({ id: 'x', name: 'chat500000001', isGroup: true, participants: ['Avery Quinn', 'Reign'] }), 'Avery Quinn and Reign');
  assert.equal(chatTitle({ id: 'x', name: 'Weekend plans', isGroup: true, participants: ['Avery Quinn'] }), 'Weekend plans');
  assert.equal(chatTitle({ id: 'x', name: 'chat500000001', isGroup: true, participants: [] }), 'Group chat');
  assert.equal(chatTitle({ id: 'x', name: '', participants: [] }), 'Unknown');
  assert.equal(chatPreview({ lastMessage: { text: '', fromMe: true, attachments: 2 } }), 'You: 2 attachments');
  // iMessage writes U+FFFC where an inline object sits, meaning an emoji sent as an image. It has no glyph, so
  // printing it drew a box in the list (issue #80): the object reads as itself, and one with nothing readable left
  // is the attachment it actually is.
  assert.equal(chatPreview({ lastMessage: { text: '\uFFFCSent! ', fromMe: true, attachments: 1 } }), 'You: Sent!');
  assert.equal(chatPreview({ lastMessage: { text: '\uFFFC', fromMe: true, attachments: 1 } }), 'You: 1 attachment');
  assert.equal(mapMessage({ id: 1, chat_id: '9', guid: 'g1', text: '\uFFFCSent! ', is_from_me: true, created_at: '2026-01-01T00:00:00.000Z' }, { attachmentId: () => 'a' }).text, 'Sent! ');
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
  // A row that names no chat (issue 48) maps to the one value that means no chat, whatever form the engine gave it.
  for (const chat_id of [0, null, undefined]) assert.equal(mapMessage({ id: 10, chat_id, text: '', created_at: '2026-01-15T10:00:00Z' }, { attachmentId: () => 'x' }).chatId, NO_CHAT_ID);
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
  assert.match(css, /--color-bg: #faf9f7;/);
  assert.match(css, /prefers-color-scheme: dark/);
  assert.match(css, /--space-4: 16px;/);
  assert.match(css, /:root\[data-scheme="dark"\]/, 'an explicit dark skin wins over the system');
  assert.match(css, /:root:not\(\[data-scheme="light"\]\)/, 'an explicit light skin cancels the system dark block');
  assert.match(css, /--shadow-sm: 0 1px 2px/, 'elevation comes from the tokens');
});

test('a theme turns into custom properties for the scheme in force', () => {
  assert.equal(resolveScheme('dark', false), 'dark', 'an explicit choice wins over the system');
  assert.equal(resolveScheme('light', true), 'light');
  assert.equal(resolveScheme('system', true), 'dark', 'the system decides when the choice is system');
  assert.equal(resolveScheme(undefined, false), 'light');
  assert.equal(resolveScheme('future', true), 'dark', 'an unknown choice falls back to the system, not a refusal');
  assert.equal(cssVarName('color', 'bg'), '--color-bg');
  assert.equal(cssVarName('radius', 'md'), '--radius-md');
  const theme = { color: { light: { accent: '#111111' }, dark: { accent: '#eeeeee' } }, radius: { md: '9px' } };
  assert.deepEqual(themeVars(theme, 'light'), [['--radius-md', '9px'], ['--color-accent', '#111111']], 'the scheme picks its own colours');
  assert.deepEqual(themeVars(theme, 'dark'), [['--radius-md', '9px'], ['--color-accent', '#eeeeee']]);
  assert.deepEqual(themeVars(null, 'light'), [], 'no theme writes nothing, so tokens.css stands');
  assert.equal(themeName(theme), '');
  assert.equal(themeName({ name: 'elegant luxury' }), 'elegant luxury');
});

test('a tweakcn theme is imported, and every name it cannot carry is refused out loud', () => {
  const css = [
    ':root {',
    '  --background: oklch(1 0 0);',
    '  --foreground: oklch(0.145 0 0);',
    '  --primary: oklch(0.205 0 0);',
    '  --primary-foreground: oklch(0.985 0 0);',
    '  --accent: oklch(0.97 0 0);',
    '  --border: oklch(0.922 0 0);',
    '  --chart-1: oklch(0.646 0.222 41.116);',
    '  --radius: 0.625rem;',
    '  --font-sans: Geist, sans-serif;',
    '  --sidebar-background: oklch(0.985 0 0);',
    '}',
    '.dark {',
    '  --background: oklch(0.145 0 0);',
    '  --primary: oklch(0.922 0 0);',
    '  --primary-foreground: oklch(0.205 0 0);',
    '}',
  ].join('\n');
  const { theme, accepted, refused } = importTweakcn(css, { name: 'elegant luxury' });
  assert.equal(theme.name, 'elegant luxury');
  assert.equal(theme.source, 'tweakcn');
  assert.equal(theme.color.light.bg, 'oklch(1 0 0)');
  assert.equal(theme.color.light.accent, 'oklch(0.205 0 0)', 'primary is the accent');
  assert.equal(theme.color.light['bubble-me'], 'oklch(0.205 0 0)', 'a sent bubble follows the accent');
  assert.equal(theme.color.light.selection, 'oklch(0.97 0 0)', 'the tweakcn accent is the selection highlight');
  assert.equal(theme.color.dark.bg, 'oklch(0.145 0 0)', 'the .dark block fills dark');
  assert.equal(theme.radius.md, '0.625rem');
  assert.equal(theme.font.family, 'Geist, sans-serif');
  assert.ok(accepted.includes('primary'));
  assert.ok(refused.includes('chart-1'), 'a name with no token is refused');
  assert.ok(refused.includes('sidebar-background'));
  assert.ok(!accepted.includes('chart-1'));
  assert.deepEqual(importTweakcn('not a theme').refused, [], 'input with no tokens refuses nothing rather than throwing');
  assert.deepEqual(importTweakcn('not a theme').theme.color.light, {});
});

test('the settings page draws the schema and writes the value a control gives', () => {
  const fields = settingsFields();
  assert.deepEqual(fields.slice(0, 3).map((f) => f.key), ['appearance.skin', 'appearance.textSize', 'appearance.density']);
  assert.deepEqual(settingsGroups().flatMap((g) => g.fields.map((f) => f.key)), ['appearance.skin', 'appearance.textSize', 'appearance.density', 'notifications.newMessage', 'notifications.updateAvailable', 'notifications.updateReady', 'notifications.errors', 'updates.autoDownload'], 'every key the schema declares lands in one section, once, in the schema order');
  const groupIds = settingsGroups().map((g) => g.id);
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA.keys)) assert.ok(groupIds.includes(spec.group), key + ' names a declared group, so a typo cannot quietly move it');
  for (const g of settingsGroups()) assert.ok(g.fields.length > 0, g.id + ' has at least one setting');
  assert.deepEqual(settingsGroups().map((g) => g.id), ['appearance', 'notifications', 'updates'], 'the page draws one section per group');
  assert.deepEqual(settingsGroups()[1].fields.map((f) => f.key), ['notifications.newMessage', 'notifications.updateAvailable', 'notifications.updateReady', 'notifications.errors'], 'every notice type has its own row');
  assert.deepEqual(settingsGroups()[2].fields.map((f) => f.key), ['updates.autoDownload'], 'the updates section holds the download preference');
  assert.equal(settingValue(fields.find((f) => f.key === 'updates.autoDownload'), {}), false, 'automatic download is off until the server says otherwise');
  const skin = fields.find((f) => f.key === 'appearance.skin');
  const size = fields.find((f) => f.key === 'appearance.textSize');
  assert.deepEqual(skin.options, ['system', 'light', 'dark']);
  assert.equal(settingValue(skin, {}), 'system', 'an unset key draws the schema default');
  assert.equal(settingValue(skin, { 'appearance.skin': 'dark' }), 'dark', 'the server value wins');
  assert.equal(coerceSetting(size, '16'), 16, 'a number control sends a number, not a string');
  assert.equal(coerceSetting(skin, 'dark'), 'dark');
  assert.deepEqual(mergeSettings({ 'appearance.textSize': 18 }), { 'appearance.skin': 'system', 'appearance.textSize': 18, 'appearance.density': 'comfortable', 'notifications.newMessage': true, 'notifications.updateAvailable': true, 'notifications.updateReady': true, 'notifications.errors': true, 'updates.autoDownload': false });
});

test('every notice type has its own switch and a notice only fires when it is on', () => {
  const all = { 'notifications.newMessage': true, 'notifications.updateAvailable': true, 'notifications.updateReady': true, 'notifications.errors': true };
  for (const type of Object.keys(NOTICE_TYPES)) assert.equal(noticeEnabled({}, type), true, type + ' defaults on');
  assert.equal(noticeEnabled({ ...all, 'notifications.newMessage': false }, 'newMessage'), false, 'a type turned off produces no notice');
  assert.equal(noticeEnabled({ ...all, 'notifications.updateAvailable': false }, 'updateAvailable'), false);
  assert.equal(noticeEnabled({ ...all, 'notifications.newMessage': false }, 'updateReady'), true, 'one switch leaves the others alone');
  assert.equal(noticeEnabled(all, 'nope'), false, 'an unknown type raises nothing');
});

test('the bridge spec owns the update states, and every one is either a notice or called silent', () => {
  const spec = JSON.parse(readFileSync(new URL('../spec/host-bridge.json', import.meta.url), 'utf8'));
  const declared = spec.events['update.state'].states;
  assert.ok(declared.length > 0, 'the spec declares the states the shell may send');
  for (const state of declared) assert.ok(NOTICE_UPDATE_STATES.includes(state) || SILENT_UPDATE_STATES.includes(state), state + ' is declared in the spec, so the rules must name it');
  for (const state of [...NOTICE_UPDATE_STATES, ...SILENT_UPDATE_STATES]) assert.ok(declared.includes(state), state + ' is named by the rules, so the spec must declare it');
  for (const state of NOTICE_UPDATE_STATES) assert.ok(updateNotice(state), state + ' raises a notice');
  for (const state of SILENT_UPDATE_STATES) assert.equal(updateNotice(state), null, state + ' raises nothing on purpose');
});

test('an update state carries the notice it raises, and a state with none raises nothing', () => {
  assert.deepEqual(updateNotice('available', '1.2.3'), { type: 'updateAvailable', title: 'Update available', body: 'Version 1.2.3 is available to download.' });
  assert.equal(updateNotice('available', null).type, 'updateAvailable');
  assert.equal(updateNotice('ready', '1.2.3').type, 'updateReady');
  assert.equal(updateNotice('error').type, 'error');
  assert.equal(updateNotice('checking'), null);
});

test('one release is announced once, however many checks report it', () => {
  assert.equal(updateNoticeKey('available', '1.2.3'), updateNoticeKey('available', '1.2.3'), 'the start check and an interval check name the same notice');
  assert.notEqual(updateNoticeKey('available', '1.2.3'), updateNoticeKey('available', '1.2.4'), 'a newer release is a new notice');
  assert.notEqual(updateNoticeKey('available', '1.2.3'), updateNoticeKey('ready', '1.2.3'), 'ready is its own notice after available');
  assert.equal(updateNoticeKey('error', '1.2.3'), null, 'every failure is still said');
  for (const state of SILENT_UPDATE_STATES) assert.equal(updateNoticeKey(state, '1.2.3'), null, state + ' raises no notice to remember');
});

test('the list sorts by activity, unread, name and the manual order the server holds', () => {
  const chats = [
    { id: '1', name: 'Bea', lastMessageAt: '2026-01-03T00:00:00.000Z', unread: 0, isGroup: false },
    { id: '2', name: 'Al', lastMessageAt: '2026-01-01T00:00:00.000Z', unread: 3, isGroup: true },
    { id: '3', name: 'Cy', lastMessageAt: '2026-01-02T00:00:00.000Z', unread: 1, isGroup: false },
    { id: '4', name: 'Di', lastMessageAt: null, unread: 0, isGroup: false },
  ];
  assert.deepEqual(sortChats(chats, { sort: 'recent' }).map((c) => c.id), ['1', '3', '2', '4']);
  // Unread first, and the unread ones keep their own activity order rather than the order they arrived.
  assert.deepEqual(sortChats(chats, { sort: 'unread' }).map((c) => c.id), ['3', '2', '1', '4']);
  assert.deepEqual(sortChats(chats, { sort: 'name' }).map((c) => c.id), ['2', '1', '3', '4']);
  assert.deepEqual(sortChats(chats, { sort: 'manual', order: ['4', '2'] }).map((c) => c.id), ['4', '2', '1', '3']);
  assert.deepEqual(SORT_ORDERS, ['recent', 'unread', 'name', 'manual']);
});

test('filters compose, clear one at a time, and search names and last messages', () => {
  const chats = [
    { id: '1', name: 'Bea', isGroup: false, unread: 2, participants: ['bea@example.com'], lastMessageAt: '2026-01-03T00:00:00.000Z', lastMessage: { text: 'see you at the lake', fromMe: false, sentAt: '2026-01-03T00:00:00.000Z', attachments: 0 } },
    { id: '2', name: 'Weekend', isGroup: true, unread: 0, participants: ['a@example.com', 'b@example.com'], lastMessageAt: '2026-01-01T00:00:00.000Z', lastMessage: { text: 'plans', fromMe: true, sentAt: '2026-01-01T00:00:00.000Z', attachments: 0 } },
    { id: '3', name: '', isGroup: false, unread: 1, participants: ['+15555550142'], lastMessageAt: '2026-01-02T00:00:00.000Z', lastMessage: null },
  ];
  const placement = { '1': 'g1', '2': 'g1' };
  const by = (f) => filterChats(chats, { ...emptyFilters(), ...f }, { placement }).map((c) => c.id);
  assert.deepEqual(by({}), ['1', '2', '3']);
  assert.deepEqual(by({ unread: true }), ['1', '3'], 'only unread');
  assert.deepEqual(by({ group: 'g1' }), ['1', '2'], 'a named group');
  assert.deepEqual(by({ group: UNGROUPED }), ['3'], 'the chats in no group');
  assert.deepEqual(by({ kind: 'direct' }), ['1', '3']);
  assert.deepEqual(by({ kind: 'group' }), ['2']);
  assert.deepEqual(by({ text: 'lake' }), ['1'], 'searches the last message text');
  assert.deepEqual(by({ text: 'weekend' }), ['2'], 'searches the name');
  assert.deepEqual(by({ unread: true, kind: 'direct' }), ['1', '3'], 'two filters narrow together');
  assert.deepEqual(by({ unread: true, kind: 'group' }), [], 'a filter matching nothing returns nothing');
  assert.ok(chatSearchText(chats[0]).includes('lake'));
});

test('the search predicate reads the name, the participants and the last message', () => {
  const chat = { id: '1', name: 'Bea', isGroup: false, participants: ['bea@example.com'], lastMessage: { text: 'see you at the lake', fromMe: false, attachments: 0 } };
  assert.equal(matchesSearch(chat, ''), true, 'an empty query matches');
  assert.equal(matchesSearch(chat, '   '), true, 'a blank query matches');
  assert.equal(matchesSearch(chat, 'bea'), true, 'reads the name');
  assert.equal(matchesSearch(chat, 'example.com'), true, 'reads the participants');
  assert.equal(matchesSearch(chat, 'LAKE'), true, 'reads the last message, case-insensitively');
  assert.equal(matchesSearch(chat, ' lake '), true, 'trims the query');
  assert.equal(matchesSearch(chat, 'ocean'), false, 'a query that is nowhere does not match');
  assert.equal(matchesSearch({ id: '2', name: 'Al', participants: [] }, 'al'), true, 'reads a chat with no last message');
});

test('groups keep their own order, draw as sections, and never lose an ungrouped chat', () => {
  const groups = [{ id: 'g1', name: 'Family' }, { id: 'g2', name: 'Work' }];
  const chats = [
    { id: '1', name: 'A', lastMessageAt: '2026-01-03T00:00:00.000Z' },
    { id: '2', name: 'B', lastMessageAt: '2026-01-02T00:00:00.000Z' },
    { id: '3', name: 'C', lastMessageAt: '2026-01-01T00:00:00.000Z' },
  ];
  const sections = groupSections(chats, { groups, placement: { '2': 'g2', '3': 'gone' } });
  assert.deepEqual(sections.map((s) => s.id), ['g1', 'g2', UNGROUPED]);
  assert.deepEqual(sections.map((s) => s.chats.map((c) => c.id)), [[], ['2'], ['1', '3']], 'a chat whose group is gone is ungrouped, not lost');
  assert.equal(renameGroup(groups, 'g1', 'Close family')[0].name, 'Close family');
  assert.deepEqual(moveGroup(groups, 'g1', 1).map((g) => g.id), ['g2', 'g1']);
  assert.deepEqual(moveGroup(groups, 'g2', 1).map((g) => g.id), ['g1', 'g2'], 'a move past the end is a no-op');
  assert.deepEqual(addGroup([], { id: 'g9', name: '  New  ' }), [{ id: 'g9', name: 'New' }]);
  assert.deepEqual(placeChat({ '1': 'g1' }, '1', UNGROUPED), {}, 'moving a chat out drops its placement');
  assert.deepEqual(placeChat({}, '1', 'g2'), { '1': 'g2' });
});

test('the manual order covers every chat and a move swaps one step', () => {
  const chats = [
    { id: 'a', lastMessageAt: '2026-01-03T00:00:00.000Z' },
    { id: 'b', lastMessageAt: '2026-01-02T00:00:00.000Z' },
    { id: 'c', lastMessageAt: '2026-01-01T00:00:00.000Z' },
  ];
  assert.deepEqual(manualOrder(chats, ['c']), ['c', 'a', 'b'], 'a stored head keeps its place and the rest follow activity');
  assert.deepEqual(moveChat(['a', 'b', 'c'], 'b', -1), ['b', 'a', 'c']);
  assert.deepEqual(moveChat(['a', 'b', 'c'], 'a', -1), ['a', 'b', 'c'], 'the first chat cannot move up');
  assert.deepEqual(moveChat(['a', 'b', 'c'], 'c', 1), ['a', 'b', 'c']);
  assert.deepEqual(moveChat(['a', 'b', 'c'], 'z', 1), ['a', 'b', 'c']);
});

test('the emoji picker searches by name, keeps categories, and inserts whole characters', () => {
  assert.ok(EMOJI.length > 0);
  assert.ok(EMOJI.every((e) => typeof e.char === 'string' && e.char && typeof e.name === 'string' && EMOJI_CATEGORIES.some((c) => c.id === e.category)));
  assert.ok(searchEmoji('heart').length > 0 && searchEmoji('heart').every((e) => (e.name + ' ' + (e.keywords || '')).toLowerCase().includes('heart')));
  assert.ok(searchEmoji('heart').some((e) => e.char === '\u2764\uFE0F'));
  assert.equal(searchEmoji('').length, EMOJI.length);
  assert.equal(searchEmoji('', { limit: 5 }).length, 5);
  assert.ok(searchEmoji('zzzz').length === 0);
  assert.ok(emojiInCategory('flags').length > 0 && emojiInCategory('flags').every((e) => e.category === 'flags'));

  // A flag and a skin toned hand are each one character, however many code points they are.
  assert.equal(countGraphemes('\u{1F1FA}\u{1F1F8}'), 1);
  assert.equal(countGraphemes('\u{1F44B}\u{1F3FB}'), 1);
  assert.deepEqual(graphemes('a\u{1F1FA}\u{1F1F8}'), ['a', '\u{1F1FA}\u{1F1F8}']);

  // Insert at the caret, over a selection, and several in a row.
  assert.deepEqual(insertEmoji('hi', 2, 2, '\u{1F44B}'), { text: 'hi\u{1F44B}', caret: 4 });
  assert.deepEqual(insertEmoji('abcd', 1, 3, '\u2728'), { text: 'a\u2728d', caret: 2 });
  const first = insertEmoji('x', 1, 1, '\u2728');
  const twice = insertEmoji(first.text, first.caret, first.caret, '\u{1F525}');
  assert.equal(twice.text, 'x\u2728\u{1F525}');

  // Backspace removes the whole flag or hand; delete removes the one after the caret.
  assert.deepEqual(deleteGrapheme('a\u{1F1FA}\u{1F1F8}', 5, 5, -1), { text: 'a', caret: 1 });
  assert.equal(deleteGrapheme('\u{1F44B}\u{1F3FB}b', 0, 0, 1).text, 'b');
  assert.deepEqual(deleteGrapheme('abc', 2, 2, -1), { text: 'ac', caret: 1 });
  assert.deepEqual(deleteGrapheme('abc', 0, 3, -1), { text: '', caret: 0 });

  // The frequent row counts first, recency breaks a tie, and only known characters are offered.
  assert.deepEqual(frequentEmoji(['\u2764\uFE0F', '\u2728', '\u2764\uFE0F', 'nope']), ['\u2764\uFE0F', '\u2728']);
  assert.deepEqual(frequentEmoji([]), []);
  assert.equal(isEmoji('\u2728'), true);
  assert.equal(isEmoji('x'), false);
});
