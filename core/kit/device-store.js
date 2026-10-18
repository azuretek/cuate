// A small keyed store on the device over IndexedDB, which every shell's web view hosts (issue 441). It knows nothing of
// what it holds: each object store is named with its key path, every write is one transaction that lands whole or not
// at all, and a web view with no IndexedDB, or one that refuses it, answers null so the caller runs as it would with no
// store. indexedDB and the timers are injected, so the same code runs in every shell and in the tests.
const OPEN_MS = 3000;

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('The device store refused a read.'));
});

/**
 * @param {{ name: string, stores: Record<string, string>, version?: number, idb?: any, timers?: any, openMs?: number }} options
 */
export async function openDeviceStore({ name, stores, version = 1, idb = globalThis.indexedDB, timers = globalThis, openMs = OPEN_MS }) {
  if (!idb || typeof idb.open !== 'function') return null;
  let db;
  try {
    db = await new Promise((resolve, reject) => {
      const timer = timers.setTimeout(() => reject(new Error('The device store did not open.')), openMs);
      const request = idb.open(name, version);
      request.onupgradeneeded = () => {
        const d = request.result;
        // A layout change starts the store again: what it held was written for another layout.
        for (const old of Array.from(d.objectStoreNames || [])) d.deleteObjectStore(old);
        for (const [store, keyPath] of Object.entries(stores)) d.createObjectStore(store, { keyPath });
      };
      request.onsuccess = () => { timers.clearTimeout(timer); resolve(request.result); };
      request.onerror = () => { timers.clearTimeout(timer); reject(request.error || new Error('The device store refused to open.')); };
      request.onblocked = () => { timers.clearTimeout(timer); reject(new Error('The device store is held open elsewhere.')); };
    });
  } catch {
    return null;
  }
  // Another page that upgrades the store asks this one to let go.
  db.onversionchange = () => db.close();
  const range = (prefix) => globalThis.IDBKeyRange ? globalThis.IDBKeyRange.bound(prefix, prefix + '\uffff') : { lower: prefix, upper: prefix + '\uffff' };
  const read = (store, fn) => {
    const tx = db.transaction([store], 'readonly');
    return done(fn(tx.objectStore(store)));
  };
  return {
    get: (store, key) => read(store, (s) => s.get(key)),
    all: (store, { prefix = null } = {}) => read(store, (s) => (prefix === null ? s.getAll() : s.getAll(range(prefix)))),
    // Every op in one transaction: { store, put }, { store, del }, { store, delPrefix } or { store, clear: true }.
    write(ops) {
      const list = ops.filter(Boolean);
      if (!list.length) return Promise.resolve();
      return new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction([...new Set(list.map((o) => o.store))], 'readwrite');
          for (const o of list) {
            const s = tx.objectStore(o.store);
            if (o.clear) s.clear();
            else if (o.delPrefix !== undefined) s.delete(range(o.delPrefix));
            else if (o.del !== undefined) s.delete(o.del);
            else s.put(o.put);
          }
        } catch (e) {
          try { tx?.abort(); } catch { /* never began */ }
          reject(e);
          return;
        }
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error('The device store refused a write.'));
        tx.onabort = () => reject(tx.error || new Error('The device store dropped a write.'));
      });
    },
    clear() {
      return this.write(Object.keys(stores).map((store) => ({ store, clear: true })));
    },
    close() {
      try { db.close(); } catch { /* already closed */ }
    },
  };
}
