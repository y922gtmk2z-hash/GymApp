import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import * as W from '../js/weight.js';
import * as E from '../js/engine.js';
import { LIBRARY, ACTIVITIES, defaultProfiles } from '../js/data.js';
import { defaultFocus } from '../js/schema.js';
import { addDays } from '../js/util.js';

const profiles = defaultProfiles();
const TODAY = '2026-11-16';

describe('target feasibility', () => {
  test('ACCEPTANCE: 85 -> 78 kg in 8 weeks is too fast; suggests 17 weeks at 0.5%', () => {
    const r = W.checkTarget({ startKg: 85, targetKg: 78, targetDate: addDays(TODAY, 56) }, TODAY);
    assert.equal(r.status, 'too_fast');
    assert.ok(Math.abs(r.pacePct - 1.029) < 0.01);
    assert.equal(r.suggestedWeeks, 17);
    assert.equal(r.suggestedDate, addDays(TODAY, 119));
  });
  test('ok and ambitious bands', () => {
    assert.equal(W.checkTarget({ startKg: 80, targetKg: 76, targetDate: addDays(TODAY, 140) }, TODAY).status, 'ok'); // 0.25%
    assert.equal(W.checkTarget({ startKg: 80, targetKg: 75, targetDate: addDays(TODAY, 56) }, TODAY).status, 'ambitious'); // 0.78%
  });
  test('pace-only input computes the date', () => {
    const r = W.checkTarget({ startKg: 100, targetKg: 95, pacePct: 0.5 }, TODAY);
    assert.equal(r.weeks, 10);
    assert.equal(r.targetDate, addDays(TODAY, 70));
    assert.equal(r.status, 'ok');
  });
  test('invalid targets', () => {
    assert.equal(W.checkTarget({ startKg: 80, targetKg: 82, pacePct: 0.5 }, TODAY).status, 'invalid');
    assert.equal(W.checkTarget({ startKg: 80, targetKg: 78, targetDate: addDays(TODAY, 7) }, TODAY).status, 'invalid');
    assert.equal(W.checkTarget({ startKg: null, targetKg: 78 }, TODAY).status, 'invalid');
  });
  test('BMI warning', () => {
    assert.ok(W.checkTarget({ startKg: 60, targetKg: 52, pacePct: 0.5, heightCm: 175 }, TODAY).bmiWarning);
    assert.equal(W.checkTarget({ startKg: 90, targetKg: 80, pacePct: 0.5, heightCm: 180 }, TODAY).bmiWarning, undefined);
  });
});

const goal = (over = {}) => W.createGoal({ startKg: 90, targetKg: 82, targetDate: addDays(TODAY, 140), pacePct: 0.5, baselineSteps: 6000, baselineCardioMin: 0, ...over }, TODAY);

describe('levels', () => {
  test('starting point and caps', () => {
    const g = goal();
    assert.equal(g.startCardioMin, 60);
    assert.equal(g.levels.steps, 7000);
    assert.equal(goal({ baselineSteps: 9800 }).levels.steps, 10000);
    assert.equal(goal({ baselineCardioMin: 400 }).startCardioMin, 300);
    assert.equal(goal({ baselineCardioMin: 200 }).rampEnded, true);
  });
  test('ramp +15 a week to 150, then levels', () => {
    const g = goal();
    assert.deepEqual([0, 1, 2, 5, 6, 7, 10].map((i) => W.cardioTarget(g, i)), [60, 75, 90, 135, 150, 150, 150]);
    g.levels.cardioMin = 180; g.rampEnded = true;
    assert.equal(W.cardioTarget(g, 2), 180);
    assert.equal(W.weekIndex(g, '2026-11-30'), 2);
  });
});

const liftDays = (keys, profileId = 'gym') => keys.map((k, i) => ({ date: addDays(TODAY, [0, 2, 4, 5][i]), minutes: 60, splitKey: k, profileId }));

