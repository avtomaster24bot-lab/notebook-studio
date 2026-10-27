// IndexedDB: блокноты, источники, заметки, медиа.
const DB = "notebook-studio", VER = 1;
let dbp;
function db() {
  if (!dbp) dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; for (const s of ["notebooks", "sources", "notes", "blobs"]) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, { keyPath: "id" }); };
    r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && "result" in out ? out.result : out); t.onerror = () => rej(t.error); });
}
export const put = (store, obj) => tx(store, "readwrite", (s) => s.put(obj));
export const del = (store, id) => tx(store, "readwrite", (s) => s.delete(id));
export const get = (store, id) => tx(store, "readonly", (s) => s.get(id));
export const all = (store) => tx(store, "readonly", (s) => s.getAll());
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
