// Our own typing state, relayed between the account's signed-in devices (issue 230).
//
// Typing is not a message and never enters history: the server holds it in memory with a short expiry and tells the
// account's other devices over the event stream. A device that goes away without saying stop is cleared when its last
// socket closes or the expiry fires, so a dropped connection cannot leave an indicator stuck.
//
// The other person typing is NOT invented here. imsg reports inbound typing only through an injected v2 bridge
// (bridge.events.subscribe, "started-typing"/"stopped-typing"); the ordinary database watch supplies none and the
// Messages database holds no typing state. That path is off behind config.typing.incoming and only the engine, when
// that switch is on and a bridge is already running, can feed it.
//
// Our typing also reaches the other person (issue 319): outbound, when given, is told a conversation started or
// stopped having one of our devices typing in it, and the server hands that to the engine (imsg's `typing`, which shows
// the indicator on their side). It is told once per conversation, not per device, and refreshed while the typing
// lasts, so the indicator never outlives the last device that was typing there.
export const TYPING_REFRESH_MS = 20000;
export function createTyping({ publish, ttlMs = 8000, outbound = null, refreshMs = TYPING_REFRESH_MS, now = () => Date.now(), log = null }) {
  const active = new Map();
  const key = (chatId, from) => String(chatId) + ':' + String(from);
  const told = new Map();
  const typingIn = (chatId) => [...active.values()].some((s) => s.chatId === String(chatId) && s.kind === 'device');
  const tell = (chatId, on) => {
    if (typeof outbound !== 'function') return;
    const id = String(chatId);
    if (on) {
      const at = told.get(id);
      if (at !== undefined && now() - at < refreshMs) return;
      told.set(id, now());
    } else {
      if (!told.has(id) || typingIn(id)) return;
      told.delete(id);
    }
    // Each hand-off to the engine is logged with its outcome (Abi, 2026-10-14), so our side of the indicator can be
    // checked from the log rather than only from the other person's screen.
    const said = (ok, error) => { if (log) log.emit('typing.outgoing', error ? { chat: id, typing: on, ok, error } : { chat: id, typing: on, ok }); };
    try { Promise.resolve(outbound(id, on)).then(() => said(true), (e) => said(false, (e && e.message) || 'refused')); } catch (e) { said(false, (e && e.message) || 'refused'); }
  };
  const announce = (state, typing) => publish('typing', { chatId: String(state.chatId), from: String(state.from), kind: state.kind, typing }, typing ? String(state.from) : null);

  // Drop a state and, by default, tell the devices it is over. A device's stop is announced to everyone so no client
  // is left holding it; its own start is announced to every other device but the one that sent it.
  function release(state, { announce: say = true, renew = false } = {}) {
    if (!state) return;
    clearTimeout(state.timer);
    active.delete(key(state.chatId, state.from));
    if (say) announce(state, false);
    if (state.kind === 'device' && !renew) tell(state.chatId, false);
  }

  return {
    // A signed-in device says it is (or is no longer) typing in a conversation. The account's other devices hear it.
    relay({ chatId, from, typing }) {
      const k = key(chatId, from);
      const existing = active.get(k);
      if (existing) release(existing, { announce: false, renew: Boolean(typing) });
      if (!typing) {
        announce({ chatId, from, kind: 'device' }, false);
        tell(chatId, false);
        return;
      }
      const state = { chatId: String(chatId), from: String(from), kind: 'device', timer: null };
      state.timer = setTimeout(() => release(state), ttlMs);
      state.timer.unref?.();
      active.set(k, state);
      announce(state, true);
      tell(chatId, true);
    },
    // Inbound typing from the engine, when the switch is on. Present and, by default, off (issue 230).
    incoming({ chatId, typing }) {
      announce({ chatId, from: 'contact', kind: 'contact' }, Boolean(typing));
      if (log) log.emit('typing.incoming', { chat: String(chatId), typing: Boolean(typing), resolved: true, published: true });
    },
    // Every conversation a device was typing in, when its last socket closes.
    stopFrom(from) {
      for (const state of [...active.values()]) if (String(state.from) === String(from)) release(state);
    },
    stopAll() {
      for (const state of [...active.values()]) release(state, { announce: false });
    },
    size: () => active.size,
  };
}
