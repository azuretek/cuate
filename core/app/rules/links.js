// Pure: the links in a message's text (issue 311). A message is drawn as text with each web address in it a link the
// reader can open in the browser and copy from the message's menu. Only http and https addresses, and a bare www. one,
// which opens as https; anything else (a phone number, an email address, a custom scheme) stays text. Punctuation that
// ends the sentence a link sits in is not part of it, and neither is a closing bracket the link did not open.
import { TEXT_EFFECTS, TEXT_FORMATS } from './text-styles.js';

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

/**
 * A message's text cut into the pieces a bubble draws, in order: each piece is a stretch with one link (or none), one
 * effect (or none), one mention (or none, issue 453) and the formats laid on it (issue 447), so a link inside an effect or bold words, or a style across
 * part of a link, all draw. Joined, the pieces' text is the message's text exactly.
 * @param {string} text
 * @param {{ start: number, length: number, effect?: string, bold?: boolean, italic?: boolean, underline?: boolean, strikethrough?: boolean }[]} [styles]
 * @returns {{ text: string, href?: string, effect?: string, bold?: true, italic?: true, underline?: true, strikethrough?: true }[]}
 */
export function styledParts(text, styles = []) {
  const s = String(text || '');
  const links = [];
  let at = 0;
  for (const p of splitLinks(s)) {
    if (p.href) links.push({ start: at, end: at + p.text.length, href: p.href });
    at += p.text.length;
  }
  const laid = (Array.isArray(styles) ? styles : [])
    .filter((x) => x && x.length > 0 && x.start >= 0 && x.start + x.length <= s.length)
    .map((x) => ({ start: x.start, end: x.start + x.length, effect: TEXT_EFFECTS.includes(x.effect) ? x.effect : null, formats: TEXT_FORMATS.filter((f) => x[f] === true), mention: typeof x.mention === 'string' && x.mention ? x.mention : null }))
    .filter((x) => x.effect || x.formats.length || x.mention);
  const cuts = new Set([0, s.length]);
  for (const r of [...links, ...laid]) { cuts.add(r.start); cuts.add(r.end); }
  const points = [...cuts].sort((a, b) => a - b);
  const parts = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const from = points[i];
    const to = points[i + 1];
    if (to <= from) continue;
    const link = links.find((r) => r.start <= from && to <= r.end);
    const over = laid.filter((r) => r.start <= from && to <= r.end);
    const effect = over.find((r) => r.effect);
    const part = { text: s.slice(from, to) };
    if (link) part.href = link.href;
    if (effect) part.effect = effect.effect;
    // The person a mention stands for (issue 453).
    const mention = over.find((r) => r.mention);
    if (mention) part.mention = mention.mention;
    for (const f of TEXT_FORMATS) if (over.some((r) => r.formats.includes(f))) part[f] = true;
    const prev = parts[parts.length - 1];
    if (prev && prev.href === part.href && prev.effect === part.effect && prev.mention === part.mention && TEXT_FORMATS.every((f) => prev[f] === part[f])) prev.text += part.text;
    else parts.push(part);
  }
  return parts;
}
