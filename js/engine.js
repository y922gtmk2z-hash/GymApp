// Plan, progression and deload rules. Pure and DOM-free: callers pass `today` and data in.
import { MUSCLES, findExercise } from './data.js';
import { loadKind, addIncrement, roundDownToIncrement } from './units.js';
import { dateForWeekday, addDays, daysBetween, weekStart as weekOf, clone } from './util.js';
import * as weight from './weight.js';

// ---------- Tables ----------

export const SET_TARGETS = {
  muscle: { priority: { min: 12, max: 14 }, maintain: { min: 8, max: 8 }, minimal: { min: 4, max: 4 } },
  strength: { priority: { min: 10, max: 10 }, maintain: { min: 6, max: 6 }, minimal: { min: 3, max: 3 } },
  general: { priority: { min: 10, max: 10 }, maintain: { min: 7, max: 7 }, minimal: { min: 4, max: 4 } },
};

export const REP_REST = {
  muscle: { compound: { repMin: 6, repMax: 10, restSec: 120 }, isolation: { repMin: 10, repMax: 15, restSec: 75 } },
  strength: { compound: { repMin: 3, repMax: 6, restSec: 180 }, isolation: { repMin: 6, repMax: 10, restSec: 90 } },
  general: { compound: { repMin: 8, repMax: 12, restSec: 90 }, isolation: { repMin: 10, repMax: 15, restSec: 60 } },
};

export const GOALS = ['muscle', 'strength', 'general'];
export const FOCI = ['priority', 'maintain', 'minimal'];

export const SPLITS = {
  2: ['full_a', 'full_b'],
  3: ['full_a', 'full_b', 'full_c'],
  4: ['upper_a', 'lower_a', 'upper_b', 'lower_b'],
  5: ['upper', 'lower', 'push', 'pull', 'legs'],
  6: ['push_a', 'pull_a', 'legs_a', 'push_b', 'pull_b', 'legs_b'],
};

export const SPLIT_MUSCLES = {
  full: [...MUSCLES],
  upper: ['chest', 'back', 'shoulders', 'biceps', 'triceps'],
  lower: ['quads', 'hamstrings', 'glutes', 'calves', 'core'],
  push: ['chest', 'shoulders', 'triceps'],
  pull: ['back', 'biceps', 'core'],
  legs: ['quads', 'hamstrings', 'glutes', 'calves', 'core'],
};

export const MAX_SETS_PER_EXERCISE = 4;
export const MAX_SETS_PER_MUSCLE_SESSION = 12;
export const WARMUP_SEC = 300;
export const SEC_PER_SET = 40;

export const splitType = (key) => key.split('_')[0];
export function splitName(key) {
  const [t, v] = key.split('_');
  const base = t[0].toUpperCase() + t.slice(1);
  return v ? `${base} ${v.toUpperCase()}` : base;
}
export const isLowerDay = (key) => ['lower', 'legs', 'full'].includes(splitType(key));

// ---------- Selection ----------

export function selectSplit(nDays) {
  const s = SPLITS[nDays];
  if (!s) throw new RangeError(`Training days must be 2-6, got ${nDays}`);
  return [...s];
}

export function weeklyTargets(goal, focus) {
  const t = SET_TARGETS[goal];
  if (!t) throw new RangeError(`Unknown goal ${goal}`);
  return Object.fromEntries(MUSCLES.map((m) => [m, { ...t[focus?.[m] || 'maintain'] }]));
}

export function repRest(goal, type, exId, settings = {}) {
  const base = REP_REST[goal]?.[type] || REP_REST.general[type];
  const override = settings.restOverrides?.[exId] ?? settings.restDefaults?.[type] ?? null;
  return { repMin: base.repMin, repMax: base.repMax, restSec: override ?? base.restSec };
}

/** True if the profile has any of the exercise's equipment alternatives. Bodyweight is always available. */
export function isAvailable(ex, profile) {
  const have = new Set([...(profile?.equipment || []), 'bodyweight']);
  if (!ex.equip || !ex.equip.length) return true;
  return ex.equip.some((alt) => alt.every((t) => have.has(t)));
}

export function availableExercises(library, profile) {
  return library.filter((ex) => isAvailable(ex, profile));
}

