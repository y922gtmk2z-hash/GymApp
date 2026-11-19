// Weight-loss phase rules (exercise only, no food tracking). Pure and DOM-free.
import { addDays, daysBetween, weekStart as weekOf, clamp, weekday } from './util.js';
import { metricSeries, recentAverage, cardioMinutes, e1rmDrops } from './stats.js';

export const CARDIO_FLOOR = 60;
export const CARDIO_RAMP_TO = 150;
export const CARDIO_CAP = 300;
export const RAMP_STEP = 15;
export const STEP_UP_STEPS = 1000;
export const STEP_UP_CARDIO = 30;
export const EASE_CARDIO = 30;
export const MIN_CARDIO_SESSION = 20;
export const DEFAULT_PACE = 0.5;
export const PACES = [0.25, 0.5, 0.75];

// ---------- Target feasibility ----------

/**
 * Check a weight target. Give targetDate or pacePct.
 * Returns {status, pacePct, kgPerWeek, targetDate, weeks, suggestedDate?, bmiWarning?, reason?}
 */
export function checkTarget({ startKg, targetKg, targetDate = null, pacePct = null, heightCm = null }, today) {
  if (!(startKg > 0) || !(targetKg > 0)) return { status: 'invalid', reason: 'Enter your current and target weight.' };
  if (targetKg >= startKg) return { status: 'invalid', reason: 'The target must be below your current weight.' };
  const diff = startKg - targetKg;
  let weeks, kgPerWeek;
  if (targetDate) {
    const days = daysBetween(today, targetDate);
    if (days < 14) return { status: 'invalid', reason: 'Pick a date at least 2 weeks away.' };
    weeks = days / 7;
    kgPerWeek = diff / weeks;
    pacePct = (kgPerWeek / startKg) * 100;
  } else {
    pacePct = pacePct || DEFAULT_PACE;
    kgPerWeek = (startKg * pacePct) / 100;
    weeks = Math.ceil(diff / kgPerWeek - 1e-9);
    targetDate = addDays(today, weeks * 7);
  }
  const out = { status: 'ok', pacePct, kgPerWeek, targetDate, weeks };
  if (pacePct > 1 + 1e-9) {
    out.status = 'too_fast';
    const w = Math.ceil(diff / ((startKg * DEFAULT_PACE) / 100) - 1e-9);
    out.suggestedDate = addDays(today, w * 7);
    out.suggestedWeeks = w;
  } else if (pacePct > 0.75 + 1e-9) out.status = 'ambitious';
  if (heightCm) {
    const bmi = targetKg / (heightCm / 100) ** 2;
    if (bmi < 18.5) out.bmiWarning = `That target is a BMI of ${bmi.toFixed(1)}, below the healthy range (18.5).`;
  }
  return out;
}

// ---------- Goal and levels ----------

/** Create a weight goal from builder inputs. */
export function createGoal({ startKg, targetKg, targetDate, pacePct, baselineSteps = 0, baselineCardioMin = 0, cardioDays = [], finishers = true, stepCap = 10000 }, today) {
  const startCardioMin = clamp(Math.max(CARDIO_FLOOR, baselineCardioMin || 0), CARDIO_FLOOR, CARDIO_CAP);
  return {
    active: true,
    startDate: today,
    startKg, targetKg, targetDate, pacePct,
    baselineSteps: baselineSteps || 0,
    baselineCardioMin: baselineCardioMin || 0,
    startCardioMin,
    rampEnded: startCardioMin >= CARDIO_RAMP_TO,
    levels: {
      cardioMin: Math.max(CARDIO_RAMP_TO, startCardioMin),
      steps: Math.min(stepCap, (baselineSteps || 0) + STEP_UP_STEPS),
    },
    stepCap,
    lastLever: null,
    cardioDays,
    finishers,
    reviews: [],
    endedAt: null,
  };
}

