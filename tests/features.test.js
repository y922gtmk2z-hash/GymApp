import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../js/milestones.js';
import * as CSV from '../js/csv.js';

const W = (date, exId, sets, extra = {}) => ({ id: date + exId, date, endedAt: 1, name: 'Upper, A', exercises: [{ exId, note: 'felt "good"', sets: sets.map(([kg, reps, warmup = false]) => ({ kg, reps, done: true, warmup })) }], cardio: [], prs: [], ...extra });

test('milestones: counts, streaks, lifts, PRs, cardio, weight lost', () => {
  const ws = [];
  for (let i = 0; i < 10; i++) {
    const d = new Date(2026, 8, 7 + i * 7, 12).toISOString().slice(0, 10);
    ws.push(W(d, 'bench_bb', [[40 + i * 5, 5]], { cardio: [{ minutes: 120 }], prs: i ? [{ exId: 'bench_bb', type: 'weight' }, { exId: 'bench_bb', type: 'e1rm' }] : [] }));
  }
  const metrics = [{ date: '2026-09-07', weightKg: 90 }, { date: '2026-10-05', weightKg: 88.9 }, { date: '2026-11-02', weightKg: 84.9 }];
  const ms = M.milestones({ workouts: ws, metrics, weightGoal: { startKg: 90, startDate: '2026-09-07', targetKg: 85 } });
  const ids = ms.map((m) => m.id);
  for (const id of ['workouts_1', 'workouts_10', 'streak_4', 'streak_8', 'bench_bb_60', 'bench_bb_80', 'pr_1', 'cardio_1000', 'lost_1', 'lost_5', 'goal_2026-09-07']) assert.ok(ids.includes(id), id);
  assert.ok(!ids.includes('bench_bb_100'));
  assert.equal(ms.find((m) => m.id === 'bench_bb_60').date, ws[4].date);
  assert.ok(ms.every((m, i) => i === 0 || ms[i - 1].date <= m.date), 'sorted by date');
  assert.deepEqual(M.newMilestones(ms, ids.slice(1)).map((m) => m.id), ['workouts_1']);
});

test('a gap resets the week streak', () => {
  const ws = ['2026-09-07', '2026-09-14', '2026-09-21', '2026-10-05', '2026-10-12', '2026-10-19', '2026-10-26'].map((d) => W(d, 'x', [[10, 5]]));
  const ms = M.milestones({ workouts: ws });
  assert.equal(ms.find((m) => m.id === 'streak_4').date, '2026-10-26');
});

test('activity by day', () => {
  const a = M.activityByDay([W('2026-11-16', 'x', []), W('2026-11-16', 'y', []), W('2025-01-01', 'z', [])], '2026-11-19', 4);
  assert.equal(a.from, '2026-10-26');
  assert.deepEqual(a.days, { '2026-11-16': 2 });
});

test('CSV escaping and rows', () => {
  assert.equal(CSV.cell('a,b'), '"a,b"');
  assert.equal(CSV.cell('say "hi"'), '"say ""hi"""');
  assert.equal(CSV.cell(null), '');
  const csv = CSV.setsCsv([W('2026-11-16', 'bench_bb', [[20, 10, true], [60, 8]])], { exercise: () => 'Bench, barbell' });
  const lines = csv.trim().split('\r\n');
  assert.equal(lines[0], 'date,workout,exercise,set,type,weight_kg,reps,reps_in_reserve,note');
  assert.equal(lines[1], '2026-11-16,"Upper, A","Bench, barbell",W,warm-up,20,10,,"felt ""good"""');
  assert.ok(lines[2].includes(',1,working,60,8,'));
  assert.ok(csv.endsWith('\r\n'));
  const c = CSV.checkinsCsv([{ date: '2026-11-02', weightKg: 80 }, { date: '2026-11-01', restingHr: 55 }]).trim().split('\r\n');
  assert.equal(c[1], '2026-11-01,,55,,,,,,,,,,');
  assert.match(CSV.cardioCsv([W('2026-11-16', 'x', [], { cardio: [{ activityId: 'walk', minutes: 30, intensity: 'steady' }] })], { activity: () => 'Brisk walk' }), /Brisk walk,30,,,steady/);
});
