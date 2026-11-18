import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../js/engine.js';
import { LIBRARY, MUSCLES, defaultProfiles } from '../js/data.js';
import { defaultFocus } from '../js/schema.js';
import { LB } from '../js/units.js';

const profiles = defaultProfiles();
const [gym, home] = profiles;
const byId = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));
const days = (n, profileId = 'gym', minutes = 60) =>
  [1, 2, 3, 4, 5, 6].slice(0, n).map((wd) => ({ weekday: wd, profileId, minutes, startTime: '18:00' }));
const build = (over = {}) => E.buildWeek({
  weekStart: '2026-11-16', goal: 'muscle', focus: defaultFocus(), profiles, library: LIBRARY, days: days(3), ...over,
});

describe('split selection', () => {
  test('2-6 days', () => {
    assert.deepEqual(E.selectSplit(2), ['full_a', 'full_b']);
    assert.deepEqual(E.selectSplit(3), ['full_a', 'full_b', 'full_c']);
    assert.deepEqual(E.selectSplit(4), ['upper_a', 'lower_a', 'upper_b', 'lower_b']);
    assert.deepEqual(E.selectSplit(5), ['upper', 'lower', 'push', 'pull', 'legs']);
    assert.equal(E.selectSplit(6).length, 6);
    assert.equal(E.splitName('upper_a'), 'Upper A');
    assert.equal(E.splitName('legs'), 'Legs');
  });
  test('throws outside 2-6', () => {
    assert.throws(() => E.selectSplit(1), RangeError);
    assert.throws(() => E.selectSplit(7), RangeError);
  });
});

describe('targets and rep/rest tables', () => {
  test('every goal x focus combination', () => {
    const expect = { muscle: [14, 8, 4], strength: [10, 6, 3], general: [10, 7, 4] };
    for (const [g, [p, m, n]] of Object.entries(expect)) {
      const t = E.weeklyTargets(g, { chest: 'priority', back: 'maintain', core: 'minimal' });
      assert.equal(t.chest.max, p); assert.equal(t.back.max, m); assert.equal(t.core.max, n);
      assert.equal(t.quads.max, m, 'unspecified muscles default to maintain');
    }
    assert.equal(E.weeklyTargets('muscle', { chest: 'priority' }).chest.min, 12);
  });
  test('rep ranges and rest by goal, with overrides', () => {
    assert.deepEqual(E.repRest('muscle', 'compound', 'x'), { repMin: 6, repMax: 10, restSec: 120 });
    assert.deepEqual(E.repRest('strength', 'compound', 'x'), { repMin: 3, repMax: 6, restSec: 180 });
    assert.deepEqual(E.repRest('general', 'isolation', 'x'), { repMin: 10, repMax: 15, restSec: 60 });
    assert.equal(E.repRest('muscle', 'compound', 'bench_bb', { restOverrides: { bench_bb: 150 } }).restSec, 150);
    assert.equal(E.repRest('muscle', 'isolation', 'x', { restDefaults: { isolation: 45 } }).restSec, 45);
  });
});

describe('volume allocation', () => {
  test('spreads evenly with remainder to earliest appearances', () => {
    const t = E.weeklyTargets('muscle', { ...defaultFocus(), chest: 'priority' });
    const { perSession } = E.allocateVolume(t, E.selectSplit(3));
    assert.deepEqual(perSession.map((s) => s.chest), [5, 5, 4]);
    assert.deepEqual(perSession.map((s) => s.back), [3, 3, 2]);
  });
  test('drops appearances that would get fewer than 2 sets', () => {
    const t = E.weeklyTargets('strength', { ...defaultFocus(), core: 'minimal' });
    const { perSession } = E.allocateVolume(t, E.selectSplit(3)); // 3 sets over 3 sessions
    assert.deepEqual(perSession.map((s) => s.core), [3, undefined, undefined]);
    const t2 = E.weeklyTargets('muscle', { ...defaultFocus(), calves: 'minimal' }); // 4 over 3
    assert.deepEqual(E.allocateVolume(t2, E.selectSplit(3)).perSession.map((s) => s.calves), [2, 2, undefined]);
  });
  test('caps at 12 per session and records the overflow as a deficit', () => {
    const t = { ...E.weeklyTargets('muscle', defaultFocus()), chest: { min: 30, max: 30 } };
    const { perSession, deficits } = E.allocateVolume(t, E.selectSplit(4)); // chest on 2 upper days
    assert.deepEqual([perSession[0].chest, perSession[2].chest], [12, 12]);
    assert.equal(deficits.chest, 6);
  });
  test('split muscle mapping', () => {
    const t = E.weeklyTargets('muscle', defaultFocus());
    const { perSession } = E.allocateVolume(t, E.selectSplit(4));
    assert.equal(perSession[0].quads, undefined);
    assert.equal(perSession[1].chest, undefined);
    assert.equal(perSession[1].quads, 4);
  });
});

