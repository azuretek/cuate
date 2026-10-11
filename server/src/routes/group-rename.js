// Rename an iMessage group through Messages (issue 326), so every member and every device sees the new name. An
// empty name clears it, and Messages names the group by its members again.
export default {
  id: 'group-rename',
  async handle({ req, res, params, json, badRequest, readJson, chatIdOk, chatList, paging, engine, chatChanged }) {
    if (!chatIdOk(params.chatId)) throw badRequest('bad_chat', 'Unknown chat id.');
    const id = String(params.chatId);
    const held = (await chatList(paging.chats.default)).find((c) => c.id === id);
    if (held && !held.isGroup) throw badRequest('not_group', 'Only a group can be changed this way.');
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (k !== 'name') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (typeof body.name !== 'string') throw badRequest('bad_name', 'name must be text.');
    const r = await engine.renameGroup(id, body.name.trim().slice(0, 120));
    if (!r.ok) throw badRequest('not_renamed', 'Messages did not rename the group.');
    const chat = await chatChanged((c) => c.id === id);
    return json(res, 200, chat || held);
  },
};
