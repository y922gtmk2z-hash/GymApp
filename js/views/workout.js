// Full-screen workout logger with the rest timer pinned at the bottom.
import { h, sheet, toast, confirmSheet, field, numInput, segmented } from '../ui.js';
import * as store from '../store.js';
import * as E from '../engine.js';
import * as T from '../timer.js';
import * as L from '../loading.js';
import { keepAwake, allowSleep } from '../wakelock.js';
import { detectPRs, recomputeAllPRs, workoutVolume, bestPRsByLift } from '../stats.js';
import { MUSCLES, MUSCLE_LABEL, STRENGTH_EQUIPMENT } from '../data.js';
import { displayWeight, toKg, fromKg, fmtWeight, loadKind, increment } from '../units.js';
import { today as todayFn, uid, fmtDuration, fmtDate, parseNum, clone, weekStart } from '../util.js';
import { library, activities, exName, actName, exById, profileOf, zone2For, supersetLabels } from './common.js';

const root = () => document.getElementById('overlay');
let open = false;
let ticker = null;
let audioUnlocked = false;
let scrollToNext = false;
const intervalPhase = {};

const aw = () => store.get().activeWorkout;
const units = () => store.get().settings.units;

function commitAW(fn, { rerender = false } = {}) {
  // Save immediately: iOS can close a backgrounded web app at any moment.
  store.commit((st) => { fn(st.activeWorkout, st); }, { silent: true, flush: true });
  if (rerender) render();
}

export const isOpen = () => open;

// ---------- Starting ----------

function findSession(st, sessionId) {
  for (const p of Object.values(st.plans)) {
    const s = p.sessions.find((x) => x.id === sessionId);
    if (s) return { plan: p, session: s };
  }
  return { plan: null, session: null };
}

function maxKgFor(profile, ex) {
  const kind = loadKind(ex);
  if (kind === 'dumbbell') return profile?.weights?.dumbbellMaxKg || null;
  if (kind === 'kettlebell') return profile?.weights?.kettlebellMaxKg || null;
  return null;
}