// ---------- Volume allocation ----------

/**
 * Spread weekly targets over sessions.
 * Returns { perSession: [{muscle: sets}], deficits: {muscle: sets} }.
 */
export function allocateVolume(targets, splitKeys) {
  const perSession = splitKeys.map(() => ({}));
  const deficits = {};
  for (const m of MUSCLES) {
    const total = targets[m]?.max || 0;
    if (!total) continue;
    let apps = splitKeys.map((k, i) => (SPLIT_MUSCLES[splitType(k)].includes(m) ? i : -1)).filter((i) => i >= 0);
    if (!apps.length) { deficits[m] = total; continue; }
    while (apps.length > 1 && total / apps.length < 2) apps = apps.slice(0, -1);
    const n = apps.length;
    const base = Math.floor(total / n);
    const rem = total % n;
    const alloc = apps.map((_, j) => base + (j < rem ? 1 : 0));
    // Cap per session, move overflow to other appearances under the cap.
    let overflow = 0;
    for (let j = 0; j < n; j++) if (alloc[j] > MAX_SETS_PER_MUSCLE_SESSION) { overflow += alloc[j] - MAX_SETS_PER_MUSCLE_SESSION; alloc[j] = MAX_SETS_PER_MUSCLE_SESSION; }
    for (let j = 0; j < n && overflow > 0; j++) {
      const room = MAX_SETS_PER_MUSCLE_SESSION - alloc[j];
      const add = Math.min(room, overflow);
      alloc[j] += add; overflow -= add;
    }
    if (overflow > 0) deficits[m] = overflow;
    apps.forEach((si, j) => { perSession[si][m] = alloc[j]; });
  }
  return { perSession, deficits };
}

export function exerciseCountForSets(sets) {
  if (sets <= 0) return 0;
  const n = sets <= 4 ? 1 : sets <= 8 ? 2 : 3;
  return Math.max(n, Math.ceil(sets / MAX_SETS_PER_EXERCISE));
}

const rotate = (arr, k) => (arr.length ? [...arr.slice(k % arr.length), ...arr.slice(0, k % arr.length)] : arr);

/**
 * Choose exercises for one muscle in one session.
 * candidates: available exercises (any muscle); filtered here by primary muscle.
 * Returns { items: [{exId, muscle, sets, repMin, repMax, restSec}], unfilled }.
 */
export function pickExercises({ muscle, sets, candidates, appearanceIndex = 0, goal, settings = {}, used = new Set(), preferred = [] }) {
  const mine = candidates.filter((e) => e.primary === muscle && !used.has(e.id));
  const compounds = mine.filter((e) => e.type === 'compound');
  const isos = mine.filter((e) => e.type === 'isolation');
  let pool;
  if (goal === 'strength' && compounds.length) pool = [compounds[0], ...rotate(compounds.slice(1), appearanceIndex), ...rotate(isos, appearanceIndex)];
  else if (compounds.length) pool = [...rotate(compounds, appearanceIndex), ...rotate(isos, appearanceIndex)];
  else pool = rotate(isos, appearanceIndex);
  // Preferred (e.g. last week's choices) go first if still available.
  const pref = preferred.map((id) => mine.find((e) => e.id === id)).filter(Boolean);
  pool = [...pref, ...pool.filter((e) => !pref.includes(e))];

  const want = exerciseCountForSets(sets);
  const chosen = [];
  const take = (list, limit, uniquePattern) => {
    for (const ex of list) {
      if (chosen.length >= limit) return;
      if (chosen.includes(ex)) continue;
      if (uniquePattern && chosen.some((c) => c.pattern === ex.pattern)) continue;
      chosen.push(ex);
    }
  };
  // Preferred first, then compounds (varying movement pattern where possible). With 3 exercises
  // and isolations available, the last slot is an isolation.
  take(pref, want, false);
  const poolC = pool.filter((e) => e.type === 'compound');
  const poolI = pool.filter((e) => e.type === 'isolation');
  const compoundSlots = want >= 3 && poolI.length ? want - 1 : want;
  take(poolC, compoundSlots, true);
  take(poolC, compoundSlots, false);
  take(poolI, want, true);
  take(poolI, want, false);
  take(poolC, want, false);
  // Order: compounds first, keep pool order otherwise.
  chosen.sort((a, b) => (a.type === b.type ? pool.indexOf(a) - pool.indexOf(b) : a.type === 'compound' ? -1 : 1));
  if (!chosen.length) return { items: [], unfilled: sets };
  const n = chosen.length;
  const capacity = n * MAX_SETS_PER_EXERCISE;
  const give = Math.min(sets, capacity);
  const base = Math.floor(give / n);
  const rem = give % n;
  const items = chosen.map((ex, j) => ({
    exId: ex.id, muscle, sets: base + (j < rem ? 1 : 0),
    ...repRest(goal, ex.type, ex.id, settings),
  })).filter((it) => it.sets > 0);
  for (const it of items) used.add(it.exId);
  return { items, unfilled: sets - give };
}

