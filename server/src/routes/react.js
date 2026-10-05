import { MESSAGE_GUID } from '../../../core/app/rules/messages.js';

// Add or remove this device owner's reaction on one message (issue 138). The emoji is the reaction as drawn; the
// sender decides whether the engine can send it.
export default {
  id: 'react',
  async handle({ req, res, params, json, fail, badRequest, readJson, react, chatIdOk }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    if (!MESSAGE_GUID.test(params.messageId)) throw badRequest('bad_message', 'messageId must be the id of a message with a guid');
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (k !== 'emoji' && k !== 'remove' && k !== 'text') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (typeof body.emoji !== 'string' || !body.emoji || body.emoji.length > 32) throw badRequest('bad_emoji', 'emoji must be one emoji');
    if (body.remove !== undefined && typeof body.remove !== 'boolean') throw badRequest('bad_remove', 'remove must be true or false');
    // `text` is the message being reacted to, so a platform that carries no tapback can send its own text fallback
    // quoting it (issue 184). It is optional, bounded, and never stored.
    if (body.text !== undefined && (typeof body.text !== 'string' || body.text.length > 4000)) throw badRequest('bad_text', 'text must be a string of at most 4000 characters');
    const r = await react(params.chatId, { targetId: params.messageId, emoji: body.emoji, remove: body.remove === true, text: body.text || '' });
    if (r.error) return fail(res, r.http, r.error[0], r.error[1], 'react');
    return json(res, r.http, r.body);
  },
};
