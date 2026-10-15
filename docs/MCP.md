# The OpenAPI document and the MCP surface

Both are generated from [core/spec/api.json](../core/spec/api.json), the one owner of the routes, the models and
the events. Neither can describe a route the server does not have, because both are the same spec read a second way.

## The OpenAPI document

`core/spec/openapi.json` is generated from the spec and committed. `pnpm run openapi` writes it, `pnpm run build`
fails when it is stale, and `core/test/openapi.test.js` fails when a route, a model or an event is missing from it.
The server serves the same document at `GET /openapi.json` with no token, so a tool can read what the server accepts.

## The MCP surface

The server answers MCP over JSON-RPC 2.0 at `POST /api/v1/mcp`, with a bearer token in the Authorization header,
the same token the rest of the API takes. It answers `initialize`, `tools/list` and `tools/call`, and the tool
catalogue is the spec: one tool per route, named for the route's id, with the route's models as the tool's request
and response schema. A tool call runs through the route it names with the calling token, so the scope that decides
the route decides the tool, and a call whose token cannot do the thing is refused as `forbidden` exactly as the
route is. `server/test/mcp.test.js` fails when a route has no tool or a tool has no route, and when a tool's scope
and its route's scope disagree.

The events the spec names are the webhook payloads. The OpenAPI document lists each under `webhooks` with the model
it carries, and the tool catalogue carries the same models, so a receiver and a tool read one shape. A hook delivers
that model encrypted, as the `jwe` field of a signed envelope; [the server guide](SERVER.md#hooks) has the format.

## What it deliberately does not expose

- Nothing the spec does not declare. A route with no row in `core/spec/api.json`, or a model with no shape, is on
  neither surface, because both are generated from the spec rather than hand written beside it.
- No route the token cannot reach. `tools/list` names every route so the surface is discoverable, but a call runs
  through the route and the token's scopes are enforced there, so a token that cannot send cannot send through a tool.
- Not the engine, the Mac's credentials, the token store or the server's state. Those are the server's own, reached by
  no route and so by no tool.
- Not the live event stream. The WebSocket at `/api/v1/events` is a stream, not a request and a response, so it is
  not a tool; the events reach a receiver as webhooks instead.
