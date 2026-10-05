// Pure: what a conversation's own platform carries (issue 184). The service the engine reports on a chat decides what
// the app offers and how it sends it, so an action a platform cannot carry is refused in place rather than sent in a
// form the recipient cannot read. This is the engine-capability rule (issue 188) applied to a message platform: the
// platform names what it can do, and anything else fails visibly, never substituted and never sent where it cannot be
// read.
//
// The engine reports a chat's service in its own `service` field (openclaw/imsg docs/json.md, the field the adapter
// maps onto the chat's `service`); there is no guessing a platform from a handle. A service the app does not know is
// left unknown, and nothing is offered from a guess.

// The service mapped to the platform whose capabilities apply. The values are the engine's own, lowercased; the app
// writes no transport name of its own into what a reader reads (guards.test.js, issue 56). A service the adapter did
// not receive is the default it already writes (engine-imsg.js), so it reads as that same platform rather than as a
// guess; a service the app does not know is unknown, and nothing is offered from an unknown one.
export function platformOf(chat) {
  const s = String((chat && chat.service) || '').trim().toLowerCase();
  if (s === '' || s === 'imessage') return 'imessage';
  if (s === 'sms') return 'sms';
  if (s === 'rcs') return 'rcs';
  return 'unknown';
}

// What each platform carries natively:
//  - tapback: a reaction sent through the engine's own bridge, the path the message service's own conversations use
//  - fallback: the six classic reactions sent as the platform's own text phrase, which the other client reads back
//    as a reaction on the quoted message
//  - thread: a reply that stays in a thread
//  - emoji: any emoji as a reaction (only the bridge path, and only when the engine advertises the versioned
//    capability; the version gate lives in messages.js)
// A platform the app cannot name carries nothing and offers nothing.
export const PLATFORM_CAPABILITIES = {
  imessage: { tapback: true, fallback: false, thread: true, emoji: true },
  sms: { tapback: false, fallback: true, thread: false, emoji: false },
  rcs: { tapback: false, fallback: true, thread: false, emoji: false },
  unknown: { tapback: false, fallback: false, thread: false, emoji: false },
};

export function platformCapabilities(platform) {
  return PLATFORM_CAPABILITIES[platform] || PLATFORM_CAPABILITIES.unknown;
}

// Whether a reaction can be offered at all on this platform, in either form.
export function offersReaction(platform) {
  const c = platformCapabilities(platform);
  return Boolean(c.tapback || c.fallback);
}

// The six classic reactions as the phrase a platform without tapbacks exchanges; the other client reads the phrase
// back as a reaction on the quoted message. Another emoji has no phrase here, so that platform cannot carry it.
const PHRASES = [
  ['love', 'Loved'],
  ['like', 'Liked'],
  ['dislike', 'Disliked'],
  ['laugh', 'Laughed at'],
  ['emphasis', 'Emphasized'],
  ['question', 'Questioned'],
];

export function fallbackPhrase(type) {
  const hit = PHRASES.find(([t]) => t === type);
  return hit ? hit[1] : null;
}

const quoted = (text) => '"' + String(text == null ? '' : text) + '"';

// The text a platform without tapbacks sends for one of the six classic reactions, quoting the message it answers.
// Null for anything else, which that platform cannot carry, so the caller refuses rather than send it.
export function reactionFallbackText(type, original) {
  const phrase = fallbackPhrase(type);
  return phrase ? phrase + ' ' + quoted(original) : null;
}

// An incoming text-fallback reaction (issue 184): the six phrases, or the custom-emoji phrase
// `Reacted <emoji> to "<original>"`, either of which a client on another service sends as plain text. Returns
// { type, emoji, text } or null; `text` is the original message the fallback quotes, which is how it is attached.
const FALLBACK_RE = /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned) "([^"]*)"$/;
const REACTED_RE = /^Reacted (\S+) to "([^"]*)"$/;

export function parseReactionText(text) {
  const t = String(text == null ? '' : text).trim();
  const m = FALLBACK_RE.exec(t);
  if (m) {
    const hit = PHRASES.find(([, phrase]) => phrase === m[1]);
    return hit ? { type: hit[0], emoji: null, text: m[2] } : null;
  }
  const reacted = REACTED_RE.exec(t);
  return reacted ? { type: 'emoji', emoji: reacted[1], text: reacted[2] } : null;
}

// Fold the text-fallback reactions a client on another service sends into reactions on the messages they quote, so
// show as reactions rather than as new text, in history and live (issue 184). A fallback quotes the original's text;
// it attaches to the most recent loaded message carrying exactly that text, and replaces the reaction of the same
// person already on it, one per person. A fallback whose quote matches nothing loaded is left as the text it is,
// since guessing which message it meant would put a reaction on the wrong one. A platform that carries no fallback
// leaves the list untouched.
export function foldReactions(messages, platform) {
  const list = messages || [];
  if (!platformCapabilities(platform).fallback) return list;
  const out = [];
  const who = (m) => (m.fromMe ? 'me' : m.sender || '');
  for (const m of list) {
    const parsed = m.text ? parseReactionText(m.text) : null;
    if (parsed) {
      let target = null;
      for (let i = out.length - 1; i >= 0; i -= 1) {
        const x = out[i];
        if (x.text && String(x.text).trim() === parsed.text) { target = x; break; }
      }
      if (target) {
        const me = who(m);
        const reactions = (target.reactions || []).filter((r) => (r.fromMe ? 'me' : r.sender || '') !== me);
        reactions.push({ type: parsed.type, emoji: parsed.emoji, fromMe: m.fromMe, sender: m.fromMe ? null : m.sender || null });
        out[out.indexOf(target)] = { ...target, reactions };
        continue;
      }
    }
    out.push(m);
  }
  return out;
}

// What the reader is told when the reaction they chose is not one this platform carries: the honest limit, in the
// app's own notice style, in place. It names no transport of its own (issue 56), and never substitutes another
// reaction or sends nothing silently.
export function platformReactionUnsupported(platform) {
  if (platformCapabilities(platform).fallback) {
    return {
      message: 'This conversation carries the six classic reactions, not arbitrary emoji.',
      detail: 'Send one of the six classic reactions instead.',
    };
  }
  return {
    message: 'This conversation cannot carry a reaction.',
    detail: 'The message service for this conversation could not be determined.',
  };
}

// What the reader is told when a threaded reply is asked for on a platform with no threads: it is refused in place,
// and never sent as a threaded reply the recipient cannot read.
export function platformThreadUnsupported() {
  return {
    message: 'This conversation has no threads, so the reply was not sent as one.',
    detail: 'Answer with a message instead.',
  };
}
