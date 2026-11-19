// In-memory state with subscribers and debounced persistence.
import * as db from './db.js';
import { defaults, migrate, validate } from './schema.js';
import { debounce } from './util.js';

let state = null;
const subs = new Set();

const persist = debounce(() => db.save(state), 300);

export async function init() {
  let loaded = await db.load();
  if (loaded) {
    try {
      loaded = migrate(loaded);
      const errs = validate(loaded);
      if (errs.length) console.warn('Stored state has issues', errs);
    } catch (e) {
      console.error('Migration failed; starting fresh but keeping a copy', e);
      try { localStorage.setItem('gym-pwa-broken-' + Date.now(), JSON.stringify(loaded)); } catch { /* ignore */ }
      loaded = null;
    }
  }
  state = loaded || defaults();
  readJournal();
  if (!loaded) db.save(state);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist.flush();
  });
  addEventListener('pagehide', () => persist.flush());
  return state;
}

// The in-progress workout is also journalled synchronously to localStorage, because an
// IndexedDB write can still be in flight when iOS closes the app.
const JOURNAL = 'gym-pwa-active';

function writeJournal() {
  try { localStorage.setItem(JOURNAL, JSON.stringify({ uid: state.user.id, activeWorkout: state.activeWorkout, timer: state.timer })); } catch { /* ignore */ }
}

function readJournal() {
  try {
    const j = JSON.parse(localStorage.getItem(JOURNAL) || 'null');
    if (j && j.uid === state.user.id) { state.activeWorkout = j.activeWorkout ?? null; state.timer = j.timer ?? null; }
  } catch { /* ignore */ }
}

export function get() {
  return state;
}

/** Mutate state via a function, then persist and notify. */
export function commit(mutator, { silent = false, flush = false } = {}) {
  const r = mutator(state);
  if (r && r !== state && typeof r === 'object' && 'version' in r) state = r;
  if (flush) { writeJournal(); persist.flush(); } else persist();
  if (!silent) for (const f of subs) f(state);
  return state;
}

/** Replace the current person's entire state (import, sample data, erase). Keeps their identity. */
export function replace(next) {
  next.user = { ...next.user, id: state.user.id };
  state = next;
  writeJournal();
  persist.flush();
  for (const f of subs) f(state);
}

// ---------- People ----------

export const people = () => db.people();

/** Switch to another person's data. */
export async function switchUser(id) {
  persist.flush();
  await db.save(state);
  let next = await db.loadUser(id);
  if (!next) throw new Error('That person has no data');
  next = migrate(next);
  state = next;
  writeJournal();
  await db.save(state); // marks them current
  for (const f of subs) f(state);
}

/** Add a person with fresh data and switch to them. */
export async function addPerson(name) {
  persist.flush();
  await db.save(state);
  const fresh = defaults();
  fresh.user.name = name;
  state = fresh;
  writeJournal();
  await db.save(state);
  for (const f of subs) f(state);
}

export async function deletePerson(id) {
  if (id === state.user.id) throw new Error('Switch to someone else first');
  await db.removeUser(id);
  await db.save(state);
}

export function subscribe(f) {
  subs.add(f);
  return () => subs.delete(f);
}

export function flush() {
  persist.flush();
}