export function weekIndex(goal, weekStartStr) {
  return Math.max(0, Math.floor(daysBetween(weekOf(goal.startDate), weekStartStr) / 7));
}

export function rampWeeks(goal) {
  return Math.ceil(Math.max(0, CARDIO_RAMP_TO - goal.startCardioMin) / RAMP_STEP);
}

export function rampActive(goal, i) {
  return !goal.rampEnded && i < rampWeeks(goal);
}

/** Weekly cardio minutes target for week index i of the phase. */
export function cardioTarget(goal, i) {
  if (rampActive(goal, i)) return Math.min(CARDIO_RAMP_TO, goal.startCardioMin + RAMP_STEP * i);
  return goal.levels.cardioMin;
}

// ---------- Cardio allocation ----------

const isAvail = (act, profile) => {
  const have = new Set([...(profile?.equipment || []), 'bodyweight']);
  return act.equip.some((alt) => alt.every((t) => have.has(t)));
};

function pickActivity(activities, profile, intensity, k, lowOnly = false) {
  const list = activities.filter((a) => isAvail(a, profile) && a.intensities.includes(intensity) && (!lowOnly || a.impact === 'low'));
  if (!list.length) return null;
  return list[k % list.length];
}

/**
 * Spread the weekly cardio minutes over finishers and standalone cardio days.
 * Returns { target, planned, finishers:[{index, activityId, minutes}], sessions:[...], deficit, warnings }
 */
export function allocateCardio({ cardioMin, liftSessions = [], cardioDays = [], profiles = [], activities = [], weekIndex: wi = 0, finishers = true, weekStart }) {
  const warnings = [];
  const prof = (id) => profiles.find((p) => p.id === id) || profiles[0];
  let remaining = cardioMin;
  const fins = [];
  if (finishers) {
    liftSessions.forEach((ls, i) => {
      if (remaining < 5) return;
      const act = pickActivity(activities, prof(ls.profileId), 'steady', i, true) || pickActivity(activities, prof(ls.profileId), 'steady', i);
      if (!act) return;
      const f = Math.min(remaining, clamp(Math.round(ls.minutes * 0.2), 10, 15));
      fins.push({ index: i, activityId: act.id, minutes: f });
      remaining -= f;
    });
  }
  // Standalone days that have at least one steady activity.
  let days = [...cardioDays].sort((a, b) => (a.date < b.date ? -1 : 1))
    .filter((d) => {
      const ok = activities.some((a) => isAvail(a, prof(d.profileId)));
      if (!ok) warnings.push(`No cardio activity available in ${prof(d.profileId)?.name} on ${d.date}`);
      return ok;
    });
  const sessions = [];
  if (remaining > 0 && days.length) {
    while (days.length > 1 && remaining / days.length < MIN_CARDIO_SESSION) days = days.slice(0, -1);
    const n = days.length;
    const alloc = days.map((_, j) => Math.floor(remaining / n) + (j < remaining % n ? 1 : 0));
    // Minimum length and per-day cap, moving overflow.
    for (let j = 0; j < n; j++) alloc[j] = Math.max(alloc[j], MIN_CARDIO_SESSION);
    let over = 0;
    for (let j = 0; j < n; j++) if (alloc[j] > days[j].minutes) { over += alloc[j] - days[j].minutes; alloc[j] = days[j].minutes; }
    for (let j = 0; j < n && over > 0; j++) {
      const add = Math.min(days[j].minutes - alloc[j], over);
      alloc[j] += add; over -= add;
    }
    remaining = over; // minutes that did not fit in any day
    // Intervals: one session from week 4, never the day before a lower/full lifting day.
    let intervalIdx = -1;
    if (wi >= 3) {
      intervalIdx = days.findIndex((d) => {
        const next = addDays(d.date, 1);
        const nextLift = liftSessions.find((l) => l.date === next);
        const lowerNext = nextLift && ['lower', 'legs', 'full'].includes(nextLift.splitKey.split('_')[0]);
        return !lowerNext && pickActivity(activities, prof(d.profileId), 'intervals', 0);
      });
    }
    days.forEach((d, j) => {
      const intensity = j === intervalIdx ? 'intervals' : 'steady';
      const act = pickActivity(activities, prof(d.profileId), intensity, j + (wi % 3));
      sessions.push({
        id: `c-${weekStart}-${weekday(d.date)}`, kind: 'cardio', date: d.date,
        name: intensity === 'intervals' ? 'Intervals' : 'Cardio',
        profileId: prof(d.profileId).id, minutes: alloc[j], maxMinutes: d.minutes, startTime: d.startTime || '07:00',
        skipped: false, exercises: [],
        cardio: [{ activityId: act.id, minutes: alloc[j], intensity, finisher: false }],
      });
    });
  }
  const planned = fins.reduce((a, f) => a + f.minutes, 0) + sessions.reduce((a, s) => a + s.minutes, 0);
  const deficit = Math.max(0, cardioMin - planned);
  if (deficit > 0) {
    warnings.push(cardioDays.length
      ? `Cardio is ${deficit} min short of this week's ${cardioMin} min. Add a cardio day or lengthen one.`
      : `Add cardio days to reach this week's ${cardioMin} min of cardio${finishers ? '' : ', or turn on finishers'}.`);
  }
  return { target: cardioMin, planned, finishers: fins, sessions, deficit, warnings };
}