function makeEntry(st, ex, planned, { deload = false, profile = null, warmups = false } = {}) {
  const history = E.exerciseHistory(ex.id, st.workouts);
  const goal = planned.goal || st.builder.goal;
  const rr = planned.repMin ? planned : E.repRest(goal, ex.type, ex.id, st.settings);
  const nSets = planned.sets || 3;
  const sug = E.suggestNext(ex, history, { sets: nSets, repMin: rr.repMin, repMax: rr.repMax }, st.settings.units, { deload, maxKg: maxKgFor(profile, ex) });
  const sets = Array.from({ length: nSets }, (_, i) => ({ kg: sug ? sug.kg : null, reps: sug ? sug.reps[i] : null, done: false, warmup: false }));
  if (warmups && sug) {
    sets.unshift(...L.warmupSets(sug.kg, loadKind(ex), st.settings.units, st.settings.barKg).map((w) => ({ ...w, done: false, warmup: true })));
  }
  return {
    exId: ex.id, muscle: ex.primary, repMin: rr.repMin, repMax: rr.repMax, group: planned.group || null,
    restSec: st.settings.restOverrides?.[ex.id] ?? rr.restSec ?? 90,
    note: '', suggestion: sug, sets,
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
  const { plan, session } = sessionId ? findSession(st, sessionId) : { plan: null, session: null };
  const deload = !!plan?.deload;
  const profile = session ? profileOf(st, session.profileId) : null;
  const w = {
    id: uid(), date: todayFn(), startedAt: Date.now(), sessionId: session?.id || null,
    name: session?.name || 'Workout', goal: plan?.goal || st.builder.goal, profileId: session?.profileId || null, deload,
    note: '', exercises: [], cardio: [],
  };
  if (session) {
    let warmed = false;
    for (const pe of session.exercises) {
      const ex = exById(st, pe.exId);
      if (!ex) continue;
      const warm = st.settings.autoWarmups && !warmed && ex.type === 'compound' && ['barbell', 'dumbbell', 'machine'].includes(loadKind(ex));
      const entry = makeEntry(st, ex, { ...pe, goal: w.goal }, { deload, profile, warmups: warm });
      if (warm && entry.sets.some((s) => s.warmup)) warmed = true;
      w.exercises.push(entry);
    }
    for (const c of session.cardio || []) w.cardio.push(newCardio(c));
  }
  store.commit((s) => { s.activeWorkout = w; s.timer = null; }, { silent: true, flush: true });
  scrollToNext = true;
  openOverlay();
}

function newCardio(c = {}) {
  return { activityId: c.activityId || 'walk', minutes: c.minutes ?? 20, distanceKm: null, avgHr: null, intensity: c.intensity || 'steady',
    finisher: !!c.finisher, done: false, timerStart: null, interval: c.intensity === 'intervals' ? { work: 30, rest: 30, rounds: 10, startedAt: null } : null };
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
  el.addEventListener('pointerdown', unlockOnce);
  keepAwake();
  render();
  clearInterval(ticker);
  ticker = setInterval(tick, 250);
  store.commit(() => {}); // hide the resume bar behind
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

// ---------- Set order (supersets alternate) ----------

/** All sets in the order they should be done: [exerciseIndex, setIndex]. Superset partners alternate. */
export function setOrder(exercises) {
  const out = [];
  for (let i = 0; i < exercises.length; i++) {
    const e = exercises[i];
    const p = exercises[i + 1];
    if (e.group && p && p.group === e.group) {
      const n = Math.max(e.sets.length, p.sets.length);
      for (let j = 0; j < n; j++) { if (j < e.sets.length) out.push([i, j]); if (j < p.sets.length) out.push([i + 1, j]); }
      i++;
    } else for (let j = 0; j < e.sets.length; j++) out.push([i, j]);
  }
  return out;
}

const nextSet = (w) => setOrder(w.exercises).find(([i, j]) => !w.exercises[i].sets[j].done) || null;

function partnerIndex(w, i) {
  const g = w.exercises[i].group;
  if (!g) return -1;
  if (w.exercises[i + 1]?.group === g) return i + 1;
  if (w.exercises[i - 1]?.group === g) return i - 1;
  return -1;
}

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
    h('button.grow', { type: 'button', style: { background: 'none', border: 0, textAlign: 'left', padding: 0, cursor: 'pointer' }, onclick: renameSheet, 'aria-label': `Rename workout ${w.name}` },
      h('div', { style: { fontWeight: 700 } }, w.name, ' ', h('span.tiny.muted', '✎'), w.deload ? h('span.badge.warn', { style: { marginLeft: '6px' } }, 'Deload') : null),
      w.editingId ? h('span.small.muted', `Editing ${fmtDate(w.date)}`) : elapsedEl),
    h('button.btn.small.primary', { type: 'button', onclick: finish }, w.editingId ? 'Save' : 'Finish'));
  const body = h('div.ov-body');
  const next = w.editingId ? null : nextSet(w);
  const labels = supersetLabels(w.exercises);
  w.exercises.forEach((e, i) => body.append(exerciseCard(st, w, e, i, next, labels[i])));
  w.cardio.forEach((c, i) => body.append(cardioCard(st, c, i)));
  body.append(
    h('div.row',
      h('button.btn.grow', { type: 'button', onclick: addExerciseSheet }, '+ Exercise'),
      h('button.btn.grow', { type: 'button', onclick: () => commitAW((a) => { a.cardio.push(newCardio()); }, { rerender: true }) }, '+ Cardio')),
    field('Workout note', h('textarea', { rows: 2, oninput: (ev) => commitAW((a) => { a.note = ev.target.value; }) }, w.note || '')),
    h('button.btn.danger.block', { type: 'button', onclick: discard }, w.editingId ? 'Cancel editing' : 'Discard workout'),
  );
  restBarEl = h('div.restbar', { role: 'timer', 'aria-live': 'off' });
  el.replaceChildren(head, body, restBarEl);
  el.scrollTop = scroll;
  if (scrollToNext) {
    scrollToNext = false;
    requestAnimationFrame(() => el.querySelector('.set-row.next')?.scrollIntoView({ block: 'center', behavior: 'smooth' }));
  }
  tick();
}

function lastText(st, w, exId) {
  const hist = E.exerciseHistory(exId, st.workouts, { excludeId: w.editingId });
  if (!hist.length) return null;
  const last = hist[0];
  return `Last ${fmtDate(last.date)}: ${last.sets.map((s) => `${displayWeight(s.kg, units())}×${s.reps}`).join(', ')}`;
}

