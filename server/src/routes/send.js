export default {
  id: 'send',
  async handle({ req, res, params, json, fail, badRequest, readJson, send, chatIdOk }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const body = await readJson(req, 65536);
    for (const k of Object.keys(body)) if (k !== 'text' && k !== 'clientKey') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    const text = typeof body.text === 'string' ? body.text : '';
    const clientKey = typeof body.clientKey === 'string' ? body.clientKey : '';
    if (!text.trim() || text.length > 10000) throw badRequest('bad_text', 'text must be 1 to 10,000 characters');
    if (!/^[A-Za-z0-9_-]{8,100}$/.test(clientKey)) throw badRequest('bad_client_key', 'clientKey must be 8 to 100 letters, digits, dashes or underscores');
    const r = await send(params.chatId, text, clientKey);
    if (r.error) return fail(res, r.http, r.error[0], r.error[1], 'send');
    return json(res, r.http, r.body);
  },
};
