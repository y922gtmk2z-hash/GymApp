import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../js/stats.js';
import * as T from '../js/timer.js';

const W = (id, date, exId, sets) => ({ id, date, endedAt: 1, exercises: [{ exId, sets: sets.map(([kg, reps, warmup = false, done = true]) => ({ kg, reps, warmup, done })) }] });

test('Epley', () => {
  assert.equal(S.epley(100, 1), 100);
  assert.ok(Math.abs(S.epley(100, 10) - 133.333) < 0.01);
  assert.equal(S.epley(0, 5), 0);
});

test('e1RM excludes warm-ups, undone sets and sets over 12 reps', () => {
  const e = W('a', '2026-11-01', 'x', [[200, 1, true], [300, 1, false, false], [50, 20], [60, 5]]).exercises[0];
  assert.ok(Math.abs(S.entryE1rm(e) - 70) < 1e-9);
});

test('PR detection: e1rm, weight and reps; none on first session', () => {
  const w1 = W('1', '2026-11-01', 'x', [[60, 8], [60, 8]]);
  assert.deepEqual(S.detectPRs(w1, []), [], 'first session is not a PR');
  const w2 = W('2', '2026-11-04', 'x', [[62.5, 6], [60, 10]]);
  const prs = S.detectPRs(w2, [w1]);
  const types = prs.map((p) => p.type).sort();
  assert.deepEqual(types, ['e1rm', 'reps', 'weight']);
  assert.equal(prs.find((p) => p.type === 'weight').kg, 62.5);
  assert.equal(prs.find((p) => p.type === 'reps').reps, 10);
  const same = W('3', '2026-11-07', 'x', [[60, 8]]);
  assert.deepEqual(S.detectPRs(same, [w1, w2]), []);
});

test('warm-ups never count as PRs', () => {
  const w1 = W('1', '2026-11-01', 'x', [[60, 8]]);
  const w2 = W('2', '2026-11-04', 'x', [[100, 5, true], [60, 8]]);
  assert.deepEqual(S.detectPRs(w2, [w1]), []);
});

test('recompute after deleting a workout', () => {
  const w1 = W('1', '2026-11-01', 'x', [[60, 8]]);
  const w2 = W('2', '2026-11-04', 'x', [[70, 8]]);
  const w3 = W('3', '2026-11-07', 'x', [[65, 8]]);
  const all = S.recomputeAllPRs([w3, w1, w2]);
  assert.equal(all.find((w) => w.id === '3').prs.length, 0);
  const afterDelete = S.recomputeAllPRs([w1, w3]);
  assert.ok(afterDelete.find((w) => w.id === '3').prs.some((p) => p.type === 'weight'));
});

test('volume and sets', () => {
  assert.deepEqual(S.workoutVolume(W('1', '2026-11-01', 'x', [[40, 10, true], [60, 8], [60, 8]])), { volume: 960, sets: 2 });
});

test('rolling average and recent average', () => {
  const s = [{ x: '2026-11-01', y: 80 }, { x: '2026-11-03', y: 82 }, { x: '2026-11-09', y: 84 }];
  assert.deepEqual(S.rollingAverage(s, 7).map((p) => p.y), [80, 81, 83]);
  assert.equal(S.recentAverage(s, '2026-11-10', 7), 84);
  assert.equal(S.recentAverage(s, '2026-11-30', 7), 84, 'falls back to latest');
});

test('timer maths: remaining, adjust, clamp', () => {
  const t = T.startTimer(90, 'bench', 1000);
  assert.equal(T.remaining(t, 1000), 90);
  assert.equal(T.remaining(t, 61000), 30);
  assert.equal(T.isOver(t, 91000), true);
  assert.equal(T.remaining(T.adjust(t, 15, 1000), 1000), 105);
  assert.equal(T.remaining(T.adjust(t, -15, 1000), 1000), 75);
  const clamped = T.adjust(t, -200, 1000);
  assert.equal(T.remaining(clamped, 1000), 0, 'never ends before now');
  assert.equal(T.display(65.2), '1:06');
  assert.equal(T.display(-5), '0:00');
});

test('ACCEPTANCE: timer stays accurate across a 60 s screen lock (timestamp based)', () => {
  const t = T.startTimer(120, 'bench', 0);
  // No ticks happen while locked; only the end timestamp matters.
  assert.equal(T.remaining(t, 60000), 60);
  assert.equal(T.isOver(T.startTimer(45, null, 0), 60000), true);
});

test('PRs count once per lift', () => {
  const prs = [{ exId: 'a', type: 'reps' }, { exId: 'a', type: 'e1rm' }, { exId: 'a', type: 'weight' }, { exId: 'b', type: 'weight' }];
  assert.deepEqual(S.bestPRsByLift(prs).map((p) => [p.exId, p.type]), [['a', 'e1rm'], ['b', 'weight']]);
  assert.equal(S.liftsWithPRs([{ prs }, { prs: [] }, {}]), 2);
});