// ---------- Time budget ----------

export function estimateSessionSec(session) {
  if (session.kind === 'cardio') return sumCardio(session) * 60;
  let t = WARMUP_SEC;
  for (const e of session.exercises || []) t += e.sets * (SEC_PER_SET + e.restSec);
  return t + finisherMinutes(session) * 60;
}

export const finisherMinutes = (session) => (session.cardio || []).filter((c) => c.finisher).reduce((a, c) => a + c.minutes, 0);
const sumCardio = (session) => (session.cardio || []).reduce((a, c) => a + c.minutes, 0);

const TIER = { minimal: 0, maintain: 1, priorityAbove: 2, priority: 3 };

/**
 * Remove sets until the session fits its time budget.
 * floors: {muscle: sets} — Priority muscles above their floor are cut before Priority at floor.
 * Returns { session, trimmed: {muscle: n} }.
 */
export function fitTimeBudget(session, focus, floors = {}) {
  const s = clone(session);
  const trimmed = {};
  const budget = s.minutes * 60;
  const setsOf = (m) => s.exercises.filter((e) => e.muscle === m).reduce((a, e) => a + e.sets, 0);
  let guard = 500;
  while (estimateSessionSec(s) > budget && guard-- > 0) {
    const muscles = [...new Set(s.exercises.filter((e) => e.sets > 0).map((e) => e.muscle))];
    if (!muscles.length) break;
    const tierOf = (m) => {
      const f = focus?.[m] || 'maintain';
      if (f !== 'priority') return TIER[f];
      return setsOf(m) > (floors[m] ?? 0) ? TIER.priorityAbove : TIER.priority;
    };
    const minTier = Math.min(...muscles.map(tierOf));
    const inTier = muscles.filter((m) => tierOf(m) === minTier);
    inTier.sort((a, b) => setsOf(b) - setsOf(a) || MUSCLES.indexOf(b) - MUSCLES.indexOf(a));
    const m = inTier[0];
    const exs = s.exercises.filter((e) => e.muscle === m && e.sets > 0);
    const target = [...exs].reverse().find((e) => typeOf(e) === 'isolation') || exs[exs.length - 1];
    target.sets -= 1;
    trimmed[m] = (trimmed[m] || 0) + 1;
    s.exercises = s.exercises.filter((e) => e.sets > 0);
  }
  return { session: s, trimmed };
}

function typeOf(item) {
  return item.type || (item.repMin <= 6 || item.restSec >= 120 ? 'compound' : 'isolation');
}

const ORDER_RANK = (item) => {
  if (item.muscle === 'core') return 2;
  if (item.muscle === 'calves') return 3;
  return typeOf(item) === 'compound' ? 0 : 1;
};

