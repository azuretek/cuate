// Pure: the links in a message's text (issue 311). A message is drawn as text with each web address in it a link the
// reader can open in the browser and copy from the message's menu. Only http and https addresses, and a bare www. one,
// which opens as https; anything else (a phone number, an email address, a custom scheme) stays text. Punctuation that
// ends the sentence a link sits in is not part of it, and neither is a closing bracket the link did not open.
const FIND = /\b(?:https?:\/\/|www\.)[^\s<>"]+/gi;
const TRAIL = /[.,;:!?'\u2019\u201d*_]+$/;

function trim(raw) {
  let s = raw;
  for (;;) {
    const before = s;
    s = s.replace(TRAIL, '');
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (s.endsWith(close) && s.split(open).length < s.split(close).length) s = s.slice(0, -1);
    }
    if (s === before) return s;
  }
}

export function linkHref(text) {
  const t = String(text || '');
  const href = /^www\./i.test(t) ? 'https://' + t : t;
  try {
    const u = new URL(href);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') ? u.href : null;
  } catch {
    return null;
  }
}

// The text in order as parts: { text } for plain text and { text, href } for a link, so a renderer draws each as it is.
export function splitLinks(text) {
  const s = String(text || '');
  const parts = [];
  let at = 0;
  for (const m of s.matchAll(FIND)) {
    const shown = trim(m[0]);
    const href = linkHref(shown);
    if (!href) continue;
    if (m.index > at) parts.push({ text: s.slice(at, m.index) });
    parts.push({ text: shown, href });
    at = m.index + shown.length;
  }
  if (at < s.length) parts.push({ text: s.slice(at) });
  return parts;
}

// Every link a message carries, in order and once each: those in its text, then its link card's own address.
export function messageLinks(m) {
  const out = [];
  for (const p of splitLinks(m && m.text)) if (p.href && !out.includes(p.href)) out.push(p.href);
  const card = m && m.link && linkHref(m.link.url);
  if (card && !out.includes(card)) out.push(card);
  return out;
}
