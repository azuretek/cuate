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
import { tapbackType, reactionUnsupported, EMOJI_TAPBACK_VERSION } from '../../core/app/rules/messages.js';
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

  const send = async function send(chatId, { text = '', file = '', replyTo = '' } = {}, clientKey) {
    const prev = store.getSend(clientKey);
    if (prev) return { http: 200, body: { status: prev.status, clientKey, messageId: prev.message_id ?? null, duplicate: true } };
    if (inFlight.has(clientKey)) return { http: 409, error: ['in_flight', 'That message is still being sent.'] };
    if (!String(text).trim() && !file) return { http: 400, error: ['bad_text', 'Send text, a file, or a file with a caption'] };
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
      const r = path ? await engine.sendFile(chatId, path, text, opts) : await engine.sendText(chatId, text, opts);
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
        log.emit('send.refused', { reason: 'reply_unsupported', chat: chatId });
        return { http: 422, error: ['reply_unsupported', 'The Mac cannot send a threaded reply right now: it needs the engine bridge running.'] };
      }
      log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
      return { http: 502, error: ['send_failed', 'Messages did not send it.'] };
    } finally {
      inFlight.delete(clientKey);
    }
  };

  // Add or remove this device owner's reaction on one message. Messages itself takes any emoji as a reaction; an
  // engine that advertises tapback.emoji version 2 sends any emoji as itself, and one that does not sends only the six standard
  // tapbacks (it folds some other emoji onto them, so passing one through would send the wrong reaction), so any other
  // emoji is refused before it costs rate budget or reaches the engine (issue 188). One reaction per message is in
  // flight at a time, because a tapback sent twice can undo itself.
  async function react(chatId, { targetId, emoji, remove = false, text = '' }) {
    const platform = await platformOfChat(chatId);
    const caps = platformCapabilities(platform);
    // The conversation's own platform decides the form (issue 184). A platform the engine did not name, and one that
    // carries no reaction at all, is refused in place: which form to send is not something to guess.
    if (!caps.tapback && !caps.fallback) {
      const refusal = platformReactionUnsupported(platform);
      log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId });
      return { http: 422, error: ['reaction_unsupported', refusal.message + ' ' + refusal.detail] };
    }
    const type = tapbackType(emoji);
    // Where the platform carries a reaction as the classic text fallback, the six are sent as that phrase quoting the
    // message they answer, which the other client reads back as a reaction. An arbitrary emoji has no such phrase, and
    // a reaction sent this way cannot be taken back, so both are refused rather than sent in a form that cannot be read.
    if (caps.fallback && !caps.tapback) {
      const fallback = !remove && type ? reactionFallbackText(type, text) : null;
      if (!fallback) {
        const refusal = remove
          ? { message: 'A reaction on this conversation cannot be taken back.', detail: 'The service has no way to remove one.' }
          : platformReactionUnsupported(platform);
        log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId });
        return { http: 422, error: ['reaction_unsupported', refusal.message + ' ' + refusal.detail] };
      }
      const key = chatId + '/' + targetId;
      if (reacting.has(key)) return { http: 409, error: ['in_flight', 'A reaction to that message is still being sent.'] };
      const refused = admit(chatId);
      if (refused) return refused;
      const refund = charge();
      reacting.add(key);
      try {
        const r = await engine.sendText(chatId, fallback);
        if (r.ok) return { http: 201, body: { status: 'sent', targetId, type, add: true, form: 'text' } };
        if (r.uncertain) {
          log.emit('send.uncertain', { chat: chatId, code: r.code });
          return { http: 202, body: { status: 'uncertain', targetId, type, add: true, form: 'text' } };
        }
        refund();
        log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
        return { http: 502, error: ['react_failed', 'The Mac did not send the reaction.'] };
      } finally {
        reacting.delete(key);
      }
    }
    const arbitrary = engine.supportsEmojiTapback();
    if (!arbitrary && !type) {
      // The refusal names the limit and the version the engine would need, and the engine's own build, so the
      // client can tell the reader which engine answered rather than blaming the app. It never folds the emoji
      // onto a classic tapback, so nothing the reader did not choose is ever sent (issue 241).
      const have = engine.emojiTapbackVersion ? engine.emojiTapbackVersion() : 0;
      const refusal = reactionUnsupported(engine.info(), EMOJI_TAPBACK_VERSION);
      log.emit('send.refused', { reason: 'reaction_unsupported', chat: chatId, needed: EMOJI_TAPBACK_VERSION, have });
      return { http: 422, error: ['reaction_unsupported', refusal.message + ' ' + refusal.detail] };
    }
    const key = chatId + '/' + targetId;
    if (reacting.has(key)) return { http: 409, error: ['in_flight', 'A reaction to that message is still being sent.'] };
    const refused = admit(chatId);
    if (refused) return refused;
    const refund = charge();
    reacting.add(key);
    const body = { status: 'sent', targetId, type: arbitrary ? type || 'emoji' : type, add: !remove };
    if (arbitrary) body.emoji = emoji;
    try {
      const r = await engine.react(chatId, targetId, arbitrary ? { emoji, remove } : { type, remove });
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
      log.emit('send.failed', { chat: chatId, code: r.code, error: r.error || null });
      return { http: 502, error: ['react_failed', 'The Mac did not send the reaction.'] };
    } finally {
      reacting.delete(key);
    }
  }

  // The sender stays one function, as every caller has it; the reaction path and the update gate ride on it. A
  // reaction going out counts as in flight, so an update waits for it too.
  send.react = react;
  send.inFlight = () => inFlight.size + reacting.size;
  send.hold = () => { held = true; };
  send.release = () => { held = false; };
  return send;
}