function plateLine(st, ex, e) {
  if (loadKind(ex) !== 'barbell') return null;
  const work = e.sets.find((s) => !s.warmup && s.kg) || e.sets.find((s) => s.kg);
  if (!work) return null;
  const l = L.loadingFor(work.kg, st.settings);
  const txt = l.perSide.length ? l.perSide.join(' + ') : 'empty bar';
  return h('button.btn.ghost.small', { type: 'button', style: { padding: 0, minHeight: '28px', justifyContent: 'flex-start', color: 'var(--muted)' }, onclick: () => plateSheet(e) },
    `Per side: ${txt}${l.remainder ? ` (+${l.remainder} ${l.units} short)` : ''} · bar ${l.bar} ${l.units}`);
}

function plateSheet(e) {
  const st = store.get();
  const weights = [...new Set(e.sets.filter((s) => s.kg).map((s) => s.kg))].sort((a, b) => a - b);
  sheet('Plate loading', h('div.stack',
    weights.map((kg) => {
      const l = L.loadingFor(kg, st.settings);
      return h('div.row.between', h('strong', fmtWeight(kg, l.units)), h('span', l.perSide.length ? l.perSide.join(' + ') + ' per side' : 'Empty bar'));
    }),
    h('p.tiny.muted', `Bar ${L.loadingFor(0, st.settings).bar} ${units()}. Change the bar and plates you have in More > Settings.`)));
}

function exerciseCard(st, w, e, i, next, label) {
  const ex = exById(st, e.exId);
  const u = units();
  const sug = e.suggestion;
  const target = `Target ${e.sets.filter((s) => !s.warmup).length} × ${e.repMin}–${e.repMax}`;
  const sugText = sug ? `${fmtWeight(sug.kg, u)} × ${sug.reps[0]}${sug.reps.some((r) => r !== sug.reps[0]) ? '…' : ''}` : 'No history yet: enter your first numbers';
  const last = lastText(st, w, e.exId);
  const setup = st.exerciseNotes?.[e.exId];
  const effort = st.settings.logEffort;
  let workIdx = 0;
  const rows = e.sets.map((s, j) => setRow(ex, e, i, s, j, s.warmup ? 'W' : String(++workIdx), next && next[0] === i && next[1] === j, effort));
  return h('div.card', { 'data-ex': String(i), class: e.group ? 'superset' : '' },
    h('div.card-head',
      h('div.grow', h('h3', label ? h('span.badge.accent', { style: { marginRight: '6px' } }, label) : null, ex?.name || e.exId),
        h('div.tiny.muted', `${MUSCLE_LABEL[e.muscle] || ''}${label ? ' · superset: alternate sets, rest after each pair' : ''}`)),
      h('div.row.nowrap', { style: { gap: '4px' } },
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => commitAW((a) => { [a.exercises[i - 1], a.exercises[i]] = [a.exercises[i], a.exercises[i - 1]]; a.exercises = E.cleanGroups(a.exercises); }, { rerender: true }) }, '↑'),
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'Move down', disabled: i === w.exercises.length - 1, onclick: () => commitAW((a) => { [a.exercises[i + 1], a.exercises[i]] = [a.exercises[i], a.exercises[i + 1]]; a.exercises = E.cleanGroups(a.exercises); }, { rerender: true }) }, '↓'),
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'More actions', onclick: () => exerciseMenu(i) }, '⋯'))),
    setup ? h('div.small', { style: { color: 'var(--accent)' } }, '📌 ', setup) : null,
    h('div.small', h('span', target), ' · ', h('button.btn.ghost.small', { type: 'button', style: { padding: 0, minHeight: '28px', color: 'var(--accent)' }, onclick: () => restSheet(i), 'aria-label': `Rest ${e.restSec} seconds, change` }, `Rest ${e.restSec}s`)),
    !w.editingId ? h('div.small', { class: sug ? '' : 'muted' }, sug ? h('span', h('strong', 'Next: '), sugText, h('span.muted', ` · ${E.REASON_TEXT[sug.reason]}`)) : sugText) : null,
    last ? h('div.tiny.muted', last) : null,
    ex ? plateLine(st, ex, e) : null,
    e.note ? h('div.small', { style: { fontStyle: 'italic' } }, e.note) : null,
    h('div.set-row.head', { class: effort ? 'effort' : '' }, h('span.center', 'Set'), h('span.center', { style: { gridColumn: 'span 3' } }, u), h('span.center', 'Reps'), effort ? h('span.center', 'RIR') : null, h('span.center', 'Done')),
    rows,
    h('div.tiny.muted', 'Tap a set number to mark it as a warm-up.'),
    h('div.row',
      h('button.btn.small', { type: 'button', onclick: () => commitAW((a) => { const x = a.exercises[i]; const last2 = x.sets[x.sets.length - 1]; x.sets.push({ kg: last2?.kg ?? null, reps: last2?.reps ?? null, done: false, warmup: false }); }, { rerender: true }) }, '+ Set'),
      h('button.btn.small', { type: 'button', disabled: e.sets.length <= 1, onclick: () => commitAW((a) => { a.exercises[i].sets.pop(); }, { rerender: true }) }, '− Set'),
      h('button.btn.small', { type: 'button', onclick: () => addWarmups(i) }, 'Warm-ups')));
}

