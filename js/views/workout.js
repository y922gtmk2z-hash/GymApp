// Full-screen workout logger with the rest timer pinned at the bottom.
import { h, sheet, toast, confirmSheet, field, numInput, segmented } from '../ui.js';
import * as store from '../store.js';
import * as E from '../engine.js';
import * as T from '../timer.js';
import { keepAwake, allowSleep } from '../wakelock.js';
import { detectPRs, recomputeAllPRs, workoutVolume, epley } from '../stats.js';
import { MUSCLES, MUSCLE_LABEL, STRENGTH_EQUIPMENT } from '../data.js';
import { displayWeight, toKg, fmtWeight } from '../units.js';
import { today as todayFn, uid, fmtDuration, fmtDate, parseNum, clone, weekStart } from '../util.js';
import { library, activities, exName, actName, exById, profileOf, zone2For } from './common.js';

const root = () => document.getElementById('overlay');
let open = false;
let ticker = null;
let audioUnlocked = false;

const aw = () => store.get().activeWorkout;
const units = () => store.get().settings.units;

function commitAW(fn, { rerender = false } = {}) {
  // Save immediately: iOS can close a backgrounded web app at any moment.
  store.commit((st) => { fn(st.activeWorkout, st); }, { silent: true, flush: true });
  if (rerender) render();
}

// ---------- Starting ----------

function goalFor(st, sessionId) {
  const wk = st.plans[weekStart(todayFn())];
  for (const p of Object.values(st.plans)) if (p.sessions.some((s) => s.id === sessionId)) return { plan: p, session: p.sessions.find((s) => s.id === sessionId) };
  return { plan: wk || null, session: null };
}

function makeEntry(st, ex, planned, { deload = false } = {}) {
  const history = E.exerciseHistory(ex.id, st.workouts);
  const goal = planned.goal || st.builder.goal;
  const rr = planned.repMin ? planned : E.repRest(goal, ex.type, ex.id, st.settings);
  const nSets = planned.sets || 3;
  const sug = E.suggestNext(ex, history, { sets: nSets, repMin: rr.repMin, repMax: rr.repMax }, st.settings.units, { deload });
  return {
    exId: ex.id, muscle: ex.primary, repMin: rr.repMin, repMax: rr.repMax,
    restSec: st.settings.restOverrides?.[ex.id] ?? rr.restSec ?? 90,
    note: '', suggestion: sug,
    sets: Array.from({ length: nSets }, (_, i) => ({ kg: sug ? sug.kg : null, reps: sug ? sug.reps[i] : null, done: false, warmup: false })),
  };
}

export async function startWorkout(sessionId) {
  const st = store.get();
  const cur = st.activeWorkout;
  if (cur) {
    if (cur.sessionId === sessionId || (!sessionId && !cur.sessionId)) { openOverlay(); return; }
    const ok = await confirmSheet('Workout in progress', `You have “${cur.name}” in progress. Discard it and start a new one?`, { ok: 'Discard and start', danger: true });
    if (!ok) { openOverlay(); return; }
  }
  const { plan, session } = sessionId ? goalFor(st, sessionId) : { plan: null, session: null };
  const deload = !!plan?.deload;
  const w = {
    id: uid(), date: todayFn(), startedAt: Date.now(), sessionId: session?.id || null,
    name: session?.name || 'Workout', goal: plan?.goal || st.builder.goal, profileId: session?.profileId || null, deload,
    note: '', exercises: [], cardio: [],
  };
  if (session) {
    for (const pe of session.exercises) {
      const ex = exById(st, pe.exId);
      if (ex) w.exercises.push(makeEntry(st, ex, { ...pe, goal: w.goal }, { deload }));
    }
    for (const c of session.cardio || []) w.cardio.push({ activityId: c.activityId, minutes: c.minutes, distanceKm: null, avgHr: null, intensity: c.intensity, finisher: !!c.finisher, done: false, timerStart: null });
  }
  store.commit((s) => { s.activeWorkout = w; s.timer = null; }, { silent: true });
  openOverlay();
}

