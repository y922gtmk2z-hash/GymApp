import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../js/loading.js';
import * as E from '../js/engine.js';
import { LIBRARY } from '../js/data.js';
import { LB } from '../js/units.js';

const byId = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));

test('plates per side, greedy and exact', () => {
  assert.deepEqual(L.platesPerSide(100, 20, [25, 20, 15, 10, 5, 2.5, 1.25]), { perSide: [25, 15], remainder: 0 });
  assert.deepEqual(L.platesPerSide(62.5, 20, [25, 20, 15, 10, 5, 2.5, 1.25]), { perSide: [20, 1.25], remainder: 0 });
  assert.deepEqual(L.platesPerSide(20, 20, [25]), { perSide: [], remainder: 0 });
  assert.equal(L.platesPerSide(61, 20, [20, 5]).remainder, 0.5);
  const lb = L.loadingFor(225 * LB, { units: 'lb', plates: [] });
  assert.deepEqual(lb.perSide, [45, 45]);
  assert.equal(lb.bar, 45);
});

test('warm-up sets', () => {
  const bb = L.warmupSets(100, 'barbell', 'kg', 20);
  assert.deepEqual(bb, [{ kg: 20, reps: 10 }, { kg: 40, reps: 8 }, { kg: 60, reps: 5 }, { kg: 80, reps: 3 }]);
  assert.ok(L.warmupSets(30, 'barbell').every((s) => s.kg < 30));
  assert.deepEqual(L.warmupSets(24, 'dumbbell'), [{ kg: 12, reps: 8 }, { kg: 18, reps: 4 }]);
  assert.deepEqual(L.warmupSets(20, 'bodyweight'), []);
  assert.deepEqual(L.warmupSets(null, 'barbell'), []);
});

test('interval timer phases', () => {
  const cfg = { work: 30, rest: 30, rounds: 3, startedAt: 0 };
  assert.deepEqual(L.intervalState(cfg, 10000), { phase: 'work', round: 1, remaining: 20, total: 150, elapsed: 10 });
  assert.equal(L.intervalState(cfg, 45000).phase, 'rest');
  assert.equal(L.intervalState(cfg, 65000).round, 2);
  assert.equal(L.intervalState(cfg, 150000).phase, 'done');
});

const hist = (sets) => E.exerciseHistory('x', [{ id: 'w', date: '2026-11-16', endedAt: 1, exercises: [{ exId: 'x', sets: sets.map(([kg, reps, rir]) => ({ kg, reps, rir, done: true })) }] }]);
const planned = { sets: 3, repMin: 6, repMax: 10 };

test('effort: a set to failure holds the weight; easy sets earn a double step', () => {
  assert.equal(E.suggestNext(byId.bench_bb, hist([[60, 10, 2], [60, 10, 1], [60, 10, 0]]), planned).reason, 'top_hard');
  const easy = E.suggestNext(byId.bench_bb, hist([[60, 10, 3], [60, 10, 4], [60, 10, 3]]), planned);
  assert.equal(easy.kg, 65);
  assert.equal(easy.reason, 'increase_easy');
  assert.equal(E.suggestNext(byId.bench_bb, hist([[60, 10], [60, 10], [60, 10]]), planned).kg, 62.5, 'unlogged effort behaves as before');
});

test('available weights cap progression', () => {
  assert.equal(E.suggestNext(byId.bench_db, hist([[22, 10], [22, 10]]), planned, 'kg', { maxKg: 23 }).kg, 23);
  const atMax = E.suggestNext(byId.bench_db, hist([[24, 10], [24, 10]]), planned, 'kg', { maxKg: 24 });
  assert.equal(atMax.reason, 'max_weight');
  assert.equal(atMax.kg, 24);
  assert.deepEqual(atMax.reps, [11, 11, 11]);
});
