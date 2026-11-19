// CSV export for spreadsheets. Pure.

export function cell(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const toCsv = (rows) => rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

/** One row per logged set. names: {exercise(id)} */
export function setsCsv(workouts, names) {
  const rows = [['date', 'workout', 'exercise', 'set', 'type', 'weight_kg', 'reps', 'reps_in_reserve', 'note']];
  for (const w of [...workouts].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))) {
    for (const e of w.exercises || []) {
      let n = 0;
      for (const s of e.sets || []) {
        rows.push([w.date, w.name, names.exercise(e.exId), s.warmup ? 'W' : ++n, s.warmup ? 'warm-up' : 'working', s.kg ?? 0, s.reps, s.rir ?? '', e.note || '']);
      }
    }
  }
  return toCsv(rows);
}

/** One row per cardio entry. names: {activity(id)} */
export function cardioCsv(workouts, names) {
  const rows = [['date', 'workout', 'activity', 'minutes', 'distance_km', 'avg_heart_rate', 'intensity', 'finisher']];
  for (const w of [...workouts].sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const c of w.cardio || []) rows.push([w.date, w.name, names.activity(c.activityId), c.minutes, c.distanceKm ?? '', c.avgHr ?? '', c.intensity, c.finisher ? 'yes' : '']);
  }
  return toCsv(rows);
}

export const METRIC_COLUMNS = ['weightKg', 'restingHr', 'waistCm', 'stepsAvg', 'hrvMs', 'vo2max', 'sleepHrs', 'bodyFatPct', 'chestCm', 'armCm', 'thighCm', 'hipCm'];
const HEAD = ['weight_kg', 'resting_hr_bpm', 'waist_cm', 'steps_daily_avg', 'hrv_ms', 'vo2max', 'sleep_hours', 'body_fat_pct', 'chest_cm', 'arm_cm', 'thigh_cm', 'hip_cm'];

export function checkinsCsv(metrics) {
  const rows = [['date', ...HEAD]];
  for (const m of [...metrics].sort((a, b) => (a.date < b.date ? -1 : 1))) rows.push([m.date, ...METRIC_COLUMNS.map((k) => m[k] ?? '')]);
  return toCsv(rows);
}
