import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../js/charts.js';
import * as S from '../js/stats.js';

test('nice ticks', () => {
  assert.deepEqual(C.niceTicks(0, 100, 4), [0, 50, 100]);
  assert.deepEqual(C.niceTicks(78.3, 85.6, 4), [78, 80, 82, 84, 86]);
  assert.ok(C.niceTicks(5, 5).length >= 2);
  assert.deepEqual(C.niceTicks(NaN, 3), []);
});

test('scale and path', () => {
  const s = C.scale(0, 10, 0, 100);
  assert.equal(s(5), 50);
  assert.equal(C.scale(1, 1, 0, 100)(1), 50);
  assert.equal(C.pathD([[0, 0], [10, 5.25]]), 'M0.0,0.0L10.0,5.3');
});

test('line chart maps dates and values into the viewBox', () => {
  const pts = [{ x: '2026-11-01', y: 80 }, { x: '2026-11-08', y: 79 }, { x: '2026-11-15', y: 78 }];
  const { svg, hits } = C.lineChart({ series: [{ points: pts, cls: 's0' }], target: 75, from: '2026-11-01', to: '2026-11-15', width: 300, height: 200 });
  assert.match(svg, /^<svg class="chart" viewBox="0 0 300 200"/);
  assert.match(svg, /class="target"/);
  assert.equal(hits.length, 3);
  assert.ok(hits[0].px < hits[1].px && hits[1].px < hits[2].px);
  assert.ok(hits[0].py < hits[2].py, 'higher values are higher on screen');
  for (const h of hits) { assert.ok(h.px >= 0 && h.px <= 300); assert.ok(h.py >= 0 && h.py <= 200); }
  assert.equal(C.lineChart({ series: [{ points: [] }], from: 'a', to: 'b' }).svg, '');
});

test('bar chart', () => {
  const { svg, hits } = C.barChart({ bars: [{ label: 'A', y: 2 }, { label: 'B', y: 4 }], target: 3 });
  assert.equal((svg.match(/<rect/g) || []).length, 2);
  assert.ok(hits[1].py < hits[0].py);
});

test('ranges and filtering', () => {
  assert.equal(C.rangeStart('4w', '2026-11-28'), '2026-11-01');
  assert.equal(C.rangeStart('all', '2026-11-28', '2025-01-01'), '2025-01-01');
  assert.deepEqual(C.filterRange([{ x: '2026-10-01' }, { x: '2026-11-05' }], '2026-11-01', '2026-11-28'), [{ x: '2026-11-05' }]);
});

test('target progress either direction', () => {
  assert.equal(C.targetProgress(90, 85, 80), 50);
  assert.equal(C.targetProgress(100, 110, 120), 50);
  assert.equal(C.targetProgress(100, 90, 120), 0);
  assert.equal(C.targetProgress(100, 130, 120), 100);
});

test('weekly aggregation uses Monday weeks across a year boundary', () => {
  const w = (date, sets) => ({ id: date, date, exercises: [{ exId: 'b', sets: sets.map((r) => ({ kg: 50, reps: r, done: true })) }] });
  const ws = [w('2026-12-28', [5, 5]), w('2027-01-03', [5]), w('2027-01-04', [5, 5, 5])];
  const by = S.weeklySetsByMuscle(ws, () => 'chest');
  assert.deepEqual(by, { '2026-12-28': { chest: 3 }, '2027-01-04': { chest: 3 } });
  assert.deepEqual(S.sessionsByWeek(ws), { '2026-12-28': 2, '2027-01-04': 1 });
  assert.deepEqual(S.weeksBetween('2026-12-30', '2027-01-12'), ['2026-12-28', '2027-01-04', '2027-01-11']);
  assert.equal(S.volumeByWeek(ws)['2027-01-04'], 750);
});

test('week over week change', () => {
  const m = [{ date: '2026-11-10', weightKg: 82 }, { date: '2026-11-11', weightKg: 82 }, { date: '2026-11-16', weightKg: 81 }, { date: '2026-11-18', weightKg: 81 }];
  assert.deepEqual(S.weekOverWeek(m, 'weightKg', '2026-11-18'), { cur: 81, prev: 82, delta: -1 });
});