describe('equipment filtering', () => {
  test('all-of and any-of alternatives', () => {
    assert.equal(E.isAvailable(byId.bench_bb, { equipment: ['barbell', 'bench'] }), false);
    assert.equal(E.isAvailable(byId.bench_bb, { equipment: ['barbell', 'bench', 'rack'] }), true);
    assert.equal(E.isAvailable(byId.goblet_squat, { equipment: ['kettlebell'] }), true);
    assert.equal(E.isAvailable(byId.goblet_squat, { equipment: ['dumbbell'] }), true);
    assert.equal(E.isAvailable(byId.goblet_squat, { equipment: ['bands'] }), false);
  });
  test('bodyweight is always available', () => {
    assert.equal(E.isAvailable(byId.pushup, { equipment: [] }), true);
  });
  test('home excludes barbell, cable and machine exercises', () => {
    const avail = E.availableExercises(LIBRARY, home);
    for (const e of avail) {
      assert.ok(e.equip.some((alt) => alt.every((t) => home.equipment.includes(t) || t === 'bodyweight')), e.id);
    }
    assert.ok(!avail.find((e) => e.id === 'bench_bb'));
    assert.ok(!avail.find((e) => e.id === 'pushdown'));
    assert.ok(!avail.find((e) => e.id === 'leg_press'));
  });
});

describe('exercise picking', () => {
  test('exercise count by sets', () => {
    assert.deepEqual([1, 4, 5, 8, 9, 12].map(E.exerciseCountForSets), [1, 1, 2, 2, 3, 3]);
  });
  test('sets split with max 4 per exercise, compounds first', () => {
    const { items } = E.pickExercises({ muscle: 'chest', sets: 12, candidates: LIBRARY, goal: 'muscle' });
    assert.equal(items.length, 3);
    assert.ok(items.every((i) => i.sets === 4));
    assert.equal(byId[items[0].exId].type, 'compound');
    assert.equal(byId[items[2].exId].type, 'isolation');
    const five = E.pickExercises({ muscle: 'back', sets: 5, candidates: LIBRARY, goal: 'muscle' }).items;
    assert.deepEqual(five.map((i) => i.sets), [3, 2]);
  });
  test('rotation between appearances; strength keeps the main lift', () => {
    const a0 = E.pickExercises({ muscle: 'quads', sets: 3, candidates: LIBRARY, goal: 'muscle', appearanceIndex: 0 }).items[0].exId;
    const a1 = E.pickExercises({ muscle: 'quads', sets: 3, candidates: LIBRARY, goal: 'muscle', appearanceIndex: 1 }).items[0].exId;
    assert.notEqual(a0, a1);
    const s0 = E.pickExercises({ muscle: 'quads', sets: 3, candidates: LIBRARY, goal: 'strength', appearanceIndex: 0 }).items[0].exId;
    const s1 = E.pickExercises({ muscle: 'quads', sets: 3, candidates: LIBRARY, goal: 'strength', appearanceIndex: 1 }).items[0].exId;
    assert.equal(s0, 'squat_bb');
    assert.equal(s1, 'squat_bb');
  });
  test('no candidates returns nothing and the unfilled sets', () => {
    const r = E.pickExercises({ muscle: 'calves', sets: 3, candidates: [], goal: 'muscle' });
    assert.deepEqual(r, { items: [], unfilled: 3 });
  });
  test('preferred exercises are kept when available', () => {
    const r = E.pickExercises({ muscle: 'chest', sets: 3, candidates: LIBRARY, goal: 'muscle', preferred: ['pec_deck'] });
    assert.equal(r.items[0].exId, 'pec_deck');
  });
});

