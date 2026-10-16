// Pure: typing state, as a client sees it (issues 230 and 390). The server relays one signed-in device's typing to
// the account's other signed-in devices, and the other person's typing where the engine reports it; this holds what
// one client should draw, and clears a stale one on its own so a dropped connection can never leave an indicator up.
//
// The other person typing is drawn only where the engine reports it, which the server's typing.incoming switch gates
// (issue 230, docs/READ-AND-TYPING.md): nothing is invented for it.
export const TYPING_TTL_MS = 8000;

// Whether a typing state is still live at now. A state older than the ttl is stale, whatever last set it.
export function typingActive(state, now) {
  return Boolean(state) && Number.isFinite(state.at) && now - state.at < TYPING_TTL_MS;
}

// The state after one event, for the conversation the client is showing. An event for another conversation, or a
// stop, clears it; a start replaces it. Never turns one conversation's typing into another's.
export function applyTyping(state, event, { chatId, now }) {
  if (!event || String(event.chatId) !== String(chatId)) return typingActive(state, now) ? state : null;
  if (!event.typing) return null;
  return { chatId: String(chatId), kind: event.kind === 'contact' ? 'contact' : 'device', at: now };
}

// The quiet note the conversation header carries for our own other device typing, or nothing. The other person's
// typing is never a header line: it is the bubble at the foot of the conversation (typingBubble, issue 390), so the
// note can never be mistaken for the other person typing.
export function typingNote(state, now) {
  if (!typingActive(state, now) || state.kind !== 'device') return '';
  return "You're typing on another device";
}

// Whether the conversation draws the other person's typing bubble, three dots under the newest message (issue 390).
// Only live typing from the other person; our own other device never draws it.
export function typingBubble(state, now) {
  return typingActive(state, now) && state.kind === 'contact';
}

// What the bubble is called to assistive technology.
export const TYPING_BUBBLE_LABEL = 'typing';

// The keyframes one dot of the bubble pulses through, so the dots rise and brighten in turn, one after another, on one
// shared cycle (issue 390): dot index of count peaks at its own point in the cycle and rests dim the rest of it. lift is
// how far a dot rises, in CSS pixels, read by the caller from a spacing token. No delay is needed, so every dot starts
// together and stays in step however long the bubble is up.
export function typingPulse(index, count, lift) {
  const n = Math.max(1, count);
  const span = 0.6 / n;
  const peak = 0.2 + index * span;
  const rest = { opacity: 0.4, translate: '0px 0px' };
  return [
    { offset: 0, ...rest },
    { offset: Math.max(0, peak - span), ...rest },
    { offset: peak, opacity: 1, translate: '0px ' + -Math.abs(lift) + 'px' },
    { offset: Math.min(1, peak + span), ...rest },
    { offset: 1, ...rest },
  ];
}