function setRow(ex, e, i, s, j, label, isNext, effort) {
  const u = units();
  const kind = ex ? loadKind(ex) : 'bodyweight';
  const step = increment(kind, u) || (u === 'lb' ? 5 : 1);
  const kgIn = numInput({ value: displayWeight(s.kg, u), label: `Set ${label} weight in ${u}`, placeholder: '–',
    onInput: (v) => commitAW((a) => { a.exercises[i].sets[j].kg = toKg(parseNum(v), u); }) });
  const bump = (dir) => {
    const cur = fromKg(s.kg ?? 0, u);
    const nv = Math.max(0, Math.round((cur + dir * step) * 100) / 100);
    commitAW((a) => { a.exercises[i].sets[j].kg = toKg(nv, u); });
    s.kg = toKg(nv, u);
    kgIn.value = displayWeight(s.kg, u);
  };
  const repIn = numInput({ value: s.reps ?? '', decimal: false, label: `Set ${label} reps`, placeholder: '–',
    onInput: (v) => commitAW((a) => { const n = parseNum(v); a.exercises[i].sets[j].reps = n === null ? null : Math.round(n); }) });
  const rir = effort ? h('select.rir', { 'aria-label': `Set ${label} reps in reserve`, onchange: (ev) => commitAW((a) => { const v = ev.target.value; a.exercises[i].sets[j].rir = v === '' ? null : Number(v); }) },
    h('option', { value: '' }, '–'), [0, 1, 2, 3, 4].map((r) => h('option', { value: r, selected: s.rir === r }, r === 4 ? '4+' : String(r)))) : null;
  return h('div.set-row', { class: [s.done ? 'done' : '', s.warmup ? 'warmup' : '', isNext ? 'next' : '', effort ? 'effort' : ''].join(' ') },
    h('button.idx', { type: 'button', 'aria-pressed': String(!!s.warmup), 'aria-label': `Set ${label}${s.warmup ? ', warm-up' : ''}. Toggle warm-up`,
      onclick: () => commitAW((a) => { a.exercises[i].sets[j].warmup = !a.exercises[i].sets[j].warmup; }, { rerender: true }) }, label),
    h('button.step', { type: 'button', 'aria-label': `Set ${label} weight down ${step} ${u}`, onclick: () => bump(-1) }, '−'),
    kgIn,
    h('button.step', { type: 'button', 'aria-label': `Set ${label} weight up ${step} ${u}`, onclick: () => bump(1) }, '+'),
    repIn, rir,
    h('button.tick', { type: 'button', class: s.done ? 'on' : '', 'aria-pressed': String(!!s.done), 'aria-label': `Set ${label} done`, onclick: () => toggleDone(i, j) }, '✓'));
}

function toggleDone(i, j) {
  unlockOnce();
  let partnerHint = null;
  commitAW((a, st) => {
    const e = a.exercises[i];
    const s = e.sets[j];
    s.done = !s.done;
    if (!s.done) return;
    if (s.reps === null || s.reps === undefined) s.reps = e.suggestion?.reps?.[j] ?? e.repMin;
    if (s.warmup) return;
    const p = partnerIndex(a, i);
    if (p >= 0) {
      const done = (x) => x.sets.filter((y) => y.done && !y.warmup).length;
      const remaining = a.exercises[p].sets.filter((y) => !y.done && !y.warmup).length;
      if (remaining > 0 && done(a.exercises[p]) < done(e)) { partnerHint = exName(st, a.exercises[p].exId); return; }
      st.timer = T.startTimer(Math.max(e.restSec, a.exercises[p].restSec), e.exId);
      return;
    }
    st.timer = T.startTimer(e.restSec, e.exId);
  });
  scrollToNext = true;
  render();
  if (partnerHint) toast(`Superset: now ${partnerHint}`);
}