describe('time budget and ordering', () => {
  test('estimate formula', () => {
    const s = { minutes: 45, exercises: [{ sets: 3, restSec: 120 }, { sets: 2, restSec: 60 }], cardio: [] };
    assert.equal(E.estimateSessionSec(s), 300 + 3 * 160 + 2 * 100);
    s.cardio = [{ minutes: 10, finisher: true }];
    assert.equal(E.estimateSessionSec(s), 300 + 3 * 160 + 2 * 100 + 600);
  });
  test('trims lowest focus first and never exceeds the budget', () => {
    const session = {
      minutes: 25, cardio: [],
      exercises: [
        { exId: 'a', muscle: 'chest', type: 'compound', sets: 4, restSec: 120 },
        { exId: 'b', muscle: 'back', type: 'compound', sets: 4, restSec: 120 },
        { exId: 'c', muscle: 'biceps', type: 'isolation', sets: 3, restSec: 75 },
      ],
    };
    const focus = { chest: 'priority', back: 'maintain', biceps: 'minimal' };
    const { session: out, trimmed } = E.fitTimeBudget(session, focus, { chest: 3 });
    assert.ok(E.estimateSessionSec(out) <= 25 * 60);
    assert.equal(trimmed.biceps, 3, 'minimal muscle trimmed out first');
    assert.ok((trimmed.back || 0) >= 1);
    assert.equal(trimmed.chest || 0, 0, 'priority untouched while lower tiers remain');
    const again = E.fitTimeBudget(session, focus, { chest: 3 });
    assert.deepEqual(again, { session: out, trimmed }, 'deterministic');
  });
  test('core and calves last, compounds before isolations', () => {
    const ex = [
      { muscle: 'calves', type: 'isolation' }, { muscle: 'biceps', type: 'isolation' },
      { muscle: 'core', type: 'isolation' }, { muscle: 'chest', type: 'compound' },
    ];
    assert.deepEqual(E.orderSession(ex).map((e) => e.muscle), ['chest', 'biceps', 'core', 'calves']);
  });
});

describe('buildWeek', () => {
  test('ACCEPTANCE: 3 days, 45 min, chest Priority, Home', () => {
    const plan = build({ focus: { ...defaultFocus(), chest: 'priority' }, days: days(3, 'home', 45) });
    const lifts = plan.sessions.filter((s) => s.kind === 'lift');
    assert.equal(lifts.length, 3);
    const homeIds = new Set(E.availableExercises(LIBRARY, home).map((e) => e.id));
    for (const s of lifts) {
      assert.ok(E.estimateSessionSec(s) <= 45 * 60, `${s.name} over budget`);
      for (const e of s.exercises) assert.ok(homeIds.has(e.exId), `${e.exId} not home equipment`);
      assert.equal(s.profileId, 'home');
    }
    const planned = E.plannedSetsByMuscle(plan);
    for (const m of MUSCLES) if (m !== 'chest') assert.ok(planned.chest >= planned[m], `chest < ${m}`);
    assert.ok(planned.chest >= 12);
    assert.deepEqual(plan.warnings, []);
  });
  test('sessions have stable ids, names, dates and are ordered', () => {
    const plan = build({ days: days(4) });
    assert.deepEqual(plan.sessions.map((s) => s.id), ['s-2026-11-16-upper_a', 's-2026-11-16-lower_a', 's-2026-11-16-upper_b', 's-2026-11-16-lower_b']);
    assert.deepEqual(plan.sessions.map((s) => s.date), ['2026-11-16', '2026-11-17', '2026-11-18', '2026-11-19']);
    for (const s of plan.sessions) {
      const ranks = s.exercises.map((e) => (e.muscle === 'calves' ? 3 : e.muscle === 'core' ? 2 : e.type === 'compound' ? 0 : 1));
      assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b));
    }
    assert.deepEqual(build({ days: days(4) }), plan, 'deterministic');
  });
  test('previous plan choices are kept', () => {
    const first = build();
    const s0 = first.sessions[0];
    const idx = s0.exercises.findIndex((e) => e.muscle === 'chest');
    const swapped = E.swapExercise(first, s0.id, idx, byId.pec_deck);
    const next = build({ weekStart: '2026-11-23', previousPlan: swapped });
    assert.ok(next.sessions[0].exercises.some((e) => e.exId === 'pec_deck'));
  });
  test('deload: 60% sets', () => {
    const plan = build();
    const d = E.applyDeload(plan);
    assert.equal(d.deload, true);
    d.sessions.forEach((s, i) => s.exercises.forEach((e, j) => {
      assert.equal(e.sets, Math.max(1, Math.round(plan.sessions[i].exercises[j].sets * 0.6)));
    }));
    assert.equal(build({ deload: true }).deload, true);
  });
  test('a muscle with no equipment produces a warning', () => {
    const bare = [{ id: 'bare', name: 'Bare', equipment: [] }];
    const plan = E.buildWeek({ weekStart: '2026-11-16', goal: 'muscle', focus: defaultFocus(), profiles: bare, library: LIBRARY.filter((e) => e.primary !== 'calves' || e.equip[0][0] !== 'bodyweight'), days: days(3, 'bare') });
    assert.ok(plan.warnings.some((w) => w.includes('calves')));
  });
});

