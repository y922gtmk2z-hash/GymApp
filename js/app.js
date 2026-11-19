// App boot: store, router, tab bar, theme, service worker.
import * as store from './store.js';
import { requestPersist } from './db.js';
import { h, clear, toast } from './ui.js';
import * as today from './views/today.js';
import * as plan from './views/plan.js';
import * as progress from './views/progress.js';
import * as more from './views/more.js';
import * as workout from './views/workout.js';

const VIEWS = { today, plan, progress, more };
const viewEl = document.getElementById('view');
const titleEl = document.getElementById('title');
const actionsEl = document.getElementById('topbar-actions');

let current = null;

export function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'today';
  const [name, ...rest] = hash.split('/');
  return { name: VIEWS[name] ? name : 'today', params: rest };
}

export function navigate(path) {
  if (location.hash !== '#/' + path) location.hash = '#/' + path;
  else render();
}

function render({ keepScroll = false } = {}) {
  const r = route();
  const y = window.scrollY;
  const changed = !current || current.name !== r.name || current.params.join('/') !== r.params.join('/');
  current = r;
  for (const a of document.querySelectorAll('.tabbar a')) {
    if (a.dataset.tab === r.name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  clear(viewEl);
  clear(actionsEl);
  const ctx = {
    state: store.get(),
    params: r.params,
    commit: store.commit,
    navigate,
    setTitle: (t) => { titleEl.textContent = t; document.title = t === 'Gym' ? 'Gym' : `${t} · Gym`; },
    setActions: (...nodes) => { clear(actionsEl); actionsEl.append(...nodes.filter(Boolean)); },
    rerender: () => render({ keepScroll: true }),
    startWorkout: workout.startWorkout,
    quickCardio: workout.quickCardio,
    editWorkout: workout.editWorkout,
  };
  VIEWS[r.name].render(viewEl, ctx);
  if (changed && !keepScroll) { window.scrollTo(0, 0); viewEl.focus({ preventScroll: true }); }
  else window.scrollTo(0, y);
}

export function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('gym-theme', JSON.stringify(theme)); } catch { /* ignore */ }
}

function registerSW() {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol === 'file:') return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    const promptUpdate = (w) => {
      toast('Update ready', { action: 'Reload', ms: 15000, onAction: () => w.postMessage('skipWaiting') });
    };
    if (reg.waiting && navigator.serviceWorker.controller) promptUpdate(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) promptUpdate(w);
      });
    });
  }).catch((e) => console.warn('SW registration failed', e));
  let reloading = false;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Only reload when an update replaces an existing worker, not on first install.
    if (reloading || !hadController) return;
    reloading = true;
    location.reload();
  });
}

const hooks = [];
/** Modules (e.g. workout overlay) can register boot hooks. */
export function onBoot(f) { hooks.push(f); }

async function boot() {
  const state = await store.init();
  applyTheme(state.settings.theme);
  store.subscribe((s) => {
    applyTheme(s.settings.theme);
    render({ keepScroll: true });
  });
  addEventListener('hashchange', () => render());
  render();
  workout.resumeIfActive();
  registerSW();
  requestPersist();
  for (const f of hooks) f({ state, navigate });
  window.__gym = { store, navigate }; // handy for debugging and smoke tests
}

boot().catch((e) => {
  console.error(e);
  viewEl.append(h('div.banner.warn', h('strong', 'Something went wrong starting the app.'), h('span.small', String(e?.message || e))));
});
