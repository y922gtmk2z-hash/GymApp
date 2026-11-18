// Persistence: IndexedDB (one store, one document) with a localStorage fallback.

const DB_NAME = 'gym-pwa';
const STORE = 'kv';
const KEY = 'state';
const LS_KEY = 'gym-pwa-state';

let dbPromise = null;
let useLocal = false;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('indexedDB blocked'));
  });
  return dbPromise;
}

function idb(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    const req = fn(store);
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

export async function load() {
  try {
    const v = await idb('readonly', (s) => s.get(KEY));
    if (v !== undefined) return v;
    // Migrate from fallback if a previous session used it.
    const ls = localStorage.getItem(LS_KEY);
    return ls ? JSON.parse(ls) : null;
  } catch (e) {
    console.warn('IndexedDB unavailable, using localStorage', e);
    useLocal = true;
    try {
      const ls = localStorage.getItem(LS_KEY);
      return ls ? JSON.parse(ls) : null;
    } catch { return null; }
  }
}

export async function save(state) {
  if (!useLocal) {
    try {
      await idb('readwrite', (s) => s.put(state, KEY));
      return;
    } catch (e) {
      console.warn('IndexedDB write failed, falling back', e);
      useLocal = true;
    }
  }
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { console.error('Save failed', e); }
}

export function backend() {
  return useLocal ? 'localStorage' : 'IndexedDB';
}

export async function requestPersist() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    if (navigator.storage?.persist) return await navigator.storage.persist();
  } catch { /* ignore */ }
  return false;
}

export async function isPersisted() {
  try { return !!(await navigator.storage?.persisted?.()); } catch { return false; }
}
