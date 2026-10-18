// What changed since a cursor (issue 441): new messages, reactions, edits, unsends and read receipts, oldest first, in
// bounded pages, read from the Messages store's own marks. With no cursor it answers the head to start from.
const CHAT_LIST = /^\d{1,12}(,\d{1,12}){0,499}$/;

export default {
  id: 'changes',
  async handle({ res, url, json, engine, paging, intParam, badRequest }) {
    const limit = intParam(url, 'limit', 1, paging.changes.max, paging.changes.default);
    const since = url.searchParams.get('since');
    if (since !== null && since.length > 200) throw badRequest('bad_cursor', 'since is not a cursor this server wrote.');
    const list = url.searchParams.get('chats');
    if (list !== null && !CHAT_LIST.test(list)) throw badRequest('bad_chats', 'chats is a comma-separated list of chat ids.');
    const chats = list === null ? null : new Set(list.split(','));
    json(res, 200, await engine.changes({ since, limit, chats }));
  },
};