describe('re-balance', () => {
  test('swap keeps muscle totals', () => {
    const plan = build();
    const s = plan.sessions[0];
    const idx = s.exercises.findIndex((e) => e.exId === 'bench_bb');
    const swapped = E.swapExercise(plan, s.id, idx, byId.bench_db);
    assert.equal(swapped.sessions[0].exercises[idx].exId, 'bench_db');
    assert.deepEqual(E.plannedSetsByMuscle(swapped), E.plannedSetsByMuscle(plan));
  });
  test('move keeps ids and refuses clashes', () => {
    const plan = build();
    const r = E.moveSession(plan, plan.sessions[0].id, '2026-11-20');
    assert.equal(r.ok, true);
    assert.equal(r.plan.sessions.find((s) => s.id === plan.sessions[0].id).date, '2026-11-20');
    const clash = E.moveSession(plan, plan.sessions[0].id, plan.sessions[1].date);
    assert.equal(clash.ok, false);
    assert.equal(clash.conflictId, plan.sessions[1].id);
    const sw = E.swapSessionDates(plan, plan.sessions[0].id, plan.sessions[1].id);
    assert.equal(sw.sessions.find((s) => s.id === plan.sessions[0].id).date, plan.sessions[1].date);
  });
  test('skip redistributes within budgets and the 4-set cap', () => {
    const plan = build({ days: days(3, 'gym', 90) });
    const { plan: p, moved, lost } = E.skipSession(plan, plan.sessions[0].id, '2026-11-16');
    assert.equal(p.sessions[0].skipped, true);
    for (const s of p.sessions.slice(1)) {
      assert.ok(E.estimateSessionSec(s) <= s.minutes * 60);
      for (const e of s.exercises) assert.ok(e.sets <= 4);
    }
    const before = E.plannedSetsByMuscle(plan);
    const after = E.plannedSetsByMuscle(p);
    for (const m of MUSCLES) {
      const skippedSets = plan.sessions[0].exercises.filter((e) => e.muscle === m).reduce((a, e) => a + e.sets, 0);
      assert.equal(after[m], before[m] - skippedSets + (moved[m] || 0));
      assert.equal((moved[m] || 0) + (lost[m] || 0), skippedSets);
    }
    assert.ok(Object.values(moved).reduce((a, b) => a + b, 0) > 0);
  });
  test('alternatives: same muscle, available, same pattern first', () => {
    const alts = E.suggestAlternatives('bench_bb', home, LIBRARY);
    assert.ok(alts.length > 0);
    assert.ok(alts.every((e) => e.primary === 'chest' && E.isAvailable(e, home)));
    assert.equal(alts[0].pattern, 'h_push');
    assert.ok(!alts.some((e) => e.id === 'bench_bb'));
  });
});

const W = (date, exId, sets, extra = {}) => ({
  id: 'w-' + date + exId, date, endedAt: 1, durationSec: 1,
  exercises: [{ exId, repMin: 6, repMax: 10, sets: sets.map(([kg, reps, warmup = false]) => ({ kg, reps, done: true, warmup })) }], ...extra,
});

