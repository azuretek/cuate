const { nativeStreamOpen, nativeStreamWrite, nativeStreamClose } = globalThis;
let next = 10000;
module.exports = function transport({ database, fixture = false } = {}) {
  const id = next++;
  const lines = new Set(), exits = new Set();
  let ended = false, closing = false, cancelled = false, result;
  const done = new Promise(resolve => { result = resolve; });
  if (!nativeStreamOpen(id, database || '', fixture, line => {
    if (!ended && !cancelled) for (const cb of lines) cb(line);
  }, code => {
    ended = true;
    for (const cb of exits) cb({ code, signal: null });
    result({ code });
  })) throw new Error('native stream admission refused');
  return {
    id, done, methods: [],
    onLine(cb) { lines.add(cb); return () => lines.delete(cb); },
    onExit(cb) { exits.add(cb); return () => exits.delete(cb); },
    write(line) {
      if (ended || closing) throw Object.assign(new Error('native stream closed'), { code: 'engine_exit' });
      try { this.methods.push(JSON.parse(line).method); } catch { /* native validates admission */ }
      const code = nativeStreamWrite(id, line);
      if (code) {
        closing = true; nativeStreamClose(id, true);
        throw Object.assign(new Error('native stream admission refused: ' + code), { code: 'native_admission' });
      }
    },
    close(cancel = false) {
      if (!ended) { closing = true; cancelled ||= cancel; nativeStreamClose(id, cancel); }
      return done;
    },
  };
};
