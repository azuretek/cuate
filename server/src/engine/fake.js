// An in-process engine that answers the same JSON-RPC methods as imsg rpc, over synthetic data. The server's tests,
// the desktop smoke and anyone without a Mac run against it. With liveText set, it delivers one incoming message a
// couple of seconds after the first conversation is opened, which is how the smoke proves live events reach the UI.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { gradientPng } from './png.js';
import { writePlist } from './bplist.js';
import { buildFixtures, imsgReaction, TEXT_RUNS, SEND_STYLE_ROWS } from './fixtures.js';
import { PHOTO_SCAN_ROWS } from '../../../core/app/rules/engine-imsg.js';
import { compareHistory } from '../../../core/app/rules/history.js';

// The fixture PDF's pages: each a page of the given size in points with one square filled in the given colour (0 to 1
// per channel). Synthetic: drawn here, no text and no fonts.
export const SYNTHETIC_PDF_PAGES = [
  { width: 200, height: 260, fill: [0.8, 0.3, 0.2] },
  { width: 200, height: 260, fill: [0.2, 0.4, 0.8] },
];

// A well-formed PDF of filled pages, with a real cross-reference table, so a strict reader opens it as a lenient one
// does.
export function syntheticPdf(pages) {
  const objects = [];
  const kids = pages.map((_, i) => (3 + i * 2) + ' 0 R').join(' ');
  objects.push('<</Type/Catalog/Pages 2 0 R>>');
  objects.push('<</Type/Pages/Kids[' + kids + ']/Count ' + pages.length + '>>');
  pages.forEach((p, i) => {
    const inset = 20;
    const draw = p.fill.join(' ') + ' rg ' + inset + ' ' + inset + ' ' + (p.width - inset * 2) + ' ' + (p.height - inset * 2) + ' re f';
    objects.push('<</Type/Page/Parent 2 0 R/MediaBox[0 0 ' + p.width + ' ' + p.height + ']/Contents ' + (4 + i * 2) + ' 0 R/Resources<<>>>>');
    objects.push('<</Length ' + draw.length + '>>\nstream\n' + draw + '\nendstream');
  });
  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += (i + 1) + ' 0 obj\n' + body + '\nendobj\n';
  });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n';
  for (const o of offsets) out += String(o).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<</Size ' + (objects.length + 1) + '/Root 1 0 R>>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