describe('cardio allocation', () => {
  test('finishers then standalone days, even spread, min 20', () => {
    const r = W.allocateCardio({ cardioMin: 120, weekStart: TODAY, finishers: true, profiles, activities: ACTIVITIES,
      liftSessions: liftDays(['full_a', 'full_b', 'full_c']),
      cardioDays: [{ date: addDays(TODAY, 1), minutes: 45, profileId: 'home' }, { date: addDays(TODAY, 5), minutes: 60, profileId: 'gym' }] });
    assert.deepEqual(r.finishers.map((f) => f.minutes), [12, 12, 12]);
    assert.deepEqual(r.sessions.map((s) => s.minutes), [42, 42]);
    assert.equal(r.planned, 120);
    assert.equal(r.deficit, 0);
    for (const s of r.sessions) {
      const act = ACTIVITIES.find((a) => a.id === s.cardio[0].activityId);
      assert.ok(E.isAvailable(act, profiles.find((p) => p.id === s.profileId)), 'activity fits profile');
    }
  });
  test('drops a day rather than giving under 20 min, and reports deficits', () => {
    const r = W.allocateCardio({ cardioMin: 30, weekStart: TODAY, finishers: false, profiles, activities: ACTIVITIES,
      cardioDays: [{ date: addDays(TODAY, 1), minutes: 45, profileId: 'home' }, { date: addDays(TODAY, 3), minutes: 45, profileId: 'home' }] });
    assert.deepEqual(r.sessions.map((s) => s.minutes), [30]);
    const short = W.allocateCardio({ cardioMin: 150, weekStart: TODAY, finishers: false, profiles, activities: ACTIVITIES,
      cardioDays: [{ date: addDays(TODAY, 1), minutes: 45, profileId: 'home' }] });
    assert.equal(short.planned, 45);
    assert.equal(short.deficit, 105);
    assert.ok(short.warnings[0].includes('105 min short'));
    const none = W.allocateCardio({ cardioMin: 60, weekStart: TODAY, finishers: false, profiles, activities: ACTIVITIES });
    assert.equal(none.deficit, 60);
  });
  test('intervals: at most one, only from week 4, never before a lower/full day', () => {
    const args = (wi) => ({ cardioMin: 100, weekStart: TODAY, weekIndex: wi, finishers: false, profiles, activities: ACTIVITIES,
      liftSessions: [{ date: addDays(TODAY, 2), minutes: 60, splitKey: 'lower_a', profileId: 'gym' }],
      cardioDays: [{ date: addDays(TODAY, 1), minutes: 50, profileId: 'gym' }, { date: addDays(TODAY, 3), minutes: 50, profileId: 'gym' }] });
    assert.equal(W.allocateCardio(args(2)).sessions.filter((s) => s.cardio[0].intensity === 'intervals').length, 0);
    const wk4 = W.allocateCardio(args(3)).sessions;
    const iv = wk4.filter((s) => s.cardio[0].intensity === 'intervals');
    assert.equal(iv.length, 1);
    assert.equal(iv[0].date, addDays(TODAY, 3), 'not the day before the lower day');
    assert.ok(ACTIVITIES.find((a) => a.id === iv[0].cardio[0].activityId).intensities.includes('intervals'));
  });
  test('rotation: consecutive sessions use different activities when possible', () => {
    const r = W.allocateCardio({ cardioMin: 90, weekStart: TODAY, finishers: false, profiles, activities: ACTIVITIES,
      cardioDays: [1, 3, 5].map((d) => ({ date: addDays(TODAY, d), minutes: 30, profileId: 'gym' })) });
    const ids = r.sessions.map((s) => s.cardio[0].activityId);
    assert.equal(new Set(ids).size, 3);
  });
  test('R2 ACCEPTANCE: phase on, 3 lift + 2 cardio days gives a valid week', () => {
    const g = goal({ baselineCardioMin: 120, cardioDays: [
      { weekday: 2, minutes: 45, profileId: 'home', startTime: '07:00' }, { weekday: 6, minutes: 60, profileId: 'gym', startTime: '09:00' }] });
    const plan = E.buildWeek({ weekStart: TODAY, goal: 'general', focus: defaultFocus(), profiles, library: LIBRARY, activities: ACTIVITIES, weightGoal: g,
      days: [1, 3, 5].map((wd) => ({ weekday: wd, profileId: 'gym', minutes: 60, startTime: '18:00' })) });
    assert.equal(plan.cardioTargetMin, 120);
    assert.ok(E.plannedCardioMinutes(plan) >= plan.cardioTargetMin);
    for (const s of plan.sessions) {
      const prof = profiles.find((p) => p.id === s.profileId);
      if (s.kind === 'lift') {
        assert.ok(E.estimateSessionSec(s) <= s.minutes * 60, `${s.name} over budget with finisher`);
        assert.ok(s.cardio.length === 1 && s.cardio[0].finisher);
      }
      for (const c of s.cardio) assert.ok(E.isAvailable(ACTIVITIES.find((a) => a.id === c.activityId), prof));
    }
    assert.equal(plan.sessions.filter((s) => s.kind === 'cardio').length, 2);
    assert.equal(plan.stepTarget, 7000);
  });
  test('deload cuts cardio to 60%', () => {
    const g = goal({ baselineCardioMin: 150, cardioDays: [{ weekday: 2, minutes: 60, profileId: 'gym' }] });
    const args = { weekStart: TODAY, goal: 'general', focus: defaultFocus(), profiles, library: LIBRARY, activities: ACTIVITIES, weightGoal: g,
      days: [1, 3, 5].map((wd) => ({ weekday: wd, profileId: 'gym', minutes: 60 })) };
    const normal = E.buildWeek(args);
    const d = E.buildWeek({ ...args, deload: true });
    assert.equal(d.cardioTargetMin, Math.round(normal.cardioTargetMin * 0.6));
    assert.ok(E.plannedCardioMinutes(d) < E.plannedCardioMinutes(normal));
  });
});

