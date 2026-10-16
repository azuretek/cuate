import { cursorOptions } from '../history.js';
import { mediaItems } from '../../../core/app/rules/media.js';

export default {
  id: 'media',
  async handle({ res, url, params, json, engine, paging, intParam, chatIdOk, badRequest }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    // One bounded history page per request, even across a long stretch with no media. An empty
    // media page can have a continuation; consumers must use hasMore, not the item count.
    const limit = intParam(url, 'limit', 1, paging.messages.max, paging.messages.default);
    const page = await engine.messages(params.chatId, { limit, ...cursorOptions(url, badRequest) });
    if (page.messages.length && !page.nextCursor) throw badRequest('cursor_unavailable', 'Update the message engine to browse the whole conversation.');
    const items = mediaItems([...page.messages].reverse());
    json(res, 200, { items, hasMore: page.hasMore, nextCursor: page.nextCursor || null });
  },
};
