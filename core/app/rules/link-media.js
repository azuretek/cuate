// Pure: which shared links play in the app's own viewer, and the bounds the server resolves one within (issue 243).
//
// A shared video link (an Instagram reel, the example the issue names) is not something we hold: the app keeps only
// the link's still. Playing it means fetching and decoding media from someone else's site, which is a different kind
// of change with a different privacy surface than drawing a still we already stored (issue 238). The rule here is:
// the site is named once, the SERVER resolves the site's own media URL, fetches it within the bounds below and caches
// it with an expiry, and only then does the client play it in the viewer it already owns. The client never reaches
// the third party, and a message render never fetches anything: the viewer asks only when a person presses play.
//
// A link whose host is not listed is not playable: it stays the link card it is and opens in the reader's own
// browser, exactly as issue 238 left it. Nothing here does I/O or reads a clock.

// The sites whose shared video links play in the app. Instagram is first because it is the case the issue names: its
// media URLs are short lived and hotlink protected, so the server resolves the page's own video metadata on demand
// and holds the bytes for ttlMs rather than a client asking Instagram directly (resolve names how).
export const LINK_SITES = [
  { host: 'instagram.com', resolve: 'og-video', ttlMs: 21600000 },
];

// How the server bounds a resolution: how long the site may take to answer, how large a page it may send back, and
// how large the media it names may be. A site that answers with more is refused rather than trusted.
export const LINK_BOUNDS = { timeoutMs: 10000, maxPageBytes: 524288, maxMediaBytes: 26214400 };

// The host a URL names, lowercase, without a leading www or a port, or '' when it cannot be read. Read by hand rather
// than with the URL API, which the embedded engines a shell runs do not all carry.
export function hostOf(url) {
  const m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
  if (!m) return '';
  return m[1].replace(/^.*@/, '').replace(/:[0-9]+$/, '').toLowerCase().replace(/^www\./, '');
}

// The site rule a URL matches, by exact host or a subdomain of it, or null when the link is not one we play.
export function linkMediaSite(url) {
  const host = hostOf(url);
  if (!host) return null;
  return LINK_SITES.find((s) => host === s.host || host.endsWith('.' + s.host)) || null;
}

// Whether a shared link is one the app plays in its own viewer.
export function isPlayableLink(url) {
  return Boolean(linkMediaSite(url));
}

// A stable, filesystem-safe key for a link, so one URL is one cache entry. An FNV-1a hash over the URL, in hex: no
// path, no query and no host a person could read out of a filename.
export function linkMediaKey(url) {
  let h = 0x811c9dc5;
  const s = String(url || '');
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// The media URL a page's own metadata names for its video, or null. Open Graph is the one shape both the page and the
// embed carry, and the secure URL is preferred over the plain one. A value is read as property or name and must be an
// absolute http(s) URL, so a relative or non-http value is refused rather than guessed at.
export function parseOgVideo(html) {
  const text = String(html || '');
  // The quote characters are built from their codes rather than written: a literal quote in a regex literal defeats the
  // committed-bundle guard, which strips string literals by the same characters and would desync on it (issue 243).
  const dq = String.fromCharCode(34);
  const sq = String.fromCharCode(39);
  const q = '[' + dq + sq + ']';
  const grab = (prop) => {
    const tag = new RegExp('<meta[^>]+(?:property|name)=' + q + prop + q + '[^>]*>', 'i').exec(text);
    if (!tag) return null;
    const content = new RegExp('content=' + q + '([^' + dq + sq + ']*)' + q, 'i').exec(tag[0]);
    return content ? content[1].trim() : null;
  };
  for (const prop of ['og:video:secure_url', 'og:video:url', 'og:video']) {
    const value = grab(prop);
    if (value && /^https?:\/\//i.test(value)) return value;
  }
  return null;
}