function addWarmups(i) {
  commitAW((a, st) => {
    const e = a.exercises[i];
    const work = e.sets.find((s) => !s.warmup && s.kg);
    const ex = exById(st, e.exId);
    if (!work || !ex) return;
    const ws = L.warmupSets(work.kg, loadKind(ex), st.settings.units, st.settings.barKg);
    e.sets = [...ws.map((w) => ({ ...w, done: false, warmup: true })), ...e.sets.filter((s) => !s.warmup)];
  }, { rerender: true });
  const e = aw().exercises[i];
  if (!e.sets.some((s) => s.warmup)) toast(e.sets.some((s) => s.kg) ? 'No warm-up needed at this weight' : 'Enter a working weight first');
}

function renameSheet() {
  let name = aw().name;
  sheet('Workout name', (close) => h('div.stack',
    h('input', { type: 'text', value: name, 'aria-label': 'Workout name', oninput: (e) => { name = e.target.value; } }),
    h('button.btn.primary', { type: 'button', onclick: () => { commitAW((a) => { a.name = name.trim() || a.name; a.named = true; }, { rerender: true }); close(); } }, 'Save')));
}

function exerciseMenu(i) {
  sheet('Exercise', (close) => h('div',
    h('button.list-btn', { type: 'button', onclick: () => { close(); swapSheet(i); } }, 'Swap exercise', h('span.muted', '›')),
    h('button.list-btn', { type: 'button', onclick: () => { close(); setupSheet(i); } }, 'Setup notes (kept for next time)', h('span.muted', '›')),
    h('button.list-btn', { type: 'button', onclick: () => { close(); noteSheet(i); } }, 'Note for today', h('span.muted', '›')),
    h('button.list-btn', { type: 'button', onclick: () => { close(); restSheet(i); } }, 'Change rest time', h('span.muted', '›')),
    partnerIndex(aw(), i) >= 0 ? h('button.list-btn', { type: 'button', onclick: () => { close(); commitAW((a) => { const p = partnerIndex(a, i); delete a.exercises[i].group; delete a.exercises[p].group; }, { rerender: true }); } }, 'Split superset', h('span.muted', '›'))
      : aw().exercises[i + 1] && !aw().exercises[i + 1].group && !aw().exercises[i].group ? h('button.list-btn', { type: 'button', onclick: () => { close(); commitAW((a) => { a.exercises[i].group = 'Z'; a.exercises[i + 1].group = 'Z'; a.exercises = E.cleanGroups(a.exercises); }, { rerender: true }); } }, 'Superset with the next exercise', h('span.muted', '›')) : null,
    h('button.list-btn', { type: 'button', style: { color: 'var(--bad)' }, onclick: () => { close(); commitAW((a) => { a.exercises.splice(i, 1); a.exercises = E.cleanGroups(a.exercises); }, { rerender: true }); } }, 'Remove exercise')));
}

function setupSheet(i) {
  const exId = aw().exercises[i].exId;
  sheet(`Setup notes: ${exName(store.get(), exId)}`, (close) => {
    const ta = h('textarea', { rows: 3, placeholder: 'e.g. seat height 4, narrow grip', 'aria-label': 'Setup notes' }, store.get().exerciseNotes?.[exId] || '');
    return h('div.stack', h('p.small.muted', 'Shown every time you do this exercise.'), ta,
      h('button.btn.primary', { type: 'button', onclick: () => {
        store.commit((s) => { const v = ta.value.trim(); if (v) s.exerciseNotes[exId] = v; else delete s.exerciseNotes[exId]; }, { silent: true, flush: true });
        render(); close();
      } }, 'Save'));
  });
}