export function editWorkout(id) {
  const st = store.get();
  const w = st.workouts.find((x) => x.id === id);
  if (!w) return;
  if (st.activeWorkout && !st.activeWorkout.editingId) { toast('Finish or discard the current workout first'); return; }
  const copy = clone(w);
  copy.editingId = w.id;
  copy.exercises = copy.exercises.map((e) => ({ ...e, suggestion: null }));
  copy.cardio = (copy.cardio || []).map((c) => ({ ...c, done: true }));
  store.commit((s) => { s.activeWorkout = copy; s.timer = null; }, { silent: true });
  openOverlay();
}

// ---------- Overlay lifecycle ----------

export function openOverlay() {
  if (!aw()) return;
  open = true;
  const el = root();
  el.hidden = false;
  document.body.style.overflow = 'hidden';
  el.addEventListener('pointerdown', unlockOnce, { once: false });
  keepAwake();
  render();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
}

function unlockOnce() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  T.unlockAudio();
}

export function closeOverlay() {
  open = false;
  clearInterval(ticker);
  root().hidden = true;
  root().replaceChildren();
  document.body.style.overflow = '';
  allowSleep();
  store.commit(() => {}); // refresh the tab view behind
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && open) tick();
});

// ---------- Rendering ----------

let restBarEl = null;
let elapsedEl = null;

function render() {
  const w = aw();
  const el = root();
  if (!w) { closeOverlay(); return; }
  const scroll = el.scrollTop;
  const st = store.get();
  elapsedEl = h('span.small.muted.num', '');
  const head = h('div.ov-head',
    h('button.btn.small', { type: 'button', onclick: closeOverlay, 'aria-label': 'Minimise workout' }, '⌄'),
    h('div.grow', h('div', { style: { fontWeight: 700 } }, w.name, w.deload ? h('span.badge.warn', { style: { marginLeft: '6px' } }, 'Deload') : null), w.editingId ? h('span.small.muted', `Editing ${fmtDate(w.date)}`) : elapsedEl),
    h('button.btn.small.primary', { type: 'button', onclick: finish }, w.editingId ? 'Save' : 'Finish'));
  const body = h('div.ov-body');
  w.exercises.forEach((e, i) => body.append(exerciseCard(st, w, e, i)));
  w.cardio.forEach((c, i) => body.append(cardioCard(st, c, i)));
  body.append(
    h('div.row',
      h('button.btn.grow', { type: 'button', onclick: addExerciseSheet }, '+ Exercise'),
      h('button.btn.grow', { type: 'button', onclick: () => commitAW((a) => { a.cardio.push({ activityId: 'walk', minutes: 20, distanceKm: null, avgHr: null, intensity: 'steady', finisher: false, done: false, timerStart: null }); }, { rerender: true }) }, '+ Cardio')),
    field('Workout note', h('textarea', { rows: 2, oninput: (ev) => commitAW((a) => { a.note = ev.target.value; }) }, w.note || '')),
    h('button.btn.danger.block', { type: 'button', onclick: discard }, w.editingId ? 'Cancel editing' : 'Discard workout'),
  );
  restBarEl = h('div.restbar', { role: 'timer', 'aria-live': 'off' });
  el.replaceChildren(head, body, restBarEl);
  el.scrollTop = scroll;
  tick();
}

function lastText(st, w, exId) {
  const hist = E.exerciseHistory(exId, st.workouts, { excludeId: w.editingId });
  if (!hist.length) return null;
  const last = hist[0];
  return `Last ${fmtDate(last.date)}: ${last.sets.map((s) => `${displayWeight(s.kg, units())}×${s.reps}`).join(', ')}`;
}

