// GET /api/v1/links/media?url=<link>: the bytes of a shared video link's media (issue 243). The server resolves and
// caches the third party's media, so a client asks only us and never the site, and the page fetches nothing on render.
export default {
  id: 'link-media',
  async handle({ res, url, linkMedia, fail, badRequest }) {
    const target = url.searchParams.get('url');
    if (!target) throw badRequest('bad_url', 'A link URL is required.');
    if (!linkMedia) return fail(res, 400, 'link_unsupported', 'This server cannot resolve shared video links.');
    const media = await linkMedia.get(target);
    res.writeHead(200, { 'content-type': media.mime, 'content-length': String(media.bytes), 'cache-control': 'private, max-age=3600', 'content-disposition': 'inline' });
    res.end(media.body);
    return undefined;
  },
};
