// The MCP surface: one tool per route declared in core/spec/api.json, named from the spec, with the spec's own
// request and response shapes. A call is dispatched through the server's own route, so a tool allows exactly what
// its route allows and there is one scope check rather than two.
import { jsonSchema, modelJsonSchema } from '../../core/kit/rules/schema.js';
import { pathParams } from '../../core/kit/rules/openapi.js';

const DEFS = '#/$defs/';
const PROTOCOL = '2025-06-18';
const reply = (id, result) => ({ jsonrpc: '2.0', id, result });
const failure = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

// The catalogue is the spec read a second way: every route is a tool, and the tool's schema is the route's models.
export function toolCatalogue(apiSpec) {
  const defs = {};
  for (const name of Object.keys(apiSpec.models)) defs[name] = modelJsonSchema(name, apiSpec.models, DEFS);
  return apiSpec.routes.map((route) => {
    const properties = {};
    const required = [];
    for (const name of pathParams(route.path)) { properties[name] = { type: 'string' }; required.push(name); }
    for (const name of route.query || []) properties[name] = { type: 'string' };
    if (route.body) { properties.body = { $ref: DEFS + route.body }; required.push('body'); }
    const output = jsonSchema(route.returns, apiSpec.models, DEFS);
    if (output.$ref) output.$defs = defs;
    return {
      name: route.id,
      title: route.method + ' ' + route.path,
      description: route.method + ' ' + route.path + (route.scope === 'none' ? '' : ' (scope: ' + route.scope + ')'),
      route: route.id,
      scope: route.scope,
      query: route.query || [],
      pathParams: pathParams(route.path),
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false, $defs: defs },
      outputSchema: output,
    };
  });
}

export function createMcp({ tools, dispatch, principal, serverInfo }) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const pick = (args, keys) => Object.fromEntries(keys.filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
  return {
    tools,
    async handle(message) {
      if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return failure(message && message.id, -32600, 'Not a JSON-RPC 2.0 request.');
      const id = message.id === undefined ? null : message.id;
      const params = message.params || {};
      switch (message.method) {
        case 'initialize':
          return reply(id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo });
        case 'notifications/initialized':
        case 'notifications/cancelled':
          return null;
        case 'ping':
          return reply(id, {});
        case 'tools/list':
          return reply(id, { tools: tools.map((t) => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, outputSchema: t.outputSchema })) });
        case 'tools/call': {
          const tool = byName.get(params.name);
          if (!tool) return failure(id, -32602, 'Unknown tool: ' + String(params.name));
          const args = params.arguments && typeof params.arguments === 'object' ? params.arguments : {};
          try {
            const { status, body, binary } = await dispatch(tool.route, { params: pick(args, tool.pathParams), query: pick(args, tool.query), body: args.body === undefined ? null : args.body, principal });
            const text = binary ? JSON.stringify({ status, note: 'The route returned binary content.' }) : JSON.stringify(body);
            return reply(id, { content: [{ type: 'text', text }], isError: status >= 400 });
          } catch (e) {
            return reply(id, { content: [{ type: 'text', text: JSON.stringify({ error: { code: e.code || 'internal', message: e.message } }) }], isError: true });
          }
        }
        default:
          return failure(id, -32601, 'Method not found: ' + message.method);
      }
    },
  };
}
