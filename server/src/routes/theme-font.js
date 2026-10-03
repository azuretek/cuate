// GET /api/v1/themes/fonts/:fontId: one font file a held theme names (theme.fonts[].id), fetched by the server when the
// theme was imported (theme-fonts.js). Clients read it here with their token and add it with the FontFace API, so a
// theme's type draws without the page loading anything from the network.
import { createReadStream } from 'node:fs';

export default {
  id: 'theme-font',
  async handle({ res, params, fail, badRequest, themeFonts }) {
    const id = params.fontId;
    if (!/^[a-f0-9]{64}$/.test(String(id))) throw badRequest('bad_font', 'Unknown font id.');
    const found = themeFonts ? await themeFonts.file(id) : null;
    if (!found) return fail(res, 404, 'font_unknown', 'The server holds no font by that id. Import the theme again.');
    res.writeHead(200, { 'content-type': 'font/woff2', 'content-length': found.size, 'cache-control': 'private, max-age=31536000, immutable' });
    createReadStream(found.file).pipe(res);
    return undefined;
  },
};
