// Mark a whole conversation read. A client calls this when it opens a chat: the engine marks every message
// read on the Mac, which is also what sends the read receipt, and the server tells every client through
// chat.read so each agrees on the count.
export default {
  id: 'read',
  async handle({ res, params, json, badRequest, chatIdOk, engine, markRead }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    await engine.read(params.chatId);
    markRead(params.chatId);
    return json(res, 200, { chatId: String(params.chatId), unread: 0 });
  },
};
