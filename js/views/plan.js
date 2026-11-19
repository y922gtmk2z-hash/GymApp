// Plan tab: builder, week calendar, session editing, volume bars, calendar export.
import { h, segmented, sheet, toast, confirmSheet, field, numInput, empty, bar } from '../ui.js';
import * as E from '../engine.js';
import * as W from '../weight.js';
import { MUSCLES, MUSCLE_LABEL } from '../data.js';
import { buildCalendar, planEvents } from '../ics.js';
import { saveFile } from '../share.js';
import { metricSeries, recentAverage } from '../stats.js';
import { addDays, fmtDate, today as todayFn, weekStart, weekday, WEEKDAY_SHORT, parseNum, uid, dateForWeekday, clone } from '../util.js';
import { fmtWeight, toKg, fromKg, fmtBodyWeight } from '../units.js';
import * as store from '../store.js';
import {
  library, activities, exName, actName, exById, profileOf, planFor, sessionMinutes, sessionLines,
  dayLabel, zone2For, workoutForSession,
} from './common.js';

let viewWeek = null;

export function render(root, ctx) {
  const st = ctx.state;
  const today = todayFn();
  const p0 = ctx.params[0];
  if (p0 && /^\d{4}-\d{2}-\d{2}$/.test(p0)) viewWeek = weekStart(p0);
  if (!viewWeek) viewWeek = weekStart(today);
  const wk = viewWeek;
  const plan = planFor(st, wk);
  ctx.setTitle('Plan');
  ctx.setActions(plan ? h('button.btn.small', { type: 'button', onclick: () => exportIcs(wk) }, 'Export') : null);

  root.append(h('div.row.between.nowrap', { style: { marginBottom: '12px' } },
    h('button.btn.icon', { type: 'button', 'aria-label': 'Previous week', onclick: () => { viewWeek = addDays(wk, -7); ctx.rerender(); } }, '‹'),
    h('div.center', h('div', { style: { fontWeight: 700 } }, wk === weekStart(today) ? 'This week' : wk === addDays(weekStart(today), 7) ? 'Next week' : `Week of ${fmtDate(wk)}`),
      h('div.small.muted', `${fmtDate(wk)} – ${fmtDate(addDays(wk, 6))}`)),
    h('button.btn.icon', { type: 'button', 'aria-label': 'Next week', onclick: () => { viewWeek = addDays(wk, 7); ctx.rerender(); } }, '›')));

  if (!plan) {
    root.append(h('div.card',
      empty('No plan for this week', 'Pick your training days and goals, and the plan is built for you.',
        h('div.stack.tight',
          st.plans[addDays(wk, -7)] ? h('button.btn.primary', { type: 'button', onclick: () => { rebuildWeek(wk); toast('Plan built from last week\'s settings'); } }, 'Build from last week\'s settings') : null,
          h('button.btn' + (st.plans[addDays(wk, -7)] ? '' : '.primary'), { type: 'button', onclick: () => openBuilder(wk) }, st.plans[addDays(wk, -7)] ? 'Customise first' : 'Build this week')))));
    return;
  }
  const stack = h('div.stack');
  root.append(stack);
  stack.append(h('div.row.between',
    h('div.row', h('span.badge.accent', goalLabel(plan.goal)), plan.deload ? h('span.badge.warn', 'Deload week') : null,
      plan.stepTarget ? h('span.badge.cardio', `Steps ${plan.stepTarget.toLocaleString('en-GB')}/day`) : null),
    h('button.btn.small', { type: 'button', onclick: () => openBuilder(wk) }, 'Rebuild')));

  for (const w of plan.warnings || []) stack.append(h('div.banner.warn', h('span.small', w)));

  for (const s of plan.sessions) stack.append(sessionCard(st, plan, s, today, ctx));
  stack.append(volumeCard(st, plan));
}

const goalLabel = (g) => ({ muscle: 'Muscle', strength: 'Strength', general: 'General' })[g] || g;

const expanded = new Set();