function exerciseCard(st, w, e, i) {
  const ex = exById(st, e.exId);
  const u = units();
  const sug = e.suggestion;
  const target = `Target ${e.sets.filter((s) => !s.warmup).length} × ${e.repMin}–${e.repMax}`;
  const sugText = sug ? `${fmtWeight(sug.kg, u)} × ${sug.reps[0]}${sug.reps.some((r) => r !== sug.reps[0]) ? '…' : ''}` : 'No history yet: enter your first numbers';
  const last = lastText(st, w, e.exId);
  const rows = e.sets.map((s, j) => setRow(e, i, s, j));
  let workIdx = 0;
  rows.forEach((r, j) => { if (!e.sets[j].warmup) r.querySelector('.idx').textContent = String(++workIdx); else r.querySelector('.idx').textContent = 'W'; });
  return h('div.card', { 'data-ex': String(i) },
    h('div.card-head',
      h('div.grow', h('h3', ex?.name || e.exId), h('div.tiny.muted', `${MUSCLE_LABEL[e.muscle] || ''}`)),
      h('div.row.nowrap', { style: { gap: '4px' } },
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => commitAW((a) => { [a.exercises[i - 1], a.exercises[i]] = [a.exercises[i], a.exercises[i - 1]]; }, { rerender: true }) }, '↑'),
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'Move down', disabled: i === w.exercises.length - 1, onclick: () => commitAW((a) => { [a.exercises[i + 1], a.exercises[i]] = [a.exercises[i], a.exercises[i + 1]]; }, { rerender: true }) }, '↓'),
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'More actions', onclick: () => exerciseMenu(i) }, '⋯'))),
    h('div.small', h('span', target), ' · ', h('button.btn.ghost.small', { type: 'button', style: { padding: 0, minHeight: 0, color: 'var(--accent)' }, onclick: () => restSheet(i), 'aria-label': `Rest ${e.restSec} seconds, change` }, `Rest ${e.restSec}s`)),
    !w.editingId ? h('div.small', { class: sug ? '' : 'muted' }, sug ? h('span', h('strong', 'Next: '), sugText, h('span.muted', ` · ${E.REASON_TEXT[sug.reason]}`)) : sugText) : null,
    last ? h('div.tiny.muted', last) : null,
    e.note ? h('div.small', { style: { fontStyle: 'italic' } }, e.note) : null,
    h('div.set-row.head', h('span.center', 'Set'), h('span.center', 'Type'), h('span.center', u), h('span.center', 'Reps'), h('span.center', 'Done')),
    rows,
    h('div.row',
      h('button.btn.small', { type: 'button', onclick: () => commitAW((a) => { const x = a.exercises[i]; const last2 = x.sets[x.sets.length - 1]; x.sets.push({ kg: last2?.kg ?? null, reps: last2?.reps ?? null, done: false, warmup: false }); }, { rerender: true }) }, '+ Set'),
      h('button.btn.small', { type: 'button', disabled: e.sets.length <= 1, onclick: () => commitAW((a) => { a.exercises[i].sets.pop(); }, { rerender: true }) }, '− Set'),
      h('button.btn.small', { type: 'button', onclick: () => commitAW((a) => { const x = a.exercises[i]; const first = x.sets[0]; x.sets.unshift({ kg: first?.kg ? Math.round(first.kg * 0.5 * 2) / 2 : null, reps: 8, done: false, warmup: true }); }, { rerender: true }) }, '+ Warm-up')));
}

function setRow(e, i, s, j) {
  const u = units();
  const kgIn = numInput({ value: displayWeight(s.kg, u), label: `Set ${j + 1} weight in ${u}`, placeholder: '–',
    onInput: (v) => commitAW((a) => { a.exercises[i].sets[j].kg = toKg(parseNum(v), u); }) });
  const repIn = numInput({ value: s.reps ?? '', decimal: false, label: `Set ${j + 1} reps`, placeholder: '–',
    onInput: (v) => commitAW((a) => { const n = parseNum(v); a.exercises[i].sets[j].reps = n === null ? null : Math.round(n); }) });
  const row = h('div.set-row', { class: [s.done ? 'done' : '', s.warmup ? 'warmup' : ''].join(' ') },
    h('span.idx', String(j + 1)),
    h('button.wu', { type: 'button', class: s.warmup ? 'on' : '', 'aria-pressed': String(!!s.warmup), 'aria-label': `Set ${j + 1} warm-up`, onclick: () => commitAW((a) => { a.exercises[i].sets[j].warmup = !a.exercises[i].sets[j].warmup; }, { rerender: true }) }, s.warmup ? 'W' : 'Work'),
    kgIn, repIn,
    h('button.tick', { type: 'button', class: s.done ? 'on' : '', 'aria-pressed': String(!!s.done), 'aria-label': `Set ${j + 1} done`, onclick: () => toggleDone(i, j) }, '✓'));
  return row;
}

function toggleDone(i, j) {
  unlockOnce();
  let startRest = null;
  commitAW((a, st) => {
    const e = a.exercises[i];
    const s = e.sets[j];
    s.done = !s.done;
    if (s.done) {
      if (s.reps === null || s.reps === undefined) s.reps = e.suggestion?.reps?.[j] ?? e.repMin;
      if (!s.warmup) startRest = e.restSec;
    }
    if (startRest) st.timer = T.startTimer(startRest, e.exId);
  }, { rerender: true });
}

