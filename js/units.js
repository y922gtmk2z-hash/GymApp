// Weight units. Storage is always kg; lb is display only. Pure.

export const LB = 0.45359237;

export const toKg = (v, units) => (v === null || v === undefined ? null : units === 'lb' ? Math.round((v * LB) * 1000) / 1000 : v);
export const fromKg = (kg, units) => (kg === null || kg === undefined ? null : units === 'lb' ? kg / LB : kg);

/** Display value rounded to 0.5 kg / 0.5 lb-ish precision (kg 0.25 steps shown to 2dp max). */
export function displayWeight(kg, units) {
  if (kg === null || kg === undefined) return '';
  const v = fromKg(kg, units);
  const r = units === 'lb' ? Math.round(v * 2) / 2 : Math.round(v * 4) / 4;
  return String(Number(r.toFixed(2)));
}

export function fmtWeight(kg, units, { unit = true } = {}) {
  if (kg === null || kg === undefined) return '–';
  return displayWeight(kg, units) + (unit ? ' ' + units : '');
}

/** Increment kind for an exercise from its first equipment alternative. */
export function loadKind(ex) {
  const first = ex?.equip?.[0] || [];
  if (first.includes('barbell')) return 'barbell';
  if (first.includes('machine')) return 'machine';
  if (first.includes('cable')) return 'cable';
  if (first.includes('dumbbell')) return 'dumbbell';
  if (first.includes('kettlebell')) return 'kettlebell';
  if (first.includes('bands')) return 'bands';
  return 'bodyweight';
}

/** Weight increment in the DISPLAY unit, or 0 for reps-only kinds. */
export function increment(kind, units) {
  if (kind === 'bodyweight' || kind === 'bands') return 0;
  if (units === 'lb') return 5;
  if (kind === 'dumbbell') return 2;
  if (kind === 'kettlebell') return 4;
  return 2.5;
}

/** Round a kg value down to a multiple of the increment, in the display unit, return kg. */
export function roundDownToIncrement(kg, kind, units) {
  const inc = increment(kind, units) || (units === 'lb' ? 1 : 0.5);
  const v = fromKg(kg, units);
  const r = Math.floor(v / inc + 1e-9) * inc;
  return toKg(Math.max(0, r), units);
}

/** Add the increment in display units and convert back to kg. */
export function addIncrement(kg, kind, units) {
  const inc = increment(kind, units);
  if (!inc) return kg;
  return toKg(fromKg(kg, units) + inc, units);
}
