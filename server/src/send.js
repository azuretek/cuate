// Sending, which is the dangerous half: off until switched on, rate limited, one send per client key, and an
// uncertain outcome is reported as uncertain and never retried. A send carries text, a file, or a file with a
// caption, optionally as a reply to one message; the file is an attachment id the server already holds, resolved to
// its path only here. A reaction is a send too: it passes the same gate, switch and rate window (issue 138).
//
// While the updater is about to switch versions it holds new sends (503 updating) and waits for the ones in flight to
// finish, so a restart never cuts a send off halfway: inFlight() is how many are going out, hold() and release() the gate.
import os from 'node:os';
import nodePath from 'node:path';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { tapbackType, reactionUnsupported, EMOJI_TAPBACK_VERSION, editRefusal, reactionChoices, reactionAllowed } from '../../core/app/rules/messages.js';
import { platformCapabilities, reactionFallbackText, platformReactionUnsupported, platformThreadUnsupported } from '../../core/app/rules/platform.js';
import { internalPayload } from './file-type.js';

// Whether a held file can go out as an attachment: null, or a refusal [code, the reason in words]. A message's own
// data is never a file to send; a file that is gone, unreadable or empty would reach the recipient as a blank
// document, so it is refused with the reason instead (issue 197). Messages records its own paths from ~/.
async function unsendable(rec) {
  if (internalPayload(rec)) return ['attachment_internal', "That is part of a message's own data (a link preview or an app's message), not a file, so it was not sent."];
  const file = rec.path.startsWith('~/') ? nodePath.join(os.homedir(), rec.path.slice(2)) : rec.path;
  const st = await stat(file).catch(() => null);
  const readable = st && st.isFile() && (await access(file, constants.R_OK).then(() => true, () => false));
  if (!readable) return ['attachment_unreadable', 'The server cannot read that file any more, so it was not sent.'];
  if (st.size === 0) return ['attachment_empty', 'That file is empty, so it was not sent.'];
  return null;
}