// liveEdit: with liveText, the words the live message is edited to by its sender on another device, once the client has
// sent its first message after the live one arrived, which is how the smoke proves an edit made elsewhere reaches the UI.
export function createFakeImsg({ attachmentsRoot, base = Date.now() - 60000, liveText = null, liveDelayMs = 2000, liveEdit = null, capabilities = null, features = [] } = {}) {
  mkdirSync(path.join(attachmentsRoot, 'fake'), { recursive: true });
  const imagePath = path.join(attachmentsRoot, 'fake', 'sunset.png');
  const png = gradientPng(480, 320);
  writeFileSync(imagePath, png);
  // A second picture, so the first conversation carries more than one media item and the viewer has a neighbour to
  // step to (issue 181).
  const photo2Path = path.join(attachmentsRoot, 'fake', 'hills.png');
  const photo2 = gradientPng(320, 240);
  writeFileSync(photo2Path, photo2);
  // A document the conversation can preview, open and save (issues 219 and 374): a small, well-formed PDF under its
  // real name, whose two pages are each one filled square, so the smoke can read a drawn page's colour back.
  const docPath = path.join(attachmentsRoot, 'fake', 'booking.pdf');
  const pdf = syntheticPdf(SYNTHETIC_PDF_PAGES);
  writeFileSync(docPath, pdf);
  const { chats, messages, backgrounds: backgroundEvents } = buildFixtures({ base, imagePath, imageBytes: png.length, docPath, docBytes: pdf.length, photo2Path, photo2Bytes: photo2.length });
  // A conversation background (issue 417), as Messages keeps it: the picture it rendered for the chat, in a property
  // list in the transcript background cache beside the attachments folder, named for the row that set it.
  const backgroundCache = path.join(path.dirname(attachmentsRoot), 'TranscriptBackgroundCache');
  mkdirSync(backgroundCache, { recursive: true });
  const backdropPath = (guid) => path.join(backgroundCache, guid + '-watchBackground');
  const writeBackdrop = (guid) => {
    const picture = gradientPng(360, 640);
    writeFileSync(backdropPath(guid), writePlist({ isHighKey: false, luminance: 0.5, backgroundImageData: picture, extensionIdentifier: 'fake.background' }));
    return picture.length;
  };
  for (const e of backgroundEvents) if (e.action === 'set') e.bytes = writeBackdrop(e.guid);
  let rowid = messages.length;
  let attempts = 0;
  let liveSent = false;
  let liveMessage = null;
  let liveEdited = false;
  const sends = [];
  // send: how a send answers. sendDelayMs: how long a send takes to answer, so a test can hold one in flight.
  // afterDelayMs: how long each messages.after page takes, so a test can hold a sweep open.
  // bridge: 'ready', or 'down' to answer the bridge-only calls (a tapback, a reply) the way imsg does with no bridge.
  // capabilities: the block the fake's status advertises, so a test can model an engine that sends an arbitrary
  // emoji (a tapback.emoji version of 2 or more) and one that must not (the default, an older engine with no
  // version, and version 1, the first emoji path whose sender target did not survive retainArguments).
  // features: the rpc_features the fake's status advertises beside the block, so a test can model an engine that
  // sends an arbitrary emoji (add 'tapback.emoji') and one that does not (the default, an older bridge).
  // replyAnswer: 'own' answers a send with the guid of the row it created (what Messages does); 'existing' models the
  // bridge's reply path, which has answered a threaded reply with the id of an existing message in the chat (issue 208),
  // so a test can prove the server does not report that message as the one it created.
  // edit: false models an engine whose bridge cannot edit a message, so status leaves message.edit out (issue 391).
  const behavior = { send: 'ok', sendDelayMs: 0, afterDelayMs: 0, bridge: 'ready', edit: true, capabilities: capabilities ?? { engine: { version: 'fake-1.0', commit: 'fake', built_at: '1970-01-01T00:00:00.000Z' }, features: {} }, features, replyAnswer: 'own' };
  const tapbackEmojiVersion = () => {
    const v = behavior.capabilities.features ? behavior.capabilities.features['tapback.emoji'] : 0;
    return Number.isInteger(v) ? v : 0;
  };
  // Every typing call, as { chatId, typing }, so a test sees our indicator shown and taken down (issue 319).
  const typings = [];
  const tapbacks = [];
  const KINDS = new Set(['love', 'like', 'dislike', 'laugh', 'emphasis', 'question']);
  const transports = new Set();

  const lastAt = (chatId) => messages.filter((m) => m.chat_id === chatId && !m.is_reaction).reduce((a, m) => (m.created_at > a ? m.created_at : a), '');
  const withAttachments = (m, on) => (on ? m : { ...m, attachments: [] });
  const add = (fields) => {
    rowid += 1;
    const m = { id: rowid, guid: 'FAKE-' + String(rowid).padStart(4, '0'), created_at: new Date().toISOString(), attachments: [], text: '', sender: '', sender_name: '', ...fields };
    messages.push(m);
    return m;
  };
  const broadcast = (m) => { for (const t of transports) t.notify(m); };

  // Edits as Messages records them (issue 391): the row's text changes in place and the row is stamped with when, and
  // nothing is said on the message stream, as an edit made on another device reaches the Mac's database. The adapter
  // learns of it through `edits`, the fake's stand-in for the store reader in edits.js, with the same shape.
  const editListeners = new Set();
  let lastEditAt = 0;
  const editRow = (m, text) => {
    // The words it replaced join its history, written when they were (issue 437), as Messages keeps each version.
    m.edit_history = [...(m.edit_history || []), { text: m.text, at: new Date(m.edited_at || Date.parse(m.created_at)).toISOString() }];
    m.text = String(text);
    lastEditAt = Math.max(Date.now(), lastEditAt + 1);
    m.edited_at = lastEditAt;
    for (const cb of editListeners) setImmediate(cb);
    return m;
  };
  const editedRows = () => messages.filter((m) => m.edited_at && !m.is_reaction);
  const edits = {
    latest: () => editedRows().reduce((a, m) => Math.max(a, m.edited_at), 0),
    since(cursor, limit = 100) {
      const rows = editedRows().filter((m) => m.edited_at > cursor).sort((a, b) => a.edited_at - b.edited_at).slice(0, limit);
      return {
        rows: rows.map((m) => ({ rowid: m.id, guid: m.guid, chatId: String(m.chat_id), editedAt: new Date(m.edited_at).toISOString() })),
        cursor: rows.length ? rows[rows.length - 1].edited_at : cursor,
        more: rows.length >= limit,
      };
    },
    among(guids) {
      const want = new Set((guids || []).map(String));
      return new Map(editedRows().filter((m) => want.has(m.guid)).map((m) => [m.guid, new Date(m.edited_at).toISOString()]));
    },
    histories(guids) {
      const want = new Set((guids || []).map(String));
      return new Map(editedRows().filter((m) => want.has(m.guid) && m.edit_history?.length).map((m) => [m.guid, m.edit_history.filter((v) => v.text).map((v) => ({ ...v }))]));
    },
    onChange(cb) { editListeners.add(cb); },
    close() {},
  };

  // The fake's stand-in for backgrounds.js, with the same shape: which rows the store records as a background change,
  // each chat's newest one, and what `imsg chat-background status` answers for a chat.
  const backgrounds = {
    among(guids) {
      const want = new Set((guids || []).map(String));
      return new Map(backgroundEvents.filter((e) => want.has(e.guid)).map((e) => [e.guid, e.action]));
    },
    latest() {
      const found = new Map();
      for (const e of backgroundEvents) found.set(e.chatId, e);
      return found;
    },
    async status(chatId) {
      world.requests.push('chat-background.status');
      const chat = chats.find((c) => String(c.id) === String(chatId));
      if (!chat) throw Object.assign(new Error('chat not found'), { code: 'status_failed' });
      const e = backgroundEvents.filter((x) => x.chatId === String(chatId)).at(-1) || null;
      const row = e ? messages.find((m) => m.guid === e.guid) : null;
      const latest = row ? { row_id: row.id, guid: row.guid, action: e.action, date: row.created_at } : undefined;
      if (!e || e.action !== 'set') return { ok: true, chat_id: chat.id, chat_guid: chat.guid, background_set: false, latest_event: latest };
      return { ok: true, chat_id: chat.id, chat_guid: chat.guid, background_set: true, background_channel_guid: e.guid, file_size: e.bytes, communication_safety_state: 0, watch_background_path: backdropPath(e.guid), watch_background_exists: true, latest_event: latest };
    },
    close() {},
  };

  // The fake's stand-in for rich-text.js, with the same shape: of the rows asked about, the ones whose words the store
  // records text effects on, each with its words and its runs (issue 433).
  const richText = {
    among(guids) {
      const want = new Set((guids || []).map(String));
      const found = new Map();
      for (const m of messages) if (want.has(m.guid) && TEXT_RUNS[m.guid]) found.set(m.guid, { text: m.text, runs: TEXT_RUNS[m.guid].map((r) => ({ ...r })) });
      return found;
    },
    close() {},
  };

  // The fake's stand-in for send-effects.js, with the same shape: of the rows asked about, the ones the store records an
  // effect on, each with Messages' identifier for it (issue 442). A message that arrives with one keeps it here too.
  const sendStyles = new Map(Object.entries(SEND_STYLE_ROWS));
  const sendEffects = {
    among(guids) {
      const want = new Set((guids || []).map(String));
      return new Map([...sendStyles].filter(([guid]) => want.has(guid)));
    },
    close() {},
  };

  const world = {
    sends,
    tapbacks,
    edits,
    backgrounds,
    richText,
    sendEffects,
    // A participant sets (or clears) the conversation's background on their phone: Messages writes the row, the
    // rendered picture and the chat's record, and the row streams like any other (issue 417).
    changeBackground(chatId, sender, { clear = false } = {}) {
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return null;
      const m = add({ chat_id: chatId, is_from_me: false, sender: sender || chat.participants[0], text: '', is_read: true });
      const e = { guid: m.guid, chatId: String(chatId), action: clear ? 'clear' : 'set' };
      if (!clear) e.bytes = writeBackdrop(m.guid);
      backgroundEvents.push(e);
      broadcast(m);
      return m;
    },
    // A message edited by its sender on another device: the row's text changes and it is stamped as edited.
    editElsewhere(guid, text) {
      const m = messages.find((x) => x.guid === guid && !x.is_reaction);
      return m ? editRow(m, text) : null;
    },
    // A conversation read on another device: its messages turn read in the engine and its count falls, with nothing
    // said on the message stream, as a read on the phone reaches the Mac's database (issue 323).
    readElsewhere(chatId) {
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return false;
      for (const m of messages) if (m.chat_id === chatId && !m.is_from_me) m.is_read = true;
      chat.unread_count = 0;
      return true;
    },
    typings,
    behavior,
    messages,
    requests: [],
    get attempts() { return attempts; },
    // sendStyle: Messages' identifier for the effect the message was sent with, which the store records (issue 442).
    incoming(chatId, text, sender, { sendStyle = null } = {}) {
      const chat = chats.find((c) => c.id === chatId);
      const m = add({ chat_id: chatId, is_from_me: false, sender: sender || chat.participants[0], text, is_read: false });
      if (sendStyle) sendStyles.set(m.guid, String(sendStyle));
      // An unread message raises its conversation's count, as it does in chat.db.
      chat.unread_count = (chat.unread_count || 0) + 1;
      broadcast(m);
      return m;
    },
    // Someone else's reaction: a standard kind, or any emoji, added or taken off. The target's own reactions change as
    // they would in chat.db (one per person), and the row streams in imsg's shape, so the adapter maps what imsg sends.
    react(chatId, targetGuid, kindOrEmoji, sender, { remove = false } = {}) {
      const { type, emoji } = imsgReaction(kindOrEmoji);
      const target = messages.find((x) => x.guid === targetGuid && x.chat_id === chatId && !x.is_reaction);
      if (target) {
        const others = (target.reactions || []).filter((r) => r.is_from_me || r.sender !== sender);
        target.reactions = remove ? others : [...others, { type, emoji, sender, is_from_me: false }];
      }
      const m = add({ chat_id: chatId, is_from_me: false, sender, is_reaction: true, reaction_type: type, reaction_emoji: emoji, is_reaction_add: !remove, reacted_to_guid: targetGuid });
      broadcast(m);
      return m;
    },
    crashAll() { for (const t of [...transports]) t.crash(); },
    // Another person starts (or stops) typing in a chat, as imsg's injected bridge reports it: the event names the
    // chat by its GUID. Only reaches an engine that subscribed, which the adapter does only with the switch on.
    incomingTyping(chatId, typing = true) {
      const chat = chats.find((c) => c.id === chatId);
      if (!chat) return null;
      const event = { event: typing ? 'started-typing' : 'stopped-typing', ts: new Date().toISOString(), data: { chatGuid: chat.guid } };
      for (const t of transports) t.bridgeEvent(event);
      return event;
    },
    transport() {
      const lines = new Set();
      const exits = new Set();
      const subs = new Map();
      const bridgeSubs = new Set();
      let nextSub = 0;
      let nextBridgeSub = 0;
      let closed = false;
      const out = (obj) => {
        const s = JSON.stringify(obj);
        setImmediate(() => { if (!closed) for (const cb of lines) cb(s); });
      };
      const reply = (id, result) => out({ jsonrpc: '2.0', id, result });
      const fail = (id, code, message, data) => out({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } });
      const noBridge = (id) => fail(id, -32003, 'The bridge is not started. Run imsg launch explicitly before using bridge methods.', { retry_safe: true, disposition: 'not_started', transport: 'bridge', operation: 'send', detail: '' });
      const end = (code) => {
        if (closed) return;
        closed = true;
        transports.delete(t);
        for (const cb of exits) cb({ code, signal: null });
      };
      const handle = (req) => {
        const p = req.params || {};
        world.requests.push(req.method);
        switch (req.method) {
          case 'initialize':
          case 'status':
            // A ready bridge advertises its event stream, as imsg does when the non-launching bridge probe succeeds. The
            // adapter only subscribes when the inbound-typing switch is on (issue 230).
            return reply(req.id, { version: 'fake-1.0', protocol_version: 1, database: { path: ':fake:', ready: true }, capabilities: behavior.capabilities, rpc_features: behavior.features, methods: behavior.bridge === 'ready' ? ['bridge.events.subscribe', 'typing', ...(behavior.edit ? ['message.edit'] : [])] : [] });
          case 'chats.list': {
            const list = chats.map((c) => ({ ...c, last_message_at: lastAt(c.id) || null })).sort((a, b) => (b.last_message_at || '').localeCompare(a.last_message_at || ''));
            return reply(req.id, { chats: list.slice(0, p.limit || 20) });
          }
          case 'messages.stats':
            return reply(req.id, { total_messages: messages.filter((m) => m.chat_id === p.chat_id && !m.is_reaction).length });
          case 'messages.history': {
            const cursor = (m) => m.history_cursor || String(BigInt(Date.parse(m.created_at) - Date.parse('2001-01-01T00:00:00Z')) * 1000000n) + ':' + m.id;
            const compare = (a, b) => compareHistory({ historyCursor: a }, { historyCursor: b });
            let ms = messages.filter((m) => m.chat_id === p.chat_id && !m.is_reaction);
            if (p.end) ms = ms.filter((m) => m.created_at < p.end);
            if (p.before_cursor) ms = ms.filter((m) => compare(cursor(m), p.before_cursor) < 0);
            if (p.after_cursor) ms = ms.filter((m) => compare(cursor(m), p.after_cursor) > 0);
            ms.sort((a, b) => p.after_cursor ? compare(cursor(a), cursor(b)) : compare(cursor(b), cursor(a)));
            const hasMore = ms.length > (p.limit || 50);
            ms = ms.slice(0, p.limit || 50);
            // The live message lands in the first conversation a client opens, never in a group the engine reads for its
            // photo (issue 341), which is no conversation anyone opened.
            if (liveText && !liveSent && (p.limit || 50) > 5 && p.limit !== PHOTO_SCAN_ROWS) {
              liveSent = true;
              setTimeout(() => { liveMessage = world.incoming(p.chat_id, liveText); }, liveDelayMs).unref();
            }
            return reply(req.id, { messages: ms.map((m) => ({ ...withAttachments(m, p.attachments), history_cursor: cursor(m) })), has_more: hasMore });
          }
          case 'messages.after': {
            const since = Number.isFinite(p.since_rowid) ? p.since_rowid : 0;
            const limit = Math.min(Math.max(1, Number.isFinite(p.limit) ? p.limit : 100), 500);
            const rows = messages.slice().sort((a, b) => a.id - b.id).filter((m) => m.id > since);
            let next = since;
            const out = [];
            for (const m of rows) {
              if (out.length >= limit) break;
              next = m.id;
              if (m.is_reaction && !p.include_reactions) continue;
              out.push(withAttachments(m, p.attachments));
            }
            const page = { messages: out, next_rowid: next, has_more: rows.some((m) => m.id > next) };
            if (behavior.afterDelayMs > 0) { setTimeout(() => reply(req.id, page), behavior.afterDelayMs).unref(); return undefined; }
            return reply(req.id, page);
          }
          case 'watch.subscribe':
            nextSub += 1;
            subs.set(nextSub, p);
            return reply(req.id, { subscription: nextSub, buffer_limit: 256 });
          case 'watch.unsubscribe':
            subs.delete(p.subscription);
            return reply(req.id, { ok: true });
          // imsg's typing: our indicator in a chat, shown or taken down, through the bridge.
          case 'typing': {
            if (behavior.bridge !== 'ready') return noBridge(req.id);
            if (!chats.some((c) => c.id === p.chat_id)) return fail(req.id, -32602, 'unknown chat_id ' + p.chat_id);
            typings.push({ chatId: p.chat_id, typing: p.typing !== false });
            return reply(req.id, { ok: true });
          }
          case 'bridge.events.subscribe': {
            nextBridgeSub += 1;
            bridgeSubs.add(nextBridgeSub);
            return reply(req.id, { subscription: nextBridgeSub, buffer_limit: p.buffer_limit || 256, resumable: false });
          }
          case 'chats.create': {
            const addresses = Array.isArray(p.addresses) ? p.addresses.map(String).filter(Boolean) : [];
            if (!addresses.length) return fail(req.id, -32602, 'addresses is required');
            const group = addresses.length > 1;
            const existing = group ? null : chats.find((c) => !c.is_group && c.identifier === addresses[0]);
            if (existing) return reply(req.id, { ok: true, chat_guid: existing.guid });
            const id = Math.max(0, ...chats.map((c) => c.id)) + 1;
            const identifier = group ? 'chat' + (900000000 + id) : addresses[0];
            const guid = 'iMessage;' + (group ? '+' : '-') + ';' + identifier;
            chats.push({ id, name: p.name || (group ? '' : addresses[0]), display_name: p.name || '', contact_name: '', identifier, guid, service: 'iMessage', is_group: group, participants: addresses, unread_count: 0 });
            return reply(req.id, { ok: true, chat_guid: guid });
          }
          case 'group.rename':
          case 'group.addParticipant':
          case 'group.removeParticipant': {
            const chat = chats.find((c) => c.id === p.chat_id);
            if (!chat) return fail(req.id, -32602, 'unknown chat_id');
            if (!chat.is_group) return fail(req.id, -32602, 'not a group chat');
            if (req.method === 'group.rename') { chat.display_name = String(p.name || ''); chat.name = chat.display_name; }
            else if (req.method === 'group.addParticipant') { if (!chat.participants.includes(p.address)) chat.participants = [...chat.participants, String(p.address)]; }
            else chat.participants = chat.participants.filter((a) => a !== p.address);
            return reply(req.id, { ok: true });
          }
          case 'read': {
            const chat = chats.find((c) => c.id === p.chat_id);
            if (!chat) return fail(req.id, -32602, 'unknown chat_id');
            for (const m of messages) {
              if (m.chat_id === p.chat_id && !m.is_reaction && !m.is_from_me) m.is_read = true;
            }
            chat.unread_count = 0;
            return reply(req.id, { ok: true });
          }
          case 'send': {
            attempts += 1;
            if (behavior.send === 'hang') return undefined;
            if (behavior.send === 'uncertain') return fail(req.id, -32001, 'The send may have completed.', { retry_safe: false, disposition: 'may_have_completed', transport: 'applescript', operation: 'send', detail: '' });
            if (behavior.send === 'fail') return fail(req.id, -32603, 'Messages refused the send.', { retry_safe: true, disposition: 'not_started', transport: 'applescript', operation: 'send', detail: '' });
            if (!p.text && !p.file) return fail(req.id, -32602, 'send needs text or a file.', { retry_safe: true, disposition: 'not_started', transport: 'applescript', operation: 'send', detail: '' });
            if (p.reply_to && behavior.bridge !== 'ready') return noBridge(req.id);
            const file = p.file ? [{ filename: path.basename(p.file), transfer_name: path.basename(p.file), mime_type: 'application/octet-stream', total_bytes: 0, is_sticker: false, missing: false, original_path: p.file }] : [];
            // As Messages records it: reply_to_guid names the chat's previous message on every row, and a reply carries
            // thread_originator_guid with the part of the original it answers and no associated type at all, which is the
            // shape Messages itself writes for a threaded reply (issues 195 and 208).
            const prev = [...messages].reverse().find((x) => x.chat_id === p.chat_id && !x.is_reaction);
            const m = add({ chat_id: p.chat_id, is_from_me: true, text: p.text || '', attachments: file, ...(prev ? { reply_to_guid: prev.guid } : {}), ...(p.reply_to ? { thread_originator_guid: p.reply_to, thread_originator_part: '0:0:0' } : {}) });
            sends.push({ chatId: p.chat_id, text: p.text || '', file: p.file || null, replyTo: p.reply_to || null });
            // The live message's sender edits it on their phone once the client has answered it (issue 391).
            if (liveEdit && liveMessage && !liveEdited) {
              liveEdited = true;
              setTimeout(() => world.editElsewhere(liveMessage.guid, liveEdit), 300).unref();
            }
            // The answer names the row the engine created, unless the test asks it to model the bridge's reply path and
            // hand back an existing message's id instead (issue 208).
            const answerGuid = p.reply_to && behavior.replyAnswer === 'existing' ? String(p.reply_to) : m.guid;
            if (behavior.sendDelayMs > 0) setTimeout(() => reply(req.id, { ok: true, id: m.id, guid: answerGuid }), behavior.sendDelayMs).unref();
            else reply(req.id, { ok: true, id: m.id, guid: answerGuid });
            setTimeout(() => broadcast(m), 30).unref();
            return undefined;
          }
          // The bridge's tapback: one of the six standard kinds, or an arbitrary emoji when the fake advertises
          // tapback.emoji, added or removed on a message by its guid. The target's own reactions change as they would
          // in chat.db, and the reaction row streams like any other.
          case 'tapback': {
            attempts += 1;
            if (behavior.bridge !== 'ready') return noBridge(req.id);
            if (behavior.send === 'hang') return undefined;
            if (behavior.send === 'uncertain') return fail(req.id, -32001, 'The tapback may have completed.', { retry_safe: false, disposition: 'may_have_completed', transport: 'bridge', operation: 'tapback', detail: '' });
            if (behavior.send === 'fail') return fail(req.id, -32603, 'Messages refused the tapback.', { retry_safe: true, disposition: 'not_started', transport: 'bridge', operation: 'tapback', detail: '' });
            const emoji = typeof p.emoji === 'string' ? p.emoji : '';
            if (emoji && tapbackEmojiVersion() < 2 && !behavior.features.includes('tapback.emoji')) return fail(req.id, -32602, 'unsupported tapback reaction ' + emoji);
            if (!emoji && !KINDS.has(p.kind)) return fail(req.id, -32602, 'kind must be a standard tapback.');
            const target = messages.find((m) => m.guid === p.message_guid && m.chat_id === p.chat_id && !m.is_reaction);
            if (!target) return fail(req.id, -32602, 'unknown message_guid');
            const adding = p.remove !== true;
            const shape = imsgReaction(emoji || p.kind);
            const others = (target.reactions || []).filter((r) => !r.is_from_me);
            target.reactions = adding ? [...others, { ...shape, is_from_me: true }] : others;
            const m = add({ chat_id: p.chat_id, is_from_me: true, is_reaction: true, reaction_type: shape.type, reaction_emoji: shape.emoji, is_reaction_add: adding, reacted_to_guid: target.guid });
            tapbacks.push({ chatId: p.chat_id, targetId: target.guid, kind: emoji ? shape.type : p.kind, ...(emoji ? { emoji } : {}), remove: !adding });
            reply(req.id, { ok: true });
            setTimeout(() => broadcast(m), 30).unref();
            return undefined;
          }
          // The bridge's message.edit: the text of one of our own messages replaced, recorded on the row as Messages does
          // (issue 391). Someone else's message, or one the chat does not hold, is refused as imsg refuses it.
          case 'message.edit': {
            attempts += 1;
            if (behavior.bridge !== 'ready') return noBridge(req.id);
            if (!behavior.edit) return fail(req.id, -32601, 'Method not found');
            if (behavior.send === 'hang') return undefined;
            if (behavior.send === 'uncertain') return fail(req.id, -32001, 'The edit may have completed.', { retry_safe: false, disposition: 'may_have_completed', transport: 'bridge', operation: 'edit', detail: '' });
            if (behavior.send === 'fail') return fail(req.id, -32603, 'Messages refused the edit.', { retry_safe: true, disposition: 'not_started', transport: 'bridge', operation: 'edit', detail: '' });
            const target = messages.find((m) => (m.guid === p.message_guid || m.id === p.message_id) && m.chat_id === p.chat_id && !m.is_reaction);
            if (!target) return fail(req.id, -32602, 'unknown message_guid');
            if (!target.is_from_me) return fail(req.id, -32602, 'only your own message can be edited');
            if (typeof p.text !== 'string' || !p.text.trim()) return fail(req.id, -32602, 'text is required');
            editRow(target, p.text);
            return reply(req.id, { ok: true });
          }
          default:
            return fail(req.id, -32601, 'Method not found');
        }
      };
      const t = {
        // A bridge event, in imsg's normalized shape, to every active bridge.events.subscribe.
        bridgeEvent(event) {
          for (const id of bridgeSubs) out({ jsonrpc: '2.0', method: 'bridge.event', params: { subscription: id, event } });
        },
        notify(m) {
          for (const [id, p] of subs) {
            if (m.is_reaction && !p.include_reactions) continue;
            if (p.chat_id && p.chat_id !== m.chat_id) continue;
            out({ jsonrpc: '2.0', method: 'message', params: { subscription: id, message: withAttachments(m, p.attachments) } });
          }
        },
        write(s) {
          let req;
          try { req = JSON.parse(s); } catch { return; }
          handle(req);
        },
        onLine(cb) { lines.add(cb); },
        onExit(cb) { exits.add(cb); },
        close() { end(0); return Promise.resolve(); },
        crash() { end(1); },
      };
      transports.add(t);
      return t;
    },
  };
  return world;
}
