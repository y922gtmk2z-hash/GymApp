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

// ---------- Workouts and PRs ----------

/** Bests for one exercise across workouts: {e1rm, kg, repsAt: {kg: reps}} */
export function exerciseBests(exId, workouts) {
  const b = { e1rm: 0, kg: 0, repsAt: {}, sessions: 0 };
  for (const w of workouts) for (const e of w.exercises || []) {
    if (e.exId !== exId) continue;
    let any = false;
    for (const s of e.sets || []) {
      if (!isWorking(s)) continue;
      any = true;
      const kg = s.kg || 0;
      if (s.reps <= E1RM_MAX_REPS) b.e1rm = Math.max(b.e1rm, epley(kg, s.reps));
      b.kg = Math.max(b.kg, kg);
      b.repsAt[kg] = Math.max(b.repsAt[kg] || 0, s.reps);
    }
    if (any) b.sessions++;
  }
  return b;
}

/** Most reps ever done at weight >= kg. */
function bestRepsAtOrAbove(bests, kg) {
  let r = 0;
  for (const [w, reps] of Object.entries(bests.repsAt)) if (Number(w) >= kg) r = Math.max(r, reps);
  return r;
}

/**
 * PRs in `workout` compared with `prior` workouts. No PRs for an exercise's first-ever session.
 * Returns [{exId, type: 'e1rm'|'weight'|'reps', value, kg, reps, previous}]
 */
export function detectPRs(workout, prior) {
  const prs = [];
  for (const e of workout.exercises || []) {
    const sets = (e.sets || []).filter(isWorking);
    if (!sets.length) continue;
    const before = exerciseBests(e.exId, prior);
    if (!before.sessions) continue;
    let bestE = null;
    for (const s of sets) {
      if (s.reps > E1RM_MAX_REPS) continue;
      const v = epley(s.kg || 0, s.reps);
      if (v > before.e1rm + 1e-9 && (!bestE || v > bestE.value)) bestE = { exId: e.exId, type: 'e1rm', value: v, kg: s.kg, reps: s.reps, previous: before.e1rm };
    }
    if (bestE) prs.push(bestE);
    const heaviest = sets.reduce((a, s) => ((s.kg || 0) > (a.kg || 0) ? s : a), sets[0]);
    if ((heaviest.kg || 0) > before.kg + 1e-9) prs.push({ exId: e.exId, type: 'weight', value: heaviest.kg, kg: heaviest.kg, reps: heaviest.reps, previous: before.kg });
    let bestR = null;
    for (const s of sets) {
      const prev = bestRepsAtOrAbove(before, s.kg || 0);
      if (prev > 0 && s.reps > prev && (!bestR || s.reps - prev > bestR.value - bestR.previous)) {
        bestR = { exId: e.exId, type: 'reps', value: s.reps, kg: s.kg, reps: s.reps, previous: prev };
      }
    }
    if (bestR) prs.push(bestR);
  }
  return prs;
}

/** Recompute PRs for every workout in date order (after an edit or delete). */
export function recomputeAllPRs(workouts) {
  const sorted = [...workouts].sort((a, b) => (a.date === b.date ? (a.endedAt || 0) - (b.endedAt || 0) : a.date < b.date ? -1 : 1));
  const done = [];
  const out = new Map();
  for (const w of sorted) {
    out.set(w.id, detectPRs(w, done));
    done.push(w);
  }
  return workouts.map((w) => ({ ...w, prs: out.get(w.id) || [] }));
}

export function workoutVolume(w) {
  let v = 0, sets = 0;
  for (const e of w.exercises || []) for (const s of e.sets || []) if (isWorking(s)) { v += (s.kg || 0) * s.reps; sets++; }
  return { volume: v, sets };
}

// ---------- Weekly aggregates ----------

/** Direct working sets per muscle per week: {weekStart: {muscle: sets}}. exMuscle(id) -> muscle. */
export function weeklySetsByMuscle(workouts, exMuscle) {
  const out = {};
  for (const w of workouts) {
    const wk = weekOf(w.date);
    for (const e of w.exercises || []) {
      const m = exMuscle(e.exId);
      if (!m) continue;
      const n = (e.sets || []).filter(isWorking).length;
      if (!n) continue;
      out[wk] ||= {};
      out[wk][m] = (out[wk][m] || 0) + n;
    }
  }
  return out;
}

export function sessionsByWeek(workouts) {
  const out = {};
  for (const w of workouts) { const wk = weekOf(w.date); out[wk] = (out[wk] || 0) + 1; }
  return out;
}

export function volumeByWeek(workouts) {
  const out = {};
  for (const w of workouts) {
    const wk = weekOf(w.date);
    out[wk] = (out[wk] || 0) + workoutVolume(w).volume;
  }
  return out;
}

/** List of week starts from `from` to `to` inclusive. */
export function weeksBetween(from, to) {
  const out = [];
  for (let w = weekOf(from); w <= to; w = addDays(w, 7)) out.push(w);
  return out;
}

/** Mean of a metric over [from, to], or null. */
export function meanInWindow(metrics, key, from, to) {
  const v = metrics.filter((m) => m.date >= from && m.date <= to && Number.isFinite(m[key])).map((m) => m[key]);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Change in a metric's 7-day mean vs the previous 7 days, ending today. */
export function weekOverWeek(metrics, key, today) {
  const cur = meanInWindow(metrics, key, addDays(today, -6), today);
  const prev = meanInWindow(metrics, key, addDays(today, -13), addDays(today, -7));
  return { cur, prev, delta: cur !== null && prev !== null ? cur - prev : null };
}

/** One PR per lift (est. 1RM preferred, then heaviest, then reps), in the order lifts first appear. */
export function bestPRsByLift(prs = []) {
  const rank = { e1rm: 0, weight: 1, reps: 2 };
  const best = new Map();
  for (const p of prs) {
    const cur = best.get(p.exId);
    if (!cur || rank[p.type] < rank[cur.type]) best.set(p.exId, p);
  }
  return [...best.values()];
}

/** Number of distinct lifts with a PR across workouts. */
export const liftsWithPRs = (workouts) => workouts.reduce((a, w) => a + bestPRsByLift(w.prs).length, 0);
