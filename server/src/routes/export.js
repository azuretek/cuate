// The export endpoint: hands the message data to a tooling token in the format core/spec/export.schema.json owns.
// The route declares the endpoint and its scope here; the document's shape stays in the schema, its one owner.
//
// A full export holds the engine for minutes, so the route ties the sweep to its client: the response closing before
// it is written means the client went away, and the sweep stops at its next page rather than paging on for nobody.
// A second export while one is sweeping is answered 409 export_running instead of competing for the engine, which is
// what pushed single pages past the engine timeout and took every other request down with it (issue 107).
import { EXPORT_RUNNING, EXPORT_ABANDONED, EXPORT_HELD } from '../export.js';

// What a server logs for a request whose client closed it before the answer: no response reached anyone.
const CLIENT_CLOSED = 499;

export default {
  id: 'export',
  async handle({ res, url, json, badRequest, exporter }) {
    const mode = url.searchParams.get('mode') || 'full';
    if (mode !== 'full' && mode !== 'since') throw badRequest('bad_mode', 'mode must be full or since');
    const abandoned = new AbortController();
    const onClose = () => { if (!res.writableEnded) abandoned.abort(); };
    res.on('close', onClose);
    let doc;
    try {
      doc = await exporter.collect({ mode, signal: abandoned.signal });
    } catch (e) {
      if (e.code === EXPORT_RUNNING) throw badRequest(EXPORT_RUNNING, e.message, 409);
      if (e.code === EXPORT_HELD) throw badRequest(EXPORT_HELD, e.message, 503);
      if (e.code === EXPORT_ABANDONED) { res.statusCode = CLIENT_CLOSED; return; }
      throw e;
    } finally {
      if (typeof res.off === 'function') res.off('close', onClose);
    }
    json(res, 200, doc);
  },
};
