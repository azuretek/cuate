// Pure: the OpenAPI 3.1 document for the API declared in core/spec/api.json, so the description of the routes has
// one owner and cannot drift from the server. scripts/gen-openapi.mjs writes the committed document from this, and
// a test fails when it is stale.
import { jsonSchema, modelJsonSchema } from './schema.js';

const COMPONENT = '#/components/schemas/';
const ref = (name) => ({ $ref: COMPONENT + name });
// The parameter names a spec route path declares (`/api/chats/:id` gives `['id']`), in order. The OpenAPI document and the
// server's MCP tools both read them from here.
export const pathParams = (p) => [...p.matchAll(/:([A-Za-z]+)/g)].map((m) => m[1]);
const openapiPath = (p) => p.replace(/:([A-Za-z]+)/g, '{$1}');
const tagFor = (route) => (route.path.startsWith('/api/') ? 'api' : 'meta');

// The response body, from the same model the validator and the client use. A binary route is the attachment bytes.
function responseFor(route, models) {
  if (route.returns === 'binary') {
    return { description: 'The attachment bytes', content: { 'application/octet-stream': { schema: { type: 'string', format: 'binary' } } } };
  }
  return { description: 'OK', content: { 'application/json': { schema: jsonSchema(route.returns, models, COMPONENT) } } };
}

function operationFor(route, models) {
  const op = {
    operationId: route.id,
    summary: route.method + ' ' + route.path,
    tags: [tagFor(route)],
    'x-scope': route.scope,
    responses: {
      200: responseFor(route, models),
      default: { description: 'An error', content: { 'application/json': { schema: ref('Error') } } },
    },
  };
  if (route.scope !== 'none') op.security = [{ bearerAuth: [] }];
  const parameters = pathParams(route.path).map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' } }));
  for (const name of route.query || []) parameters.push({ name, in: 'query', required: name === 'q', schema: { type: 'string' } });
  if (parameters.length) op.parameters = parameters;
  if (route.body) op.requestBody = { required: true, content: { 'application/json': { schema: ref(route.body) } } };
  return op;
}

export function openapiDocument(apiSpec, naming) {
  const models = apiSpec.models;
  const schemas = {};
  for (const name of Object.keys(models)) schemas[name] = modelJsonSchema(name, models, COMPONENT);
  const paths = {};
  for (const route of apiSpec.routes) {
    const at = openapiPath(route.path);
    paths[at] = paths[at] || {};
    paths[at][route.method.toLowerCase()] = operationFor(route, models);
  }
  // The events the spec names are the webhook payloads, so a receiver reads the same shape the server publishes.
  const webhooks = {};
  for (const [event, model] of Object.entries(apiSpec.events)) {
    webhooks[event] = { post: { requestBody: { required: true, description: 'The event data. A hook delivers it encrypted, as the jwe field of a signed envelope (docs/server.md, Hooks).', content: { 'application/json': { schema: ref(model) } } }, responses: { 200: { description: 'The receiver accepted the event.' } } } };
  }
  return {
    openapi: '3.1.0',
    info: { title: naming.product + ' API', version: String(apiSpec.version), description: apiSpec.description },
    paths,
    webhooks,
    components: { schemas, securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
  };
}
