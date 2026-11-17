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

// A group is only as capable as its most limited member. The Mac's own message app gives a conversation one service, the one
// every member can receive (a group with anyone off the message service is a text conversation for all of them), and
// the engine reports that one service on the chat; where a member's own service is reported as well, the most limited
// of them decides, so nothing is offered that one member's phone cannot show. Most limited first.
const LIMITS = ['unknown', 'sms', 'rcs', 'imessage'];

export function conversationPlatform(chat) {
  let platform = platformOf(chat);
  const members = chat && Array.isArray(chat.members) ? chat.members : [];
  for (const m of members) {
    const service = m && typeof m.service === 'string' ? m.service.trim() : '';
    if (!service) continue;
    const p = platformOf({ service });
    if (LIMITS.indexOf(p) < LIMITS.indexOf(platform)) platform = p;
  }
  return platform;
}

// What each platform carries natively:
//  - tapback: a reaction sent through the engine's own bridge. The Mac then sends it the way that conversation's own
//    service carries one: a reaction on the message service, the classic text form on SMS (exactly the words an iPhone
//    sends there, which Google's Android app shows as a reaction), and a reaction on RCS, which the iPhone has carried to
//    Android as a reaction since iOS 18.1 (the sources are in docs/DESIGN.md, Platforms)
//  - fallback: the six classic reactions sent by the server as that same text when the bridge cannot be reached, which
//    only SMS takes, since on SMS the text is the reaction's own form; on RCS it would be a stray text
//  - fold: an incoming reaction that arrives as text (from Android, or from an iPhone over SMS) is folded onto the
//    message it names rather than drawn as a message
//  - thread: a reply that stays in a thread
//  - emoji: any emoji as a reaction (only the message service, and only when the engine advertises the versioned
//    capability; the choice is reactionChoices in messages.js)
//  - edit: changing a message after it was sent (issue 391), which only the message service carries; SMS and RCS
//    send no edit, so one made there would never reach the other person
// A platform the app cannot name carries nothing and offers nothing.
export const PLATFORM_CAPABILITIES = {
  imessage: { tapback: true, fallback: false, fold: false, thread: true, emoji: true, edit: true },
  sms: { tapback: true, fallback: true, fold: true, thread: false, emoji: false, edit: false },
  rcs: { tapback: true, fallback: false, fold: true, thread: false, emoji: false, edit: false },
  unknown: { tapback: false, fallback: false, fold: false, thread: false, emoji: false, edit: false },
};

export function platformCapabilities(platform) {
  return PLATFORM_CAPABILITIES[platform] || PLATFORM_CAPABILITIES.unknown;
}

// Whether a reaction can be offered at all on this platform, in either form.
export function offersReaction(platform) {
  const c = platformCapabilities(platform);
  return Boolean(c.tapback || c.fallback);
}

// The six classic reactions, each with its glyph, the verb the Mac writes for it, and the words it writes when one is
// taken back. These are the Mac's own summary words, the ones the engine's bridge builds a tapback's body from
// (openclaw/imsg Sources/IMsgHelper/ReactionHandlers.inc), so what the server sends as text is word for word what an
// iPhone sends on SMS, curly quotes included.
export const REACTION_GLYPHS = { love: '\u2764\ufe0f', like: '\ud83d\udc4d', dislike: '\ud83d\udc4e', laugh: '\ud83d\ude02', emphasis: '\u203c\ufe0f', question: '\u2753' };
const PHRASES = [
  { type: 'love', verb: 'Loved', removed: 'a heart' },
  { type: 'like', verb: 'Liked', removed: 'a like' },
  { type: 'dislike', verb: 'Disliked', removed: 'a dislike' },
  { type: 'laugh', verb: 'Laughed at', removed: 'a laugh' },
  { type: 'emphasis', verb: 'Emphasized', removed: 'an exclamation' },
  { type: 'question', verb: 'Questioned', removed: 'a question mark' },
];
const OPEN = '\u201c';
const CLOSE = '\u201d';

export function fallbackPhrase(type) {
  const hit = PHRASES.find((p) => p.type === type);
  return hit ? hit.verb : null;
}

