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
  if (!loaded) db.save(state);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist.flush();
  });
  addEventListener('pagehide', () => persist.flush());
  return state;
}

export function get() {
  return state;
}

/** Mutate state via a function, then persist and notify. */
export function commit(mutator, { silent = false } = {}) {
  const r = mutator(state);
  if (r && r !== state && typeof r === 'object' && 'version' in r) state = r;
  persist();
  if (!silent) for (const f of subs) f(state);
  return state;
}

/** Replace entire state (import). */
export function replace(next) {
  state = next;
  persist.flush();
  for (const f of subs) f(state);
}

export function subscribe(f) {
  subs.add(f);
  return () => subs.delete(f);
}

export function flush() {
  persist.flush();
}
