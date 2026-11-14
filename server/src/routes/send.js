import { MESSAGE_GUID } from '../../../core/app/rules/messages.js';

const ATTACHMENT_ID = /^[A-Za-z0-9_-]{10,64}$/;

export default {
  id: 'send',
  async handle({ req, res, params, json, fail, badRequest, readJson, send, chatIdOk }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const body = await readJson(req, 65536);
    for (const k of Object.keys(body)) if (k !== 'text' && k !== 'file' && k !== 'clientKey' && k !== 'replyTo' && k !== 'voice') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    const text = typeof body.text === 'string' ? body.text : '';
    const file = typeof body.file === 'string' ? body.file : '';
    const clientKey = typeof body.clientKey === 'string' ? body.clientKey : '';
    const replyTo = typeof body.replyTo === 'string' ? body.replyTo : '';
    if (body.voice !== undefined && typeof body.voice !== 'boolean') throw badRequest('bad_voice', 'voice must be true or false');
    const voice = body.voice === true;
    if (voice && (!file || text.trim())) throw badRequest('bad_voice', 'A voice message is one audio file with no text.');
    if (text.length > 10000) throw badRequest('bad_text', 'text must be at most 10,000 characters');
    if (!text.trim() && !file) throw badRequest('bad_text', 'Send text, a file, or a file with a caption');
    if (file && !ATTACHMENT_ID.test(file)) throw badRequest('bad_file', 'file must be an attachment id');
    if (body.replyTo !== undefined && !MESSAGE_GUID.test(replyTo)) throw badRequest('bad_reply_to', 'replyTo must be the id of a message with a guid');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientKey)) throw badRequest('bad_client_key', 'clientKey must be 8 to 100 letters, digits, dashes or underscores');
    const r = await send(params.chatId, { text, file, ...(replyTo ? { replyTo } : {}), ...(voice ? { voice } : {}) }, clientKey);
    if (r.error) return fail(res, r.http, r.error[0], r.error[1], 'send');
    return json(res, r.http, r.body);
  },
};