// The text an SMS conversation carries for one of the six classic reactions, quoting the message it answers in curly
// quotes, or naming "a message" when that message has no words; taking one back is the Mac's own removal sentence.
// Null for anything else, which that platform cannot carry, so the caller refuses rather than send it.
export function reactionFallbackText(type, original, { remove = false } = {}) {
  const hit = PHRASES.find((p) => p.type === type);
  if (!hit) return null;
  const words = String(original == null ? '' : original);
  const target = words.trim() ? OPEN + words + CLOSE : 'a message';
  return remove ? 'Removed ' + hit.removed + ' from ' + target : hit.verb + ' ' + target;
}

// An incoming reaction that arrived as text (issues 184 and 533): what an iPhone sends on SMS and what Google's Android app
// sends from Android. Every shape here is cited in docs/DESIGN.md, Platforms, and held by a fixture in
// core/test/platform.test.js:
//  - the six verbs quoting the message: Liked "...", Loved "...", Laughed at "...", Emphasized "...", Questioned "...",
//    Disliked "..."
//  - any emoji: Reacted <emoji> to "..."
//  - a removal: Removed a like from "..." (a heart, a dislike, a laugh, an exclamation, a question mark), or
//    Removed <emoji> from "..."
//  - the quote in curly or straight quotes, either side, and cut short with an ellipsis (... or the one character)
//  - a message with no words named by what it is: an image, a video, a movie, an audio message, a sticker, an
//    attachment, or a message
// Returns { type, emoji, remove, text, truncated, noun } or null. text is the quoted words (null when the message is
// named by a noun instead), truncated says the quote was cut short, and noun is what the message with no words was.
const NOUNS = { 'an image': 'image', 'a photo': 'image', 'a video': 'video', 'a movie': 'video', 'an audio message': 'audio', 'a sticker': 'sticker', 'an attachment': 'attachment', 'a message': 'message' };
const VERB_RE = /^(Loved|Liked|Disliked|Laughed at|Emphasized|Questioned) ([\s\S]+)$/;
const REACTED_RE = /^Reacted (\S+) to ([\s\S]+)$/u;
const REMOVED_RE = /^Removed (a heart|a like|a dislike|a laugh|an exclamation|a question mark) from ([\s\S]+)$/;
const REMOVED_EMOJI_RE = /^Removed (\S+) from ([\s\S]+)$/u;
const QUOTE_RE = /^["\u201c]([\s\S]*)["\u201d]$/;
const ELLIPSIS_RE = /(?:\u2026|\.\.\.)$/;
const PICTURE_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u;

function reactionTarget(rest) {
  const q = QUOTE_RE.exec(rest);
  if (q) {
    const cut = ELLIPSIS_RE.exec(q[1]);
    const text = cut ? q[1].slice(0, -cut[0].length) : q[1];
    if (!text.trim()) return { text: null, truncated: false, noun: 'message' };
    return { text, truncated: Boolean(cut), noun: null };
  }
  const noun = NOUNS[rest];
  return noun ? { text: null, truncated: false, noun } : null;
}

export function parseReactionText(text) {
  const t = String(text == null ? '' : text).trim();
  const make = (type, emoji, remove, rest) => {
    const target = reactionTarget(rest);
    return target ? { type, emoji, remove, ...target } : null;
  };
  let m = VERB_RE.exec(t);
  if (m) return make(PHRASES.find((p) => p.verb === m[1]).type, null, false, m[2]);
  m = REACTED_RE.exec(t);
  if (m) return PICTURE_RE.test(m[1]) ? make('emoji', m[1], false, m[2]) : null;
  m = REMOVED_RE.exec(t);
  if (m) return make(PHRASES.find((p) => p.removed === m[1]).type, null, true, m[2]);
  m = REMOVED_EMOJI_RE.exec(t);
  if (m) return PICTURE_RE.test(m[1]) ? make('emoji', m[1], true, m[2]) : null;
  return null;
}

const squash = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
const bare = (s) => String(s || '').replace(/\ufe0f/g, '');
const who = (m) => (m.fromMe ? 'me' : m.sender || '');