function exerciseMenu(i) {
  sheet('Exercise', (close) => h('div',
    h('button.list-btn', { type: 'button', onclick: () => { close(); swapSheet(i); } }, 'Swap exercise', h('span.muted', '›')),
    h('button.list-btn', { type: 'button', onclick: () => { close(); noteSheet(i); } }, 'Add a note', h('span.muted', '›')),
    h('button.list-btn', { type: 'button', onclick: () => { close(); restSheet(i); } }, 'Change rest time', h('span.muted', '›')),
    h('button.list-btn', { type: 'button', style: { color: 'var(--bad)' }, onclick: () => { close(); commitAW((a) => { a.exercises.splice(i, 1); }, { rerender: true }); } }, 'Remove exercise')));
}

function noteSheet(i) {
  const e = aw().exercises[i];
  sheet('Note', (close) => {
    const ta = h('textarea', { rows: 3 }, e.note || '');
    return h('div.stack', ta, h('button.btn.primary', { type: 'button', onclick: () => { commitAW((a) => { a.exercises[i].note = ta.value.trim(); }, { rerender: true }); close(); } }, 'Save'));
  });
}

function restSheet(i) {
  const e = aw().exercises[i];
  let sec = e.restSec;
  let remember = true;
  sheet('Rest time', (close) => {
    const out = h('strong.num', { style: { fontSize: '1.6rem' } }, `${sec}s`);
    const set = (v) => { sec = Math.max(15, Math.min(600, v)); out.textContent = `${sec}s`; };
    return h('div.stack',
      h('div.row.between', h('button.btn.icon', { type: 'button', 'aria-label': 'Less rest', onclick: () => set(sec - 15) }, '−'), out, h('button.btn.icon', { type: 'button', 'aria-label': 'More rest', onclick: () => set(sec + 15) }, '+')),
      h('div.row', T.QUICK_CHIPS.map((c) => h('button.chip', { type: 'button', onclick: () => set(c) }, `${c}s`))),
      h('label.check', h('input', { type: 'checkbox', checked: true, onchange: (ev) => { remember = ev.target.checked; } }), `Remember for ${exName(store.get(), e.exId)}`),
      h('button.btn.primary', { type: 'button', onclick: () => {
        commitAW((a, st) => { a.exercises[i].restSec = sec; if (remember) st.settings.restOverrides[e.exId] = sec; }, { rerender: true });
        close();
      } }, 'Save'));
  });
}

function profileForSwap(st, w) {
  if (w.profileId) return profileOf(st, w.profileId);
  return { id: 'all', name: 'All', equipment: [...new Set(st.profiles.flatMap((p) => p.equipment)), ...STRENGTH_EQUIPMENT] };
}

function swapSheet(i) {
  const st = store.get();
  const w = aw();
  const e = w.exercises[i];
  const alts = E.suggestAlternatives(e.exId, profileForSwap(st, w), library(st));
  sheet('Swap exercise', (close) => alts.length ? h('div', alts.map((ex) => h('button.list-btn', { type: 'button', onclick: () => {
    commitAW((a, s) => {
      const old = a.exercises[i];
      const fresh = makeEntry(s, ex, { sets: old.sets.filter((x) => !x.warmup).length, goal: a.goal }, { deload: a.deload });
      a.exercises[i] = { ...fresh, note: old.note };
    }, { rerender: true });
    close();
  } }, h('span', h('div.ex-name', ex.name), h('div.small.muted', ex.type)), h('span.muted', '›')))) : h('p.muted', 'No alternatives with this equipment.'));
}

