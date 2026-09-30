// The export endpoint: hands the message data to a tooling token in the format core/spec/export.schema.json owns.
// The route declares the endpoint and its scope here; the document's shape stays in the schema, its one owner.
export default {
  id: 'export',
  async handle({ res, url, json, badRequest, exporter }) {
    const mode = url.searchParams.get('mode') || 'full';
    if (mode !== 'full' && mode !== 'since') throw badRequest('bad_mode', 'mode must be full or since');
    json(res, 200, await exporter.collect({ mode }));
  },
};
