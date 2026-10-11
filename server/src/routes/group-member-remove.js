// Remove a person from an iMessage group through Messages (issue 326).
import { addressOk } from './chat-create.js';

export default {
  id: 'group-member-remove',
  async handle({ res, params, json, badRequest, chatIdOk, chatList, paging, engine, chatChanged }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const id = String(params.chatId);
    const held = (await chatList(paging.chats.default)).find((c) => c.id === id);
    if (held && !held.isGroup) throw badRequest('not_group', 'Only a group can be changed this way.');
    const address = decodeURIComponent(String(params.address || ''));
    if (!addressOk(address)) throw badRequest('bad_address', 'address must be a phone number or an email address.');
    const r = await engine.removeMember(id, address.trim());
    if (!r.ok) throw badRequest('not_removed', 'Messages did not remove the person.');
    const chat = await chatChanged((c) => c.id === id);
    return json(res, 200, chat || held);
  },
};