/** Compounds, then isolations, then core, then calves. Stable. */
export function orderSession(exercises) {
  return exercises.map((e, i) => [e, i]).sort((a, b) => ORDER_RANK(a[0]) - ORDER_RANK(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// ---------- Week building ----------

/**
 * Build a week plan.
 * args: { weekStart, goal, focus, days:[{weekday, profileId, minutes, startTime}], profiles, library,
 *         settings, previousPlan?, deload?, weightGoal?, activities?, stepCap? }
 */
export function buildWeek(args) {
  const { weekStart, goal, focus, profiles, library, settings = {}, previousPlan = null, deload = false } = args;
  const days = [...args.days]
    .map((d) => ({ ...d, date: d.date || dateForWeekday(weekStart, d.weekday) }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const splitKeys = selectSplit(days.length);
  const targets = weeklyTargets(goal, focus);
  const { perSession, deficits: allocDeficits } = allocateVolume(targets, splitKeys);
  const warnings = [];
  const deficits = { ...allocDeficits };
  const profileById = (id) => profiles.find((p) => p.id === id) || profiles[0];

  // Weight-loss cardio (finishers reduce lifting budgets).
  let cardio = null;
  const wg = args.weightGoal?.active ? args.weightGoal : null;
  if (wg) {
    const weekIndex = weight.weekIndex(wg, weekStart);
    const cardioMin = weight.cardioTarget(wg, weekIndex);
    cardio = weight.allocateCardio({
      cardioMin, weekStart, weekIndex, finishers: wg.finishers,
      liftSessions: days.map((d, i) => ({ date: d.date, minutes: d.minutes, splitKey: splitKeys[i], profileId: d.profileId })),
      cardioDays: (wg.cardioDays || []).map((c) => ({ ...c, date: dateForWeekday(weekStart, c.weekday) }))
        .filter((c) => !days.some((d) => d.date === c.date)),
      profiles, activities: args.activities || [],
    });
    warnings.push(...cardio.warnings);
  }

  const appearances = {};
  const sessions = days.map((d, i) => {
    const key = splitKeys[i];
    const profile = profileById(d.profileId);
    const available = availableExercises(library, profile);
    const prev = previousPlan?.sessions?.find((s) => s.splitKey === key && s.kind !== 'cardio');
    const used = new Set();
    let exercises = [];
    for (const m of MUSCLES) {
      const sets = perSession[i][m];
      if (!sets) continue;
      const appearanceIndex = appearances[m] = (appearances[m] ?? -1) + 1;
      const preferred = (prev?.exercises || []).filter((e) => e.muscle === m).map((e) => e.exId);
      const { items, unfilled } = pickExercises({ muscle: m, sets, candidates: available, appearanceIndex, goal, settings, used, preferred });
      if (!items.length) warnings.push(`No ${m} exercise available in ${profile.name}`);
      if (unfilled) deficits[m] = (deficits[m] || 0) + unfilled;
      exercises.push(...items.map((it) => ({ ...it, type: findType(library, it.exId) })));
    }
    const fin = cardio?.finishers.find((f) => f.index === i);
    const session = {
      id: `s-${weekStart}-${key}`, kind: 'lift', date: d.date, name: splitName(key), splitKey: key,
      profileId: profile.id, minutes: d.minutes, startTime: d.startTime || '18:00', skipped: false,
      exercises,
      cardio: fin ? [{ activityId: fin.activityId, minutes: fin.minutes, intensity: 'steady', finisher: true }] : [],
    };
    const floors = priorityFloors(targets, perSession[i], focus);
    const fitted = fitTimeBudget(session, focus, floors);
    for (const [m, n] of Object.entries(fitted.trimmed)) deficits[m] = (deficits[m] || 0) + n;
    fitted.session.exercises = orderSession(fitted.session.exercises);
    return fitted.session;
  });
  // Muscles that appear but have no exercises at all: count whole allocation as deficit (already warned).
  if (cardio) sessions.push(...cardio.sessions);
  sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'lift' ? -1 : 1));

  let plan = {
    weekStart, goal, focus: { ...focus }, deload: false,
    days: days.map((d) => ({ date: d.date, weekday: d.weekday, profileId: d.profileId, minutes: d.minutes, startTime: d.startTime })),
    sessions, warnings: [...new Set(warnings)], deficits,
    cardioTargetMin: cardio ? cardio.target : 0,
    stepTarget: wg ? wg.levels.steps : null,
    icsSequence: previousPlan?.weekStart === weekStart ? (previousPlan.icsSequence || 0) + 1 : 0,
  };
  if (deload) plan = applyDeload(plan);
  return plan;
}

function findType(library, id) {
  return library.find((e) => e.id === id)?.type || 'isolation';
}

/** Per-session floor for Priority muscles: allocation scaled by min/max. */
function priorityFloors(targets, alloc, focus) {
  const floors = {};
  for (const [m, sets] of Object.entries(alloc)) {
    if (focus?.[m] === 'priority') floors[m] = Math.round((sets * targets[m].min) / targets[m].max);
  }
  return floors;
}

// ---------- Plan queries and edits ----------

export function plannedSetsByMuscle(plan) {
  const out = Object.fromEntries(MUSCLES.map((m) => [m, 0]));
  for (const s of plan.sessions) {
    if (s.skipped || s.kind === 'cardio') continue;
    for (const e of s.exercises) out[e.muscle] = (out[e.muscle] || 0) + e.sets;
  }
  return out;
}

export function plannedCardioMinutes(plan) {
  let t = 0;
  for (const s of plan.sessions) if (!s.skipped) t += (s.cardio || []).reduce((a, c) => a + c.minutes, 0);
  return t;
}

/** Budget for the lifting part of a session (seconds). */
export const sessionBudgetSec = (s) => s.minutes * 60;

function editSession(plan, sessionId, fn) {
  const p = clone(plan);
  const s = p.sessions.find((x) => x.id === sessionId);
  if (!s) throw new Error(`No session ${sessionId}`);
  fn(s, p);
  return p;
}

export function swapExercise(plan, sessionId, idx, newEx, settings = {}) {
  return editSession(plan, sessionId, (s, p) => {
    const old = s.exercises[idx];
    const rr = repRest(p.goal, newEx.type, newEx.id, settings);
    s.exercises[idx] = { exId: newEx.id, muscle: newEx.primary, type: newEx.type, sets: old.sets, ...rr };
    const fitted = fitTimeBudget(s, p.focus, {});
    s.exercises = fitted.session.exercises;
  });
}

export function setSets(plan, sessionId, idx, sets) {
  return editSession(plan, sessionId, (s) => {
    s.exercises[idx].sets = Math.max(0, Math.min(10, sets));
    if (s.exercises[idx].sets === 0) s.exercises.splice(idx, 1);
  });
}

export function removeExercise(plan, sessionId, idx) {
  return editSession(plan, sessionId, (s) => { s.exercises.splice(idx, 1); });
}

export function addExercise(plan, sessionId, ex, sets = 3, settings = {}) {
  return editSession(plan, sessionId, (s, p) => {
    s.exercises.push({ exId: ex.id, muscle: ex.primary, type: ex.type, sets, ...repRest(p.goal, ex.type, ex.id, settings) });
  });
}

export function moveExercise(plan, sessionId, idx, dir) {
  return editSession(plan, sessionId, (s) => {
    const j = idx + dir;
    if (j < 0 || j >= s.exercises.length) return;
    [s.exercises[idx], s.exercises[j]] = [s.exercises[j], s.exercises[idx]];
  });
}

export function setCardio(plan, sessionId, idx, patch) {
  return editSession(plan, sessionId, (s) => { Object.assign(s.cardio[idx], patch); });
}

/** Move a session to another date. Fails if a session of the same kind already occupies that date. */
export function moveSession(plan, sessionId, newDate) {
  const s = plan.sessions.find((x) => x.id === sessionId);
  const clash = plan.sessions.find((x) => x.id !== sessionId && x.date === newDate && !x.skipped && x.kind === s.kind);
  if (clash) return { ok: false, conflictId: clash.id, plan };
  const p = editSession(plan, sessionId, (x) => { x.date = newDate; });
  p.sessions.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind === 'lift' ? -1 : 1));
  return { ok: true, plan: p };
}

export function swapSessionDates(plan, idA, idB) {
  const p = clone(plan);
  const a = p.sessions.find((x) => x.id === idA);
  const b = p.sessions.find((x) => x.id === idB);
  [a.date, b.date] = [b.date, a.date];
  p.sessions.sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : 0));
  return p;
}

