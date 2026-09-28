// JSON-RPC 2.0 over a line transport (imsg rpc's stdio, or the fake engine in process).
export function createRpc({ transport, timeoutMs = 30000 }) {
  let nextId = 1;
  const pending = new Map();
  const handlers = new Set();
  transport.onLine((line) => {
    let msg;
    try { msg = JSON.parse(line); } catch { return; }
    if (msg && msg.id !== undefined && msg.id !== null && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(Object.assign(new Error(msg.error.message || 'engine error'), { code: msg.error.code, data: msg.error.data }));
      else p.resolve(msg.result);
      return;
    }
    if (msg && typeof msg.method === 'string') for (const cb of handlers) cb(msg.method, msg.params || {});
  });
  transport.onExit(() => {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(Object.assign(new Error('engine exited'), { code: 'engine_exit' }));
    }
    pending.clear();
  });
  return {
    request(method, params, ms = timeoutMs) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(Object.assign(new Error('engine timed out on ' + method), { code: 'timeout' }));
        }, ms);
        pending.set(id, { resolve, reject, timer });
        transport.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }));
      });
    },
    onNotification(cb) {
      handlers.add(cb);
      return () => handlers.delete(cb);
    },
  };
}
