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
export function createTyping({ publish, ttlMs = 8000 }) {
  const active = new Map();
  const key = (chatId, from) => String(chatId) + ':' + String(from);
  const announce = (state, typing) => publish('typing', { chatId: String(state.chatId), from: String(state.from), kind: state.kind, typing }, typing ? String(state.from) : null);

  // Drop a state and, by default, tell the devices it is over. A device's stop is announced to everyone so no client
  // is left holding it; its own start is announced to every other device but the one that sent it.
  function release(state, { announce: say = true } = {}) {
    if (!state) return;
    clearTimeout(state.timer);
    active.delete(key(state.chatId, state.from));
    if (say) announce(state, false);
  }

  return {
    // A signed-in device says it is (or is no longer) typing in a conversation. The account's other devices hear it.
    relay({ chatId, from, typing }) {
      const k = key(chatId, from);
      const existing = active.get(k);
      if (existing) release(existing, { announce: false });
      if (!typing) {
        announce({ chatId, from, kind: 'device' }, false);
        return;
      }
      const state = { chatId: String(chatId), from: String(from), kind: 'device', timer: null };
      state.timer = setTimeout(() => release(state), ttlMs);
      state.timer.unref?.();
      active.set(k, state);
      announce(state, true);
    },
    // Inbound typing from the engine, when the switch is on. Present and, by default, off (issue 230).
    incoming({ chatId, typing }) {
      announce({ chatId, from: 'contact', kind: 'contact' }, Boolean(typing));
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