// ---------- Heart rate ----------

export function zone2(birthYear, restingHr, today) {
  if (!birthYear || !restingHr) return null;
  const age = Number(today.slice(0, 4)) - birthYear;
  const max = 208 - 0.7 * age;
  return [Math.round(restingHr + 0.6 * (max - restingHr)), Math.round(restingHr + 0.7 * (max - restingHr))];
}

// ---------- Trend and projection ----------

/**
 * Least-squares weight trend over the last 21 days.
 * Returns {kgPerWeek, pacePct, avg7, n14, n21} or {reason: 'need_data', n14}.
 */
export function weightTrend(metrics, today) {
  const series = metricSeries(metrics, 'weightKg').filter((p) => p.x <= today);
  const win = series.filter((p) => daysBetween(p.x, today) < 21);
  const n14 = series.filter((p) => daysBetween(p.x, today) < 14).length;
  if (n14 < 4 || win.length < 2) return { reason: 'need_data', n14 };
  const xs = win.map((p) => daysBetween(today, p.x));
  const ys = win.map((p) => p.y);
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, den = 0;
  for (let i = 0; i < xs.length; i++) { num += (xs[i] - mx) * (ys[i] - my); den += (xs[i] - mx) ** 2; }
  if (den === 0) return { reason: 'need_data', n14 };
  const kgPerWeek = (num / den) * 7;
  const avg7 = recentAverage(series, today, 7);
  return { kgPerWeek, pacePct: (-kgPerWeek / avg7) * 100, avg7, n14, n21: win.length };
}

export function projectDate(trend, avg7, targetKg, today) {
  if (!trend || trend.reason || !(trend.kgPerWeek < 0)) return null;
  if (avg7 <= targetKg) return today;
  const weeks = (avg7 - targetKg) / -trend.kgPerWeek;
  return addDays(today, Math.ceil(weeks * 7));
}

export function goalLine(goal) {
  return [{ x: goal.startDate, y: goal.startKg }, { x: goal.targetDate, y: goal.targetKg }];
}

export function progressPct(goal, avg7) {
  if (avg7 === null || avg7 === undefined) return 0;
  return clamp(((goal.startKg - avg7) / (goal.startKg - goal.targetKg)) * 100, 0, 100);
}

// ---------- Weekly review ----------

export const REVIEW_KINDS = ['goal_reached', 'need_data', 'adherence', 'strength_warning', 'ease_off', 'recomp', 'ramping', 'step_up', 'levers_maxed', 'on_track'];

