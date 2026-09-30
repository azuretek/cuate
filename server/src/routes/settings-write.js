export default {
  id: 'settings-write',
  async handle({ req, res, json, badRequest, readJson, settings, publish }) {
    const body = await readJson(req, 65536);
    for (const k of Object.keys(body)) if (k !== 'values') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (!body.values || typeof body.values !== 'object' || Array.isArray(body.values)) throw badRequest('bad_values', 'values must be a JSON object');
    const changed = settings.set(body.values);
    if (changed) publish('settings.changed', { values: changed });
    json(res, 200, { values: settings.all() });
  },
};