function sessionCard(st, plan, s, today, ctx) {
  const done = workoutForSession(st, s.id);
  const est = sessionMinutes(s);
  const open = s.kind === 'cardio' || expanded.has(s.id) || (s.date === today && !done);
  const finisher = (s.cardio || []).find((c) => c.finisher);
  const summary = h('button.btn.ghost.small', { type: 'button', 'aria-expanded': 'false', style: { justifyContent: 'space-between', padding: 0 },
    onclick: () => { expanded.add(s.id); ctx.rerender(); } },
    h('span', `${s.exercises.length} exercises${s.exercises.some((e) => e.group) ? ' · supersets' : ''}${finisher ? ` · ${finisher.minutes} min finisher` : ''}`), h('span.muted', 'Show ▾'));
  const head = h('div.card-head',
    h('div', h('div.small.muted', dayLabel(s.date, today) + (s.startTime ? ` · ${s.startTime}` : '')),
      h('h3', s.name, ' ', h('span.badge', profileOf(st, s.profileId).name))),
    h('div.small.muted.num', { title: 'Estimated / available minutes' }, s.kind === 'cardio' ? `${s.minutes} min` : `${est}/${s.minutes} min`));
  const actions = h('div.row',
    done ? h('span.badge.good', 'Done') : null,
    !done ? h('button.btn.small', { type: 'button', onclick: () => openEditor(plan.weekStart, s.id) }, 'Edit') : null,
    !done ? h('button.btn.small', { type: 'button', onclick: () => openMove(plan.weekStart, s.id) }, 'Move') : null,
    !done ? (s.skipped
      ? h('button.btn.small', { type: 'button', onclick: () => updatePlan(plan.weekStart, (p) => E.unskipSession(p, s.id)) }, 'Unskip')
      : h('button.btn.small', { type: 'button', onclick: () => doSkip(plan.weekStart, s.id) }, 'Skip')) : null,
    !done && !s.skipped && s.date <= today && ctx.startWorkout ? h('button.btn.small.primary', { type: 'button', onclick: () => ctx.startWorkout(s.id) }, 'Start') : null);
  const lines = open ? h('div.stack.tight.small', sessionLines(st, s),
    s.kind !== 'cardio' && expanded.has(s.id) ? h('button.btn.ghost.small', { type: 'button', 'aria-expanded': 'true', style: { padding: 0, alignSelf: 'flex-start' }, onclick: () => { expanded.delete(s.id); ctx.rerender(); } }, 'Hide ▴') : null) : summary;
  return h('div.card', { class: [s.kind === 'cardio' ? 'cardio' : '', s.skipped ? 'skipped' : ''].join(' ') },
    head, lines, actions);
}

function volumeCard(st, plan) {
  const targets = E.weeklyTargets(plan.goal, plan.focus);
  const planned = E.plannedSetsByMuscle(plan);
  const rows = MUSCLES.map((m) => {
    const t = targets[m];
    const v = planned[m] || 0;
    const cls = v < t.min ? '.warn' : v > t.max ? '' : '.good';
    const tgt = t.min === t.max ? `${t.max}` : `${t.min}–${t.max}`;
    return h('div.vol-row', h('span', MUSCLE_LABEL[m]), bar(v, Math.max(t.max, v), { cls, label: `${MUSCLE_LABEL[m]} sets` }), h('span.num.small', `${v}/${tgt}`));
  });
  const card = h('div.card', h('div.card-head', h('h3', 'Weekly sets vs target'), h('span.tiny.muted', plan.focus ? 'direct sets' : '')), rows);
  if (plan.cardioTargetMin) {
    const c = E.plannedCardioMinutes(plan);
    card.append(h('div.hr'), h('div.vol-row', h('span', 'Cardio'), bar(c, Math.max(c, plan.cardioTargetMin), { cls: '.cardio', label: 'Cardio minutes' }), h('span.num.small', `${c}/${plan.cardioTargetMin}`)));
  }
  const short = MUSCLES.filter((m) => planned[m] < targets[m].min);
  if (short.length >= 2) {
    const args = {
      weekStart: plan.weekStart, goal: plan.goal, focus: plan.focus, profiles: st.profiles, library: library(st), activities: activities(st),
      settings: st.settings, supersets: !!plan.supersets, prefs: st.exercisePrefs, weightGoal: st.weightGoal?.active ? st.weightGoal : null,
      days: plan.days.map((d) => ({ weekday: weekday(d.date), profileId: d.profileId, minutes: d.minutes, startTime: d.startTime })),
    };
    const opts = plan.days.length >= 2 ? E.whatWouldHelp(args, plan) : [];
    card.append(h('div.stack.tight',
      h('p.small.muted', `${short.length} muscles are below target because the sessions are full.${opts.length ? ' What would help:' : ' Set some muscles to Minimal to make room.'}`),
      opts.map((o) => h('div.row.between.small', h('span', o.label), h('span.badge.good', `+${o.gain} sets`))),
      opts.length ? h('button.btn.small', { type: 'button', onclick: () => openBuilder(plan.weekStart) }, 'Change plan') : null));
  }
  return card;
}

