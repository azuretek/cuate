// The MCP endpoint: JSON-RPC 2.0 over the server's own HTTP surface, so a tool call runs through the route it
// names and the token's scopes are the ones that route already enforces.
import { createMcp, toolCatalogue } from '../mcp.js';

export default {
  id: 'mcp',
  async handle({ req, res, json, readJson, apiSpec, naming, serverVersion, principal, dispatch }) {
    const body = await readJson(req, 262144);
    const mcp = createMcp({ tools: toolCatalogue(apiSpec), dispatch, principal, serverInfo: { name: naming.slug, version: serverVersion } });
    const frames = Array.isArray(body) ? body : [body];
    const answers = [];
    for (const frame of frames) {
      const answer = await mcp.handle(frame);
      if (answer !== null) answers.push(answer);
    }
    if (!answers.length) {
      res.writeHead(202);
      res.end();
      return;
    }
    json(res, 200, Array.isArray(body) ? answers : answers[0]);
  },
};