function addExerciseSheet() {
  const st = store.get();
  const w = aw();
  const avail = E.availableExercises(library(st), profileForSwap(st, w));
  sheet('Add exercise', (close) => {
    let q = '';
    let muscle = '';
    const list = h('div');
    const draw = () => list.replaceChildren(...avail.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!muscle || e.primary === muscle)).slice(0, 60)
      .map((ex) => h('button.list-btn', { type: 'button', onclick: () => {
        commitAW((a, s) => { a.exercises.push(makeEntry(s, ex, { sets: 3, goal: a.goal }, { deload: a.deload })); }, { rerender: true });
        close();
      } }, h('span', h('div.ex-name', ex.name), h('div.small.muted', MUSCLE_LABEL[ex.primary])), h('span.muted', '+'))));
    draw();
    return h('div.stack',
      h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search exercises', oninput: (ev) => { q = ev.target.value.toLowerCase(); draw(); } }),
      h('select', { 'aria-label': 'Muscle', onchange: (ev) => { muscle = ev.target.value; draw(); } }, h('option', { value: '' }, 'All muscles'), MUSCLES.map((m) => h('option', { value: m }, MUSCLE_LABEL[m]))),
      list);
  });
}

function cardioCard(st, c, i) {
  const z2 = zone2For(st, todayFn());
  const running = !!c.timerStart;
  return h('div.card.cardio',
    h('div.card-head', h('h3', c.finisher ? 'Finisher' : 'Cardio'),
      h('button.btn.icon.small', { type: 'button', 'aria-label': 'Remove cardio', onclick: () => commitAW((a) => { a.cardio.splice(i, 1); }, { rerender: true }) }, '✕')),
    h('select', { 'aria-label': 'Activity', onchange: (ev) => commitAW((a) => { a.cardio[i].activityId = ev.target.value; }) },
      activities(st).map((a) => h('option', { value: a.id, selected: a.id === c.activityId }, a.name))),
    segmented({ small: true, label: 'Intensity', value: c.intensity, options: [{ value: 'steady', label: 'Steady' }, { value: 'intervals', label: 'Intervals' }], onChange: (v) => commitAW((a) => { a.cardio[i].intensity = v; }) }),
    c.intensity === 'steady' ? h('div.tiny.muted', z2 ? `Zone 2: ${z2[0]}–${z2[1]} bpm` : 'Conversational pace (RPE 3–4)') : null,
    h('div.grid3',
      field('Minutes', numInput({ value: c.minutes ?? '', decimal: false, label: 'Minutes', onInput: (v) => commitAW((a) => { a.cardio[i].minutes = parseNum(v); }) })),
      field('Distance km', numInput({ value: c.distanceKm ?? '', label: 'Distance in kilometres', onInput: (v) => commitAW((a) => { a.cardio[i].distanceKm = parseNum(v); }) })),
      field('Avg HR', numInput({ value: c.avgHr ?? '', decimal: false, label: 'Average heart rate', onInput: (v) => commitAW((a) => { a.cardio[i].avgHr = parseNum(v); }) }))),
    h('div.row.between',
      h('button.btn.small', { type: 'button', onclick: () => commitAW((a) => {
        const x = a.cardio[i];
        if (x.timerStart) { x.minutes = Math.max(1, Math.round((Date.now() - x.timerStart) / 60000)); x.timerStart = null; }
        else x.timerStart = Date.now();
      }, { rerender: true }) }, running ? h('span', 'Stop ', h('span.num', { 'data-cardio-timer': String(c.timerStart) }, '')) : 'Start timer'),
      h('button.tick', { type: 'button', class: c.done ? 'on' : '', 'aria-pressed': String(!!c.done), 'aria-label': 'Cardio done', onclick: () => commitAW((a) => { a.cardio[i].done = !a.cardio[i].done; }, { rerender: true }) }, '✓')));
}

// ---------- Timer bar ----------