// ---------- Plan mutations ----------

function updatePlan(wk, fn) {
  store.commit((st) => {
    const r = fn(st.plans[wk], st);
    if (r) st.plans[wk] = r;
    st.plans[wk].edited = true;
  });
}

/** Keep sessions that already have a logged workout when a week is rebuilt. */
export function keepFinished(oldPlan, newPlan, st) {
  if (!oldPlan) return newPlan;
  const done = oldPlan.sessions.filter((s) => st.workouts.some((w) => w.sessionId === s.id));
  if (!done.length) return newPlan;
  const sessions = newPlan.sessions.filter((s) => !done.some((d) => d.id === s.id || (d.date === s.date && d.kind === s.kind)));
  sessions.push(...done);
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'lift' ? -1 : 1));
  return { ...newPlan, sessions };
}

/** True if rebuilding would lose something: edits or finished sessions. */
export function rebuildRisk(st, wk) {
  const p = st.plans[wk];
  if (!p) return null;
  const done = p.sessions.filter((s) => st.workouts.some((w) => w.sessionId === s.id)).length;
  if (!p.edited && !done) return null;
  return [p.edited ? 'your edits to this week (swaps, sets, moves and skips)' : null, done ? `${done} finished session${done > 1 ? 's' : ''} will be kept as logged` : null].filter(Boolean);
}

function doSkip(wk, id) {
  const st = store.get();
  const { plan, moved, lost } = E.skipSession(st.plans[wk], id, todayFn());
  store.commit((s) => { s.plans[wk] = { ...plan, edited: true }; });
  const m = Object.values(moved).reduce((a, b) => a + b, 0);
  const l = Object.entries(lost).filter(([, n]) => n > 0);
  const lostN = l.reduce((a, [, n]) => a + n, 0);
  toast(['Skipped.', m ? `${m} sets moved to later sessions.` : '', lostN ? `${lostN} sets didn't fit this week.` : ''].filter(Boolean).join(' '));
}

async function exportIcs(wk) {
  const st = store.get();
  store.commit((s) => { s.plans[wk].icsSequence = (s.plans[wk].icsSequence || 0) + 1; }, { silent: true });
  const plan = store.get().plans[wk];
  const events = planEvents(plan, { exercise: (id) => exName(st, id), activity: (id) => actName(st, id), zone2: zone2For(st, todayFn()) });
  if (!events.length) { toast('Nothing to export'); return; }
  const text = buildCalendar(events, { alarmMinutes: st.settings.alarmMinutes, now: new Date() });
  const r = await saveFile(text, `gym-week-${wk}.ics`, 'text/calendar');
  if (r !== 'cancelled') toast('Calendar file ready. Open it to add to Calendar.');
}

// ---------- Move ----------

function openMove(wk, id) {
  const close = sheet('Move session', (close) => {
    const st = store.get();
    const plan = st.plans[wk];
    const s = plan.sessions.find((x) => x.id === id);
    return h('div.stack',
      h('p.small.muted', `Move ${s.name} to another day this week.`),
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(wk, i);
        const other = plan.sessions.find((x) => x.date === date && x.id !== id && x.kind === s.kind && !x.skipped);
        return h('button.list-btn', { type: 'button', disabled: date === s.date, onclick: async () => {
          const r = E.moveSession(plan, id, date);
          if (r.ok) { store.commit((x) => { x.plans[wk] = { ...r.plan, edited: true }; }); close(); return; }
          const ok = await confirmSheet('Swap days?', `${other.name} is already on ${fmtDate(date, { weekday: true })}. Swap the two sessions?`, { ok: 'Swap' });
          if (ok) { store.commit((x) => { x.plans[wk] = { ...E.swapSessionDates(plan, id, r.conflictId), edited: true }; }); close(); }
        } }, h('span', fmtDate(date, { weekday: true })), h('span.small.muted', date === s.date ? 'current' : other ? other.name : ''));
      }));
  });
  void close;
}

// ---------- Session editor ----------

