// Persistence: IndexedDB (one store) with a localStorage fallback.
// Each person's state is its own document: `state:<userId>`. `meta` lists people and who is current.
// A legacy single `state` document (before multiple people) is adopted as the first person.

const DB_NAME = 'gym-pwa';
const STORE = 'kv';
const LEGACY_KEY = 'state';
const META_KEY = 'meta';
const LS_PREFIX = 'gym-pwa-';

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
    const req = fn(tx.objectStore(STORE));
    tx.oncomplete = () => resolve(req?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

const lsKey = (k) => LS_PREFIX + k;

async function get(key) {
  if (!useLocal) {
    try { return await idb('readonly', (s) => s.get(key)); } catch (e) { console.warn('IndexedDB unavailable, using localStorage', e); useLocal = true; }
  }
  try { const v = localStorage.getItem(lsKey(key)); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}

async function put(key, value) {
  if (!useLocal) {
    try { await idb('readwrite', (s) => s.put(value, key)); return; } catch (e) { console.warn('IndexedDB write failed, falling back', e); useLocal = true; }
  }
  try { localStorage.setItem(lsKey(key), JSON.stringify(value)); } catch (e) { console.error('Save failed', e); }
}

async function del(key) {
  if (!useLocal) { try { await idb('readwrite', (s) => s.delete(key)); return; } catch { useLocal = true; } }
  try { localStorage.removeItem(lsKey(key)); } catch { /* ignore */ }
}

let meta = null;

async function loadMeta() {
  if (meta) return meta;
  meta = (await get(META_KEY)) || null;
  if (!meta) {
    // Adopt a legacy single-person document (IndexedDB or the old localStorage key).
    let legacy = await get(LEGACY_KEY);
    if (!legacy) { try { const v = localStorage.getItem('gym-pwa-state'); legacy = v ? JSON.parse(v) : null; } catch { legacy = null; } }
    if (legacy?.user?.id) {
      await put(`state:${legacy.user.id}`, legacy);
      meta = { current: legacy.user.id, users: [{ id: legacy.user.id, name: legacy.user.name || '' }] };
      await put(META_KEY, meta);
    } else meta = { current: null, users: [] };
  }
  return meta;
}

/** Load the current person's state, or null on first launch. */
export async function load() {
  const m = await loadMeta();
  if (!m.current) return null;
  return (await get(`state:${m.current}`)) || null;
}

export async function loadUser(id) {
  return (await get(`state:${id}`)) || null;
}

/** Save a state document and keep the people list in step with its name. */
export async function save(state) {
  const m = await loadMeta();
  const id = state.user.id;
  const entry = m.users.find((u) => u.id === id);
  let metaChanged = false;
  if (!entry) { m.users.push({ id, name: state.user.name || '' }); metaChanged = true; }
  else if (entry.name !== (state.user.name || '')) { entry.name = state.user.name || ''; metaChanged = true; }
  if (m.current !== id) { m.current = id; metaChanged = true; }
  await put(`state:${id}`, state);
  if (metaChanged) await put(META_KEY, m);
}

export async function people() {
  const m = await loadMeta();
  return { current: m.current, users: [...m.users] };
}

export async function removeUser(id) {
  const m = await loadMeta();
  m.users = m.users.filter((u) => u.id !== id);
  if (m.current === id) m.current = m.users[0]?.id || null;
  await del(`state:${id}`);
  await put(META_KEY, m);
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
