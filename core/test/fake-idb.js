// An IndexedDB stand-in for the tests (issue 441): enough of the API for core/kit/device-store.js, with the parts that
// matter to it kept honest. A transaction's writes land together when it completes and none of them land when it fails
// or aborts; values are cloned in and out, as the real store clones them; and the data outlives a close, so a test can
// open the same store again the way a relaunched app does. refuse makes open fail, as a web view that refuses storage
// does, and failNextWrite makes the next transaction fail after its requests have run.
export function createFakeIdb({ refuse = false } = {}) {
  const dbs = new Map();
  const later = (fn) => setTimeout(fn, 0);
  const inRange = (key, q) => (q && typeof q === 'object' ? key >= q.lower && key <= q.upper : key === q);
  const factory = {
    failNextWrite: false,
    opened: 0,
    dump: (name) => dbs.get(name),
    open(name, version = 1) {
      const request = { result: null, error: null };
      later(() => {
        if (refuse) { request.error = new Error('refused'); request.onerror?.(); return; }
        factory.opened += 1;
        let rec = dbs.get(name);
        const upgrade = !rec || rec.version < version;
        if (!rec) { rec = { version, stores: new Map() }; dbs.set(name, rec); }
        const db = handle(rec);
        request.result = db;
        if (upgrade) { rec.version = version; request.onupgradeneeded?.(); }
        request.onsuccess?.();
      });
      return request;
    },
  };
  function handle(rec) {
    let closed = false;
    return {
      get objectStoreNames() { return [...rec.stores.keys()]; },
      createObjectStore(name, { keyPath }) { rec.stores.set(name, { keyPath, rows: new Map() }); },
      deleteObjectStore(name) { rec.stores.delete(name); },
      close() { closed = true; },
      transaction(names, mode) {
        if (closed) throw new Error('closed');
        const staged = new Map(names.map((n) => [n, new Map(rec.stores.get(n).rows)]));
        let aborted = false;
        let pending = 0;
        const tx = {
          error: null,
          abort() { aborted = true; later(() => tx.onabort?.()); },
          objectStore(n) {
            const meta = rec.stores.get(n);
            const rows = staged.get(n);
            const req = (fn) => {
              const r = { result: undefined };
              pending += 1;
              later(() => { r.result = fn(); r.onsuccess?.(); pending -= 1; settle(); });
              return r;
            };
            const write = (fn) => { if (mode !== 'readwrite') throw new Error('readonly'); return req(fn); };
            return {
              get: (key) => req(() => (rows.has(key) ? structuredClone(rows.get(key)) : undefined)),
              getAll: (q) => req(() => [...rows.entries()].filter(([k]) => q === undefined || inRange(k, q)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => structuredClone(v))),
              put: (value) => write(() => { rows.set(value[meta.keyPath], structuredClone(value)); }),
              delete: (q) => write(() => { for (const k of [...rows.keys()]) if (inRange(k, q)) rows.delete(k); }),
              clear: () => write(() => rows.clear()),
            };
          },
        };
        function settle() {
          if (pending || aborted) return;
          later(() => {
            if (pending || aborted) return;
            if (mode === 'readwrite' && factory.failNextWrite) {
              factory.failNextWrite = false;
              tx.error = new Error('write failed');
              tx.onerror?.();
              return;
            }
            if (mode === 'readwrite') for (const [n, rows] of staged) rec.stores.get(n).rows = rows;
            tx.oncomplete?.();
          });
        }
        later(settle);
        return tx;
      },
    };
  }
  return factory;
}
