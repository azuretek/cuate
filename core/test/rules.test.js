import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { orderChats, chatTitle, chatPreview, initials, applyMessageToChats, sortChats, filterChats, groupSections, emptyFilters, addGroup, renameGroup, moveGroup, placeChat, contactSearchText, messageSearchText, matchesTerm, addTerm, removeTerm, setTermMode, termsSentence, emptyListText, SEARCH_MODES, SEARCH_MODE_LABELS, SORT_ORDERS, SORT_LABELS, normalizeSort, defaultGroupName, UNGROUPED, toggleChecked, setAllChecked, allChecked, checkedCount, addChatsToGroup, groupFromSelection, removeGroup, clearGroupPlacement, hideChats, forgetChats, requestDelete, requestDeleteGroup, resolveDelete, DELETE_STEPS } from '../app/rules/chats.js';
import { EMOJI, EMOJI_CATEGORIES, graphemes, countGraphemes, insertEmoji, deleteGrapheme, searchEmoji, emojiInCategory, frequentEmoji, isEmoji, emojiPickerSections, pickerSide } from '../app/rules/emoji.js';
import { ATTACH_ACTIONS, sizeLabel, stageCheck, toBase64, localAttachment } from '../app/rules/attach.js';
import { mergeMessages, groupMessages, deliveryLabel, applyReaction, summarizeReactions, TAPBACKS, tapbackType, myReaction, replyQuote, canTarget } from '../app/rules/messages.js';
import { formatListTime, formatSeparator, daysAgo } from '../app/rules/time.js';
import { connectionSentence } from '../app/rules/connection.js';
import { SETTINGS_SCHEMA, settingsFields, settingsGroups, settingValue, coerceSetting, mergeSettings, settingsAfterWrite, settingsAfterRefusal, optionLabel, ABOUT_ORDER, aboutRows, aboutLinks } from '../app/rules/settings.js';
import { BUILD_SPEC as ABOUT_SPEC } from '../app/rules/build-spec.js';
import { pressOutside } from '../kit/rules/dismiss.js';
import { slideProgress, slideConfirms, slideRelease, slideKey, SLIDE_CONFIRM_AT } from '../app/rules/slide.js';
import { NOTICE_TYPES, NOTICE_UPDATE_STATES, SILENT_UPDATE_STATES, noticeEnabled, updateNotice, updateNoticeKey, messageNotice } from '../app/rules/notifications.js';
import { resolveScheme, themeVars, themeName, importTweakcn, importSummary, cssVarName, importTheme, safeValue, themeId, addTheme, removeTheme, themeChoices, swatchVars, MAX_THEMES, TEXT_SCALES, TYPE_SIZE_VARS, textScale, textScaleVars, themeFonts, contrastRatio } from '../app/rules/theme.js';
import { mapChat, mapMessage, mapReaction, NO_CHAT_ID } from '../app/rules/engine-imsg.js';
import { validate } from '../kit/rules/schema.js';
import { scrub } from '../kit/rules/scrub.js';
import { formatTraceparent, parseTraceparent, newTraceparent } from '../kit/rules/trace.js';
import { tokensCss, iconSvg } from '../kit/rules/tokens.js';
import { springCurve } from '../kit/rules/motion.js';
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

test('an import says what it carried and names each refused value once, and an empty one is not stored', () => {
  const css = ':root { --primary: #8a3b12; --chart-1: #000000; --radius: 0.5rem; }\n.dark { --primary: #e0a070; --chart-1: #ffffff; }';
  const result = importTweakcn(css, { name: 'smoke' });
  const summary = importSummary(result);
  assert.equal(summary.ok, true);
  assert.equal(summary.text, 'Imported 2 values. Refused: chart-1.', 'a name accepted in both blocks counts once, a refused one is named once, and a derived pair is not a value of its own');
  assert.deepEqual(importSummary(importTweakcn(':root { --primary: #8a3b12; }')), { ok: true, text: 'Imported 1 value. Nothing refused.' });
  assert.equal(importSummary(importTweakcn('not a theme')).ok, false, 'text with nothing to carry is not a theme');
  assert.equal(importSummary(importTweakcn(':root { --chart-1: #000000; }')).ok, false, 'a theme of refused names only is not stored');
  assert.equal(importSummary().ok, false);
});

test('the settings page draws the schema and writes the value a control gives', () => {
  const fields = settingsFields();
  assert.deepEqual(fields.slice(0, 2).map((f) => f.key), ['appearance.skin', 'appearance.textScale']);
  assert.deepEqual(settingsGroups().flatMap((g) => g.fields.map((f) => f.key)), ['appearance.skin', 'appearance.textScale', 'notifications.newMessage', 'notifications.updateAvailable', 'notifications.updateReady', 'notifications.errors', 'updates.autoDownload', 'updates.serverAuto'], 'every key the schema declares lands in one section, once, in the schema order');
  const groupIds = settingsGroups().map((g) => g.id);
  for (const [key, spec] of Object.entries(SETTINGS_SCHEMA.keys)) assert.ok(groupIds.includes(spec.group), key + ' names a declared group, so a typo cannot quietly move it');
  for (const g of settingsGroups().filter((g) => g.kind === 'settings')) assert.ok(g.fields.length > 0, g.id + ' has at least one setting');
  for (const g of settingsGroups().filter((g) => g.kind !== 'settings')) assert.deepEqual(g.fields, [], g.id + ' draws its own rows, and no setting lands in it');
  for (const g of settingsGroups()) assert.ok(typeof g.description === 'string' && g.description.length > 0, g.id + ' carries a one-line description for its section');
  assert.deepEqual(settingsGroups().map((g) => g.id), ['appearance', 'notifications', 'updates', 'device', 'about'], 'the page draws one section per group');
  assert.deepEqual(settingsGroups()[1].fields.map((f) => f.key), ['notifications.newMessage', 'notifications.updateAvailable', 'notifications.updateReady', 'notifications.errors'], 'every notice type has its own row');
  assert.deepEqual(settingsGroups()[2].fields.map((f) => f.key), ['updates.autoDownload', 'updates.serverAuto'], 'the updates section holds the client and server preferences');
  assert.equal(settingValue(fields.find((f) => f.key === 'updates.autoDownload'), {}), false, 'automatic download is off until the server says otherwise');
  assert.equal(settingValue(fields.find((f) => f.key === 'updates.serverAuto'), {}), true);
  const skin = fields.find((f) => f.key === 'appearance.skin');
  const size = fields.find((f) => f.key === 'appearance.textScale');
  assert.deepEqual(skin.options, ['system', 'light', 'dark']);
  assert.equal(settingValue(skin, {}), 'system', 'an unset key draws the schema default');
  assert.equal(settingValue(skin, { 'appearance.skin': 'dark' }), 'dark', 'the server value wins');
  assert.equal(coerceSetting(size, '150'), 150, 'a percentage control sends a number, not a string');
  assert.equal(coerceSetting(skin, 'dark'), 'dark');
  assert.deepEqual(mergeSettings({ 'appearance.textScale': 125 }), { 'appearance.skin': 'system', 'appearance.textScale': 125, 'notifications.newMessage': true, 'notifications.updateAvailable': true, 'notifications.updateReady': true, 'notifications.errors': true, 'updates.autoDownload': false, 'updates.serverAuto': true });
});

