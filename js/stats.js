// Training and body statistics. Pure, DOM-free.
import { addDays, daysBetween, weekStart as weekOf } from './util.js';

export const E1RM_MAX_REPS = 12;

/** Epley estimated 1RM. r = 1 gives w. */
export function epley(kg, reps) {
  if (!kg || !reps) return 0;
  if (reps === 1) return kg;
  return kg * (1 + reps / 30);
}

export const isWorking = (s) => s.done && !s.warmup && Number.isFinite(s.reps) && s.reps > 0;

/** Best e1RM for an exercise entry (working sets up to 12 reps). */
export function entryE1rm(entry) {
  let best = 0;
  for (const s of entry.sets || []) {
    if (!isWorking(s) || s.reps > E1RM_MAX_REPS) continue;
    best = Math.max(best, epley(s.kg || 0, s.reps));
  }
  return best;
}

/** e1RM series [{x: date, y}] for an exercise, one point per workout (best of the day). */
export function e1rmSeries(exId, workouts) {
  const byDate = {};
  for (const w of workouts) for (const e of w.exercises || []) {
    if (e.exId !== exId) continue;
    const v = entryE1rm(e);
    if (v > 0) byDate[w.date] = Math.max(byDate[w.date] || 0, v);
  }
  return Object.entries(byDate).sort(([a], [b]) => (a < b ? -1 : 1)).map(([x, y]) => ({ x, y }));
}

/** Best e1RM for each exercise within [from, to] dates (inclusive). */
export function bestE1rmInWindow(workouts, from, to) {
  const out = {};
  for (const w of workouts) {
    if (w.date < from || w.date > to) continue;
    for (const e of w.exercises || []) {
      const v = entryE1rm(e);
      if (v > 0) out[e.exId] = Math.max(out[e.exId] || 0, v);
    }
  }
  return out;
}

/** Lifts whose best e1RM in the last 14 days is down >= pct vs the window 28-42 days ago. */
export function e1rmDrops(workouts, today, pct = 5) {
  const recent = bestE1rmInWindow(workouts, addDays(today, -13), today);
  const before = bestE1rmInWindow(workouts, addDays(today, -42), addDays(today, -28));
  const drops = [];
  for (const [id, v] of Object.entries(recent)) {
    const b = before[id];
    if (b && v <= b * (1 - pct / 100)) drops.push({ exId: id, before: b, now: v, pct: ((b - v) / b) * 100 });
  }
  return drops;
}

/** Total logged cardio minutes for workouts dated in [from, to]. */
export function cardioMinutes(workouts, from, to) {
  let t = 0;
  for (const w of workouts) {
    if (w.date < from || w.date > to) continue;
    for (const c of w.cardio || []) t += c.minutes || 0;
  }
  return t;
}

export function cardioMinutesByWeek(workouts) {
  const out = {};
  for (const w of workouts) for (const c of w.cardio || []) {
    const wk = weekOf(w.date);
    out[wk] = (out[wk] || 0) + (c.minutes || 0);
  }
  return out;
}

/** Metric series [{x, y}] sorted by date, skipping null values. */
export function metricSeries(metrics, key) {
  return metrics.filter((m) => m[key] !== null && m[key] !== undefined && Number.isFinite(m[key]))
    .sort((a, b) => (a.date < b.date ? -1 : 1)).map((m) => ({ x: m.date, y: m[key] }));
}

/** Rolling mean over the trailing `days` calendar days at each point. */
export function rollingAverage(series, days = 7) {
  return series.map((p) => {
    const win = series.filter((q) => q.x <= p.x && daysBetween(q.x, p.x) < days);
    return { x: p.x, y: win.reduce((a, q) => a + q.y, 0) / win.length };
  });
}

/** Mean of values dated within the last `days` days up to today; falls back to the latest value. */
export function recentAverage(series, today, days = 7) {
  const win = series.filter((p) => p.x <= today && daysBetween(p.x, today) < days);
  if (win.length) return win.reduce((a, p) => a + p.y, 0) / win.length;
  const past = series.filter((p) => p.x <= today);
  return past.length ? past[past.length - 1].y : null;
}