function openEditor(wk, id) {
  const body = h('div.stack');
  const draw = () => {
    const st = store.get();
    const plan = st.plans[wk];
    const s = plan?.sessions.find((x) => x.id === id);
    body.replaceChildren();
    if (!s) return;
    if (s.kind === 'cardio') { body.append(cardioEditor(st, wk, s, draw)); return; }
    body.append(h('div.row.between', h('span.small.muted', `${profileOf(st, s.profileId).name} · about ${sessionMinutes(s)} of ${s.minutes} min`)));
    s.exercises.forEach((e, i) => {
      body.append(h('div.card.flat',
        h('div.row.between.nowrap',
          h('div.grow', h('div.ex-name', exName(st, e.exId)), h('div.small.muted', `${MUSCLE_LABEL[e.muscle]} · ${e.repMin}–${e.repMax} reps · ${e.restSec}s rest`)),
          h('div.reorder',
            h('button.btn.icon.small', { type: 'button', 'aria-label': 'Move up', disabled: i === 0, onclick: () => { updatePlan(wk, (p) => E.moveExercise(p, id, i, -1)); draw(); } }, '↑'),
            h('button.btn.icon.small', { type: 'button', 'aria-label': 'Move down', disabled: i === s.exercises.length - 1, onclick: () => { updatePlan(wk, (p) => E.moveExercise(p, id, i, 1)); draw(); } }, '↓'))),
        h('div.row.between',
          h('div.row', { role: 'group', 'aria-label': 'Sets' },
            h('button.btn.icon.small', { type: 'button', 'aria-label': 'Remove a set', onclick: () => { updatePlan(wk, (p) => E.setSets(p, id, i, e.sets - 1)); draw(); } }, '−'),
            h('strong.num', `${e.sets} sets`),
            h('button.btn.icon.small', { type: 'button', 'aria-label': 'Add a set', onclick: () => { updatePlan(wk, (p) => E.setSets(p, id, i, e.sets + 1)); draw(); } }, '+')),
          h('div.row',
            h('button.btn.small', { type: 'button', onclick: () => openSwap(wk, id, i, draw) }, 'Swap'),
            h('button.btn.small.danger', { type: 'button', onclick: () => { updatePlan(wk, (p) => E.removeExercise(p, id, i)); draw(); } }, 'Remove')))));
    });
    for (const [ci, c] of (s.cardio || []).entries()) {
      body.append(h('div.card.flat.cardio', h('div.row.between',
        h('span', `Finisher: ${actName(st, c.activityId)}`),
        h('div.row',
          h('button.btn.icon.small', { type: 'button', 'aria-label': 'Shorter', onclick: () => { updatePlan(wk, (p) => E.setCardio(p, id, ci, { minutes: Math.max(5, c.minutes - 5) })); draw(); } }, '−'),
          h('strong.num', `${c.minutes} min`),
          h('button.btn.icon.small', { type: 'button', 'aria-label': 'Longer', onclick: () => { updatePlan(wk, (p) => E.setCardio(p, id, ci, { minutes: c.minutes + 5 })); draw(); } }, '+')))));
    }
    body.append(h('button.btn.block', { type: 'button', onclick: () => openAddExercise(wk, id, draw) }, '+ Add exercise'));
  };
  draw();
  const st = store.get();
  sheet(st.plans[wk].sessions.find((x) => x.id === id).name, body);
}

function cardioEditor(st, wk, s, draw) {
  const c = s.cardio[0];
  const prof = profileOf(st, s.profileId);
  const acts = activities(st).filter((a) => E.isAvailable(a, prof));
  return h('div.stack',
    field('Activity', h('select', { onchange: (e) => { updatePlan(wk, (p) => E.setCardio(p, s.id, 0, { activityId: e.target.value })); draw(); } },
      acts.map((a) => h('option', { value: a.id, selected: a.id === c.activityId }, a.name)))),
    h('div.field', h('label', 'Intensity'), segmented({ label: 'Intensity', value: c.intensity,
      options: [{ value: 'steady', label: 'Steady' }, { value: 'intervals', label: 'Intervals' }],
      onChange: (v) => { updatePlan(wk, (p) => E.setCardio(p, s.id, 0, { intensity: v })); draw(); } })),
    h('div.row.between', h('span', 'Minutes'),
      h('div.row',
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'Shorter', onclick: () => { updatePlan(wk, (p) => { const q = E.setCardio(p, s.id, 0, { minutes: Math.max(10, c.minutes - 5) }); q.sessions.find((x) => x.id === s.id).minutes = Math.max(10, c.minutes - 5); return q; }); draw(); } }, '−'),
        h('strong.num', `${c.minutes} min`),
        h('button.btn.icon.small', { type: 'button', 'aria-label': 'Longer', onclick: () => { updatePlan(wk, (p) => { const q = E.setCardio(p, s.id, 0, { minutes: c.minutes + 5 }); q.sessions.find((x) => x.id === s.id).minutes = c.minutes + 5; return q; }); draw(); } }, '+'))));
}