test('there is no density setting, and the skin and the text size are a switch and percentage choices (issue 112)', () => {
  assert.equal(Object.hasOwn(SETTINGS_SCHEMA.keys, 'appearance.density'), false, 'density has left the schema');
  assert.equal(Object.hasOwn(SETTINGS_SCHEMA.keys, 'appearance.textSize'), false, 'the 11 to 20 number field has left the schema');
  assert.equal(settingsFields().some((f) => /density/i.test(f.key + f.label)), false, 'no field names density');
  assert.equal(Object.hasOwn(mergeSettings({}), 'appearance.density'), false, 'merged settings carry no density');
  const skin = settingsFields().find((f) => f.key === 'appearance.skin');
  assert.equal(skin.type, 'segmented', 'the skin is a three-position switch, not a dropdown');
  assert.deepEqual(skin.options.map((o) => optionLabel(skin, o)), ['System', 'Light', 'Dark']);
  const size = settingsFields().find((f) => f.key === 'appearance.textScale');
  assert.equal(size.type, 'scale');
  assert.deepEqual(size.options, TEXT_SCALES);
  assert.equal(size.default, 100, 'the default text size is today\'s rendering');
  assert.equal(Math.min(...TEXT_SCALES), 50);
  assert.equal(Math.max(...TEXT_SCALES), 300);
  assert.deepEqual(size.options.map((o) => optionLabel(size, o)), ['50%', '75%', '100%', '125%', '150%', '200%', '300%']);
});

test('a text size percentage scales every type token, and 100% writes nothing', () => {
  const base = { '--font-size-xs': '11px', '--font-size-sm': '12px', '--font-size-md': '14px', '--font-size-lg': '16px', '--font-size-xl': '20px' };
  assert.deepEqual(textScaleVars(100, base), [], '100% renders exactly what the tokens say');
  assert.deepEqual(textScaleVars(150, base), TYPE_SIZE_VARS.map((n) => [n, 'calc(' + base[n] + ' * 1.5)']));
  assert.deepEqual(textScaleVars(50, base)[2], ['--font-size-md', 'calc(14px * 0.5)']);
  assert.deepEqual(textScaleVars(300, base)[4], ['--font-size-xl', 'calc(20px * 3)']);
  assert.deepEqual(textScaleVars(125, { '--font-size-md': '0.9rem' }), [['--font-size-md', 'calc(0.9rem * 1.25)']], 'a theme size is scaled as it resolved, and a size that resolved to nothing is left alone');
  assert.equal(textScale(undefined), 100, 'unset reads as 100');
  assert.equal(textScale(14), 100, 'a size stored under the old pixel field is never read as a percentage');
  assert.equal(textScale('200'), 200);
  assert.equal(textScale(110), 100, 'a value no control offers reads as 100, so the page can always be put back');
  assert.deepEqual(textScaleVars(110, base), []);
});

test('a theme URL answer in tweakcn registry form converts through the same converter as a paste', () => {
  const item = { name: 'amethyst-haze', title: 'Amethyst Haze', cssVars: {
    theme: { 'font-sans': 'Geist, sans-serif', radius: '0.5rem', 'tracking-tight': 'calc(var(--tracking-normal) - 0.025em)' },
    light: { background: 'oklch(0.97 0 0)', primary: 'oklch(0.61 0.07 299)', 'chart-1': 'oklch(0.6 0.07 299)' },
    dark: { background: 'oklch(0.2 0 0)', primary: 'oklch(0.7 0.07 299)' },
  } };
  const out = importTheme(JSON.stringify(item));
  assert.equal(out.theme.name, 'Amethyst Haze', 'the registry title names the theme');
  assert.equal(out.theme.color.light.accent, 'oklch(0.61 0.07 299)');
  assert.equal(out.theme.color.dark.bg, 'oklch(0.2 0 0)');
  assert.equal(out.theme.radius.md, '0.5rem');
  assert.equal(out.theme.font.family, 'Geist, sans-serif');
  assert.ok(out.refused.includes('chart-1') && out.refused.includes('tracking-tight'), 'what it could not carry is named');
  const css = ':root { --background: oklch(0.97 0 0); --primary: oklch(0.61 0.07 299); } .dark { --background: oklch(0.2 0 0); --primary: oklch(0.7 0.07 299); }';
  assert.deepEqual(importTheme(css, { name: 'Amethyst Haze' }).theme.color, out.theme.color, 'a URL and a paste of the same theme agree');
  assert.equal(importTheme(JSON.stringify(item), { name: 'Mine' }).theme.name, 'Mine', 'a given name wins');
  assert.equal(importSummary(importTheme('{"name":"x","cssVars":{}}')).ok, false, 'a registry item that carries nothing is not a theme');
  assert.equal(importSummary(importTheme('<html><body>Not found</body></html>')).ok, false, 'a page that is not a theme is not a theme');
  assert.equal(importSummary(importTheme('{"not": "a theme"}')).ok, false);
});

