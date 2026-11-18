// iCalendar (.ics) generation, RFC 5545. Pure.
import { addDays } from './util.js';

export const CRLF = '\r\n';

export function escapeText(s) {
  return String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets without splitting UTF-8 characters. */
export function foldLine(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const out = [];
  let cur = '';
  let curLen = 0;
  let limit = 75;
  for (const ch of line) {
    const n = enc.encode(ch).length;
    if (curLen + n > limit) {
      out.push(cur);
      cur = '';
      curLen = 0;
      limit = 74; // continuation lines start with a space
    }
    cur += ch;
    curLen += n;
  }
  out.push(cur);
  return out.join(CRLF + ' ');
}

const pad = (n) => String(n).padStart(2, '0');

export function utcStamp(d) {
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

/** Floating local date-time from 'YYYY-MM-DD' and 'HH:MM' plus offset minutes. */
export function floating(date, time, plusMin = 0) {
  const [hh, mm] = (time || '18:00').split(':').map(Number);
  let total = hh * 60 + mm + plusMin;
  const dayShift = Math.floor(total / 1440);
  total -= dayShift * 1440;
  const d = addDays(date, dayShift).replace(/-/g, '');
  return `${d}T${pad(Math.floor(total / 60))}${pad(total % 60)}00`;
}

/**
 * Build a calendar.
 * events: [{uid, date, startTime, minutes, summary, description, sequence}]
 */
export function buildCalendar(events, { alarmMinutes = 30, now = new Date(), name = 'Gym' } = {}) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gym PWA//Workout Plan//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
  ];
  const stamp = utcStamp(now);
  for (const ev of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${ev.uid}`,
      `DTSTAMP:${stamp}`,
      `SEQUENCE:${ev.sequence || 0}`,
      `DTSTART:${floating(ev.date, ev.startTime)}`,
      `DTEND:${floating(ev.date, ev.startTime, ev.minutes)}`,
      `SUMMARY:${escapeText(ev.summary)}`,
      `DESCRIPTION:${escapeText(ev.description)}`,
      'TRANSP:OPAQUE',
    );
    if (alarmMinutes !== null && alarmMinutes !== undefined && alarmMinutes >= 0) {
      lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${escapeText(ev.summary)}`, `TRIGGER:-PT${Math.round(alarmMinutes)}M`, 'END:VALARM');
    }
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join(CRLF) + CRLF;
}

/**
 * Events for a week plan. names: {exercise(id) -> name, activity(id) -> name, zone2?: [lo, hi]}
 */
export function planEvents(plan, names) {
  return plan.sessions.filter((s) => !s.skipped).map((s) => {
    let description;
    if (s.kind === 'cardio') {
      const c = s.cardio[0];
      description = `${names.activity(c.activityId)}: ${c.minutes} min, ${c.intensity === 'intervals' ? 'intervals' : 'steady (Zone 2)'}`;
      if (names.zone2 && c.intensity !== 'intervals') description += `\nHeart rate ${names.zone2[0]}-${names.zone2[1]} bpm`;
    } else {
      description = s.exercises.map((e) => `${names.exercise(e.exId)}: ${e.sets} x ${e.repMin}-${e.repMax}`).join('\n');
      const fin = (s.cardio || []).filter((c) => c.finisher);
      if (fin.length) description += '\n' + fin.map((c) => `Finisher: ${names.activity(c.activityId)} ${c.minutes} min`).join('\n');
      if (plan.deload) description = 'Deload week\n' + description;
    }
    const summary = s.kind === 'cardio' ? `${s.name}: ${names.activity(s.cardio[0].activityId)}` : `Gym: ${s.name}`;
    return { uid: `${s.id}@gym-pwa`, date: s.date, startTime: s.startTime, minutes: s.minutes, summary, description, sequence: plan.icsSequence || 0 };
  });
}
