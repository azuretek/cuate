export default {
  id: 'search',
  async handle({ res, url, json, badRequest, search, paging, intParam, chatIdOk }) {
    const q = url.searchParams.get('q');
    if (q === null || !q.trim()) throw badRequest('bad_query', 'q is required and must not be blank');
    if (q.length > 200) throw badRequest('bad_query', 'q must be 200 characters or fewer');
    const limit = intParam(url, 'limit', 1, paging.search.max, paging.search.default);
    const chatId = url.searchParams.get('chatId');
    if (chatId !== null && !chatIdOk(chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    json(res, 200, await search(q, { limit, chatId }));
  },
};