function openSwap(wk, id, idx, after) {
  sheet('Swap exercise', (close) => {
    const st = store.get();
    const s = st.plans[wk].sessions.find((x) => x.id === id);
    const cur = s.exercises[idx];
    const alts = E.suggestAlternatives(cur.exId, profileOf(st, s.profileId), library(st), st.exercisePrefs);
    if (!alts.length) return h('p.muted', 'No other exercises for this muscle with this profile\'s equipment.');
    return h('div', alts.map((ex) => h('button.list-btn', { type: 'button', onclick: () => {
      updatePlan(wk, (p) => E.swapExercise(p, id, idx, ex, st.settings));
      close(); after();
    } }, h('span', h('div.ex-name', ex.name), h('div.small.muted', ex.type === 'compound' ? 'Compound' : 'Isolation')), h('span.muted', '›'))));
  });
}

function openAddExercise(wk, id, after) {
  sheet('Add exercise', (close) => {
    const st = store.get();
    const s = st.plans[wk].sessions.find((x) => x.id === id);
    const excl = new Set(st.exercisePrefs.exclude);
    const avail = E.availableExercises(library(st), profileOf(st, s.profileId)).filter((e) => !excl.has(e.id));
    let q = '';
    let muscle = '';
    const list = h('div');
    const draw = () => {
      list.replaceChildren(...avail.filter((e) => (!q || e.name.toLowerCase().includes(q)) && (!muscle || e.primary === muscle)).slice(0, 60)
        .map((ex) => h('button.list-btn', { type: 'button', onclick: () => {
          updatePlan(wk, (p) => E.addExercise(p, id, ex, 3, st.settings)); close(); after();
        } }, h('span', h('div.ex-name', ex.name), h('div.small.muted', MUSCLE_LABEL[ex.primary])), h('span.muted', '+'))));
    };
    draw();
    return h('div.stack',
      h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search exercises', oninput: (e) => { q = e.target.value.toLowerCase(); draw(); } }),
      h('select', { 'aria-label': 'Muscle', onchange: (e) => { muscle = e.target.value; draw(); } }, h('option', { value: '' }, 'All muscles'),
        MUSCLES.map((m) => h('option', { value: m }, MUSCLE_LABEL[m]))),
      list);
  });
}

// ---------- Rebuild helpers ----------

/** Rebuild a week from the saved builder settings, keeping choices from the existing plan. */
export function rebuildWeek(wk, { deload } = {}) {
  const st = store.get();
  const existing = st.plans[wk];
  const plan = E.buildWeek({
    weekStart: wk, goal: st.builder.goal, focus: st.builder.focus, days: st.builder.days, profiles: st.profiles,
    library: library(st), activities: activities(st), settings: st.settings, supersets: !!st.builder.supersets, prefs: st.exercisePrefs,
    previousPlan: existing || st.plans[addDays(wk, -7)] || null,
    deload: deload ?? (!!existing?.deload || st.lastDeloadWeek === wk),
    weightGoal: st.weightGoal?.active ? st.weightGoal : null,
  });
  const kept = keepFinished(existing, plan, st);
  store.commit((s) => { s.plans[wk] = kept; });
  return kept;
}

// ---------- Builder ----------

const MINUTES = [30, 45, 60, 90];

function draftFrom(st, wk) {
  const plan = planFor(st, wk);
  const b = clone(st.builder);
  if (plan) {
    b.goal = plan.goal;
    b.focus = { ...plan.focus };
    b.supersets = !!plan.supersets;
    b.days = plan.days.map((d) => ({ weekday: weekday(d.date), profileId: d.profileId, minutes: d.minutes, startTime: d.startTime }));
  }
  const g = st.weightGoal;
  const avg = recentAverage(metricSeries(st.metrics, 'weightKg'), todayFn(), 7);
  b.wl = {
    on: !!g?.active,
    existing: !!g?.active,
    currentKg: avg !== null ? Math.round(avg * 10) / 10 : null,
    targetKg: g?.targetKg ?? null,
    mode: g?.active ? 'date' : 'pace',
    targetDate: g?.targetDate ?? null,
    pacePct: g?.pacePct && W.PACES.includes(g.pacePct) ? g.pacePct : 0.5,
    baselineSteps: g?.baselineSteps ?? null,
    baselineCardioMin: g?.baselineCardioMin ?? null,
    cardioDays: g?.cardioDays ? clone(g.cardioDays) : [],
    finishers: g ? g.finishers : true,
  };
  return b;
}