test('a theme carries its whole design language: radius and spacing scales, shadows, letter spacing, and dark-only values', () => {
  const css = [
    ':root { --radius: 0rem; --spacing: 0.3rem; --letter-spacing: 0.01em; --shadow-sm: 0 1px 2px #0002; --shadow-md: 0 2px 4px #0002; --shadow-xl: 0 9px 9px #0002; --destructive-foreground: #ffffff; }',
    '.dark { --radius: 0rem; --shadow-md: 0 2px 4px #0008; --destructive-foreground: #111111; }',
  ].join('\n');
  const { theme, accepted, refused } = importTweakcn(css, { name: 'square' });
  assert.deepEqual(theme.radius, { md: '0rem', sm: 'calc(0rem * 0.6)', lg: 'calc(0rem * 1.4)' }, 'a radius of 0 is square at every size');
  assert.deepEqual(theme.space, { 1: '0.3rem', 2: 'calc(0.3rem * 2)', 3: 'calc(0.3rem * 3)', 4: 'calc(0.3rem * 4)', 5: 'calc(0.3rem * 6)', 6: 'calc(0.3rem * 8)' });
  assert.equal(theme.font.tracking, '0.01em');
  assert.deepEqual(theme.shadow, { sm: '0 1px 2px #0002', md: '0 2px 4px #0002' });
  assert.deepEqual(theme.schemes, { dark: { shadow: { md: '0 2px 4px #0008' } } }, 'only what dark says differently is held for dark');
  assert.equal(theme.color.dark['danger-fg'], '#111111');
  assert.ok(refused.includes('shadow-xl'));
  assert.ok(!accepted.includes('shadow-xl'));
  assert.equal(importSummary({ accepted, refused }).text, 'Imported 6 values. Refused: shadow-xl.', 'a derived scale step is not a value of its own');
  const light = Object.fromEntries(themeVars(theme, 'light'));
  const dark = Object.fromEntries(themeVars(theme, 'dark'));
  assert.equal(light['--shadow-md'], '0 2px 4px #0002');
  assert.equal(dark['--shadow-md'], '0 2px 4px #0008', 'dark draws its own shadow over the shared one');
  assert.equal(dark['--space-5'], 'calc(0.3rem * 6)');
  assert.equal(light['--font-tracking'], '0.01em');
  // A .dark block written first is read after the light one all the same.
  assert.deepEqual(importTweakcn('.dark { --shadow-md: b; } :root { --shadow-md: a; }').theme.schemes, { dark: { shadow: { md: 'b' } } });
  assert.equal(importTheme(JSON.stringify({ name: 'elegant-luxury', cssVars: { light: { primary: '#000' } } })).theme.name, 'Elegant Luxury', 'a registry slug with no title reads as the theme page names it');
});

test('a theme\'s fonts reach the FontFace API only as a family, a digest, a weight and a style', () => {
  const id = 'a'.repeat(64);
  assert.deepEqual(themeFonts({ fonts: [{ family: 'Poppins', id, weight: '400', style: 'normal', extra: 1 }] }), [{ family: 'Poppins', id, weight: '400', style: 'normal' }]);
  assert.deepEqual(themeFonts({ fonts: [{ family: 'Poppins", x', id, weight: '400' }, { family: 'Poppins', id: '../x', weight: '400' }, { family: 'Poppins', id, weight: 'bold' }, null] }), []);
  assert.deepEqual(themeFonts(null), []);
});

test('the System, Light, Dark switch and the text size chips read at 4.5:1 in both schemes of the default palette', () => {
  // The pairs app.css draws them with (issue 135): on-accent words on the accent thumb or chip, muted words on the page
  // surface that is the track and an unselected chip.
  const spec = JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url), 'utf8'));
  for (const scheme of ['light', 'dark']) {
    const c = spec.color[scheme];
    assert.ok(contrastRatio(c['accent-fg'], c.accent) >= 4.5, scheme + ' selected ' + contrastRatio(c['accent-fg'], c.accent));
    assert.ok(contrastRatio(c['fg-muted'], c.bg) >= 4.5, scheme + ' unselected ' + contrastRatio(c['fg-muted'], c.bg));
  }
  assert.equal(Math.round(contrastRatio('#ffffff', '#000000')), 21);
  assert.equal(contrastRatio('#777', '#777'), 1);
  assert.ok(Math.abs(contrastRatio('oklch(1 0 0)', 'rgb(0, 0, 0)') - 21) < 0.01, 'oklch and rgb are read');
  assert.equal(contrastRatio('hsl(0 0% 0%)', '#fff'), null, 'a form it cannot read gives no ratio rather than a wrong one');
});

test('a theme value that could end the declaration or reach the network is refused', () => {
  for (const v of ['#fff', 'oklch(0.5 0.1 40)', 'rgba(0, 0, 0, 0.4)', '"Fira Code", monospace', '0.5rem']) assert.equal(safeValue(v), true, v);
  for (const v of ['red; background: blue', 'url(https://example.com/x.png)', 'image-set("x.png" 1x)', '@import "x"', '}', 'a\\62', '', 'x'.repeat(201)]) assert.equal(safeValue(v), false, v);
  const out = importTweakcn(':root { --primary: #8a3b12; --background: url(https://example.com/beacon); }');
  assert.equal(out.theme.color.light.bg, undefined, 'the unsafe value is not carried');
  assert.ok(out.refused.includes('background'), 'and is named as refused');
  assert.deepEqual(themeVars({ color: { light: { accent: 'url(x)', bg: '#fff' } } }, 'light'), [['--color-bg', '#fff']], 'a stored value that is unsafe is not written onto the page');
});

test('the themes the server holds: added by id, bounded, and offered in the picker with the one in force marked', () => {
  assert.equal(themeId('Amethyst Haze!'), 'amethyst-haze');
  assert.equal(themeId(''), 'theme');
  const a = { name: 'Amethyst Haze', source: 'tweakcn', color: { light: { accent: '#111111' }, dark: { accent: '#222222' } } };
  const first = addTheme(undefined, a);
  assert.equal(first.ok, true);
  assert.equal(first.theme.id, 'amethyst-haze');
  const again = addTheme(first.themes, { ...a, color: { light: { accent: '#333333' }, dark: {} } });
  assert.equal(again.themes.length, 1, 'importing the same theme again replaces it');
  assert.equal(again.replaced, true);
  assert.equal(again.themes[0].color.light.accent, '#333333');
  const full = Array.from({ length: MAX_THEMES }, (_, i) => ({ id: 't' + i, name: 't' + i }));
  const over = addTheme(full, { name: 'one more' });
  assert.equal(over.ok, false, 'the list is bounded');
  assert.match(over.reason, /remove one/);
  assert.deepEqual(removeTheme(first.themes, 'amethyst-haze'), []);
  const cards = themeChoices({ 'appearance.themes': first.themes });
  assert.deepEqual(cards.map((c) => [c.id, c.selected]), [['default', true], ['amethyst-haze', false]], 'the default palette is first, and in force when no theme is');
  const chosen = themeChoices({ 'appearance.themes': first.themes, 'appearance.theme': first.theme });
  assert.deepEqual(chosen.map((c) => c.selected), [false, true]);
  const legacy = themeChoices({ 'appearance.theme': { name: 'pasted before the list', source: 'tweakcn', color: { light: {}, dark: {} } } });
  assert.deepEqual(legacy.map((c) => [c.name, c.selected]), [['Default', false], ['pasted before the list', true]], 'a theme in force that is not in the list is still offered, and marked');
  assert.deepEqual(swatchVars(a, 'dark'), [['--color-accent', '#222222']], 'a card shows the colours of the scheme in force');
  assert.deepEqual(swatchVars(null, 'light'), [], 'the default card sets nothing, so the default palette shows');
});

