// One owner for what a token may do, read from core/spec/api.json, so the HTTP routes and the MCP tools allow
// exactly the same calls rather than each deciding for itself.
export function allows(apiSpec, principal, scope) {
  if (scope === 'any') return Boolean(principal);
  if (scope === 'none') return true;
  return Boolean(principal) && (apiSpec.scopes[principal.scope] || []).includes(scope);
}
