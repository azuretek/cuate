// A recording played on one client is played on every client (issue 440). The client that played it says so here; the
// server keeps it, so every later read marks the recording played, and tells every client through attachment.played.
// Only an attachment the server handed out can be marked.
export default {
  id: 'attachment-played',
  async handle({ res, params, json, fail, badRequest, store, publish }) {
    const id = params.attachmentId;
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) throw badRequest('bad_attachment', 'Unknown attachment id.');
    if (!store.getAttachment(id)) return fail(res, 404, 'attachment_unknown', 'The server does not know that attachment. Reload the conversation.');
    store.markPlayed(id);
    const body = { attachmentId: id, played: true };
    publish('attachment.played', body);
    return json(res, 200, body);
  },
};