// Whether a loaded message is the one a reaction names: the same words (a quote cut short matches the start of
// them), or, for one named by a noun, the latest message carrying that kind of file, or with no words at all.
function namedBy(x, parsed) {
  if (!x || x.event) return false;
  const files = Array.isArray(x.attachments) ? x.attachments : [];
  if (parsed.text != null) {
    const have = squash(x.text);
    const want = squash(parsed.text);
    return Boolean(have) && (have === want || (parsed.truncated && have.startsWith(want)));
  }
  const mime = (a) => String((a && a.mime) || '');
  if (parsed.noun === 'image') return files.some((a) => mime(a).startsWith('image/') && !a.sticker);
  if (parsed.noun === 'video') return files.some((a) => mime(a).startsWith('video/'));
  if (parsed.noun === 'audio') return files.some((a) => mime(a).startsWith('audio/'));
  if (parsed.noun === 'sticker') return files.some((a) => a && a.sticker);
  if (parsed.noun === 'attachment') return files.length > 0;
  return !squash(x.text);
}

// The words an unmatched reaction is drawn with, and the event that carries them: a quiet line naming who reacted, with
// what, and to what, so it never reads as a message the person typed.
function reactionLine(m, parsed) {
  const emoji = parsed.emoji || REACTION_GLYPHS[parsed.type] || '';
  return { ...m, text: '', attachments: [], link: null, reactions: [], event: { kind: 'reaction', emoji, remove: parsed.remove, quote: parsed.text, truncated: parsed.truncated, noun: parsed.noun } };
}

// Fold the reactions that arrive as text into reactions on the messages they name, in history and live (issue 184),
// so they show as a reaction chip and never as a stray message. A reaction attaches to the most recent loaded message
// it names and replaces the reaction the same person already has on it, one per person; a removal takes that
// person's matching reaction off. One that names nothing loaded is drawn as a quiet line saying who reacted, with
// what, and to what, rather than as the raw text, since guessing which message it meant would put a reaction on the
// wrong one. A platform whose reactions never arrive as text leaves the list untouched.
export function foldReactions(messages, platform) {
  const list = messages || [];
  if (!platformCapabilities(platform).fold) return list;
  const out = [];
  for (const m of list) {
    const files = m && Array.isArray(m.attachments) ? m.attachments : [];
    const parsed = m && !m.event && m.text && !files.length ? parseReactionText(m.text) : null;
    if (!parsed) {
      out.push(m);
      continue;
    }
    let at = -1;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      if (namedBy(out[i], parsed)) { at = i; break; }
    }
    if (at < 0) {
      out.push(reactionLine(m, parsed));
      continue;
    }
    const target = out[at];
    const me = who(m);
    const same = (r) => (parsed.type === 'emoji' ? bare(r.emoji) === bare(parsed.emoji) : r.type === parsed.type && !r.emoji);
    let reactions = Array.isArray(target.reactions) ? target.reactions : [];
    if (parsed.remove) reactions = reactions.filter((r) => !(who(r) === me && same(r)));
    else reactions = [...reactions.filter((r) => who(r) !== me), { type: parsed.type, emoji: parsed.emoji, fromMe: Boolean(m.fromMe), sender: m.fromMe ? null : m.sender || null }];
    out[at] = { ...target, reactions };
  }
  return out;
}

// What the reader is told when the reaction they chose is not one this platform carries: the honest limit, in the
// app's own notice style, in place. It names no transport of its own (issue 56), and never substitutes another
// reaction or sends nothing silently. The menu offers only what the conversation carries (reactionChoices), so this is
// what a request made around it hears.
export function platformReactionUnsupported(platform) {
  if (offersReaction(platform)) {
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

// Who is on the other end, and whether what we send is end-to-end encrypted (2026-10-12 and 2026-10-14). Every message
// we send is one colour whatever the platform (the quiet bubble since issue 459); the difference is told instead: an icon
// beside the name for a conversation on Apple devices, which explains itself on hover, a plain explanation on the name
// otherwise, and a small lock beside the time in a message's menu. A platform the app does not know says nothing.
export function serviceNote(chat) {
  const platform = platformOf(chat);
  const group = Boolean(chat && chat.isGroup);
  if (platform === 'imessage') {
    return { encrypted: true, apple: true, label: (group ? 'Everyone here is on Apple devices.' : 'On Apple devices.') + ' Your messages here are end-to-end encrypted.' };
  }
  if (platform === 'sms' || platform === 'rcs') {
    return { encrypted: false, apple: false, label: (group ? 'Not everyone here is on Apple devices.' : 'Not on Apple devices.') + ' Your messages here go as text messages and are not end-to-end encrypted.' };
  }
  return null;
}
