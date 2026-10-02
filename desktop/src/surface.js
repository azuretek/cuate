// The rendered surface, compared against the one spec every platform shares.
//
// The app takes every colour and length from the tokens, so the values a page
// RESOLVES are the design itself rather than a proxy for it. A change that reaches
// one platform or one scheme and not another shows up here as a token the page
// resolved to something the spec does not hold.
//
// Pure by design: the caller supplies what the spec expects and what the page
// resolved, so the comparison is a unit test rather than a live rendering that
// only appears in CI, and the smoke that uses it names the scheme and the token
// that broke instead of failing as one opaque boot.
const norm = (value) => String(value === undefined || value === null ? '' : value).trim().toLowerCase();

// Every token the page was asked for but did not resolve to the expected value.
// An absent token counts: a stylesheet that never loaded leaves the property empty.
export function tokenMismatches({ expected = {}, resolved = {} } = {}) {
  const bad = [];
  for (const [name, want] of Object.entries(expected)) {
    const got = resolved[name];
    if (got === undefined) bad.push({ name, expected: want, got: null });
    else if (norm(got) !== norm(want)) bad.push({ name, expected: want, got });
  }
  return bad;
}

// The colour tokens one scheme must resolve to, read from the spec so the check
// and the stylesheet cannot disagree about a value. Colour is the half that differs
// by scheme; the lengths do not.
export function expectedTokens(tokenSpec, scheme) {
  const colors = (tokenSpec && tokenSpec.color && tokenSpec.color[scheme]) || {};
  const out = {};
  for (const [key, value] of Object.entries(colors)) out['--color-' + key] = value;
  return out;
}
