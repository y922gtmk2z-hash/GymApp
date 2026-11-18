import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCalendar, escapeText, foldLine, floating, planEvents, CRLF } from '../js/ics.js';
import { buildWeek } from '../js/engine.js';
import { LIBRARY, ACTIVITIES, defaultProfiles } from '../js/data.js';
import { defaultFocus } from '../js/schema.js';

const now = new Date('2026-11-18T09:30:00Z');
const ev = { uid: 's-2026-11-16-full_a@gym-pwa', date: '2026-11-16', startTime: '18:00', minutes: 60, summary: 'Gym: Full A', description: 'Bench: 3 x 6-10\nRow: 3 x 6-10', sequence: 2 };

test('calendar structure, CRLF and floating times', () => {
  const ics = buildCalendar([ev], { alarmMinutes: 30, now });
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n'));
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'every newline is CRLF');
  assert.match(ics, /\r\nDTSTART:20261116T180000\r\n/);
  assert.match(ics, /\r\nDTEND:20261116T190000\r\n/);
  assert.match(ics, /\r\nDTSTAMP:20261118T093000Z\r\n/);
  assert.match(ics, /\r\nSEQUENCE:2\r\n/);
  assert.match(ics, /UID:s-2026-11-16-full_a@gym-pwa/);
  assert.ok(!/DTSTART[^:]*:\d+T\d+Z/.test(ics), 'start is floating, not UTC');
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 1);
});

test('alarm minutes', () => {
  assert.match(buildCalendar([ev], { alarmMinutes: 45, now }), /BEGIN:VALARM\r\nACTION:DISPLAY\r\nDESCRIPTION:Gym: Full A\r\nTRIGGER:-PT45M\r\nEND:VALARM/);
  assert.match(buildCalendar([ev], { alarmMinutes: 0, now }), /TRIGGER:-PT0M/);
  assert.doesNotMatch(buildCalendar([ev], { alarmMinutes: null, now }), /VALARM/);
});

test('text escaping', () => {
  assert.equal(escapeText('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('folding at 75 octets, UTF-8 safe', () => {
  const long = 'DESCRIPTION:' + 'x'.repeat(200);
  const folded = foldLine(long);
  for (const l of folded.split(CRLF)) assert.ok(Buffer.byteLength(l) <= 75);
  assert.equal(folded.split(CRLF).map((l, i) => (i ? l.slice(1) : l)).join(''), long);
  const multi = 'SUMMARY:' + 'é💪'.repeat(40);
  const f2 = foldLine(multi);
  for (const l of f2.split(CRLF)) {
    assert.ok(Buffer.byteLength(l) <= 75);
    assert.ok(!l.includes('�'));
  }
  assert.equal(f2.split(CRLF).map((l, i) => (i ? l.slice(1) : l)).join(''), multi);
});

test('end time rolls over midnight', () => {
  assert.equal(floating('2026-12-31', '23:30', 90), '20270101T010000');
});

test('plan events: stable UIDs across exports, skipped excluded, cardio included', () => {
  const profiles = defaultProfiles();
  const args = { weekStart: '2026-11-16', goal: 'muscle', focus: defaultFocus(), profiles, library: LIBRARY, activities: ACTIVITIES,
    days: [1, 3, 5].map((wd) => ({ weekday: wd, profileId: 'gym', minutes: 60, startTime: '07:15' })),
    weightGoal: { active: true, startDate: '2026-11-16', startCardioMin: 60, rampEnded: false, levels: { cardioMin: 150, steps: 8000 }, finishers: false,
      cardioDays: [{ weekday: 6, minutes: 60, profileId: 'gym', startTime: '09:00' }] } };
  const plan = buildWeek(args);
  const names = { exercise: (id) => LIBRARY.find((e) => e.id === id).name, activity: (id) => ACTIVITIES.find((a) => a.id === id).name, zone2: [120, 135] };
  const a = planEvents(plan, names);
  const b = planEvents(buildWeek(args), names);
  assert.deepEqual(a.map((e) => e.uid), b.map((e) => e.uid));
  assert.equal(a.length, 4);
  assert.ok(a[0].description.includes('Barbell bench press'));
  const cardio = a.find((e) => e.summary.startsWith('Cardio'));
  assert.match(cardio.description, /120-135 bpm/);
  plan.sessions[1].skipped = true;
  assert.equal(planEvents(plan, names).length, 3);
  const ics = buildCalendar(a, { now });
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 4);
  assert.match(ics, /DTSTART:20261116T071500/);
});