test('the default palette is offered on any element that asks for it, in both schemes', () => {
  const css = tokensCss(spec('tokens.json'));
  const tokens = spec('tokens.json');
  const block = (selector) => { const at = css.indexOf(selector + ' {'); return at < 0 ? '' : css.slice(at, css.indexOf('}', at)); };
  assert.ok(block('[data-palette="default"]').includes('--color-accent: ' + tokens.color.light.accent + ';'), 'the light defaults');
  assert.ok(block(':root[data-scheme="dark"] [data-palette="default"]').includes('--color-accent: ' + tokens.color.dark.accent + ';'), 'the dark defaults under an explicit dark skin');
  assert.match(css, /:root\[data-scheme="dark"\] \[data-palette="default"\] \{[^}]*--color-accent: /);
});

// The sheet's backdrop is closed through the kit's one dismiss behaviour (issue 170), whose rule this is.
test('a press leaves the sheet only when it both starts and ends on the backdrop', () => {
  assert.equal(pressOutside(true, true), true, 'a press on the backdrop, down and up, goes back');
  assert.equal(pressOutside(true, false), false, 'a press that starts on the backdrop and ends inside the card does not');
  assert.equal(pressOutside(false, true), false, 'a drag that starts inside the card and is released over the backdrop does not throw the page away');
  assert.equal(pressOutside(false, false), false, 'a press inside the card is the page own');
  assert.equal(pressOutside(undefined, undefined), false);
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

test('the list sorts by activity, or by name A to Z and Z to A (issue 136)', () => {
  const chats = [
    { id: '1', name: 'bea', lastMessageAt: '2026-01-03T00:00:00.000Z', unread: 0, isGroup: false },
    { id: '2', name: 'Al', lastMessageAt: '2026-01-01T00:00:00.000Z', unread: 3, isGroup: true },
    { id: '3', name: 'Cy', lastMessageAt: '2026-01-02T00:00:00.000Z', unread: 1, isGroup: false },
    { id: '4', name: 'Ál', lastMessageAt: null, unread: 0, isGroup: false },
    { id: '5', name: '', participants: ['Dee'], lastMessageAt: '2026-01-04T00:00:00.000Z', unread: 0, isGroup: false },
  ];
  assert.deepEqual(sortChats(chats, { sort: 'recent' }).map((c) => c.id), ['5', '1', '3', '2', '4']);
  // Case and accents do not split the order: "bea" sits between "Al" and "Cy", and "Ál" ties "Al", broken by id.
  assert.deepEqual(sortChats(chats, { sort: 'name', locale: 'en' }).map((c) => c.id), ['2', '4', '1', '3', '5']);
  assert.deepEqual(sortChats(chats, { sort: 'name-desc', locale: 'en' }).map((c) => c.id), ['5', '3', '1', '4', '2'], 'Z to A is A to Z reversed');
  // The name is the one drawn on the row, so a chat with no name sorts by its people.
  assert.equal(sortChats(chats, { sort: 'name', locale: 'en' }).at(-1).id, '5');
  // A stored order the menu no longer offers reads as Recent.
  assert.deepEqual(sortChats(chats, { sort: 'manual' }).map((c) => c.id), sortChats(chats, { sort: 'recent' }).map((c) => c.id));
  assert.equal(normalizeSort('unread'), 'recent');
  assert.equal(normalizeSort(undefined), 'recent');
  assert.equal(normalizeSort('name-desc'), 'name-desc');
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
  assert.deepEqual(by({ text: 'lake', mode: 'text' }), ['1'], 'Full text searches the last message text');
  assert.deepEqual(by({ text: 'lake' }), [], 'Contact, the default, does not read message text');
  assert.deepEqual(by({ text: 'weekend' }), ['2'], 'Contact searches the name');
  assert.deepEqual(by({ unread: true, kind: 'direct' }), ['1', '3'], 'two filters narrow together');
  assert.deepEqual(by({ unread: true, kind: 'group' }), [], 'a filter matching nothing returns nothing');
  assert.ok(messageSearchText(chats[0]).includes('lake'));
  assert.ok(!contactSearchText(chats[0]).includes('lake'));
});

test('a search term reads the contact or the message text, by its own mode', () => {
  const chat = { id: '1', name: 'Bea', isGroup: false, participants: ['bea@example.com'], lastMessage: { text: 'see you at the lake', fromMe: false, attachments: 0 } };
  const contact = (text) => matchesTerm(chat, { text, mode: 'contact' });
  const full = (text, texts) => matchesTerm(chat, { text, mode: 'text' }, { texts });
  assert.deepEqual(SEARCH_MODES, ['contact', 'text']);
  assert.deepEqual(SEARCH_MODES.map((m) => SEARCH_MODE_LABELS[m]), ['Contact', 'Full text']);
  assert.equal(contact(''), true, 'an empty term matches');
  assert.equal(contact('   '), true, 'a blank term matches');
  assert.equal(contact('BEA'), true, 'Contact reads the name, case-insensitively');
  assert.equal(contact('example.com'), true, 'Contact reads the participants');
  assert.equal(contact('lake'), false, 'Contact does not read message text');
  assert.equal(full(' LAKE '), true, 'Full text reads the last message, trimmed and case-insensitively');
  assert.equal(full('bea'), false, 'Full text does not read the name');
  assert.equal(full('cooler', { '1': ['I can bring the cooler'] }), true, 'Full text reads the history the client has loaded');
  assert.equal(full('cooler', { '2': ['I can bring the cooler'] }), false, 'another chat\'s history is not this chat\'s');
  assert.equal(full('lake', undefined), true);
  assert.equal(matchesTerm({ id: '2', name: 'Al', participants: [] }, { text: 'x', mode: 'text' }), false, 'a chat with no last message has no text to match');
});

test('Enter adds a search term, each term refines, and a chip can be removed or switch its mode (issue 133)', () => {
  const chats = [
    { id: '1', name: 'Avery Quinn', participants: ['+15555550100'], lastMessage: { text: 'See you soon' } },
    { id: '2', name: 'Weekend plans', participants: ['jordan@example.com'], lastMessage: { text: 'Meet at the corner' } },
    { id: '3', name: '+15555550142', participants: ['+15555550142'], lastMessage: { text: 'Thank you' } },
  ];
  const ids = (f) => filterChats(chats, { ...emptyFilters(), ...f }).map((c) => c.id);
  let terms = addTerm([], '  a  ', 'contact');
  assert.deepEqual(terms, [{ text: 'a', mode: 'contact' }], 'the text is trimmed and keeps the mode it was added in');
  assert.deepEqual(ids({ terms }), ['1', '2']);
  terms = addTerm(terms, 'corner', 'text');
  assert.deepEqual(terms, [{ text: 'a', mode: 'contact' }, { text: 'corner', mode: 'text' }]);
  assert.deepEqual(ids({ terms }), ['2'], 'the second term refines the first');
  assert.deepEqual(ids({ terms, text: 'week', mode: 'contact' }), ['2'], 'what is being typed refines the terms live');
  assert.deepEqual(ids({ terms, text: 'zzz', mode: 'contact' }), []);
  assert.equal(addTerm(terms, '', 'text'), terms, 'a blank entry adds nothing');
  assert.equal(addTerm(terms, 'CORNER', 'text'), terms, 'a repeat in the same mode adds nothing');
  assert.equal(addTerm(terms, 'corner', 'contact').length, 3, 'the same text in the other mode is its own term');
  assert.deepEqual(addTerm([], 'x', 'bogus'), [{ text: 'x', mode: 'contact' }], 'an unknown mode reads as Contact');
  const switched = setTermMode(terms, 1, 'contact');
  assert.deepEqual(switched, [{ text: 'a', mode: 'contact' }, { text: 'corner', mode: 'contact' }], 'a chip keeps its text and changes its mode');
  assert.deepEqual(terms[1].mode, 'text', 'switching a mode is a new list');
  assert.deepEqual(ids({ terms: switched }), [], 'no chat is named "corner"');
  assert.deepEqual(removeTerm(terms, 1), [{ text: 'a', mode: 'contact' }]);
  assert.deepEqual(ids({ terms: removeTerm(terms, 1) }), ['1', '2'], 'removing a term widens the list again');
  assert.deepEqual(removeTerm(terms, 9), terms);
  // The empty list names the terms in force.
  assert.equal(termsSentence(switched), '"a" (Contact) and "corner" (Contact)');
  assert.equal(emptyListText({ terms: switched }), 'No conversations match "a" (Contact) and "corner" (Contact).');
  assert.equal(emptyListText({ terms: [{ text: 'a', mode: 'contact' }], text: ' lake ', mode: 'text' }), 'No conversations match "a" (Contact) and "lake" (Full text).');
  assert.equal(emptyListText({ terms: addTerm(addTerm(switched, 'b', 'text'), 'c', 'text') }), 'No conversations match "a" (Contact), "corner" (Contact), "b" (Full text) and "c" (Full text).');
  assert.equal(emptyListText({ unread: true }), 'No conversations match these filters.');
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
  assert.deepEqual(addGroup([], { id: 'g9', name: '   ' }), [{ id: 'g9', name: 'Group 1' }], 'an unnamed group takes a default');
  assert.deepEqual(placeChat({ '1': 'g1' }, '1', UNGROUPED), {}, 'moving a chat out drops its placement');
  assert.deepEqual(placeChat({}, '1', 'g2'), { '1': 'g2' });
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

test('the recently used row sits on the picker edge nearest the emoji button (issue 123)', () => {
  // The panel opens upward from the composer, so the button is below it: the recents row is the last, bottom, row,
  // and the grid, the field and the categories keep their order above it. Top to bottom is also the keyboard order.
  const above = emojiPickerSections({ side: 'above', recents: true });
  assert.deepEqual(above, ['grid', 'search', 'tabs', 'recents']);
  assert.equal(above.at(-1), 'recents', 'the row nearest the button is the recents row');
  assert.deepEqual(emojiPickerSections({ recents: true }), above, 'above is the default');
  // Opened below the button, the row follows it to the top edge.
  const below = emojiPickerSections({ side: 'below', recents: true });
  assert.deepEqual(below, ['recents', 'grid', 'search', 'tabs']);
  // Nothing used yet: no row, and the rest is unchanged either way.
  assert.deepEqual(emojiPickerSections({ side: 'above', recents: false }), ['grid', 'search', 'tabs']);
  assert.deepEqual(emojiPickerSections({ side: 'below' }), ['grid', 'search', 'tabs']);

  // The side is read from where the panel and the button were drawn.
  const button = { top: 600, bottom: 640 };
  assert.equal(pickerSide({ top: 220, bottom: 590 }, button), 'above');
  assert.equal(pickerSide({ top: 650, bottom: 1020 }, button), 'below');
  assert.equal(pickerSide(null, button), 'above', 'an unreadable rect keeps the default');

  // The picker draws its sections from this rule rather than an order of its own.
  const picker = readFileSync(new URL('../app/components/app-emoji-picker.js', import.meta.url), 'utf8');
  assert.match(picker, /emojiPickerSections\(/);
  assert.match(picker, /pickerSide\(/);
});

test('the attach menu offers a photo or video and any file, in that order', () => {
  assert.deepEqual(ATTACH_ACTIONS.map((a) => a.id), ['media', 'file']);
  assert.equal(ATTACH_ACTIONS[0].accept, 'image/*,video/*');
  assert.equal(ATTACH_ACTIONS[1].accept, '');
});

test('a staged file reads its size in words, and is refused when empty or past the server cap', () => {
  assert.equal(sizeLabel(0), '0 B');
  assert.equal(sizeLabel(1536), '1.5 KB');
  assert.equal(sizeLabel(25 * 1024 * 1024), '25 MB');
  assert.deepEqual(stageCheck({ size: 10 }, 100), { ok: true });
  assert.equal(stageCheck({ size: 0 }, 100).ok, false);
  const big = stageCheck({ size: 200 * 1024 * 1024 }, 100 * 1024 * 1024);
  assert.equal(big.ok, false);
  assert.match(big.reason, /200 MB.*100 MB/);
  assert.deepEqual(stageCheck({ size: 10 }, undefined), { ok: true }, 'an older server that names no cap leaves the check to the server');
});

test('base64 matches the platform encoder for every remainder, emoji text included', () => {
  for (const s of ['', 'a', 'ab', 'abc', 'abcd', 'hello \u{1F44B}\u{1F3FD} \u{1F1EF}\u{1F1F5}']) {
    const bytes = new TextEncoder().encode(s);
    assert.equal(toBase64(bytes), Buffer.from(bytes).toString('base64'), JSON.stringify(s));
  }
  const all = Uint8Array.from({ length: 256 }, (_, i) => i);
  assert.equal(toBase64(all), Buffer.from(all).toString('base64'));
});

test('the local bubble shows the staged file by name until the server message replaces it', () => {
  const a = localAttachment({ name: 'notes.pdf', type: 'application/pdf', size: 42 });
  assert.deepEqual(a, { id: 'local', name: 'notes.pdf', mime: 'application/pdf', bytes: 42, sticker: false, missing: false, local: true });
});

test('a message notice carries the text exactly, emoji included, and names an attachment when there is no text', () => {
  const text = 'hi \u{1F44B}\u{1F3FD} \u{1F1EF}\u{1F1F5}';
  assert.deepEqual(messageNotice('Sam', { text, attachments: [] }), { title: 'Sam', body: text });
  assert.equal(messageNotice('Sam', { text: '', attachments: [{}] }).body, 'Attachment');
  assert.equal(messageNotice('Sam', { text: '', attachments: [{}, {}] }).body, '2 attachments');
});

// The flake on run 37000805003: the page wrote the skin, a change to another setting made at the server arrived on
// the event stream, and then the skin write's answer (the whole store as it was before that change) landed and was
// drawn wholesale, so the other setting went back. The answer is taken for the written keys only. (The other setting
// was the density until issue 112 removed it; the text size stands in for it.)
test('a late write answer never rolls back a change the event stream already delivered', () => {
  const written = { 'appearance.skin': 'dark' };
  const staleAnswer = { 'appearance.skin': 'dark', 'appearance.textScale': 100 };
  const afterStream = { 'appearance.skin': 'dark', 'appearance.textScale': 150 };
  assert.equal(staleAnswer['appearance.textScale'], 100, 'drawing the answer wholesale is what lost the change');
  assert.deepEqual(settingsAfterWrite(afterStream, written, staleAnswer), afterStream, 'the streamed text size survives the late answer');
  assert.deepEqual(settingsAfterWrite({ 'appearance.skin': 'dark' }, written, { 'appearance.skin': 'light' }), { 'appearance.skin': 'light' }, 'the server, not the page, decides a written key');
  assert.deepEqual(settingsAfterWrite({ 'appearance.skin': 'dark' }, written, undefined), { 'appearance.skin': 'dark' }, 'an empty answer keeps what the page holds');
});

test('the sort menu names its three choices, and every order has a label', () => {
  assert.deepEqual(SORT_ORDERS, ['recent', 'name', 'name-desc']);
  assert.deepEqual(SORT_ORDERS.map((o) => SORT_LABELS[o]), ['Recent', 'Name A to Z', 'Name Z to A']);
});

test('grouping a selection takes an optional name, and an unnamed group gets the first free default (issue 137)', () => {
  assert.equal(defaultGroupName([]), 'Group 1');
  assert.equal(defaultGroupName([{ id: 'a', name: 'Group 1' }, { id: 'b', name: 'Family' }]), 'Group 2');
  assert.equal(defaultGroupName([{ id: 'a', name: 'Group 2' }]), 'Group 1', 'a gap is filled first');
  const named = groupFromSelection([], {}, ['1', '2'], { id: 'g1', name: 'Lake trip' });
  assert.deepEqual(named, { groups: [{ id: 'g1', name: 'Lake trip' }], placement: { '1': 'g1', '2': 'g1' } });
  const unnamed = groupFromSelection(named.groups, named.placement, ['3'], { id: 'g2', name: '' });
  assert.deepEqual(unnamed.groups, [{ id: 'g1', name: 'Lake trip' }, { id: 'g2', name: 'Group 1' }]);
  assert.deepEqual(unnamed.placement, { '1': 'g1', '2': 'g1', '3': 'g2' });
  const again = groupFromSelection(unnamed.groups, unnamed.placement, ['1'], { id: 'g3' });
  assert.equal(again.groups.at(-1).name, 'Group 2', 'two unnamed groups never read alike');
  assert.equal(again.placement['1'], 'g3', 'a chat moves to the new group');
});

test('slide to confirm only confirms at the end of the track, by drag or by key', () => {
  assert.equal(slideProgress(0, 200), 0);
  assert.equal(slideProgress(100, 200), 0.5);
  assert.equal(slideProgress(400, 200), 1, 'past the end is the end');
  assert.equal(slideProgress(-20, 200), 0, 'before the start is the start');
  assert.equal(slideProgress(50, 0), 0, 'a track with no travel never moves');
  assert.equal(slideConfirms(0.5), false);
  assert.equal(slideConfirms(SLIDE_CONFIRM_AT), true);
  assert.equal(slideRelease(0.85), 0, 'let go short of the end and the thumb returns');
  assert.equal(slideRelease(0.95), 1, 'let go at the end and it stays there');
  assert.equal(slideKey(0, 'ArrowRight'), 0.1);
  assert.equal(slideKey(0.9, 'ArrowRight'), 1);
  assert.equal(slideKey(1, 'ArrowRight'), 1);
  assert.equal(slideKey(0, 'ArrowLeft'), 0);
  assert.equal(slideKey(0.3, 'Home'), 0);
  assert.equal(slideKey(0.3, 'End'), 1);
  assert.equal(slideKey(0.3, 'Enter'), null, 'Enter is not a slide, so a press alone never confirms');
  assert.equal(slideKey(0.3, ' '), null);
  // Ten arrow presses reach the end without drifting short of it.
  let p = 0;
  for (let i = 0; i < 10; i += 1) p = slideKey(p, 'ArrowRight');
  assert.equal(p, 1);
});

test('a selection counts, selects all and clears together, and agrees with the rows on screen', () => {
  const visible = ['1', '2', '3'];
  assert.deepEqual(toggleChecked([], '1'), ['1']);
  assert.deepEqual(toggleChecked(['1'], '1'), [], 'checking a checked row clears it');
  assert.equal(allChecked([], visible), false);
  assert.equal(allChecked(['1'], visible), false, 'a partial selection is not all');
  assert.equal(allChecked(['1', '2', '3'], visible), true);
  assert.deepEqual(setAllChecked(['9'], visible, true), ['9', '1', '2', '3'], 'select-all adds the on-screen rows and keeps the rest');
  assert.deepEqual(setAllChecked(['1', '2', '9'], visible, false), ['9'], 'clearing takes the on-screen rows only');
  assert.equal(checkedCount(['1', '9'], visible), 1, 'the count is the checked rows that are on screen');
  assert.equal(checkedCount(['1', '2'], visible), 2);
});

test('a selection joins an existing group or starts a group of its own', () => {
  const groups = [{ id: 'g1', name: 'Family' }];
  assert.deepEqual(addChatsToGroup({ '9': 'g1' }, ['1', '2'], 'g1'), { '9': 'g1', '1': 'g1', '2': 'g1' });
  assert.deepEqual(addChatsToGroup({ '1': 'g1' }, ['1'], UNGROUPED), {}, 'adding a selection to no group drops those placements');
  const made = groupFromSelection(groups, { '9': 'g1' }, ['1', '2'], { id: 'g2', name: '  Weekend  ' });
  assert.deepEqual(made.groups, [{ id: 'g1', name: 'Family' }, { id: 'g2', name: 'Weekend' }]);
  assert.deepEqual(made.placement, { '9': 'g1', '1': 'g2', '2': 'g2' }, 'the new group takes the selection');
  assert.deepEqual(removeGroup(groups, 'g1'), [], 'deleting a group drops the group entry');
  assert.deepEqual(clearGroupPlacement({ '1': 'g1', '2': 'g1', '9': 'g2' }, 'g1'), { '9': 'g2' }, 'its placements go with it, the chats stay');
});

test('a delete cannot complete without the confirm gate, and it only hides the client entry', () => {
  assert.equal(requestDelete([]), null, 'an empty selection cannot even open the gate');
  const pending = requestDelete(['1', '1', '2']);
  assert.deepEqual(pending, { ids: ['1', '2'], step: DELETE_STEPS.confirming });
  assert.equal(resolveDelete(pending, false), null, 'the first press resolves nothing');
  assert.equal(resolveDelete(pending, undefined), null);
  assert.deepEqual(resolveDelete(pending, true), { ids: ['1', '2'], step: DELETE_STEPS.confirming }, 'only the second press resolves it');
  assert.equal(resolveDelete(null, true), null);
  const group = requestDeleteGroup('g1', 'Weekend');
  assert.deepEqual(resolveDelete(group, true), { kind: 'group', id: 'g1', name: 'Weekend', step: DELETE_STEPS.confirming });
  assert.equal(requestDeleteGroup(null, 'x'), null);
  assert.deepEqual(hideChats(['9'], ['1', '2', '1']), ['9', '1', '2'], 'the hidden list is a set, in order');
  assert.deepEqual(forgetChats(['1', '9'], { '1': 'g1', '9': 'g2' }, ['1']), { order: ['9'], placement: { '9': 'g2' } }, 'a hidden chat leaves the order and the placement too');
});

test('the group actions act on the first press, and the confirm modal is the only delete gate', () => {
  // Adding and creating return the next arrangement directly: neither carries a pending step, so nothing stands
  // between the press and the result.
  assert.deepEqual(addChatsToGroup({}, ['1'], 'g1'), { '1': 'g1' });
  const made = groupFromSelection([], {}, ['1'], { id: 'g2', name: 'Family' });
  assert.deepEqual(made.groups, [{ id: 'g2', name: 'Family' }]);
  assert.equal(Object.hasOwn(made, 'step') || Object.hasOwn(made.groups[0], 'step'), false, 'a group action is its result, not a pending step');
  // The delete gate is the only gate: an object that never went through requestDelete cannot resolve, however it is
  // confirmed.
  assert.equal(resolveDelete(requestDelete(['1']), false), null, 'the first press resolves nothing');
  assert.equal(resolveDelete({ ids: ['1'] }, true), null, 'an object that skipped the gate never resolves');
});

test('a refused write rolls back only the keys it named', () => {
  const before = { 'appearance.skin': 'system' };
  const current = { 'appearance.skin': 'dark', 'appearance.textScale': 150, 'chats.order': ['a'] };
  assert.deepEqual(settingsAfterRefusal(current, before, { 'appearance.skin': 'dark', 'chats.order': ['a'] }), { 'appearance.skin': 'system', 'appearance.textScale': 150 }, 'the named keys return to what they held, and one that did not exist is removed');
});

// Issue 134: About is the last section of Settings, with chela's full details inline and in chela's order.
test('About is the last section of Settings, and This device sits just above it with no About link', () => {
  const groups = settingsGroups();
  assert.equal(groups.at(-1).id, 'about', 'About is the last section');
  assert.equal(groups.at(-1).kind, 'about');
  assert.equal(groups.at(-2).id, 'device');
  const page = readFileSync(new URL('../app/components/app-settings.js', import.meta.url), 'utf8');
  assert.equal(/data-action="about"/.test(page), false, 'the separate About link has gone');
  assert.ok(page.includes('<app-about'), 'the settings page draws the About section itself');
});

test('the About section shows every field in chela\'s order, each from its own half', () => {
  const host = { product: 'App', version: '1.2.3-dev.4.abcdef0123', channel: 'dev', build: '4', commit: 'a'.repeat(40), builtAt: '2026-10-02T00:00:00Z', electron: '38.0.0', chromium: '140.0', node: '22.13.0', platform: 'linux', arch: 'x64', packaged: false, installSource: 'source', updateChannel: 'dev' };
  const info = { product: 'App', repository: 'https://example.test/owner/app', serverVersion: '9.9.9', serverChannel: 'stable', serverBuild: '7', serverCommit: 'b'.repeat(40), serverBuiltAt: 'then', serverPlatform: 'darwin', engine: { kind: 'fake', version: '0.1' }, apiVersion: 1 };
  const rows = aboutRows(host, info);
  assert.deepEqual(rows.map((r) => r.key), [
    'product', 'version', 'channel', 'build', 'commit', 'builtAt',
    'serverVersion', 'serverCommit', 'serverChannel', 'serverBuild', 'serverBuiltAt',
    'platform', 'arch', 'electron', 'chromium', 'node',
    'installSource', 'packaged', 'updateChannel',
    'serverPlatform', 'engine.kind', 'engine.version', 'apiVersion',
  ], 'name and version, channel, build and commit, the server\'s version and commit, platform and architecture, Electron, Chromium and Node, install source, then the rest');
  assert.deepEqual(rows.slice(0, 2).map((r) => [r.label, r.value]), [['App', 'App'], ['Client version', host.version]]);
  assert.equal(rows.find((r) => r.key === 'serverVersion').value, '9.9.9', 'the server\'s version comes from the server');
  assert.equal(rows.find((r) => r.key === 'version').value, host.version, 'the client\'s version comes from the shell');
  assert.equal(rows.find((r) => r.key === 'electron').value, '38.0.0');
  // Every field the build spec declares is on the page once, so a field added there cannot be left off.
  const declared = Object.entries(ABOUT_SPEC.halves).flatMap(([half, h]) => h.fields.map((f) => half + ':' + f.key));
  const shown = ABOUT_ORDER.filter(([, key]) => key !== 'product').map(([half, key]) => half + ':' + key);
  assert.deepEqual([...shown].sort(), [...declared].sort());
  assert.equal(new Set(shown).size, shown.length, 'no field is shown twice');
  for (const row of rows) assert.ok(typeof row.value === 'string' && row.value.length > 0, row.key + ' has a value to copy');
  assert.equal(aboutRows({}, {}).find((r) => r.key === 'commit').value, 'Unknown', 'a missing value reads Unknown');
});

test('the About links go to the source, the licence and the issues, and only over https', () => {
  const links = aboutLinks('https://example.test/owner/app.git');
  assert.deepEqual(links.map((l) => [l.key, l.label]), [['source', 'Source code'], ['licence', 'Licence'], ['report', 'Report a problem']]);
  assert.deepEqual(links.map((l) => l.href), ['https://example.test/owner/app', 'https://example.test/owner/app/blob/main/LICENSE', 'https://example.test/owner/app/issues/new']);
  assert.deepEqual(aboutLinks('http://example.test/owner/app'), [], 'not over plain http');
  assert.deepEqual(aboutLinks('javascript:alert(1)'), []);
  assert.deepEqual(aboutLinks(undefined), [], 'a server that names no repository draws no links');
});

test('a reaction is one of the six standard tapbacks or none, whichever presentation the emoji arrives in (issue 138)', () => {
  assert.deepEqual(TAPBACKS.map((t) => t.type), ['love', 'like', 'dislike', 'laugh', 'emphasis', 'question']);
  for (const t of TAPBACKS) assert.equal(tapbackType(t.glyph), t.type);
  assert.equal(tapbackType('\u2764'), 'love', 'the text heart is the love tapback');
  assert.equal(tapbackType('\u203c'), 'emphasis');
  for (const other of ['\u{1F389}', '\u{1F44D}\u{1F3FD}', '', null, 'love']) assert.equal(tapbackType(other), null, String(other));
});

test('my reaction, and which messages can be reacted to or replied to', () => {
  assert.equal(myReaction(msg({ reactions: [{ type: 'like', emoji: null, fromMe: false, sender: 'a@example.com' }] })), null);
  assert.deepEqual(myReaction(msg({ reactions: [{ type: 'like', emoji: null, fromMe: false, sender: 'a@example.com' }, { type: 'love', emoji: null, fromMe: true, sender: null }] })), { type: 'love', emoji: null, fromMe: true, sender: null });
  assert.equal(canTarget(msg({ id: 'FAKE-0013' })), true);
  assert.equal(canTarget(msg({ id: '8DF0A1B2-3C4D-4E5F-8A9B-0C1D2E3F4A5B' })), true);
  assert.equal(canTarget(msg({ id: 'local:abc', state: 'sending' })), false, 'not sent yet');
  assert.equal(canTarget(msg({ id: 'row:12' })), false, 'no guid to target');
});

test('a reply quotes its parent by who wrote it and a line of it, and says so when the parent is not loaded', () => {
  const parent = msg({ id: 'p1', senderName: 'Avery Quinn', text: 'Are we   still on\nfor coffee?' });
  const mine = msg({ id: 'p2', fromMe: true, sender: null, text: '' , attachments: [{ id: 'a', name: 'sunset.png', mime: 'image/png', bytes: 1, sticker: false, missing: false }] });
  const long = msg({ id: 'p3', sender: 'jordan@example.com', text: 'x'.repeat(100) });
  const all = [parent, mine, long];
  assert.equal(replyQuote(all, msg({ replyTo: null })), null);
  assert.deepEqual(replyQuote(all, msg({ replyTo: 'p1' })), { id: 'p1', found: true, who: 'Avery Quinn', text: 'Are we still on for coffee?' });
  assert.deepEqual(replyQuote(all, msg({ replyTo: 'p2' })), { id: 'p2', found: true, who: 'You', text: 'sunset.png' });
  const q = replyQuote(all, msg({ replyTo: 'p3' }));
  assert.equal(q.who, 'jordan@example.com');
  assert.equal(Array.from(q.text).length, 80);
  assert.ok(q.text.endsWith('\u2026'));
  assert.deepEqual(replyQuote(all, msg({ replyTo: 'gone' })), { id: 'gone', found: false, who: '', text: 'An earlier message' });
});

test('the motion tokens are the sibling app\'s, and the spring is recomputed rather than trusted', () => {
  const tokens = spec('tokens.json');
  const s = tokens.motionSource.spring;
  const curve = springCurve({ responseMs: s['response-ms'], dampingFraction: s['damping-fraction'] });
  assert.equal(tokens.motion.spring, curve.durationMs + 'ms', 'the duration is how long the spring takes to settle');
  assert.equal(tokens.motion['spring-ease'], curve.linear, 'the easing is the spring sampled');
  // Chela's own values (its core/spec/tokens.json motion block and the linear() its ui.css restates), so a drift here
  // is a drift between the two clients rather than a tidy-up.
  assert.equal(curve.durationMs, 730);
  assert.match(curve.linear, /^linear\(0, 0\.05, 0\.164, .*, 1\.01, 1\.01, .*, 1\)$/);
  assert.equal(tokens.motion.screen, '350ms');
  assert.equal(tokens.motion['min-visible'], '900ms');
  assert.equal(tokens.motion['sheet-ease'], 'cubic-bezier(0.32, 0.72, 0, 1)', 'the screen moves on the sheet curve');
  assert.equal(tokens.motion.ease, 'cubic-bezier(0.16, 1, 0.3, 1)');
  const css = tokensCss(tokens);
  for (const name of ['screen', 'spring', 'spring-ease', 'min-visible']) assert.ok(css.includes('--motion-' + name + ': ' + tokens.motion[name] + ';'), name);
  const critical = springCurve({ responseMs: 500, dampingFraction: 1 });
  assert.ok(critical.linear.startsWith('linear(0, ') && critical.linear.endsWith(', 1)'), 'a critically damped spring still runs 0 to 1');
});

test('the icon set is drawn from the tokens, one stroked glyph per name, in the generated stylesheet', () => {
  const tokens = spec('tokens.json');
  const css = tokensCss(tokens);
  assert.ok(css.includes('--icon-size: ' + tokens.icon.size + ';') && css.includes('--icon-stroke: ' + tokens.icon.stroke + ';'));
  const glyphs = tokens.icons.glyphs;
  for (const name of ['x', 'check', 'circle-x', 'alert-triangle', 'info']) assert.ok(glyphs[name], 'Chela\'s set carries ' + name);
  for (const [name, glyph] of Object.entries(glyphs)) {
    assert.ok(glyph['sf-symbol'], name + ' names the SF Symbol the phone draws');
    const svg = iconSvg(glyph, tokens.icon);
    assert.match(svg, /fill="none"/, name);
    assert.match(svg, /stroke-linecap="round" stroke-linejoin="round"/, name);
    assert.ok(svg.includes('stroke-width="' + (glyph['stroke-width'] || tokens.icon.stroke) + '"'), name);
    assert.ok(css.includes('.icon[data-icon="' + name + '"] { --icon-glyph: url("data:image/svg+xml,' + encodeURIComponent(svg) + '"); }'), name + ' is in the stylesheet');
  }
  assert.ok(iconSvg(glyphs['arrow-left'], tokens.icon).includes('stroke-width="1.7"'), 'the back arrow keeps Chela\'s finer weight');
});
