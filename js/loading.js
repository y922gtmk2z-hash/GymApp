// Bar loading, warm-up sets and interval timing. Pure, DOM-free.
import { fromKg, toKg, increment, roundDownToIncrement } from './units.js';

export const LB_PLATES = [45, 35, 25, 10, 5, 2.5];
export const LB_BAR = 45;

/**
 * Plates per side for a barbell total, greedy from the heaviest plate.
 * All values in the display unit. Returns { perSide: number[], remainder } (remainder per side, 0 if exact).
 */
export function platesPerSide(total, bar, plates) {
  let side = (total - bar) / 2;
  if (side <= 0) return { perSide: [], remainder: 0 };
  const perSide = [];
  for (const p of [...plates].sort((a, b) => b - a)) {
    while (side >= p - 1e-9) { perSide.push(p); side -= p; }
  }
  return { perSide, remainder: Math.round(side * 1000) / 1000 };
}

/** Plate loading for a weight stored in kg, using settings and display units. */
export function loadingFor(kg, settings) {
  const units = settings.units;
  const bar = units === 'lb' ? LB_BAR : settings.barKg ?? 20;
  const plates = units === 'lb' ? LB_PLATES : settings.plates;
  const total = Math.round(fromKg(kg, units) * 100) / 100;
  return { bar, units, ...platesPerSide(total, bar, plates) };
}

/**
 * Warm-up sets leading to a working weight (kg). Barbell: empty bar then 40/60/80%.
 * Dumbbell/kettlebell: 50% and 75%. Machine/cable: 50%. Bodyweight/bands: none.
 * Returns [{kg, reps}] ascending, each lighter than the working weight.
 */
export function warmupSets(workKg, kind, units = 'kg', barKg = 20) {
  if (!workKg || kind === 'bodyweight' || kind === 'bands') return [];
  const steps = kind === 'barbell' ? [[0.4, 8], [0.6, 5], [0.8, 3]]
    : kind === 'dumbbell' || kind === 'kettlebell' ? [[0.5, 8], [0.75, 4]]
      : [[0.5, 8]];
  const out = [];
  const bar = units === 'lb' ? toKg(LB_BAR, 'lb') : barKg;
  if (kind === 'barbell' && workKg > bar * 1.5) out.push({ kg: bar, reps: 10 });
  for (const [pct, reps] of steps) {
    let kg = roundDownToIncrement(workKg * pct, kind, units);
    if (kind === 'barbell') kg = Math.max(kg, bar);
    if (kg <= 0 || kg >= workKg - 1e-9) continue;
    if (out.some((s) => Math.abs(s.kg - kg) < 1e-6)) continue;
    out.push({ kg, reps });
  }
  return out;
}

/**
 * State of an interval session at `now`.
 * cfg: {work, rest, rounds, startedAt} (seconds, ms). Returns {phase, round, remaining, total, elapsed}.
 */
export function intervalState(cfg, now) {
  const total = cfg.rounds * cfg.work + (cfg.rounds - 1) * cfg.rest;
  const t = Math.max(0, (now - cfg.startedAt) / 1000);
  if (t >= total) return { phase: 'done', round: cfg.rounds, remaining: 0, total, elapsed: total };
  const cycle = cfg.work + cfg.rest;
  const round = Math.floor(t / cycle) + 1;
  const inCycle = t - (round - 1) * cycle;
  if (inCycle < cfg.work) return { phase: 'work', round, remaining: cfg.work - inCycle, total, elapsed: t };
  return { phase: 'rest', round, remaining: cycle - inCycle, total, elapsed: t };
}

export { increment };
