// The MCP surface is the spec read again: every route is a tool, and the token's scopes decide both the route
// and the tool because a tool call runs through the route.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { boot } from './helpers.js';
import { apiSpec, serverVersion } from '../src/paths.js';
import { toolCatalogue } from '../src/mcp.js';

const calls = (token, body) => s.post('/api/v1/mcp', token, body);
const call = (token, name, args) => calls(token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
let s;
before(async () => { s = await boot(); });
after(async () => { await s.close(); });

test('every route has exactly one tool, and every tool names a route', () => {
  const tools = toolCatalogue(apiSpec);
  assert.deepEqual(tools.map((t) => t.route).sort(), apiSpec.routes.map((r) => r.id).sort());
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length, 'tool names are unique');
});

test('a tool carries the same scope as its route', () => {
  for (const tool of toolCatalogue(apiSpec)) {
    const route = apiSpec.routes.find((r) => r.id === tool.route);
    assert.equal(tool.scope, route.scope, tool.name);
  }
});

test('a tool carries the spec shapes of its route request and response', () => {
  for (const tool of toolCatalogue(apiSpec)) {
    const route = apiSpec.routes.find((r) => r.id === tool.route);
    for (const name of [...route.path.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1])) assert.ok(tool.inputSchema.properties[name], tool.name + ' is missing path parameter ' + name);
    for (const name of route.query || []) assert.ok(tool.inputSchema.properties[name], tool.name + ' is missing query ' + name);
    if (route.body) assert.deepEqual(tool.inputSchema.properties.body, { $ref: '#/$defs/' + route.body });
    assert.ok(tool.inputSchema.$defs[Object.keys(apiSpec.models)[0]], tool.name + ' carries the model shapes');
    if (route.returns === 'binary') assert.equal(tool.outputSchema.format, 'binary');
    else if (apiSpec.models[route.returns]) assert.deepEqual(tool.outputSchema, { $ref: '#/$defs/' + route.returns, $defs: tool.inputSchema.$defs });
  }
});

test('the endpoint answers initialize and lists every tool', async () => {
  const hello = await (await calls(s.tokens.admin, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })).json();
  assert.equal(hello.result.serverInfo.version, serverVersion);
  const list = await (await calls(s.tokens.admin, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
  assert.deepEqual(list.result.tools.map((t) => t.name).sort(), apiSpec.routes.map((r) => r.id).sort());
});

test('a tool call runs through its route, and the route scope decides both', async () => {
  const info = await (await call(s.tokens.tooling, 'info', {})).json();
  assert.ok(!info.result.isError);
  assert.equal(JSON.parse(info.result.content[0].text).apiVersion, apiSpec.version);
  const refused = await (await call(s.tokens.device, 'mac-restart', { body: { what: 'messages' } })).json();
  assert.equal(refused.result.isError, true);
  assert.equal(JSON.parse(refused.result.content[0].text).error.code, 'forbidden');
  const unknown = await (await call(s.tokens.admin, 'not-a-route', {})).json();
  assert.equal(unknown.error.code, -32602);
  assert.equal((await calls(s.tokens.device, { jsonrpc: '2.0', id: 3, method: 'nope' })).status, 200);
});

test('the MCP endpoint needs a token', async () => {
  const r = await s.post('/api/v1/mcp', null, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  assert.equal(r.status, 401);
});

test('the OpenAPI document is served unauthenticated and matches the committed copy', async () => {
  const r = await s.get('/openapi.json');
  assert.equal(r.status, 200);
  const doc = await r.json();
  assert.deepEqual(doc, JSON.parse(readFileSync(new URL('../../core/spec/openapi.json', import.meta.url), 'utf8')));
  for (const route of apiSpec.routes) {
    const at = route.path.replace(/:([A-Za-z]+)/g, '{$1}');
    assert.equal(doc.paths[at][route.method.toLowerCase()].operationId, route.id);
  }
});
