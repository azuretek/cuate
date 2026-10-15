// Pure: our own typing state, as a client sees it (issue 230). The server relays one signed-in device's typing to
// the account's other signed-in devices; this holds what one of them should draw, and clears a stale one on its own
// so a dropped connection can never leave an indicator up.
//
// Only our own typing is real here. The other person typing is not drawn: the engine the server uses reports no
// inbound typing, so nothing is invented for it (issue 230, docs/READ-AND-TYPING.md).
export const TYPING_TTL_MS = 8000;
const ELLIPSIS = '\u2026';

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

// What the conversation header says, or nothing when there is no live typing. Our own other device names itself, so
// the line is never mistaken for the other person typing.
export function typingLabel(state, now) {
  if (!typingActive(state, now)) return '';
  return state.kind === 'contact' ? 'typing' + ELLIPSIS : "You're typing on another device";
}