/**
 * Skip a session and move its volume to remaining sessions this week (date >= today) that
 * train the same muscles (or, for cardio, to remaining cardio sessions), within budgets and caps.
 */
export function skipSession(plan, sessionId, today) {
  const p = clone(plan);
  const s = p.sessions.find((x) => x.id === sessionId);
  s.skipped = true;
  const moved = {};
  const lost = {};
  const future = p.sessions.filter((x) => x.id !== sessionId && !x.skipped && x.date >= today);
  if (s.kind === 'cardio') {
    let left = s.cardio.reduce((a, c) => a + c.minutes, 0);
    for (const f of future.filter((x) => x.kind === 'cardio')) {
      const room = Math.max(0, (f.maxMinutes || f.minutes) - sumCardio(f));
      const add = Math.min(room, left);
      if (add > 0) { f.cardio[0].minutes += add; f.minutes = sumCardio(f); left -= add; }
    }
    if (left > 0) lost.cardio = left;
    p.deficits = { ...(p.deficits || {}), ...(left > 0 ? { cardio: (p.deficits?.cardio || 0) + left } : {}) };
    return { plan: p, moved, lost };
  }
  const byMuscle = {};
  for (const e of s.exercises) byMuscle[e.muscle] = (byMuscle[e.muscle] || 0) + e.sets;
  for (const [m, n] of Object.entries(byMuscle)) {
    let left = n;
    const targets = future.filter((f) => f.kind !== 'cardio' && f.exercises.some((e) => e.muscle === m));
    let progress = true;
    while (left > 0 && progress) {
      progress = false;
      for (const f of targets) {
        if (left <= 0) break;
        const musSets = f.exercises.filter((e) => e.muscle === m).reduce((a, e) => a + e.sets, 0);
        if (musSets >= MAX_SETS_PER_MUSCLE_SESSION) continue;
        const ex = f.exercises.filter((e) => e.muscle === m && e.sets < MAX_SETS_PER_EXERCISE).sort((a, b) => a.sets - b.sets)[0];
        if (!ex) continue;
        ex.sets += 1;
        if (estimateSessionSec(f) > f.minutes * 60) { ex.sets -= 1; continue; }
        left -= 1; progress = true;
        moved[m] = (moved[m] || 0) + 1;
      }
    }
    if (left > 0) lost[m] = left;
  }
  p.deficits = { ...(p.deficits || {}) };
  for (const [m, n] of Object.entries(lost)) p.deficits[m] = (p.deficits[m] || 0) + n;
  return { plan: p, moved, lost };
}

