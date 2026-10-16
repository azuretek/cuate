import { MESSAGE_GUID } from '../../../core/app/rules/messages.js';

// Change the words of one of our own messages (issue 391). The sender decides whether this message can be edited and
// whether the engine can do it; the new words are bounded and never stored.
export default {
  id: 'edit',
  async handle({ req, res, params, json, fail, badRequest, readJson, edit, chatIdOk }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    if (!MESSAGE_GUID.test(params.messageId)) throw badRequest('bad_message', 'messageId must be the id of a message with a guid');
    const body = await readJson(req, 16384);
    for (const k of Object.keys(body)) if (k !== 'text') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (typeof body.text !== 'string' || body.text.length > 4000) throw badRequest('bad_text', 'text must be a string of at most 4000 characters');
    const r = await edit(params.chatId, { messageId: params.messageId, text: body.text });
    if (r.error) return fail(res, r.http, r.error[0], r.error[1], 'edit');
    return json(res, r.http, r.body);
  },
};
