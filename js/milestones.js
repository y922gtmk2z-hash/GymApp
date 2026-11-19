// Milestones: achievements worked out from history. Pure, DOM-free.
import { isWorking } from './stats.js';
import { addDays, weekStart } from './util.js';

const LIFTS = [
  ['bench_bb', 'Bench press', [60, 80, 100, 120, 140]],
  ['squat_bb', 'Squat', [60, 100, 140, 180, 220]],
  ['deadlift', 'Deadlift', [100, 140, 180, 220, 260]],
  ['ohp_bb', 'Overhead press', [40, 60, 80, 100]],
];

const sorted = (workouts) => [...workouts].sort((a, b) => (a.date === b.date ? (a.endedAt || 0) - (b.endedAt || 0) : a.date < b.date ? -1 : 1));

/**
 * All milestones reached, in date order: [{id, title, date, kind}].
 * input: {workouts, metrics, weightGoal}
 */
export function milestones({ workouts = [], metrics = [], weightGoal = null }) {
  const out = [];
  const add = (id, title, date, kind) => out.push({ id, title, date, kind });
  const ws = sorted(workouts);

  // Workout counts
  const counts = [1, 10, 25, 50, 100, 250, 500];
  ws.forEach((w, i) => { if (counts.includes(i + 1)) add(`workouts_${i + 1}`, i ? `${i + 1} workouts` : 'First workout', w.date, 'consistency'); });

  // Week streaks (consecutive weeks with at least one workout)
  const weeks = [...new Set(ws.map((w) => weekStart(w.date)))].sort();
  let streak = 0;
  let prev = null;
  const streakMarks = [4, 8, 12, 26, 52];
  for (const wk of weeks) {
    streak = prev && addDays(prev, 7) === wk ? streak + 1 : 1;
    prev = wk;
    if (streakMarks.includes(streak) && !out.some((m) => m.id === `streak_${streak}`)) {
      const first = ws.find((w) => weekStart(w.date) === wk);
      add(`streak_${streak}`, `${streak} weeks in a row`, first.date, 'consistency');
    }
  }

  // Heaviest working weight on key lifts, total volume, cardio minutes, PRs
  const best = {};
  let volume = 0, cardio = 0, prCount = 0;
  const volMarks = [10000, 100000, 1000000];
  const cardioMarks = [1000, 5000, 10000];
  for (const w of ws) {
    for (const e of w.exercises || []) {
      for (const s of e.sets || []) {
        if (!isWorking(s)) continue;
        volume += (s.kg || 0) * s.reps;
        const lift = LIFTS.find((l) => l[0] === e.exId);
        if (lift && (s.kg || 0) > (best[e.exId] || 0)) {
          for (const kg of lift[2]) if (s.kg >= kg && (best[e.exId] || 0) < kg) add(`${e.exId}_${kg}`, `${lift[1]} ${kg} kg`, w.date, 'strength');
          best[e.exId] = s.kg;
        }
      }
    }
    for (const t of volMarks) if (volume >= t && !out.some((m) => m.id === `volume_${t}`)) add(`volume_${t}`, `${t / 1000} tonnes lifted`, w.date, 'strength');
    const before = cardio;
    cardio += (w.cardio || []).reduce((a, c) => a + (c.minutes || 0), 0);
    for (const t of cardioMarks) if (before < t && cardio >= t) add(`cardio_${t}`, `${t.toLocaleString('en-GB')} cardio minutes`, w.date, 'cardio');
    const lifts = new Set((w.prs || []).map((p) => p.exId)).size;
    if (lifts) {
      const b = prCount;
      prCount += lifts;
      if (b === 0) add('pr_1', 'First PR', w.date, 'strength');
      for (const t of [10, 50, 100]) if (b < t && prCount >= t) add(`pr_${t}`, `${t} PRs`, w.date, 'strength');
    }
  }

  // Weight lost during a weight-loss phase
  if (weightGoal?.startKg) {
    const ms = metrics.filter((m) => Number.isFinite(m.weightKg) && m.date >= weightGoal.startDate).sort((a, b) => (a.date < b.date ? -1 : 1));
    for (const kg of [1, 2.5, 5, 10, 15, 20]) {
      const hit = ms.find((m) => m.weightKg <= weightGoal.startKg - kg);
      if (hit) add(`lost_${kg}`, `${kg} kg lost`, hit.date, 'body');
    }
    const goal = ms.find((m) => m.weightKg <= weightGoal.targetKg);
    if (goal) add(`goal_${weightGoal.startDate}`, 'Weight target reached', goal.date, 'body');
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Milestones not yet seen. */
export function newMilestones(all, seen = []) {
  const s = new Set(seen);
  return all.filter((m) => !s.has(m.id));
}

/** Days trained in the last `weeks` weeks ending this week: {date: count}. */
export function activityByDay(workouts, today, weeks = 16) {
  const from = addDays(weekStart(today), -7 * (weeks - 1));
  const out = {};
  for (const w of workouts) if (w.date >= from && w.date <= today) out[w.date] = (out[w.date] || 0) + 1;
  return { from, days: out };
}
