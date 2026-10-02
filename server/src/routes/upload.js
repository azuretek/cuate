// A file from the client's own device, held so a send can name it. The cap is the spec's, and the body is read with
// room for base64's own overhead, so a file at the cap is taken and one past it is refused before it is decoded.
export default {
  id: 'upload',
  async handle({ req, res, json, fail, badRequest, readJson, uploads, apiSpec }) {
    const body = await readJson(req, Math.ceil(apiSpec.uploads.maxBytes / 3) * 4 + 4096);
    for (const k of Object.keys(body)) if (k !== 'name' && k !== 'mime' && k !== 'data') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (typeof body.name !== 'string' || !body.name.trim()) throw badRequest('bad_name', 'name must be the file name.');
    if (body.mime !== undefined && typeof body.mime !== 'string') throw badRequest('bad_mime', 'mime must be a media type.');
    const r = await uploads.put(body);
    if (r.error) return fail(res, r.error[0], r.error[1], r.error[2], 'upload');
    return json(res, 201, r);
  },
};