function tick() {
  if (!open) return;
  const st = store.get();
  const w = st.activeWorkout;
  if (elapsedEl && w) elapsedEl.textContent = fmtDuration((Date.now() - w.startedAt) / 1000);
  for (const el of document.querySelectorAll('[data-cardio-timer]')) el.textContent = fmtDuration((Date.now() - Number(el.dataset.cardioTimer)) / 1000);
  if (!restBarEl) return;
  const t = st.timer;
  const now = Date.now();
  const state = !t ? 'idle' : T.isOver(t, now) ? 'over' : 'run';
  if (restBarEl.dataset.state !== state) {
    restBarEl.dataset.state = state;
    restBarEl.className = 'restbar' + (state === 'over' ? ' over' : '');
    if (state === 'idle') {
      restBarEl.replaceChildren(h('div.row.between.nowrap',
        h('span.small.muted', 'Rest timer'),
        h('div.row.nowrap', { style: { gap: '6px' } }, T.QUICK_CHIPS.map((c) => h('button.chip', { type: 'button', onclick: () => startRest(c) }, `${c}s`)))));
    } else if (state === 'run') {
      restBarEl.replaceChildren(h('div.row.between.nowrap',
        h('div', h('div.tiny.muted', t.exId ? `Rest · ${exName(st, t.exId)}` : 'Rest'), h('div.count', { 'data-count': '1' }, T.display(T.remaining(t, now)))),
        h('div.row.nowrap', { style: { gap: '6px' } },
          h('button.btn.small', { type: 'button', 'aria-label': 'Minus 15 seconds', onclick: () => adjustRest(-15) }, '−15'),
          h('button.btn.small', { type: 'button', 'aria-label': 'Plus 15 seconds', onclick: () => adjustRest(15) }, '+15'),
          h('button.btn.small', { type: 'button', onclick: () => store.commit((s) => { s.timer = null; }, { silent: true }) }, 'Skip'))));
    } else {
      restBarEl.replaceChildren(h('div.row.between.nowrap',
        h('div', { role: 'alert' }, h('div.count', 'Rest over'), h('div.tiny', 'Next set when you\'re ready')),
        h('button.btn', { type: 'button', onclick: () => store.commit((s) => { s.timer = null; }, { silent: true }) }, 'OK')));
      if (!t.alerted) {
        store.commit((s) => { if (s.timer) s.timer.alerted = true; }, { silent: true });
        T.beep();
        T.vibrate();
        restBarEl.classList.add('flash');
      }
    }
  }
  if (state === 'run') {
    const c = restBarEl.querySelector('[data-count]');
    if (c) c.textContent = T.display(T.remaining(t, now));
  }
}

function startRest(sec) {
  unlockOnce();
  store.commit((s) => { s.timer = T.startTimer(sec, null); }, { silent: true });
  tick();
}

function adjustRest(d) {
  store.commit((s) => { if (s.timer) s.timer = T.adjust(s.timer, d); }, { silent: true });
  restBarEl.dataset.state = '';
  tick();
}

// ---------- Finish / discard ----------

async function discard() {
  const w = aw();
  const ok = w.editingId ? true : await confirmSheet('Discard workout?', 'Nothing from this workout will be saved.', { ok: 'Discard', danger: true });
  if (!ok) return;
  store.commit((s) => { s.activeWorkout = null; s.timer = null; }, { silent: true });
  closeOverlay();
}

function cleanEntry(e) {
  return { exId: e.exId, note: e.note || '', restSec: e.restSec, repMin: e.repMin, repMax: e.repMax,
    sets: e.sets.filter((s) => s.done && Number.isFinite(s.reps) && s.reps > 0).map((s) => ({ kg: s.kg ?? 0, reps: s.reps, done: true, warmup: !!s.warmup })) };
}

async function finish() {
  const st = store.get();
  const w = aw();
  const now = Date.now();
  const exercises = w.exercises.map(cleanEntry).filter((e) => e.sets.length);
  const cardio = w.cardio.filter((c) => c.done && c.minutes > 0).map((c) => ({ activityId: c.activityId, minutes: c.minutes, distanceKm: c.distanceKm ?? null, avgHr: c.avgHr ?? null, intensity: c.intensity, finisher: !!c.finisher }));
  if (!exercises.length && !cardio.length) {
    const ok = await confirmSheet('Nothing ticked', 'No sets or cardio are marked done. Discard this workout?', { ok: 'Discard', danger: true });
    if (ok) { store.commit((s) => { s.activeWorkout = null; s.timer = null; }, { silent: true }); closeOverlay(); }
    return;
  }
  let saved;
  if (w.editingId) {
    const orig = st.workouts.find((x) => x.id === w.editingId);
    saved = { ...orig, name: w.name, note: w.note || '', exercises, cardio };
    store.commit((s) => {
      s.workouts = recomputeAllPRs(s.workouts.map((x) => (x.id === saved.id ? saved : x)));
      s.activeWorkout = null; s.timer = null;
    }, { silent: true });
    closeOverlay();
    toast('Workout updated');
    return;
  }
  saved = { id: w.id, date: w.date, startedAt: w.startedAt, endedAt: now, durationSec: Math.round((now - w.startedAt) / 1000),
    sessionId: w.sessionId, name: w.name, note: w.note || '', exercises, cardio, prs: [] };
  saved.prs = detectPRs(saved, st.workouts.filter((x) => x.date <= saved.date));
  store.commit((s) => { s.workouts.push(saved); s.activeWorkout = null; s.timer = null; }, { silent: true });
  closeOverlay();
  summarySheet(saved);
}

