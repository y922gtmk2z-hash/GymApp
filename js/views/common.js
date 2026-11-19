// Helpers shared by views.
import { h } from '../ui.js';
import { allExercises, allActivities, findExercise, findActivity } from '../data.js';
import { estimateSessionSec } from '../engine.js';
import { zone2 } from '../weight.js';
import { metricSeries } from '../stats.js';
import { addDays, fmtDate, weekday, WEEKDAY_SHORT, weekStart } from '../util.js';

export const library = (st) => allExercises(st.customExercises);
export const activities = (st) => allActivities(st.customActivities);
export const exName = (st, id) => findExercise(id, st.customExercises)?.name || id;
export const actName = (st, id) => findActivity(id, st.customActivities)?.name || id;
export const exById = (st, id) => findExercise(id, st.customExercises);
export const profileOf = (st, id) => st.profiles.find((p) => p.id === id) || st.profiles[0];

export function latestMetric(st, key) {
  const s = metricSeries(st.metrics, key);
  return s.length ? s[s.length - 1].y : null;
}

export function zone2For(st, today) {
  return zone2(st.user.birthYear, latestMetric(st, 'restingHr'), today);
}

export function planFor(st, wk) {
  return st.plans[wk] || null;
}

export function sessionMinutes(s) {
  return Math.round(estimateSessionSec(s) / 60);
}

/** Workouts that came from a planned session. */
export function workoutForSession(st, sessionId) {
  return st.workouts.find((w) => w.sessionId === sessionId) || null;
}

export function weekStrip(st, wk, today, { onDay } = {}) {
  const plan = planFor(st, wk);
  return h('div.weekstrip', { role: 'list', 'aria-label': 'This week' },
    Array.from({ length: 7 }, (_, i) => {
      const date = addDays(wk, i);
      const sessions = (plan?.sessions || []).filter((s) => s.date === date);
      const dots = sessions.map((s) => {
        const done = workoutForSession(st, s.id);
        return h('span.dot', { class: [s.kind === 'cardio' ? 'cardio' : 'planned', done ? 'done' : '', s.skipped ? 'skipped' : ''].join(' ') });
      });
      const adhoc = st.workouts.some((w) => w.date === date && !w.sessionId);
      if (adhoc) dots.push(h('span.dot.done'));
      const label = `${WEEKDAY_SHORT[i]} ${fmtDate(date)}: ${sessions.length ? sessions.map((s) => s.name + (s.skipped ? ' (skipped)' : '')).join(', ') : 'rest'}`;
      return h(onDay ? 'button.d' : 'div.d', { role: 'listitem', class: date === today ? 'today' : '', 'aria-label': label, onclick: onDay ? () => onDay(date) : undefined, style: onDay ? { border: 0 } : undefined },
        h('span', WEEKDAY_SHORT[i][0]),
        h('strong', String(Number(date.slice(8)))),
        h('span.row', { style: { gap: '2px', minHeight: '10px', justifyContent: 'center' } }, dots));
    }));
}

export function sessionLines(st, s) {
  if (s.kind === 'cardio') {
    const c = s.cardio[0];
    return [h('div.row.between', h('span', actName(st, c.activityId)), h('span.muted.num', `${c.minutes} min · ${c.intensity === 'intervals' ? 'intervals' : 'steady'}`))];
  }
  const labels = supersetLabels(s.exercises);
  const rows = s.exercises.map((e, i) => h('div.row.between.nowrap',
    h('span.grow', labels[i] ? h('span.badge.accent', { style: { marginRight: '6px' }, title: 'Superset' }, labels[i]) : null, exName(st, e.exId)),
    h('span.muted.num', `${e.sets} × ${e.repMin}–${e.repMax}`)));
  for (const c of (s.cardio || []).filter((x) => x.finisher)) {
    rows.push(h('div.row.between.nowrap', h('span.grow', { style: { color: 'var(--cardio)' } }, `Finisher: ${actName(st, c.activityId)}`), h('span.muted.num', `${c.minutes} min`)));
  }
  return rows;
}

/** 'A1', 'A2'... for superset members, null otherwise. */
export function supersetLabels(exercises) {
  const seen = {};
  return exercises.map((e) => (e.group ? `${e.group}${(seen[e.group] = (seen[e.group] || 0) + 1)}` : null));
}

export function dayLabel(date, today) {
  if (date === today) return 'Today';
  if (date === addDays(today, 1)) return 'Tomorrow';
  return fmtDate(date, { weekday: true });
}

export { weekStart, weekday };
