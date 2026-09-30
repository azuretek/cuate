// Restarting Messages, the engine or the whole server on request, for the Server screen and \`mac restart\` on the
// command line. The route's scope is admin, so a device or tooling token is refused before anything is done, and
// the server's own restart answers before the process leaves, because it cannot answer afterwards.
export default {
  id: 'mac-restart',
  async handle({ req, res, json, badRequest, readJson, restarts }) {
    const body = await readJson(req, 4096);
    for (const k of Object.keys(body)) if (k !== 'what') throw badRequest('bad_body', 'Unknown field ' + k + '.');
    if (!['messages', 'engine', 'server'].includes(body.what)) throw badRequest('bad_what', 'what must be messages, engine or server');
    if (!restarts) return json(res, 503, { error: { code: 'mac_unavailable', message: 'The server is not looking after the Mac in this run.' } });
    if (body.what === 'server') {
      json(res, 200, { what: 'server', restarted: true });
      restarts.server();
      return;
    }
    const result = await restarts[body.what]();
    json(res, 200, { what: body.what, restarted: result.restarted !== false, ...(result.reason ? { reason: result.reason } : {}) });
  },
};
