// Deterministic demo data: 12 weeks of training with a weight-loss phase. Pure.
import { buildWeek } from './engine.js';
import { createGoal } from './weight.js';
import { recomputeAllPRs } from './stats.js';
import { LIBRARY, ACTIVITIES } from './data.js';
import { defaultFocus } from './schema.js';
import { addDays, weekStart, daysBetween, uid } from './util.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

export function withSampleData(base, today) {
  const rand = rng(42);
  const s = JSON.parse(JSON.stringify(base));
  const weeks = 12;
  const start = addDays(weekStart(today), -7 * weeks);
  s.user.name = s.user.name || 'Sam';
  s.user.heightCm = s.user.heightCm || 180;
  s.user.birthYear = s.user.birthYear || 1988;
  s.weightGoal = createGoal({
    startKg: 92, targetKg: 84, targetDate: addDays(start, 7 * 20), pacePct: 0.43, baselineSteps: 6000, baselineCardioMin: 30, finishers: true,
    cardioDays: [{ weekday: 2, minutes: 45, profileId: 'home', startTime: '07:00' }, { weekday: 6, minutes: 60, profileId: 'gym', startTime: '09:00' }],
  }, start);
  s.builder = { goal: 'general', focus: defaultFocus(), days: [1, 3, 5].map((wd) => ({ weekday: wd, profileId: 'gym', minutes: 60, startTime: '18:00' })) };
  s.plans = {};
  s.workouts = [];
  s.metrics = [];
  let prev = null;
  for (let i = 0; i <= weeks; i++) {
    const wk = addDays(start, 7 * i);
    const plan = buildWeek({ weekStart: wk, goal: 'general', focus: s.builder.focus, days: s.builder.days, profiles: s.profiles,
      library: LIBRARY, activities: ACTIVITIES, settings: s.settings, previousPlan: prev, weightGoal: s.weightGoal });
    s.plans[wk] = plan;
    prev = plan;
    for (const sess of plan.sessions) {
      if (sess.date >= today) continue;
      if (rand() < 0.08) continue; // the odd missed session
      const w = { id: uid(), date: sess.date, startedAt: null, endedAt: 1 + i, durationSec: sess.minutes * 60 - Math.round(rand() * 300),
        sessionId: sess.id, name: sess.name, note: '', exercises: [], cardio: [], prs: [] };
      for (const e of sess.exercises) {
        const base = 20 + (hash(e.exId) % 40);
        const kg = Math.round((base + 2.5 * Math.floor(i / 2)) * 2) / 2;
        const span = e.repMax - e.repMin + 1;
        w.exercises.push({ exId: e.exId, note: '', restSec: e.restSec, repMin: e.repMin, repMax: e.repMax,
          sets: Array.from({ length: e.sets }, (_, j) => ({ kg, reps: e.repMin + ((i + j) % span), done: true, warmup: false })) });
      }
      for (const c of sess.cardio || []) w.cardio.push({ activityId: c.activityId, minutes: c.minutes, distanceKm: null, avgHr: 120 + Math.round(rand() * 15), intensity: c.intensity, finisher: !!c.finisher });
      s.workouts.push(w);
    }
  }
  for (let d = 0; d <= weeks * 7; d += 2) {
    const date = addDays(start, d);
    if (date > today) break;
    const t = daysBetween(start, date) / 7;
    s.metrics.push({ id: uid(), date, weightKg: Math.round((92 - 0.42 * t + (rand() - 0.5) * 0.9) * 10) / 10,
      ...(d % 7 === 0 ? { restingHr: Math.round(63 - t * 0.4 + (rand() - 0.5) * 2), waistCm: Math.round((99 - t * 0.35) * 10) / 10, stepsAvg: Math.round(6500 + t * 250 + rand() * 600), sleepHrs: Math.round((6.8 + rand() * 0.8) * 10) / 10 } : {}) });
  }
  s.workouts = recomputeAllPRs(s.workouts);
  s.targets = { 'metric:weightKg': 84, 'metric:waistCm': 92 };
  return s;
}
