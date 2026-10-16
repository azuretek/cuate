import { cursorOptions } from '../history.js';

export default {
  id: 'messages',
  async handle({ res, url, params, json, engine, paging, intParam, chatIdOk, badRequest }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const limit = intParam(url, 'limit', 1, paging.messages.max, paging.messages.default);
    const cursors = cursorOptions(url, badRequest);
    const before = url.searchParams.get('before');
    if (before !== null && (cursors.beforeCursor || cursors.afterCursor)) throw badRequest('bad_cursor', 'Use a cursor or a date bound, not both.');
    if (before !== null && !Number.isFinite(Date.parse(before))) throw badRequest('bad_before', 'before must be an ISO 8601 time');
    json(res, 200, await engine.messages(params.chatId, { limit, ...cursors, includeTotal: url.searchParams.get('includeTotal') === 'true', before: before ? new Date(Date.parse(before)).toISOString() : null }));
  },
};