describe('progression', () => {
  const planned = { sets: 3, repMin: 6, repMax: 10 };
  test('no history gives null', () => {
    assert.equal(E.suggestNext(byId.bench_bb, [], planned), null);
  });
  test('ACCEPTANCE: top of range adds weight and resets reps', () => {
    const h = E.exerciseHistory('bench_bb', [W('2026-11-16', 'bench_bb', [[60, 10], [60, 10], [60, 10]])]);
    assert.deepEqual(E.suggestNext(byId.bench_bb, h, planned), { kg: 62.5, reps: [6, 6, 6], reason: 'increase' });
  });
  test('increments per equipment and unit', () => {
    const top = (id) => E.exerciseHistory(id, [W('2026-11-16', id, [[20, 10], [20, 10]])]);
    assert.equal(E.suggestNext(byId.bench_db, top('bench_db'), planned).kg, 22);
    assert.equal(E.suggestNext(byId.lat_pulldown, top('lat_pulldown'), planned).kg, 22.5);
    assert.equal(E.suggestNext(byId.kb_swing, top('kb_swing'), planned).kg, 24);
    const lb = E.suggestNext(byId.bench_bb, top('bench_bb'), planned, 'lb');
    assert.ok(Math.abs(lb.kg / LB - (20 / LB + 5)) < 0.01, 'lb mode adds 5 lb');
    const bw = E.suggestNext(byId.pushup, top('pushup'), planned);
    assert.equal(bw.reason, 'reps_only');
    assert.deepEqual(bw.reps, [11, 11, 11]);
  });
  test('all sets at least bottom: same weight, +1 rep capped at the top', () => {
    const h = E.exerciseHistory('bench_bb', [W('2026-11-16', 'bench_bb', [[60, 10], [60, 8], [60, 7]])]);
    assert.deepEqual(E.suggestNext(byId.bench_bb, h, planned), { kg: 60, reps: [10, 9, 8], reason: 'reps' });
  });
  test('below range repeats', () => {
    const h = E.exerciseHistory('bench_bb', [W('2026-11-16', 'bench_bb', [[60, 8], [60, 6], [60, 5]])]);
    assert.equal(E.suggestNext(byId.bench_bb, h, planned).reason, 'repeat');
  });
  test('warm-up and undone sets are ignored', () => {
    const w = W('2026-11-16', 'bench_bb', [[40, 10, true], [60, 10], [60, 10], [60, 10]]);
    w.exercises[0].sets.push({ kg: 80, reps: 1, done: false, warmup: false });
    const h = E.exerciseHistory('bench_bb', [w]);
    assert.equal(h[0].sets.length, 3);
    assert.equal(E.suggestNext(byId.bench_bb, h, planned).kg, 62.5);
  });
  test('stall: two bad sessions trigger a 10% drop, one does not, a good one resets', () => {
    const bad1 = W('2026-11-10', 'bench_bb', [[60, 5], [60, 4], [60, 6]]);
    const bad2 = W('2026-11-13', 'bench_bb', [[60, 5], [60, 5], [60, 6]]);
    const good = W('2026-11-12', 'bench_bb', [[60, 7], [60, 6], [60, 6]]);
    const one = E.exerciseHistory('bench_bb', [bad1]);
    assert.equal(E.isStalled(one, 6), false);
    const two = E.exerciseHistory('bench_bb', [bad1, bad2]);
    assert.equal(E.isStalled(two, 6), true);
    const s = E.suggestNext(byId.bench_bb, two, planned);
    assert.equal(s.reason, 'stall');
    assert.equal(s.kg, 52.5); // 54 rounded down to 2.5
    const reset = E.exerciseHistory('bench_bb', [bad1, good, bad2]);
    assert.equal(E.isStalled(reset, 6), false);
  });
});

describe('deload', () => {
  const weekly = (n, start = '2026-10-05') => Array.from({ length: n }, (_, i) => W(addD(start, i * 7), 'bench_bb', [[60, 8]]));
  function addD(s, n) { const d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); }
  test('6 consecutive training weeks triggers', () => {
    assert.equal(E.deloadSuggestion(weekly(5), '2026-11-04'), null);
    const s = E.deloadSuggestion(weekly(6), '2026-11-11');
    assert.equal(s.reason, 'weeks');
    assert.equal(s.weeks, 6);
  });
  test('a gap week resets the streak; last deload counts', () => {
    const w = [...weekly(3, '2026-10-05'), ...weekly(3, '2026-11-02')];
    assert.equal(E.trainingWeekStreak(w, '2026-11-18'), 3);
    assert.equal(E.deloadSuggestion(weekly(6), '2026-11-11', '2026-10-19'), null);
    assert.equal(E.trainingWeekStreak(weekly(6), '2026-11-11', '2026-10-19'), 3);
  });
  test('stalls on 3+ lifts trigger', () => {
    const bad = (id, d) => W(d, id, [[50, 3], [50, 3]]);
    const w = ['bench_bb', 'row_bb', 'squat_bb'].flatMap((id) => [bad(id, '2026-11-10'), bad(id, '2026-11-14')]);
    const s = E.deloadSuggestion(w, '2026-11-16');
    assert.equal(s.reason, 'stalls');
    assert.equal(s.exIds.length, 3);
  });
  test('deload suggestion makes deload weights', () => {
    const h = E.exerciseHistory('bench_bb', [W('2026-11-16', 'bench_bb', [[60, 8]])]);
    assert.equal(E.suggestNext(byId.bench_bb, h, { sets: 2, repMin: 6, repMax: 10 }, 'kg', { deload: true }).kg, 52.5);
  });
});
