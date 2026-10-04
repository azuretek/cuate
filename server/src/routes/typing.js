// A device says it is typing in a conversation, or that it stopped. The server relays it to the account's other
// signed-in devices and holds it with a short expiry; nothing is written to history (issue 230).
export default {
  id: 'typing',
  async handle({ req, res, params, json, badRequest, readJson, chatIdOk, typing, principal }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const body = await readJson(req, 1024);
    for (const k of Object.keys(body)) if (k !== 'typing') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (typeof body.typing !== 'boolean') throw badRequest('bad_typing', 'typing must be true or false.');
    typing.relay({ chatId: String(params.chatId), from: principal.id, typing: body.typing });
    return json(res, 200, { chatId: String(params.chatId), typing: body.typing });
  },
};