describe('heart rate', () => {
  test('zone 2 via Karvonen', () => {
    assert.deepEqual(W.zone2(1986, 60, '2026-11-16'), [Math.round(60 + 0.6 * (180 - 60)), Math.round(60 + 0.7 * (180 - 60))]);
    assert.equal(W.zone2(null, 60, TODAY), null);
    assert.equal(W.zone2(1990, null, TODAY), null);
  });
});

/** Weigh-ins every 2 days going back 20 days, losing kgPerWeek. */
const weighIns = (endKg, kgPerWeek, today = TODAY, every = 2, extra = {}) =>
  Array.from({ length: 11 }, (_, i) => ({ id: 'm' + i, date: addDays(today, -i * every), weightKg: endKg - (kgPerWeek / 7) * i * every, ...extra }));

describe('trend and projection', () => {
  test('slope maths on synthetic data', () => {
    const t = W.weightTrend(weighIns(85, -0.5), TODAY);
    assert.ok(Math.abs(t.kgPerWeek + 0.5) < 1e-9);
    assert.ok(Math.abs(t.pacePct - (0.5 / t.avg7) * 100) < 1e-9);
  });
  test('needs 4 weigh-ins in 14 days', () => {
    const few = [0, 5, 10].map((d) => ({ date: addDays(TODAY, -d), weightKg: 80 }));
    assert.equal(W.weightTrend(few, TODAY).reason, 'need_data');
  });
  test('projection and progress', () => {
    const t = W.weightTrend(weighIns(85, -0.5), TODAY);
    assert.equal(W.projectDate(t, 85, 83, TODAY), addDays(TODAY, 28));
    assert.equal(W.projectDate({ kgPerWeek: 0.1 }, 85, 83, TODAY), null);
    const g = { startKg: 90, targetKg: 80 };
    assert.equal(W.progressPct(g, 85), 50);
    assert.equal(W.progressPct(g, 92), 0);
    assert.equal(W.progressPct(g, 79), 100);
  });
});

