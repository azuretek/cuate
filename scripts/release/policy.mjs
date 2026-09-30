// Defense in depth: publication is only authorized by a main-branch release event.
export function publicationAllowed(env = process.env) {
  return env.GITHUB_REF === 'refs/heads/main' && ['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME);
}
export function assertPublicationAllowed(env = process.env) {
  if (!publicationAllowed(env)) throw new Error('Publication requires a push or manual dispatch on main');
}
