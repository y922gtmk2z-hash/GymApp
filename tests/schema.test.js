import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, validate, migrate, parseBackup, makeBackup, VERSION } from '../js/schema.js';

test('defaults validate cleanly', () => {
  assert.deepEqual(validate(defaults()), []);
});

test('backup round trip is deep-equal', () => {
  const s = defaults();
  s.user.name = 'Sam';
  s.workouts.push({ id: 'w1', date: '2026-11-16', name: 'Upper A', durationSec: 3000,
    exercises: [{ exId: 'bench_bb', note: 'felt good', sets: [{ kg: 60, reps: 8, done: true, warmup: false }] }], cardio: [] });
  s.metrics.push({ id: 'm1', date: '2026-11-16', weightKg: 82.4, restingHr: 55 });
  s.plans['2026-11-16'] = { weekStart: '2026-11-16', sessions: [] };
  s.targets['metric:weightKg'] = 78;
  const text = makeBackup(s, new Date('2026-11-18T10:00:00Z'));
  const r = parseBackup(text);
  assert.equal(r.ok, true, r.errors.join(', '));
  assert.deepEqual(r.state, s);
});

test('rejects non-JSON and foreign files with readable errors', () => {
  assert.deepEqual(parseBackup('nope').errors, ['File is not valid JSON']);
  assert.equal(parseBackup(JSON.stringify({ app: 'other', data: {} })).ok, false);
  const bad = defaults();
  bad.workouts = [{ id: 'x', date: 'yesterday', exercises: [] }];
  bad.settings.units = 'stone';
  const r = parseBackup(JSON.stringify({ app: 'gym-pwa', data: bad }));
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('units')));
  assert.ok(r.errors.some((e) => e.includes('workouts[0]')));
});

test('rejects non-numeric set values', () => {
  const bad = defaults();
  bad.workouts = [{ id: 'x', date: '2026-01-01', exercises: [{ exId: 'a', sets: [{ kg: '60', reps: 5 }] }] }];
  assert.equal(parseBackup(JSON.stringify(bad)).ok, false);
});

test('migrates an unversioned v0 document', () => {
  const v0 = { user: { name: 'Old' }, settings: { units: 'lb' }, profiles: defaults().profiles,
    plan: { weekStart: '2026-01-05', sessions: [] }, workouts: [], metrics: [], customExercises: [], targets: {} };
  const s = migrate(v0);
  assert.equal(s.version, VERSION);
  assert.equal(s.settings.units, 'lb');
  assert.equal(s.settings.theme, 'dark');
  assert.equal(s.user.name, 'Old');
  assert.ok(s.plans['2026-01-05']);
  assert.equal(s.plan, undefined);
  assert.deepEqual(validate(s), []);
});

test('refuses backups from a newer version', () => {
  const s = defaults();
  s.version = VERSION + 1;
  const r = parseBackup(JSON.stringify(s));
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /newer/);
});

test('sample data is a valid state', async () => {
  const { withSampleData } = await import('../js/sample.js');
  const s = withSampleData(defaults(), '2026-11-19');
  assert.deepEqual(validate(s), []);
  assert.ok(s.workouts.length > 30 && s.metrics.length > 30 && s.weightGoal.active);
});
