// One queued change to the person's emoji favourites: an operation id, and the emoji it adds or removes. The answer is
// the whole list as it stands after the change, so a client never has to guess what the other devices did.
export default {
  id: 'emoji-favourites-write',
  async handle({ req, res, json, badRequest, readJson, emoji, publish }) {
    const body = await readJson(req, 65536);
    for (const k of Object.keys(body)) if (!['op', 'add', 'remove'].includes(k)) throw badRequest('bad_body', 'Unknown field ' + k + '.');
    const favourites = emoji.apply(undefined, body);
    publish('emoji.changed', { favourites });
    json(res, 200, { favourites });
  },
};