export function unskipSession(plan, sessionId) {
  return editSession(plan, sessionId, (s) => { s.skipped = false; });
}

/** Same-muscle alternatives available in the profile: same pattern, then listed alternatives, then the rest. */
export function suggestAlternatives(exId, profile, library) {
  const ex = library.find((e) => e.id === exId) || findExercise(exId);
  if (!ex) return [];
  const cands = availableExercises(library, profile).filter((e) => e.primary === ex.primary && e.id !== exId);
  const rank = (e) => (e.pattern === ex.pattern ? 0 : ex.alternatives?.includes(e.id) ? 1 : 2);
  return cands.map((e, i) => [e, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map((x) => x[0]);
}

// ---------- Deload ----------

export function applyDeload(plan) {
  const p = clone(plan);
  p.deload = true;
  for (const s of p.sessions) {
    for (const e of s.exercises || []) e.sets = Math.max(1, Math.round(e.sets * 0.6));
    for (const c of s.cardio || []) c.minutes = Math.max(c.finisher ? 5 : 10, Math.round(c.minutes * 0.6));
    if (s.kind === 'cardio') s.minutes = sumCardio(s);
  }
  if (p.cardioTargetMin) p.cardioTargetMin = Math.round(p.cardioTargetMin * 0.6);
  return p;
}

// ---------- Progression ----------

export const workingSets = (entry) => (entry?.sets || []).filter((s) => s.done && !s.warmup && Number.isFinite(s.reps) && s.reps > 0);

/** History for one exercise: newest first, [{date, workoutId, sets, repMin, repMax}] with working sets only. */
export function exerciseHistory(exId, workouts, { before = null, excludeId = null } = {}) {
  const out = [];
  for (const w of workouts) {
    if (excludeId && w.id === excludeId) continue;
    if (before && w.date > before) continue;
    for (const e of w.exercises || []) {
      if (e.exId !== exId) continue;
      const sets = workingSets(e);
      if (sets.length) out.push({ date: w.date, endedAt: w.endedAt || 0, workoutId: w.id, sets, repMin: e.repMin, repMax: e.repMax });
    }
  }
  return out.sort((a, b) => (a.date === b.date ? b.endedAt - a.endedAt : a.date < b.date ? 1 : -1));
}

/** Two most recent sessions each had at least half their working sets below repMin. */
export function isStalled(history, repMin) {
  if (history.length < 2) return false;
  return history.slice(0, 2).every((h) => {
    const min = h.repMin ?? repMin;
    const below = h.sets.filter((s) => s.reps < min).length;
    return below >= h.sets.length / 2;
  });
}

/**
 * Suggest the next weight and reps for an exercise.
 * planned: {sets, repMin, repMax}. Returns null with no history, else {kg, reps[], reason}.
 */
export function suggestNext(ex, history, planned, units = 'kg', { deload = false } = {}) {
  if (!history?.length) return null;
  const last = history[0].sets;
  const kind = loadKind(ex);
  const kg = Math.max(...last.map((s) => s.kg || 0));
  const top = last.filter((s) => (s.kg || 0) === kg);
  const nSets = planned?.sets || last.length;
  const lastReps = (i) => (top[i] ?? top[top.length - 1]).reps;
  const { repMin, repMax } = planned;
  const repsArr = (f) => Array.from({ length: nSets }, (_, i) => f(lastReps(i), i));

  if (deload) return { kg: roundDownToIncrement(kg * 0.9, kind, units), reps: repsArr((r) => Math.min(r, repMax)), reason: 'deload' };
  if (isStalled(history, repMin)) return { kg: roundDownToIncrement(kg * 0.9, kind, units), reps: repsArr(() => repMin), reason: 'stall' };
  const allTop = top.length === last.length ? last.every((s) => s.reps >= repMax) : top.every((s) => s.reps >= repMax);
  const allMin = top.every((s) => s.reps >= repMin);
  if (allTop) {
    const next = addIncrement(kg, kind, units);
    if (next === kg) return { kg, reps: repsArr((r) => r + 1), reason: 'reps_only' };
    return { kg: next, reps: repsArr(() => repMin), reason: 'increase' };
  }
  if (allMin) return { kg, reps: repsArr((r) => Math.min(repMax, r + 1)), reason: 'reps' };
  return { kg, reps: repsArr((r) => r), reason: 'repeat' };
}

export const REASON_TEXT = {
  increase: 'Add weight: you hit the top of the range',
  reps: 'Same weight, one more rep',
  repeat: 'Repeat: hit the bottom of the range on every set',
  stall: 'Stalled twice: drop 10% and build back up',
  deload: 'Deload week: lighter weight',
  reps_only: 'Top of range: add reps, load or a harder variation',
};

/** Exercises stalled with their latest session within the last 14 days. */
export function stalledExercises(workouts, today) {
  const ids = new Set();
  for (const w of workouts) for (const e of w.exercises || []) ids.add(e.exId);
  const out = [];
  for (const id of ids) {
    const h = exerciseHistory(id, workouts, { before: today });
    if (h.length && daysBetween(h[0].date, today) <= 14 && isStalled(h, h[0].repMin ?? 0)) out.push(id);
  }
  return out;
}

/** Consecutive calendar weeks with >=1 workout, ending this week or last, after the last deload. */
export function trainingWeekStreak(workouts, today, lastDeloadWeek = null) {
  const weeks = new Set(workouts.filter((w) => w.endedAt || w.durationSec).map((w) => weekOf(w.date)));
  let wk = weekOf(today);
  if (!weeks.has(wk)) wk = addDays(wk, -7);
  let n = 0;
  while (weeks.has(wk) && (!lastDeloadWeek || wk > lastDeloadWeek)) { n++; wk = addDays(wk, -7); }
  return n;
}

/** Deload suggestion or null. */
export function deloadSuggestion(workouts, today, lastDeloadWeek = null) {
  const thisWeek = weekOf(today);
  if (lastDeloadWeek && daysBetween(lastDeloadWeek, thisWeek) <= 7) return null;
  const streak = trainingWeekStreak(workouts, today, lastDeloadWeek);
  if (streak >= 6) return { reason: 'weeks', weeks: streak };
  const stalled = stalledExercises(workouts, today);
  if (stalled.length >= 3) return { reason: 'stalls', exIds: stalled };
  return null;
}