export function openBuilder(wk) {
  const st0 = store.get();
  const d = draftFrom(st0, wk);
  const units = st0.settings.units;
  const body = h('div.stack');
  const errorBox = h('div');
  const feas = h('div.small');

  const updateFeas = () => {
    feas.replaceChildren();
    if (!d.wl.on) return;
    const start = d.wl.existing ? store.get().weightGoal.startKg : d.wl.currentKg;
    const r = W.checkTarget({ startKg: start, targetKg: d.wl.targetKg, targetDate: d.wl.mode === 'date' ? d.wl.targetDate : null,
      pacePct: d.wl.mode === 'pace' ? d.wl.pacePct : null, heightCm: store.get().user.heightCm }, d.wl.existing ? store.get().weightGoal.startDate : todayFn());
    if (r.status === 'invalid') { feas.append(h('span.warn', r.reason)); return; }
    const kgw = `${fromKg(r.kgPerWeek, units).toFixed(2)} ${units}`;
    const cls = r.status === 'ok' ? '.good' : '.warn';
    feas.append(h('div' + cls, `${r.pacePct.toFixed(2)}% a week (about ${kgw}/week). Target date ${fmtDate(r.targetDate, { year: true })}.`));
    if (r.status === 'ambitious') feas.append(h('div.muted', 'That\'s ambitious for exercise alone. It can work, but a slower pace is easier to keep.'));
    if (r.status === 'too_fast') {
      feas.append(h('div.warn', 'Faster than 1% of body weight a week risks losing muscle.'),
        h('button.btn.small', { type: 'button', onclick: () => { d.wl.mode = 'date'; d.wl.targetDate = r.suggestedDate; drawAll(); } },
          `Use ${fmtDate(r.suggestedDate, { year: true })} instead (0.5%/week)`));
    }
    if (r.bmiWarning) feas.append(h('div.warn', r.bmiWarning));
  };

  const drawAll = () => {
    body.replaceChildren(h('div.stack',
      h('div.field', h('label', 'Goal'), segmented({ label: 'Goal', value: d.goal,
        options: [{ value: 'muscle', label: 'Muscle' }, { value: 'strength', label: 'Strength' }, { value: 'general', label: 'General' }],
        onChange: (v) => { d.goal = v; } })),
      h('div.section-title', 'Focus per muscle'),
      h('button.btn.small', { type: 'button', 'aria-expanded': String(!!d.showFocus), onclick: () => { d.showFocus = !d.showFocus; drawAll(); } },
        d.showFocus ? 'Hide muscles' : `Customise muscles (${focusSummary(d.focus)})`),
      !d.showFocus ? null : h('div.stack.tight', MUSCLES.map((m) => h('div.row.between.nowrap', h('span', { style: { minWidth: '6.5em' } }, MUSCLE_LABEL[m]),
        h('div.grow', segmented({ small: true, label: `${MUSCLE_LABEL[m]} focus`, value: d.focus[m] || 'maintain',
          options: [{ value: 'priority', label: 'Priority' }, { value: 'maintain', label: 'Maintain' }, { value: 'minimal', label: 'Minimal' }],
          onChange: (v) => { d.focus[m] = v; } }))))),
      h('div.section-title', 'Training days'),
      dayChips(d.days.map((x) => x.weekday), (wd) => {
        const i = d.days.findIndex((x) => x.weekday === wd);
        if (i >= 0) d.days.splice(i, 1);
        else {
          const last = d.days[d.days.length - 1] || { profileId: 'gym', minutes: 60, startTime: '18:00' };
          d.days.push({ weekday: wd, profileId: last.profileId, minutes: last.minutes, startTime: last.startTime });
          d.wl.cardioDays = d.wl.cardioDays.filter((c) => c.weekday !== wd);
        }
        d.days.sort((a, b) => a.weekday - b.weekday);
        drawAll();
      }),
      h('div.small.muted', `${d.days.length} days selected (2–6).`),
      d.days.map((day) => dayCard(day, true)),
      h('label.check', h('input', { type: 'checkbox', checked: !!d.supersets, onchange: (e) => { d.supersets = e.target.checked; } }),
        h('span', 'Use supersets ', h('span.small.muted', '(pair opposing muscles back to back to fit more into short sessions)'))),
      h('div.section-title', 'Weight loss'),
      h('label.check', h('input', { type: 'checkbox', checked: d.wl.on, onchange: (e) => { d.wl.on = e.target.checked; drawAll(); } }), 'Weight-loss phase (exercise only)'),
      d.wl.on ? wlSection() : h('p.small.muted', 'Adds cardio, daily steps and a weight target with weekly check-ins. Exercise only: no food tracking.'),
      errorBox,
      h('button.btn.primary.block', { type: 'button', onclick: generate }, 'Build plan'),
    ));
    updateFeas();
  };

  function dayCard(day, lifting) {
    const st = store.get();
    return h('div.card.flat',
      h('div.row.between', h('strong', WEEKDAY_SHORT[day.weekday - 1] + (lifting ? '' : ' · cardio')),
        h('input', { type: 'time', value: day.startTime || (lifting ? '18:00' : '07:00'), 'aria-label': `${WEEKDAY_SHORT[day.weekday - 1]} start time`, style: { width: '8em' },
          onchange: (e) => { day.startTime = e.target.value; } })),
      segmented({ small: true, label: 'Minutes', value: day.minutes, options: (lifting ? MINUTES : [20, 30, 45, 60]).map((m) => ({ value: m, label: `${m} min` })), onChange: (v) => { day.minutes = v; } }),
      h('select', { 'aria-label': 'Equipment profile', onchange: (e) => { day.profileId = e.target.value; } },
        st.profiles.map((p) => h('option', { value: p.id, selected: p.id === day.profileId }, p.name))));
  }

  function wlSection() {
    const wl = d.wl;
    const lifting = d.days.map((x) => x.weekday);
    const inUnit = (kg) => (kg === null || kg === undefined ? '' : String(Math.round(fromKg(kg, units) * 10) / 10));
    return h('div.stack',
      wl.existing ? h('p.small.muted', `Phase started ${fmtDate(store.get().weightGoal.startDate, { year: true })} at ${fmtBodyWeight(store.get().weightGoal.startKg, units)}.`)
        : field(`Current weight (${units})`, numInput({ value: inUnit(wl.currentKg), label: 'Current weight', onInput: (v) => { wl.currentKg = toKg(parseNum(v), units); updateFeas(); } }),
          'From your recent weigh-ins, or enter it now.'),
      field(`Target weight (${units})`, numInput({ value: inUnit(wl.targetKg), label: 'Target weight', onInput: (v) => { wl.targetKg = toKg(parseNum(v), units); updateFeas(); } })),
      segmented({ label: 'Set by', value: wl.mode, options: [{ value: 'pace', label: 'By pace' }, { value: 'date', label: 'By date' }], onChange: (v) => { wl.mode = v; drawAll(); } }),
      wl.mode === 'date'
        ? field('Target date', h('input', { type: 'date', value: wl.targetDate || '', onchange: (e) => { wl.targetDate = e.target.value; updateFeas(); } }))
        : segmented({ label: 'Pace', value: wl.pacePct, options: W.PACES.map((p) => ({ value: p, label: `${p}%/wk` })), onChange: (v) => { wl.pacePct = v; updateFeas(); } }),
      feas,
      !wl.existing ? h('div.grid2',
        field('Daily steps now', numInput({ value: wl.baselineSteps ?? '', decimal: false, label: 'Daily steps now', placeholder: 'e.g. 6000', onInput: (v) => { wl.baselineSteps = parseNum(v); } })),
        field('Cardio min/week now', numInput({ value: wl.baselineCardioMin ?? '', decimal: false, label: 'Cardio minutes per week now', placeholder: 'e.g. 30', onInput: (v) => { wl.baselineCardioMin = parseNum(v); } }))) : null,
      h('div.field', h('label', 'Cardio days'),
        dayChips(wl.cardioDays.map((c) => c.weekday), (wd) => {
          const i = wl.cardioDays.findIndex((c) => c.weekday === wd);
          if (i >= 0) wl.cardioDays.splice(i, 1);
          else wl.cardioDays.push({ weekday: wd, minutes: 30, profileId: 'home', startTime: '07:00' });
          wl.cardioDays.sort((a, b) => a.weekday - b.weekday);
          drawAll();
        }, lifting)),
      wl.cardioDays.map((c) => dayCard(c, false)),
      h('label.check', h('input', { type: 'checkbox', checked: wl.finishers, onchange: (e) => { wl.finishers = e.target.checked; } }), 'Add 10–15 min cardio finishers to lifting days'),
      wl.existing ? h('button.btn.small.danger', { type: 'button', onclick: async () => {
        if (await confirmSheet('End weight-loss phase?', 'Cardio and step targets stop being planned. Your history is kept.', { ok: 'End phase', danger: true })) {
          store.commit((st) => { st.weightGoal = W.endGoal(st.weightGoal, todayFn()); });
          d.wl.on = false; d.wl.existing = false; drawAll();
        }
      } }, 'End phase') : null);
  }

  async function generate() {
    errorBox.replaceChildren();
    const risk = rebuildRisk(store.get(), wk);
    if (risk) {
      const ok = await confirmSheet('Rebuild this week?', `Rebuilding replaces ${risk.join('; ')}.`, { ok: 'Rebuild' });
      if (!ok) return;
    }
    const err = (m) => { errorBox.append(h('div.banner.warn', h('span.small', m))); errorBox.scrollIntoView?.({ block: 'center' }); };
    if (d.days.length < 2 || d.days.length > 6) return err('Pick between 2 and 6 training days.');
    const st = store.get();
    const today = todayFn();
    let goal = st.weightGoal;
    let newMetric = null;
    if (d.wl.on) {
      const start = d.wl.existing ? goal.startKg : d.wl.currentKg;
      const r = W.checkTarget({ startKg: start, targetKg: d.wl.targetKg, targetDate: d.wl.mode === 'date' ? d.wl.targetDate : null,
        pacePct: d.wl.mode === 'pace' ? d.wl.pacePct : null, heightCm: st.user.heightCm }, d.wl.existing ? goal.startDate : today);
      if (r.status === 'invalid') return err(r.reason);
      if (d.wl.existing) {
        goal = { ...clone(goal), targetKg: d.wl.targetKg, targetDate: r.targetDate, pacePct: Math.round(r.pacePct * 100) / 100, cardioDays: clone(d.wl.cardioDays), finishers: d.wl.finishers };
      } else {
        goal = W.createGoal({ startKg: start, targetKg: d.wl.targetKg, targetDate: r.targetDate, pacePct: Math.round(r.pacePct * 100) / 100,
          baselineSteps: d.wl.baselineSteps || 0, baselineCardioMin: d.wl.baselineCardioMin || 0, cardioDays: clone(d.wl.cardioDays),
          finishers: d.wl.finishers, stepCap: st.settings.stepCap }, today);
        const avg = recentAverage(metricSeries(st.metrics, 'weightKg'), today, 7);
        if (avg === null || Math.abs(avg - start) > 0.05) newMetric = { id: uid(), date: today, weightKg: start };
      }
    } else if (goal?.active) {
      goal = W.endGoal(goal, today);
    }
    const existing = st.plans[wk];
    const previous = existing || st.plans[addDays(wk, -7)] || null;
    const plan = E.buildWeek({
      weekStart: wk, goal: d.goal, focus: d.focus, days: d.days, profiles: st.profiles, library: library(st),
      activities: activities(st), settings: st.settings, supersets: !!d.supersets, prefs: st.exercisePrefs, previousPlan: previous, deload: !!existing?.deload || st.lastDeloadWeek === wk,
      weightGoal: goal?.active ? goal : null,
    });
    store.commit((s) => {
      s.builder = { ...s.builder, goal: d.goal, focus: { ...d.focus }, days: clone(d.days), supersets: !!d.supersets };
      s.weightGoal = goal || null;
      if (newMetric) s.metrics.push(newMetric);
      s.plans[wk] = keepFinished(existing, plan, s);
    });
    closeSheet();
    toast('Plan built');
  }

  drawAll();
  const closeSheet = sheet(`Build week of ${fmtDate(wk)}`, body);
}

function focusSummary(focus) {
  const pri = MUSCLES.filter((m) => focus[m] === 'priority').map((m) => MUSCLE_LABEL[m]);
  const min = MUSCLES.filter((m) => focus[m] === 'minimal').map((m) => MUSCLE_LABEL[m]);
  if (!pri.length && !min.length) return 'all Maintain';
  return [pri.length ? `Priority: ${pri.join(', ')}` : null, min.length ? `Minimal: ${min.join(', ')}` : null].filter(Boolean).join(' · ');
}

function dayChips(selected, onToggle, disabled = []) {
  return h('div.row', { role: 'group', 'aria-label': 'Days' }, WEEKDAY_SHORT.map((label, i) => {
    const wd = i + 1;
    return h('button.chip', { type: 'button', 'aria-pressed': String(selected.includes(wd)), disabled: disabled.includes(wd),
      style: disabled.includes(wd) ? { opacity: 0.35 } : undefined, onclick: () => onToggle(wd) }, label);
  }));
}

export { dateForWeekday };