const lastReview = (goal, weekStartStr) => [...(goal.reviews || [])].reverse().find((r) => r.weekStart < weekStartStr) || null;

function waistChange(metrics, today) {
  const s = metricSeries(metrics, 'waistCm').filter((p) => p.x <= today);
  const now = s.filter((p) => daysBetween(p.x, today) < 7);
  const then = s.filter((p) => { const d = daysBetween(p.x, today); return d >= 21 && d <= 35; });
  if (!now.length || !then.length) return null;
  return now[now.length - 1].y - then[then.length - 1].y;
}

/**
 * Review the week starting `weekStartStr` (the week just ended), evaluated on `today`.
 * plan: the reviewed week's plan (for planned cardio minutes), or null.
 * Returns {weekStart, pacePct, kind, changes, title, message}.
 */
export function weeklyReview({ goal, metrics, workouts, plan, weekStartStr, today, plannedCardio = null }) {
  const trend = weightTrend(metrics, today);
  const avg7 = recentAverage(metricSeries(metrics, 'weightKg'), today, 7);
  const target = goal.pacePct || DEFAULT_PACE;
  const nextIdx = weekIndex(goal, addDays(weekStartStr, 7));
  const curCardio = cardioTarget(goal, nextIdx);
  const base = { weekStart: weekStartStr, pacePct: trend.reason ? null : trend.pacePct, changes: {} };
  const r = (kind, title, message, changes = {}) => ({ ...base, kind, title, message, changes });
  const fmt = (x) => x.toFixed(2);

  if (avg7 !== null && avg7 <= goal.targetKg) {
    return r('goal_reached', 'Target reached',
      'Your 7-day average is at or below your target. You can end the weight-loss phase and keep your current cardio and steps as a maintenance plan.', { end: true });
  }
  if (trend.reason) {
    return r('need_data', 'Need more weigh-ins',
      `There are ${trend.n14} weigh-ins in the last 14 days. Weigh in 3 or more times a week (same time, same conditions) so the trend is reliable.`);
  }
  const weekEnd = addDays(weekStartStr, 6);
  const logged = cardioMinutes(workouts, weekStartStr, weekEnd);
  const planned = plannedCardio ?? (plan ? plan.cardioTargetMin : null);
  const stepsEntry = metrics.filter((m) => m.stepsAvg && m.date >= weekStartStr && m.date <= addDays(weekStartStr, 9))
    .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const stepsLow = stepsEntry && goal.levels.steps && stepsEntry.stepsAvg < goal.levels.steps * 0.9;
  if ((planned && logged < planned * 0.8) || stepsLow) {
    const parts = [];
    if (planned && logged < planned * 0.8) parts.push(`${logged} of ${planned} cardio minutes`);
    if (stepsLow) parts.push(`${Math.round(stepsEntry.stepsAvg).toLocaleString('en-GB')} of ${goal.levels.steps.toLocaleString('en-GB')} daily steps`);
    return r('adherence', 'Do the current plan first',
      `Last week you logged ${parts.join(' and ')}. Hitting the current plan comes before adding more, so nothing changes this week.`);
  }
  const drops = e1rmDrops(workouts, today, 5);
  if (drops.length >= 3) {
    return r('strength_warning', 'Strength is dropping',
      `${drops.length} lifts are down 5% or more on a month ago. Ease the pace a little and keep lifting volume the same to hold onto muscle.`,
      { cardioMin: Math.max(CARDIO_FLOOR, curCardio - EASE_CARDIO), rampEnded: true });
  }
  const prev = lastReview(goal, weekStartStr);
  const fast = trend.pacePct > 1;
  if (fast && prev?.pacePct > 1) {
    return r('ease_off', 'Ease off a little',
      `You've lost more than 1% of body weight a week for two weeks (${fmt(trend.pacePct)}%/wk). Faster than that risks losing muscle, so cardio drops by ${EASE_CARDIO} min. Lifting stays the same.`,
      { cardioMin: Math.max(CARDIO_FLOOR, curCardio - EASE_CARDIO), rampEnded: true });
  }
  const slow = trend.pacePct < target * 0.5;
  const prevSlow = prev && prev.pacePct !== null && prev.pacePct !== undefined && prev.pacePct < target * 0.5;
  if (slow) {
    const wc = waistChange(metrics, today);
    if (wc !== null && wc <= -1) {
      return r('recomp', 'Waist is shrinking',
        `Weight is steady but your waist is down ${Math.abs(wc).toFixed(1)} cm in 4 weeks. That's progress (losing fat while keeping or building muscle), so the plan stays the same.`);
    }
  }
  if (slow && prevSlow) {
    if (rampActive(goal, nextIdx)) {
      return r('ramping', 'Cardio is still building',
        `Weight is coming down slowly (${fmt(trend.pacePct)}%/wk), but cardio is still ramping up by ${RAMP_STEP} min a week. Give it time before adding more.`);
    }
    const stepsCapped = goal.levels.steps >= (goal.stepCap || 10000);
    const cardioCapped = curCardio >= CARDIO_CAP;
    const order = goal.lastLever === 'steps' ? ['cardio', 'steps'] : ['steps', 'cardio'];
    for (const lever of order) {
      if (lever === 'steps' && !stepsCapped) {
        const steps = Math.min(goal.stepCap || 10000, goal.levels.steps + STEP_UP_STEPS);
        return r('step_up', 'Step it up',
          `Two weeks in a row below half your target pace (${fmt(trend.pacePct)}%/wk vs ${target}%). Raise daily steps to ${steps.toLocaleString('en-GB')}.`,
          { steps, lastLever: 'steps' });
      }
      if (lever === 'cardio' && !cardioCapped) {
        const cardioMin = Math.min(CARDIO_CAP, curCardio + STEP_UP_CARDIO);
        return r('step_up', 'Step it up',
          `Two weeks in a row below half your target pace (${fmt(trend.pacePct)}%/wk vs ${target}%). Raise weekly cardio to ${cardioMin} min.`,
          { cardioMin, lastLever: 'cardio', rampEnded: true });
      }
    }
    const projected = projectDate(trend, avg7, goal.targetKg, today);
    return r('levers_maxed', 'Exercise levers are maxed',
      `Steps and cardio are both at their caps. Exercise alone has limits; diet is outside this app.${projected ? ` At your current trend you'd reach your target around ${projected}. Move the target date?` : ''}`,
      projected ? { targetDate: projected } : {});
  }
  return r('on_track', 'On track',
    `You're losing ${fmt(trend.pacePct)}% of body weight a week (target ${target}%). Keep going; no changes.`);
}

/** Apply (accepted) or record (dismissed) a review. Returns a new goal. */
export function resolveReview(goal, review, accepted) {
  const g = JSON.parse(JSON.stringify(goal));
  g.reviews = (g.reviews || []).filter((x) => x.weekStart !== review.weekStart);
  g.reviews.push({ weekStart: review.weekStart, pacePct: review.pacePct, kind: review.kind, changes: review.changes, accepted });
  if (accepted) {
    const c = review.changes || {};
    if (c.cardioMin !== undefined) g.levels.cardioMin = c.cardioMin;
    if (c.steps !== undefined) g.levels.steps = c.steps;
    if (c.lastLever) g.lastLever = c.lastLever;
    if (c.rampEnded) g.rampEnded = true;
    if (c.targetDate) g.targetDate = c.targetDate;
  }
  return g;
}

/** End the phase (goal reached or user choice): keeps levels for maintenance. */
export function endGoal(goal, today) {
  return { ...goal, active: false, endedAt: today };
}