describe('weekly review', () => {
  const REVIEWED = '2026-11-09';
  const planned = (n) => ({ cardioTargetMin: n });
  const cardioWorkout = (minutes, date = '2026-11-11') => ({ id: 'c' + date, date, endedAt: 1, exercises: [], cardio: [{ activityId: 'walk', minutes }] });
  const g = (over = {}) => ({ ...goal(), startDate: '2026-09-01', rampEnded: true, levels: { cardioMin: 150, steps: 8000 }, ...over });
  const review = (args) => W.weeklyReview({ goal: g(), metrics: weighIns(85, -0.4), workouts: [cardioWorkout(150)], plan: planned(150), weekStartStr: REVIEWED, today: TODAY, ...args });

  test('goal reached', () => {
    assert.equal(review({ metrics: weighIns(81.5, -0.4) }).kind, 'goal_reached');
  });
  test('need data', () => {
    assert.equal(review({ metrics: [{ date: TODAY, weightKg: 85 }] }).kind, 'need_data');
  });
  test('adherence: under 80% of planned cardio, or steps under 90%', () => {
    const r = review({ workouts: [cardioWorkout(100)], metrics: weighIns(85, 0) });
    assert.equal(r.kind, 'adherence');
    assert.match(r.message, /100 of 150 cardio minutes/);
    const steps = review({ metrics: [...weighIns(85, 0), { date: TODAY, stepsAvg: 6000 }] });
    assert.equal(steps.kind, 'adherence');
  });
  test('strength warning', () => {
    const lift = (date, kg) => ({ id: 'l' + date + kg, date, endedAt: 1, exercises: [{ exId: 'x' + kg, sets: [{ kg, reps: 5, done: true }] }], cardio: [] });
    const ws = [cardioWorkout(150)];
    for (const kg of [100, 110, 120]) { ws.push({ ...lift('2026-10-10', kg), exercises: [{ exId: 'x' + kg, sets: [{ kg, reps: 5, done: true }] }] }); ws.push({ ...lift('2026-11-12', kg), exercises: [{ exId: 'x' + kg, sets: [{ kg: kg * 0.9, reps: 5, done: true }] }] }); }
    const r = review({ workouts: ws });
    assert.equal(r.kind, 'strength_warning');
    assert.equal(r.changes.cardioMin, 120);
  });
  test('ease off after two fast reviews', () => {
    const fast = weighIns(85, -1.2);
    assert.equal(review({ metrics: fast }).kind, 'on_track', 'one fast review is not enough');
    const r = review({ metrics: fast, goal: g({ reviews: [{ weekStart: '2026-11-02', pacePct: 1.3, kind: 'on_track' }] }) });
    assert.equal(r.kind, 'ease_off');
    assert.equal(r.changes.cardioMin, 120);
  });
  test('recomposition when weight is flat but waist is down', () => {
    const m = [...weighIns(85, 0), { date: addDays(TODAY, -2), waistCm: 90 }, { date: addDays(TODAY, -28), waistCm: 91.5 }];
    assert.equal(review({ metrics: m, goal: g({ reviews: [{ weekStart: '2026-11-02', pacePct: 0.1 }] }) }).kind, 'recomp');
  });
  test('step up after two slow adherent reviews, alternating levers', () => {
    const slow = weighIns(85, -0.1);
    const prev = [{ weekStart: '2026-11-02', pacePct: 0.1, kind: 'on_track' }];
    assert.equal(review({ metrics: slow }).kind, 'on_track', 'one slow review is not enough');
    const r1 = review({ metrics: slow, goal: g({ reviews: prev }) });
    assert.equal(r1.kind, 'step_up');
    assert.deepEqual(r1.changes, { steps: 9000, lastLever: 'steps' });
    const r2 = review({ metrics: slow, goal: g({ reviews: prev, lastLever: 'steps' }) });
    assert.deepEqual(r2.changes, { cardioMin: 180, lastLever: 'cardio', rampEnded: true });
  });
  test('R2 ACCEPTANCE: slow but not adherent says do the plan first, not step up', () => {
    const r = review({ metrics: weighIns(85, -0.1), workouts: [cardioWorkout(90)], goal: g({ reviews: [{ weekStart: '2026-11-02', pacePct: 0.1 }] }) });
    assert.equal(r.kind, 'adherence');
  });
  test('a capped lever is skipped; both capped gives levers maxed with a new date', () => {
    const slow = weighIns(85, -0.1);
    const prev = [{ weekStart: '2026-11-02', pacePct: 0.1 }];
    const stepsCapped = review({ metrics: slow, goal: g({ reviews: prev, levels: { cardioMin: 150, steps: 10000 } }) });
    assert.equal(stepsCapped.changes.lastLever, 'cardio');
    const both = review({ metrics: slow, workouts: [cardioWorkout(300)], plan: planned(300), goal: g({ reviews: prev, levels: { cardioMin: 300, steps: 10000 } }) });
    assert.equal(both.kind, 'levers_maxed');
    assert.ok(both.changes.targetDate > TODAY);
    assert.match(both.message, /diet is outside this app/);
  });
  test('ramp holds back step-up', () => {
    const fresh = { ...goal(), reviews: [{ weekStart: '2026-11-02', pacePct: 0.1 }] };
    const r = W.weeklyReview({ goal: fresh, metrics: weighIns(85, -0.1), workouts: [cardioWorkout(60)], plan: planned(60), weekStartStr: REVIEWED, today: TODAY });
    assert.equal(r.kind, 'ramping');
  });
  test('accept applies changes; dismiss only records', () => {
    const base = g();
    const rv = { weekStart: REVIEWED, pacePct: 0.1, kind: 'step_up', changes: { steps: 9000, lastLever: 'steps' } };
    const acc = W.resolveReview(base, rv, true);
    assert.equal(acc.levels.steps, 9000);
    assert.equal(acc.lastLever, 'steps');
    assert.equal(acc.reviews.at(-1).accepted, true);
    const dis = W.resolveReview(base, rv, false);
    assert.equal(dis.levels.steps, 8000);
    assert.equal(dis.reviews.at(-1).accepted, false);
    assert.equal(W.resolveReview(acc, rv, true).reviews.length, 1, 'one review per week');
  });
  test('messages never mention calories', () => {
    for (const metrics of [weighIns(85, -0.4), weighIns(85, -0.1), weighIns(81, -1)]) {
      const r = review({ metrics, goal: g({ reviews: [{ weekStart: '2026-11-02', pacePct: 0.1 }] }) });
      assert.doesNotMatch(r.title + r.message, /calor|kcal/i);
    }
  });
});