function summarySheet(w) {
  const st = store.get();
  const { volume, sets } = workoutVolume(w);
  const mins = w.cardio.reduce((a, c) => a + c.minutes, 0);
  const u = units();
  sheet('Workout saved', h('div.stack',
    h('div.tiles',
      h('div.tile', h('div.v', fmtDuration(w.durationSec)), h('div.l', 'Duration')),
      h('div.tile', h('div.v', String(sets)), h('div.l', 'Working sets')),
      h('div.tile', h('div.v', fmtWeight(volume, u)), h('div.l', 'Volume')),
      mins ? h('div.tile', h('div.v', `${mins} min`), h('div.l', 'Cardio')) : null),
    w.prs.length ? h('div.card.flat', h('h3', `🏆 ${w.prs.length} PR${w.prs.length > 1 ? 's' : ''}`),
      w.prs.map((p) => h('div.small', `${exName(st, p.exId)}: ${p.type === 'e1rm' ? `est. 1RM ${fmtWeight(p.value, u)}` : p.type === 'weight' ? `heaviest ${fmtWeight(p.kg, u)}` : `${p.reps} reps at ${fmtWeight(p.kg, u)}`}`))) : h('p.muted.small', 'No PRs this time. Consistency is what counts.')));
}

// ---------- Quick cardio log ----------

export function quickCardio() {
  const st = store.get();
  const d = { date: todayFn(), activityId: 'walk', minutes: 30, distanceKm: null, avgHr: null, intensity: 'steady', attach: true };
  sheet('Log cardio', (close) => {
    const planned = () => Object.values(store.get().plans).flatMap((p) => p.sessions)
      .find((s) => s.kind === 'cardio' && s.date === d.date && !s.skipped && !store.get().workouts.some((w) => w.sessionId === s.id));
    return h('div.stack',
      h('p.small.muted', 'For cardio you tracked elsewhere, for example on your Apple Watch.'),
      field('Date', h('input', { type: 'date', value: d.date, max: todayFn(), onchange: (e) => { d.date = e.target.value; } })),
      field('Activity', h('select', { onchange: (e) => { d.activityId = e.target.value; } }, activities(st).map((a) => h('option', { value: a.id }, a.name)))),
      segmented({ label: 'Intensity', value: 'steady', options: [{ value: 'steady', label: 'Steady' }, { value: 'intervals', label: 'Intervals' }], onChange: (v) => { d.intensity = v; } }),
      h('div.grid3',
        field('Minutes', numInput({ value: d.minutes, decimal: false, label: 'Minutes', onInput: (v) => { d.minutes = parseNum(v); } })),
        field('Distance km', numInput({ value: '', label: 'Distance in kilometres', onInput: (v) => { d.distanceKm = parseNum(v); } })),
        field('Avg HR', numInput({ value: '', decimal: false, label: 'Average heart rate', onInput: (v) => { d.avgHr = parseNum(v); } }))),
      h('button.btn.primary', { type: 'button', onclick: () => {
        if (!(d.minutes > 0)) { toast('Enter the minutes'); return; }
        const sess = planned();
        const w = { id: uid(), date: d.date, startedAt: null, endedAt: Date.now(), durationSec: d.minutes * 60, sessionId: sess?.id || null,
          name: sess?.name || actName(st, d.activityId), note: '', exercises: [], prs: [],
          cardio: [{ activityId: d.activityId, minutes: d.minutes, distanceKm: d.distanceKm, avgHr: d.avgHr, intensity: d.intensity, finisher: false }] };
        store.commit((s) => { s.workouts.push(w); });
        close();
        toast(sess ? `Logged and counted as ${sess.name}` : 'Cardio logged');
      } }, 'Save'));
  });
}

/** Resume a workout left open (e.g. after iOS closed the app). */
export function resumeIfActive() {
  if (aw()) openOverlay();
}

export { epley };
