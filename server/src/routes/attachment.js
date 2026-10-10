export default {
  id: 'attachment',
  async handle({ res, url, params, fail, badRequest, store, attachments }) {
    const id = params.attachmentId;
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(id)) throw badRequest('bad_attachment', 'Unknown attachment id.');
    const rec = store.getAttachment(id);
    if (!rec) return fail(res, 404, 'attachment_unknown', 'The server does not know that attachment. Reload the conversation.');
    // part=live is a Live Photo's motion, served from beside its still; no other part exists.
    const part = url.searchParams.get('part');
    if (part !== null && part !== 'live') throw badRequest('bad_part', 'part must be live.');
    const resolved = await attachments.resolve(rec, url.searchParams.get('format'), part);
    if (!resolved) return fail(res, 404, 'attachment_missing', 'That attachment is not on the Mac.');
    const { file, mime, size } = resolved;
    res.writeHead(200, { 'content-type': mime, 'content-length': size, 'cache-control': 'private, max-age=86400', 'content-disposition': 'inline' });
    attachments.stream(file, res).pipe(res);
    return undefined;
  },
};
