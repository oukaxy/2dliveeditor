/** Pembungkus kecil IndexedDB untuk autosave. Semua fungsi mengembalikan Promise dan bisa reject (mis. mode privat). */
const DB = 'l2d-motion-editor', ST = 'projects';
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(ST);
  r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
});
async function tx(mode, fn) {
  const db = await open();
  try { return await new Promise((res, rej) => { const t = db.transaction(ST, mode), rq = fn(t.objectStore(ST)); t.oncomplete = () => res(rq.result); t.onerror = t.onabort = () => rej(t.error); }); }
  finally { db.close(); }
}
export const saveAuto = (key, value) => tx('readwrite', s => s.put(value, key));
export const loadAuto = key => tx('readonly', s => s.get(key));
export const clearAuto = key => tx('readwrite', s => s.delete(key));
