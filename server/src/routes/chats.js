export default {
  id: 'chats',
  async handle({ res, url, json, config, paging, intParam, chatList, loadPreview, previews, mapLimit }) {
    const limit = intParam(url, 'limit', 1, paging.chats.max, paging.chats.default);
    const list = await chatList(limit);
    const missing = list.slice(0, config.previews).filter((c) => !previews.has(String(c.id)));
    await mapLimit(missing, 4, (c) => loadPreview(c.id));
    json(res, 200, { chats: list.map((c) => ({ ...c, lastMessage: previews.get(String(c.id)) || null })) });
  },
};
