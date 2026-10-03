// Theme import by URL: the server fetches the theme itself, so a client on a phone never has to reach the site the
// theme lives on, and converts it with the one converter the paste uses (core/app/rules/theme.js). Only http and
// https are fetched, the answer is bounded in time and size, and nothing is stored unless the converter found a theme,
// so a bad URL or a page that is not a theme is refused with the reason and leaves the server as it was.
//
// A tweakcn theme PAGE (the editor, /editor/theme?theme=<name>, or a shared theme, /themes/<id>) is an HTML page, not
// the theme. Its theme lives in tweakcn's registry on the same site (/r/themes/<name>.json), so a page URL is read from
// there; that is the link people copy from the browser, and the one Abi pasted (issue 132). The theme's type is
// fetched too (theme-fonts.js), so the theme's fonts draw rather than only being named.
import { importTheme, importSummary, addTheme } from '../../core/app/rules/theme.js';

export const THEME_FETCH_MS = 10000;
export const THEME_MAX_BYTES = 262144;

const refuse = (code, message, status = 400) => Object.assign(new Error(message), { status, code });

// The URL a request names, or the reason it cannot be fetched.
export function themeUrl(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw refuse('bad_url', 'A theme URL is required.');
  let url;
  try { url = new URL(raw.trim()); } catch { throw refuse('bad_url', 'That is not a URL.'); }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw refuse('bad_url', 'Only an http or https URL can be imported.');
  if (url.username || url.password) throw refuse('bad_url', 'A theme URL cannot carry a username or password.');
  return url;
}

// The registry URL a tweakcn theme page names, or null when the URL is not one. Matched by path rather than host, so a
// self-hosted tweakcn (and the smoke's loopback copy) is read the same way.
export function registryUrl(url) {
  const p = url.pathname.replace(/\/+$/, '');
  let id = null;
  if (p === '/editor/theme') id = url.searchParams.get('theme');
  else {
    const m = p.match(/^\/(?:editor\/theme|themes)\/([^/.]+)$/);
    if (m) id = m[1];
  }
  if (!id || !/^[A-Za-z0-9_-]{1,100}$/.test(id)) return null;
  return new URL('/r/themes/' + id + '.json', url.origin);
}

export const NOT_A_THEME = 'That URL is a web page, not a theme. Paste a tweakcn theme page (tweakcn.com/editor/theme?theme=<name>), its registry link (tweakcn.com/r/themes/<name>.json), or the theme\'s CSS.';

// Read the body, stopping at the bound rather than buffering whatever the far end sends.
async function boundedText(res, max) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw refuse('too_large', 'That URL answered with more than ' + Math.round(max / 1024) + ' KB, which is not a theme.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

export async function fetchThemeText(url, { fetchImpl = globalThis.fetch, timeoutMs = THEME_FETCH_MS, maxBytes = THEME_MAX_BYTES } = {}) {
  let res;
  try {
    res = await fetchImpl(url.href, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json, text/css, text/plain;q=0.9, */*;q=0.1' } });
  } catch (e) {
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw refuse('theme_unreachable', timedOut ? 'That URL did not answer within ' + timeoutMs / 1000 + ' seconds.' : 'That URL could not be reached.');
  }
  if (!res.ok) {
    await res.body?.cancel().catch(() => {});
    throw refuse('theme_unreachable', 'That URL answered ' + res.status + ', not a theme.');
  }
  // A web page is never a theme, however large it is; say what to paste instead rather than how big it was.
  if (/text\/html/i.test(res.headers?.get?.('content-type') || '')) {
    await res.body?.cancel().catch(() => {});
    throw refuse('bad_theme', NOT_A_THEME);
  }
  return boundedText(res, maxBytes);
}

// Fetch, convert and add one theme to the held list. Answers what was carried and refused, and the new list; throws
// with the reason, before anything is stored, when the URL or its content is not a theme.
// The theme's fonts are fetched last and never refuse the import: a font that cannot be fetched is named in the answer
// and the theme still lands, drawing that type in the fallback its stack names.
export async function importThemeFromUrl({ url: raw, name, held, fetchImpl, fonts = null }) {
  const url = themeUrl(raw);
  const source = registryUrl(url) || url;
  const text = await fetchThemeText(source, { fetchImpl });
  const result = importTheme(text, { name });
  const summary = importSummary(result);
  if (!summary.ok) throw refuse('bad_theme', /^\s*</.test(text) ? NOT_A_THEME : 'That URL is not a tweakcn theme: nothing in it is a value this app can carry.');
  const refused = [...new Set(result.refused)];
  const theme = { ...result.theme, url: url.href };
  let note = summary.text;
  if (fonts) {
    const got = await fonts.forTheme(theme);
    if (got.fonts.length) theme.fonts = got.fonts;
    for (const family of got.missing) refused.push('font ' + family + ' (not fetched)');
    if (got.missing.length) note += ' Fonts not fetched: ' + got.missing.join(', ') + '.';
  }
  const added = addTheme(held, theme);
  if (!added.ok) throw refuse('too_many_themes', added.reason, 409);
  return { theme: added.theme, themes: added.themes, accepted: result.accepted, refused, summary: note };
}
