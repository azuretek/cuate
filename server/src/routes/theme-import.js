// POST /api/v1/themes: fetch a tweakcn theme from a URL, convert it and add it to the themes the server holds
// (appearance.themes), then tell every client through the same settings.changed event a settings write raises. The
// theme is offered in the picker, not put in force: choosing it is the picker's job.
import { importThemeFromUrl } from '../themes.js';

export default {
  id: 'theme-import',
  async handle({ req, res, json, badRequest, readJson, settings, publish, themeFetch }) {
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (k !== 'url' && k !== 'name') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (body.name !== undefined && typeof body.name !== 'string') throw badRequest('bad_name', 'name must be a string');
    const held = settings.all()['appearance.themes'];
    const out = await importThemeFromUrl({ url: body.url, name: body.name, held, fetchImpl: themeFetch });
    const changed = settings.set({ 'appearance.themes': out.themes });
    if (changed) publish('settings.changed', { values: changed });
    json(res, 200, { theme: out.theme, accepted: out.accepted, refused: out.refused, summary: out.summary, values: settings.all() });
  },
};