function noteSheet(i) {
  const e = aw().exercises[i];
  sheet('Note for today', (close) => {
    const ta = h('textarea', { rows: 3, 'aria-label': 'Note' }, e.note || '');
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
  const prof = profileForSwap(st, w);
  const alts = E.suggestAlternatives(e.exId, prof, library(st), st.exercisePrefs);
  const fav = new Set(st.exercisePrefs.favourite);
  sheet('Swap exercise', (close) => alts.length ? h('div', alts.map((ex) => h('button.list-btn', { type: 'button', onclick: () => {
    commitAW((a, s) => {
      const old = a.exercises[i];
      const fresh = makeEntry(s, ex, { sets: old.sets.filter((x) => !x.warmup).length, goal: a.goal, group: old.group }, { deload: a.deload, profile: a.profileId ? profileOf(s, a.profileId) : null });
      a.exercises[i] = { ...fresh, note: old.note };
    }, { rerender: true });
    close();
  } }, h('span', h('div.ex-name', fav.has(ex.id) ? '★ ' : '', ex.name), h('div.small.muted', ex.type)), h('span.muted', '›')))) : h('p.muted', 'No alternatives with this equipment.'));
}

function addExerciseSheet() {
  const st = store.get();
  const w = aw();
  const excl = new Set(st.exercisePrefs.exclude);
  const fav = new Set(st.exercisePrefs.favourite);
  const avail = E.availableExercises(library(st), profileForSwap(st, w)).filter((e) => !excl.has(e.id))
    .sort((a, b) => fav.has(b.id) - fav.has(a.id));
  sheet('Add exercise', (close) => {
    let q = '';
    let muscle = '';
    const list = h('div');
    const draw = () => list.replaceChildren(...avail.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!muscle || e.primary === muscle)).slice(0, 60)
      .map((ex) => h('button.list-btn', { type: 'button', onclick: () => {
        commitAW((a, s) => { a.exercises.push(makeEntry(s, ex, { sets: 3, goal: a.goal }, { deload: a.deload, profile: a.profileId ? profileOf(s, a.profileId) : null })); }, { rerender: true });
        close();
      } }, h('span', h('div.ex-name', fav.has(ex.id) ? '★ ' : '', ex.name), h('div.small.muted', MUSCLE_LABEL[ex.primary])), h('span.muted', '+'))));
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
  const iv = c.intensity === 'intervals' ? (c.interval || { work: 30, rest: 30, rounds: 10, startedAt: null }) : null;
  const ivField = (key, label) => field(label, numInput({ value: iv[key], decimal: false, label, onInput: (v) => commitAW((a) => {
    const n = parseNum(v); if (!n) return; a.cardio[i].interval = { ...(a.cardio[i].interval || iv), [key]: Math.round(n) };
  }) }));
  return h('div.card.cardio',
    h('div.card-head', h('h3', c.finisher ? 'Finisher' : 'Cardio'),
      h('button.btn.icon.small', { type: 'button', 'aria-label': 'Remove cardio', onclick: () => commitAW((a) => { a.cardio.splice(i, 1); }, { rerender: true }) }, '✕')),
    h('select', { 'aria-label': 'Activity', onchange: (ev) => commitAW((a) => { a.cardio[i].activityId = ev.target.value; }) },
      activities(st).map((a) => h('option', { value: a.id, selected: a.id === c.activityId }, a.name))),
    segmented({ small: true, label: 'Intensity', value: c.intensity, options: [{ value: 'steady', label: 'Steady' }, { value: 'intervals', label: 'Intervals' }], onChange: (v) => commitAW((a) => { a.cardio[i].intensity = v; }, { rerender: true }) }),
    c.intensity === 'steady' ? h('div.tiny.muted', z2 ? `Zone 2: ${z2[0]}–${z2[1]} bpm` : 'Conversational pace (RPE 3–4)') : null,
    iv ? h('div.card.flat',
      iv.startedAt ? h('div.center', h('div.count.num', { 'data-interval': String(i), style: { fontSize: '2rem', fontWeight: 800 } }, ''), h('div.small.muted', { 'data-interval-sub': String(i) }, ''))
        : h('div.grid3', ivField('work', 'Work (s)'), ivField('rest', 'Rest (s)'), ivField('rounds', 'Rounds')),
      h('button.btn.small' + (iv.startedAt ? '' : '.primary'), { type: 'button', onclick: () => commitAW((a) => {
        const x = a.cardio[i];
        x.interval = { ...(x.interval || iv) };
        if (x.interval.startedAt) {
          const stt = L.intervalState(x.interval, Date.now());
          x.minutes = Math.max(1, Math.round(stt.elapsed / 60));
          x.interval.startedAt = null;
        } else x.interval.startedAt = Date.now();
      }, { rerender: true }) }, iv.startedAt ? 'Stop interval timer' : `Start interval timer (${Math.round((iv.rounds * iv.work + (iv.rounds - 1) * iv.rest) / 60)} min)`)) : null,
    h('div.grid3',
      field('Minutes', numInput({ value: c.minutes ?? '', decimal: false, label: 'Minutes', onInput: (v) => commitAW((a) => { a.cardio[i].minutes = parseNum(v); }) })),
      field('Distance km', numInput({ value: c.distanceKm ?? '', label: 'Distance in kilometres', onInput: (v) => commitAW((a) => { a.cardio[i].distanceKm = parseNum(v); }) })),
      field('Avg HR', numInput({ value: c.avgHr ?? '', decimal: false, label: 'Average heart rate', onInput: (v) => commitAW((a) => { a.cardio[i].avgHr = parseNum(v); }) }))),
    h('div.row.between',
      !iv ? h('button.btn.small', { type: 'button', onclick: () => commitAW((a) => {
        const x = a.cardio[i];
        if (x.timerStart) { x.minutes = Math.max(1, Math.round((Date.now() - x.timerStart) / 60000)); x.timerStart = null; }
        else x.timerStart = Date.now();
      }, { rerender: true }) }, running ? h('span', 'Stop ', h('span.num', { 'data-cardio-timer': String(c.timerStart) }, '')) : 'Start timer') : h('span'),
      h('button.tick', { type: 'button', class: c.done ? 'on' : '', 'aria-pressed': String(!!c.done), 'aria-label': 'Cardio done', onclick: () => commitAW((a) => { a.cardio[i].done = !a.cardio[i].done; }, { rerender: true }) }, '✓')));
}

// ---------- Timer bar ----------

function tick() {
  if (!open) return;
  const st = store.get();
  const w = st.activeWorkout;
  if (elapsedEl && w) elapsedEl.textContent = fmtDuration((Date.now() - w.startedAt) / 1000);
  for (const el of document.querySelectorAll('[data-cardio-timer]')) el.textContent = fmtDuration((Date.now() - Number(el.dataset.cardioTimer)) / 1000);
  // Interval timers: beep on each phase change.
  w?.cardio?.forEach((c, i) => {
    if (!c.interval?.startedAt) return;
    const s = L.intervalState(c.interval, Date.now());
    const big = document.querySelector(`[data-interval="${i}"]`);
    const sub = document.querySelector(`[data-interval-sub="${i}"]`);
    if (big) big.textContent = s.phase === 'done' ? 'Done' : `${s.phase === 'work' ? 'Work' : 'Rest'} ${T.display(s.remaining)}`;
    if (sub) sub.textContent = s.phase === 'done' ? `${fmtDuration(s.total)} total` : `Round ${s.round} of ${c.interval.rounds}`;
    const key = `${s.phase}-${s.round}`;
    if (intervalPhase[i] && intervalPhase[i] !== key) { T.beep(); T.vibrate(); }
    intervalPhase[i] = key;
    if (s.phase === 'done') {
      commitAW((a) => { const x = a.cardio[i]; x.minutes = Math.max(1, Math.round(s.total / 60)); x.interval.startedAt = null; x.done = true; }, { rerender: true });
      delete intervalPhase[i];
    }
  });
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
  store.commit((s) => { s.activeWorkout = null; s.timer = null; }, { silent: true, flush: true });
  closeOverlay();
}

function cleanEntry(e) {
  return { exId: e.exId, note: e.note || '', restSec: e.restSec, repMin: e.repMin, repMax: e.repMax, ...(e.group ? { group: e.group } : {}),
    sets: e.sets.filter((s) => s.done && Number.isFinite(s.reps) && s.reps > 0)
      .map((s) => ({ kg: s.kg ?? 0, reps: s.reps, done: true, warmup: !!s.warmup, ...(Number.isFinite(s.rir) ? { rir: s.rir } : {}) })) };
}

/** Name an unnamed workout after its main muscles (or its cardio). */
export function autoName(w, st) {
  if (w.named || w.sessionId || w.name !== 'Workout') return w.name;
  const sets = {};
  for (const e of w.exercises) sets[e.muscle] = (sets[e.muscle] || 0) + e.sets.filter((s) => s.done && !s.warmup).length;
  const top = Object.entries(sets).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([m]) => MUSCLE_LABEL[m]);
  if (top.length) return top.join(' & ');
  const c = w.cardio.find((x) => x.done);
  return c ? actName(st, c.activityId) : 'Workout';
}

function askUnticked(n) {
  return new Promise((resolve) => {
    let done = false;
    sheet('Some sets aren\'t ticked', (close) => h('div.stack',
      h('p', `${n} set${n > 1 ? 's have' : ' has'} a weight and reps but ${n > 1 ? 'aren\'t' : 'isn\'t'} ticked. Did you do ${n > 1 ? 'them' : 'it'}?`),
      h('button.btn.primary', { type: 'button', onclick: () => { done = true; close(); resolve('tick'); } }, 'Yes, mark them done'),
      h('button.btn', { type: 'button', onclick: () => { done = true; close(); resolve('skip'); } }, 'No, leave them out'),
      h('button.btn.ghost', { type: 'button', onclick: () => { done = true; close(); resolve('cancel'); } }, 'Keep logging')),
    { onClose: () => { if (!done) resolve('cancel'); } });
  });
}

async function finish() {
  let w = aw();
  const pending = w.exercises.flatMap((e) => e.sets.filter((s) => !s.done && Number.isFinite(s.reps) && s.reps > 0 && !s.warmup)).length;
  if (pending && !w.editingId) {
    const r = await askUnticked(pending);
    if (r === 'cancel') return;
    if (r === 'tick') commitAW((a) => { for (const e of a.exercises) for (const s of e.sets) if (!s.done && Number.isFinite(s.reps) && s.reps > 0 && !s.warmup) s.done = true; });
  }
  const st = store.get();
  w = aw();
  const now = Date.now();
  const exercises = w.exercises.map(cleanEntry).filter((e) => e.sets.length);
  const cardio = w.cardio.filter((c) => c.done && c.minutes > 0).map((c) => ({ activityId: c.activityId, minutes: c.minutes, distanceKm: c.distanceKm ?? null, avgHr: c.avgHr ?? null, intensity: c.intensity, finisher: !!c.finisher }));
  if (!exercises.length && !cardio.length) {
    const ok = await confirmSheet('Nothing ticked', 'No sets or cardio are marked done. Discard this workout?', { ok: 'Discard', danger: true });
    if (ok) { store.commit((s) => { s.activeWorkout = null; s.timer = null; }, { silent: true, flush: true }); closeOverlay(); }
    return;
  }
  const name = autoName(w, st);
  if (w.editingId) {
    const orig = st.workouts.find((x) => x.id === w.editingId);
    const saved = { ...orig, name, note: w.note || '', exercises, cardio };
    store.commit((s) => {
      s.workouts = recomputeAllPRs(s.workouts.map((x) => (x.id === saved.id ? saved : x)));
      s.activeWorkout = null; s.timer = null;
    }, { silent: true, flush: true });
    closeOverlay();
    toast('Workout updated');
    return;
  }
  const saved = { id: w.id, date: w.date, startedAt: w.startedAt, endedAt: now, durationSec: Math.round((now - w.startedAt) / 1000),
    sessionId: w.sessionId, name, note: w.note || '', exercises, cardio, prs: [] };
  saved.prs = detectPRs(saved, st.workouts.filter((x) => x.date <= saved.date));
  store.commit((s) => { s.workouts.push(saved); s.activeWorkout = null; s.timer = null; }, { silent: true, flush: true });
  closeOverlay();
  summarySheet(saved);
  for (const f of afterFinish) f(saved);
}

/** Hooks run after a workout is saved (e.g. milestone toasts). */
export const afterFinish = [];

function prText(st, p, u) {
  return `${exName(st, p.exId)}: ${p.type === 'e1rm' ? `est. 1RM ${fmtWeight(p.value, u)} (${fmtWeight(p.kg, u)} × ${p.reps})` : p.type === 'weight' ? `heaviest ${fmtWeight(p.kg, u)}` : `${p.reps} reps at ${fmtWeight(p.kg, u)}`}`;
}

function summarySheet(w) {
  const st = store.get();
  const { volume, sets } = workoutVolume(w);
  const mins = w.cardio.reduce((a, c) => a + c.minutes, 0);
  const u = units();
  const best = bestPRsByLift(w.prs);
  sheet('Workout saved', h('div.stack',
    h('div.tiles',
      h('div.tile', h('div.v', fmtDuration(w.durationSec)), h('div.l', 'Duration')),
      h('div.tile', h('div.v', String(sets)), h('div.l', 'Working sets')),
      h('div.tile', h('div.v', fmtWeight(volume, u)), h('div.l', 'Volume')),
      mins ? h('div.tile', h('div.v', `${mins} min`), h('div.l', 'Cardio')) : null),
    best.length ? h('div.card.flat', h('h3', `🏆 PR on ${best.length} lift${best.length > 1 ? 's' : ''}`),
      best.map((p) => h('div.small', prText(st, p, u)))) : h('p.muted.small', 'No PRs this time. Consistency is what counts.')));
}

// ---------- Quick cardio log ----------

export function quickCardio() {
  const st = store.get();
  const d = { date: todayFn(), activityId: 'walk', minutes: 30, distanceKm: null, avgHr: null, intensity: 'steady' };
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
        for (const f of afterFinish) f(w);
      } }, 'Save'));
  });
}

/** Resume a workout left open (e.g. after iOS closed the app). */
export function resumeIfActive() {
  if (aw()) openOverlay();
}
