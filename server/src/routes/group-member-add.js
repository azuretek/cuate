// Add a person to an iMessage group through Messages (issue 326).
import { addressOk } from './chat-create.js';

export default {
  id: 'group-member-add',
  async handle({ req, res, params, json, badRequest, readJson, chatIdOk, chatList, paging, engine, chatChanged }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const id = String(params.chatId);
    const held = (await chatList(paging.chats.default)).find((c) => c.id === id);
    if (held && !held.isGroup) throw badRequest('not_group', 'Only a group can be changed this way.');
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (k !== 'address') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (!addressOk(body.address)) throw badRequest('bad_address', 'address must be a phone number or an email address.');
    const r = await engine.addMember(id, body.address.trim());
    if (!r.ok) throw badRequest('not_added', 'Messages did not add the person.');
    const chat = await chatChanged((c) => c.id === id);
    return json(res, 200, chat || held);
  },
};
