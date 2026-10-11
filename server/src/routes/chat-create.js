// Start a conversation through Messages itself (issue 326): one address is a direct chat, several are an iMessage
// group, optionally named, and an optional first message goes with it. Messages owns the conversation, so it is the
// same one on the phone and the Mac; the answer is the chat as the list now holds it.
const ADDRESS = /^(\+?[0-9][0-9 ().-]{2,30}|[^\s@]{1,64}@[^\s@]{1,190})$/;
export const addressOk = (a) => typeof a === 'string' && ADDRESS.test(a.trim());

export default {
  id: 'chat-create',
  async handle({ req, res, json, badRequest, readJson, engine, chatChanged }) {
    const body = await readJson(req, 16384);
    for (const k of Object.keys(body)) if (!['addresses', 'name', 'text'].includes(k)) throw badRequest('bad_body', 'Unknown field ' + k + '.');
    const addresses = Array.isArray(body.addresses) ? [...new Set(body.addresses.map((a) => String(a).trim()))] : [];
    if (!addresses.length || addresses.length > 32) throw badRequest('bad_addresses', 'addresses must name 1 to 32 people.');
    if (!addresses.every(addressOk)) throw badRequest('bad_address', 'Each address must be a phone number or an email address.');
    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (name && addresses.length < 2) throw badRequest('bad_name', 'Only a group takes a name.');
    const text = typeof body.text === 'string' ? body.text : '';
    const r = await engine.createChat(addresses, { name, text });
    if (!r.ok) throw badRequest('not_created', 'Messages did not create the conversation.');
    // The list names a chat by its id and members, so the new one is the chat with exactly these members (a group's
    // name too, when it was given one), the newest first.
    const want = [...addresses].sort().join('\n');
    const chat = await chatChanged((c) => c.isGroup === addresses.length > 1 && [...c.participants].sort().join('\n') === want && (!name || c.name === name));
    if (!chat) throw badRequest('not_listed', 'Messages created the conversation but it is not listed yet.');
    return json(res, 200, chat);
  },
};
