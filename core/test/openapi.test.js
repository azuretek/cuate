// The OpenAPI document is generated from the one spec, so it cannot describe a route the server does not have.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openapiDocument } from '../kit/rules/openapi.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const json = (f) => JSON.parse(readFileSync(path.join(ROOT, f), 'utf8'));
const api = json('core/spec/api.json');
const naming = json('core/spec/naming.json');
const document = () => openapiDocument(api, naming);

test('the committed OpenAPI document is fresh', () => {
  assert.deepEqual(json('core/spec/openapi.json'), document());
});

test('every route is a path and an operation named for its id', () => {
  const doc = document();
  for (const route of api.routes) {
    const at = route.path.replace(/:([A-Za-z]+)/g, '{$1}');
    assert.ok(doc.paths[at], route.id + ' has no path');
    const op = doc.paths[at][route.method.toLowerCase()];
    assert.ok(op, route.id + ' has no operation');
    assert.equal(op.operationId, route.id);
    assert.equal(op['x-scope'], route.scope);
    if (route.body) assert.deepEqual(op.requestBody.content['application/json'].schema, { $ref: '#/components/schemas/' + route.body });
    const schema = op.responses['200'].content['application/json'] && op.responses['200'].content['application/json'].schema;
    if (route.returns === 'binary') assert.ok(op.responses['200'].content['application/octet-stream'], route.id + ' is not binary');
    else if (route.returns === 'object') assert.deepEqual(schema, { type: 'object' });
    else assert.deepEqual(schema, { $ref: '#/components/schemas/' + route.returns });
  }
});

test('every model is a component schema and every event a webhook on its model', () => {
  const doc = document();
  for (const name of Object.keys(api.models)) assert.ok(doc.components.schemas[name], name + ' is missing from components');
  for (const [event, model] of Object.entries(api.events)) {
    assert.ok(doc.webhooks[event], event + ' is missing from webhooks');
    assert.deepEqual(doc.webhooks[event].post.requestBody.content['application/json'].schema, { $ref: '#/components/schemas/' + model });
  }
});
