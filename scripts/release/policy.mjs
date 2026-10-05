// Defense in depth: publication is only authorized by a main-branch release event,
// or by a release tag. A tag is created by release-please and the build is started
// for it with workflow_dispatch (a tag pushed with GITHUB_TOKEN raises no event),
// so both events are the release lane; a tag ref is allowed on either.
export function publicationAllowed(env = process.env) {
  const ref = env.GITHUB_REF || '';
  const event = env.GITHUB_EVENT_NAME || '';
  if (!['push', 'workflow_dispatch'].includes(event)) return false;
  return ref === 'refs/heads/main' || /^refs\/tags\/v\d+\.\d+\.\d+$/.test(ref);
}
export function assertPublicationAllowed(env = process.env) {
  if (!publicationAllowed(env)) throw new Error('Publication requires a push or manual dispatch on main, or a vX.Y.Z release tag');
}

