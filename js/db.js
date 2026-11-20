// Minimal IndexedDB wrapper. Store list is duplicated in sw.js (keep in sync).
const DB_NAME = 'neonwave';
const DB_VERSION = 1;
const STORES = {
  tracks: { keyPath: 'id' },
  blobs: { keyPath: 'id' },        // { id: 'audio:<trackId>' | 'art:<trackId>' | 'pimg:<playlistId>', blob }
  playlists: { keyPath: 'id' },
  history: { keyPath: 'id', autoIncrement: true },
  lyrics: { keyPath: 'id' },
  kv: { keyPath: 'key' },
};

let dbPromise;
export function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, opts] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, opts);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { db.close(); dbPromise = undefined; };
      resolve(db);
    };
    req.onerror = () => { dbPromise = undefined; reject(req.error); };
    req.onblocked = () => reject(new Error('Base de données bloquée par un autre onglet'));
  });
  return dbPromise;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction annulée'));
  });
}

export const get = (store, key) => tx(store, 'readonly', (s) => s.get(key));
export const all = (store) => tx(store, 'readonly', (s) => s.getAll());
export const put = (store, value) => tx(store, 'readwrite', (s) => s.put(value));
export const del = (store, key) => tx(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => tx(store, 'readwrite', (s) => s.clear());

export async function getKV(key, fallback) {
  const row = await get('kv', key);
  return row === undefined ? fallback : row.value;
}
export const setKV = (key, value) => put('kv', { key, value });

// Some WebKit builds refuse Blob values in IndexedDB; fall back to { buf, type } (read back as a Blob).
export async function getBlob(id) {
  const row = await get('blobs', id);
  if (!row) return null;
  return row.blob ?? (row.buf ? new Blob([row.buf], { type: row.type || '' }) : null);
}
export async function putBlob(id, blob) {
  try {
    await put('blobs', { id, blob });
  } catch (e) {
    if (e?.name === 'QuotaExceededError') throw e;
    await put('blobs', { id, buf: await blob.arrayBuffer(), type: blob.type });
  }
}
