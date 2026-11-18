import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LIBRARY, ACTIVITIES, MUSCLES, EQUIPMENT, PATTERNS, defaultProfiles } from '../js/data.js';
import { availableExercises, isAvailable } from '../js/engine.js';

const [gym, home] = defaultProfiles();

test('library has 80+ exercises with unique ids', () => {
  assert.ok(LIBRARY.length >= 80);
  assert.equal(new Set(LIBRARY.map((e) => e.id)).size, LIBRARY.length);
});

test('every exercise uses valid muscles, tags, types and patterns', () => {
  for (const e of LIBRARY) {
    assert.ok(MUSCLES.includes(e.primary), `${e.id} primary`);
    for (const m of e.secondary) assert.ok(MUSCLES.includes(m), `${e.id} secondary ${m}`);
    assert.ok(['compound', 'isolation'].includes(e.type), `${e.id} type`);
    assert.ok(PATTERNS.includes(e.pattern), `${e.id} pattern ${e.pattern}`);
    assert.ok(Array.isArray(e.equip) && e.equip.length, `${e.id} equip`);
    for (const alt of e.equip) for (const t of alt) assert.ok(EQUIPMENT.includes(t), `${e.id} tag ${t}`);
  }
});

test('alternatives resolve to real exercises with the same primary muscle', () => {
  const byId = Object.fromEntries(LIBRARY.map((e) => [e.id, e]));
  for (const e of LIBRARY) for (const a of e.alternatives) {
    assert.ok(byId[a], `${e.id} -> ${a} missing`);
    assert.equal(byId[a].primary, e.primary, `${e.id} -> ${a} different muscle`);
  }
});

test('gym profile has a compound for every muscle except calves/core/biceps', () => {
  const avail = availableExercises(LIBRARY, gym);
  for (const m of MUSCLES) {
    assert.ok(avail.some((e) => e.primary === m), `gym has ${m}`);
    if (!['calves', 'core', 'biceps'].includes(m)) assert.ok(avail.some((e) => e.primary === m && e.type === 'compound'), `gym compound ${m}`);
  }
});

test('default home profile has at least 2 options per muscle', () => {
  const avail = availableExercises(LIBRARY, home);
  for (const m of MUSCLES) {
    const n = avail.filter((e) => e.primary === m).length;
    assert.ok(n >= 2, `home has only ${n} ${m} exercises`);
  }
  assert.ok(!avail.some((e) => e.equip.every((alt) => alt.some((t) => ['barbell', 'cable', 'machine'].includes(t)))));
});

test('activities are valid and home has steady and interval options', () => {
  assert.equal(new Set(ACTIVITIES.map((a) => a.id)).size, ACTIVITIES.length);
  for (const a of ACTIVITIES) for (const alt of a.equip) for (const t of alt) assert.ok(EQUIPMENT.includes(t), `${a.id} ${t}`);
  const homeActs = ACTIVITIES.filter((a) => isAvailable(a, home));
  assert.ok(homeActs.some((a) => a.intensities.includes('steady')));
  assert.ok(homeActs.some((a) => a.intensities.includes('intervals')));
  // Low impact first
  const firstHigh = ACTIVITIES.findIndex((a) => a.impact === 'high');
  assert.ok(ACTIVITIES.slice(firstHigh).every((a) => a.impact === 'high'));
});