export function createSender({ engine, store, config, log, platformOfChat = () => 'imessage', now = Date.now }) {
  const recent = [];
  const inFlight = new Set();
  const reacting = new Set();
  const editing = new Set();
  let held = false;

  // The update gate, the switch and the rate window every send passes. A refusal here costs nothing.
  function admit(chatId) {
    if (held) {
      log.emit('send.refused', { reason: 'updating', chat: chatId });
      return { http: 503, error: ['updating', 'The server is updating. Send it again in a moment.'] };
    }
    if (!config.sending.enabled) {
      log.emit('send.refused', { reason: 'sending_off', chat: chatId });
      return { http: 403, error: ['sending_off', 'Sending is switched off on the server.'] };
    }
    const t = now();
    while (recent.length && t - recent[0] > 60000) recent.shift();
    if (recent.length >= config.sending.perMinute) {
      log.emit('send.refused', { reason: 'rate_limited', chat: chatId });
      return { http: 429, error: ['rate_limited', 'Too many messages in the last minute.'] };
    }
    return null;
  }
  // An admitted send takes one slot in the window, and gets it back when the engine says it cannot do the thing at
  // all, since nothing reached the Mac.
  const charge = () => {
    const t = now();
    recent.push(t);
    return () => {
      const i = recent.indexOf(t);
      if (i >= 0) recent.splice(i, 1);
    };
  };

  const send = async function send(chatId, { text = '', file = '', replyTo = '', voice = false } = {}, clientKey) {
    const prev = store.getSend(clientKey);
    if (prev) return { http: 200, body: { status: prev.status, clientKey, messageId: prev.message_id ?? null, duplicate: true } };
    if (inFlight.has(clientKey)) return { http: 409, error: ['in_flight', 'That message is still being sent.'] };
    if (!String(text).trim() && !file) return { http: 400, error: ['bad_text', 'Send text, a file, or a file with a caption'] };
    // A voice message is a recording on its own: Messages gives the waveform bubble no caption (issue 520).
    if (voice && (!file || String(text).trim())) return { http: 400, error: ['bad_voice', 'A voice message is one audio file with no text.'] };
    // A threaded reply is offered only where the conversation's platform carries threads (issue 184): a request to
    // thread anywhere else is refused in place, and never sent as a reply the recipient cannot read. Costing nothing,
    // it is checked before the rate window is charged.
    if (replyTo && !platformCapabilities(await platformOfChat(chatId)).thread) {
      const refusal = platformThreadUnsupported();
      log.emit('send.refused', { reason: 'reply_unsupported', chat: chatId });
      return { http: 422, error: ['reply_unsupported', refusal.message + ' ' + refusal.detail] };
    }
    const refused = admit(chatId);
    if (refused) return refused;
    // Resolved and checked before the window is charged, so a request naming a file we do not hold, or one we would not
    // send, costs no rate budget.
    let path = null;
    if (file) {
      const rec = store.getAttachment(file);
      if (!rec) {
        log.emit('send.refused', { reason: 'unknown_attachment', chat: chatId });
        return { http: 404, error: ['attachment_unknown', 'The server does not hold that file.'] };
      }
      const refusal = await unsendable(rec);
      if (refusal) {
        log.emit('send.refused', { reason: refusal[0], chat: chatId });
        return { http: 422, error: refusal };
      }
      path = rec.path;
    }
    const refund = charge();
    inFlight.add(clientKey);
    const opts = replyTo ? { replyTo } : {};
    try {
      store.putSend(clientKey, chatId, 'pending', null);
      const r = path && voice ? await engine.sendVoice(chatId, path, opts) : path ? await engine.sendFile(chatId, path, text, opts) : await engine.sendText(chatId, text, opts);
      if (r.ok) {
        store.putSend(clientKey, chatId, 'sent', r.messageId);
        return { http: 201, body: { status: 'sent', clientKey, messageId: r.messageId ?? null } };
      }
      if (r.uncertain) {
        store.putSend(clientKey, chatId, 'uncertain', null);
        log.emit('send.uncertain', { chat: chatId, code: r.code });
        return { http: 202, body: { status: 'uncertain', clientKey, messageId: null } };
      }
      store.putSend(clientKey, chatId, 'failed', null);
      if (r.unsupported) {
        refund();
        if (voice) {
          log.emit('send.refused', { reason: 'voice_unsupported', chat: chatId });
          return { http: 422, error: ['voice_unsupported', 'The Mac cannot send a voice message right now: it needs the engine bridge running.'] };
        }
        log.emit('send.refused', { reason: 'reply_unsupported', chat: chatId });
        return { http: 422, error: ['reply_unsupported', 'The Mac cannot send a threaded reply right now: it needs the engine bridge running.'] };
      }
      log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
      return { http: 502, error: ['send_failed', 'Messages did not send it.'] };
    } finally {
      inFlight.delete(clientKey);
    }
  };

  // Add or remove this device owner's reaction on one message. What the reaction can be is one rule, reactionChoices in
  // core, decided from the conversation's own platform and the tapback.emoji version the engine advertises: the same
  // answer the app's menu draws, enforced here so a request made around the menu is refused in place before it costs
  // rate budget or reaches the engine (issues 184 and 188). Any emoji goes as itself where the answer is 'any'; where it
  // is 'classic' only the six go, and another emoji is never folded onto one of them, which would send the wrong
  // reaction. One reaction per message is in flight at a time, because a tapback sent twice can undo itself.
  //
  // The form is the platform's. Every platform that carries a reaction sends it through the engine's bridge, and
  // Messages sends it the way that service carries one: a reaction on the message service and on RCS, and on SMS the
  // classic text an iPhone sends, which Google Messages draws as a reaction. Where the bridge cannot be reached, an SMS
  // reaction (or its removal) goes as that same text from the server, word for word, and anything else is refused with
  // the reason, never sent as a stray text.
  async function react(chatId, { targetId, emoji, remove = false, text = '' }) {
    const platform = await platformOfChat(chatId);
    const caps = platformCapabilities(platform);
    const have = engine.emojiTapbackVersion ? engine.emojiTapbackVersion() : 0;
    const offer = reactionChoices({ platform, tapbackEmoji: have });
    if (offer.kind === 'none') {
      const refusal = platformReactionUnsupported(platform);
      log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId });
      return { http: 422, error: ['reaction_unsupported', refusal.message + ' ' + refusal.detail] };
    }
    const type = tapbackType(emoji);
    if (!reactionAllowed(offer, emoji)) {
      // On the message service the limit is the engine's, so the refusal names the version it would need and the
      // engine's own build (issue 241); anywhere else it is the platform's.
      if (caps.emoji) {
        const refusal = reactionUnsupported(engine.info(), EMOJI_TAPBACK_VERSION);
        log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId, needed: EMOJI_TAPBACK_VERSION, have });
        return { http: 422, error: ['reaction_unsupported', refusal.message + ' ' + refusal.detail] };
      }
      const refusal = platformReactionUnsupported(platform);
      log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId });
      return { http: 422, error: ['reaction_unsupported', refusal.message + ' ' + refusal.detail] };
    }
    const key = chatId + '/' + targetId;
    if (reacting.has(key)) return { http: 409, error: ['in_flight', 'A reaction to that message is still being sent.'] };
    const refused = admit(chatId);
    if (refused) return refused;
    const refund = charge();
    reacting.add(key);
    const arbitrary = offer.kind === 'any';
    const body = { status: 'sent', targetId, type: arbitrary ? type || 'emoji' : type, add: !remove, form: 'tapback' };
    if (arbitrary) body.emoji = emoji;
    try {
      let r = await engine.react(chatId, targetId, arbitrary ? { emoji, remove } : { type, remove });
      if (r.unsupported && caps.fallback) {
        // The bridge cannot be reached, and on SMS the reaction's own form is a text message: send Messages' words.
        r = await engine.sendText(chatId, reactionFallbackText(type, text, { remove }));
        body.form = 'text';
      }
      if (r.ok) return { http: 201, body };
      if (r.uncertain) {
        log.emit('send.uncertain', { chat: chatId, code: r.code });
        return { http: 202, body: { ...body, status: 'uncertain' } };
      }
      if (r.unsupported) {
        refund();
        log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId });
        return { http: 422, error: ['reaction_unsupported', 'The Mac cannot send a reaction right now: it needs the engine bridge running.'] };
      }
      if (body.form === 'text') refund();
      log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
      return { http: 502, error: ['react_failed', 'The Mac did not send the reaction.'] };
    } finally {
      reacting.delete(key);
    }
  }

  // Change the words of one of our own messages (issue 391). The rule the app offers Edit by (editRefusal in core) is
  // checked here against the message as the engine holds it, so a request outside it (someone else's message, a file,
  // SMS or RCS, past the fifteen-minute window) is refused in place and never reaches the engine; an engine that cannot
  // edit is refused the same way, never asked. An edit is a send: it passes the same gate, switch and rate window.
  const EDIT_LOOKBACK = 100;
  async function edit(chatId, { messageId, text }) {
    const words = String(text || '').trim();
    if (!words) return { http: 400, error: ['bad_text', 'An edit needs some words.'] };
    if (!engine.canEdit || !engine.canEdit()) {
      log.emit('send.refused', { reason: 'edit_unsupported', chat: chatId });
      return { http: 422, error: ['edit_unsupported', 'The Mac cannot edit a message right now: it needs the engine bridge running.'] };
    }
    let message;
    try {
      const page = await engine.messages(chatId, { limit: EDIT_LOOKBACK });
      message = page.messages.find((m) => m.id === messageId) || null;
    } catch {
      return { http: 502, error: ['edit_failed', 'The server could not read that conversation, so nothing was changed.'] };
    }
    const refusal = editRefusal(message, { platform: await platformOfChat(chatId), now: now(), text: words });
    if (refusal) {
      log.emit('send.refused', { reason: refusal[0], chat: chatId });
      return { http: refusal[0] === 'bad_text' ? 400 : 422, error: refusal };
    }
    const key = chatId + '/' + messageId;
    if (editing.has(key)) return { http: 409, error: ['in_flight', 'An edit to that message is still being sent.'] };
    const refused = admit(chatId);
    if (refused) return refused;
    const refund = charge();
    editing.add(key);
    const body = { status: 'edited', messageId, text: words };
    try {
      const r = await engine.edit(chatId, messageId, words);
      if (r.ok) return { http: 200, body };
      if (r.uncertain) {
        log.emit('send.uncertain', { chat: chatId, code: r.code });
        return { http: 202, body: { ...body, status: 'uncertain' } };
      }
      if (r.unsupported) {
        refund();
        log.emit('send.refused', { reason: 'edit_unsupported', chat: chatId });
        return { http: 422, error: ['edit_unsupported', 'The Mac cannot edit a message right now: it needs the engine bridge running.'] };
      }
      log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
      return { http: 502, error: ['edit_failed', 'The Mac did not change the message.'] };
    } finally {
      editing.delete(key);
    }
  }

  // The sender stays one function, as every caller has it; the reaction path, the edit path and the update gate ride
  // on it. A reaction or an edit going out counts as in flight, so an update waits for it too.
  send.react = react;
  send.edit = edit;
  send.inFlight = () => inFlight.size + reacting.size + editing.size;
  send.hold = () => { held = true; };
  send.release = () => { held = false; };
  return send;
}
