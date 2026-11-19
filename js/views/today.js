// Today tab: today's planned session, week strip, upcoming sessions.
import { h, empty, bar } from '../ui.js';
import { today as todayFn, weekStart, addDays, fmtDate, daysBetween, round } from '../util.js';
import * as S from '../stats.js';
import * as W from '../weight.js';
import { fmtWeight, fromKg, fmtBodyWeight } from '../units.js';
import { checkInSheet } from './progress.js';
import { planFor, weekStrip, sessionLines, profileOf, sessionMinutes, workoutForSession, dayLabel } from './common.js';

/** Extra cards other modules add (summary, banners). Each: (ctx, {today, wk}) => Node|null */
export const extras = { top: [], bottom: [] };

export function render(root, ctx) {
  const st = ctx.state;
  const today = todayFn();
  const wk = weekStart(today);
  const plan = planFor(st, wk);
  ctx.setTitle(st.user.name ? `Hi ${st.user.name}` : 'Today');
  const stack = h('div.stack');
  root.append(stack);

  for (const f of extras.top) { const n = f(ctx, { today, wk }); if (n) stack.append(n); }
  const nudge = weighInNudge(st, today);
  if (nudge) stack.append(nudge);

  stack.append(h('div.card', h('div.card-head', h('h3', 'This week'), h('a.small', { href: '#/plan' }, plan ? 'Plan' : 'Build plan')), weekStrip(st, wk, today)));

  const todays = (plan?.sessions || []).filter((s) => s.date === today && !s.skipped);
  if (!plan) {
    stack.append(h('div.card', empty('No plan this week', 'Build this week\'s plan to see today\'s session here.',
      h('a.btn.primary', { href: '#/plan' }, 'Build plan'))));
  } else if (!todays.length) {
    const next = plan.sessions.find((s) => s.date > today && !s.skipped);
    stack.append(h('div.card', h('h2', 'Rest day'),
      h('p.muted', next ? `Next: ${next.name} ${dayLabel(next.date, today).toLowerCase() === 'tomorrow' ? 'tomorrow' : 'on ' + fmtDate(next.date, { weekday: true })}.` : 'No more sessions this week.')));
  }
  for (const s of todays) stack.append(sessionCard(ctx, s, today));

  if (ctx.startWorkout) {
    stack.append(h('div.row',
      h('button.btn.grow', { type: 'button', onclick: () => ctx.startWorkout(null) }, 'Start ad-hoc workout'),
      ctx.quickCardio ? h('button.btn', { type: 'button', onclick: () => ctx.quickCardio() }, 'Log cardio') : null));
  }

  // Upcoming
  const upcoming = (plan?.sessions || []).filter((s) => s.date > today && !s.skipped);
  const nextWeek = planFor(st, addDays(wk, 7));
  if (upcoming.length) {
    stack.append(h('div.section-title', 'Coming up'));
    stack.append(h('div.card', upcoming.map((s) => h('div.row.between.nowrap', { style: { padding: '6px 0' } },
      h('span', h('strong', s.name), h('span.small.muted', ` · ${dayLabel(s.date, today)}`)),
      h('span.small.muted', s.kind === 'cardio' ? `${s.minutes} min` : `${s.exercises.length} exercises`)))));
  } else if (plan && !nextWeek && today >= addDays(wk, 4)) {
    stack.append(h('div.banner.info', h('strong', 'Plan next week'), h('span.small', 'Your settings are pre-filled from this week.'),
      h('a.btn.small', { href: '#/plan/' + addDays(wk, 7) }, 'Plan next week')));
  }

  stack.append(summaryCard(st, plan, today, wk));
  for (const f of extras.bottom) { const n = f(ctx, { today, wk }); if (n) stack.append(n); }
}

function weighInNudge(st, today) {
  if (!st.weightGoal?.active) return null;
  const s = S.metricSeries(st.metrics, 'weightKg');
  const last = s[s.length - 1];
  if (last && daysBetween(last.x, today) < 3) return null;
  return h('div.banner.info', h('strong', 'Time for a weigh-in'),
    h('span.small', last ? `Last weigh-in ${fmtDate(last.x)}. The trend needs 3 or more a week.` : 'Log your weight to start the trend.'),
    h('button.btn.small', { type: 'button', onclick: () => checkInSheet() }, 'Check in'));
}

function summaryCard(st, plan, today, wk) {
  const units = st.settings.units;
  const weekW = st.workouts.filter((w) => w.date >= wk && w.date <= addDays(wk, 6));
  const planned = (plan?.sessions || []).filter((s) => !s.skipped);
  const done = planned.filter((s) => weekW.some((w) => w.sessionId === s.id)).length + weekW.filter((w) => !w.sessionId).length;
  const prs = weekW.reduce((a, w) => a + (w.prs?.length || 0), 0);
  const wt = S.weekOverWeek(st.metrics, 'weightKg', today);
  const rhr = S.weekOverWeek(st.metrics, 'restingHr', today);
  const delta = (d, f) => (d === null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${f(Math.abs(d))}`);
  const tiles = [
    h('div.tile', h('div.v', plan ? `${done}/${planned.length}` : String(done)), h('div.l', 'Sessions')),
    h('div.tile', h('div.v', String(prs)), h('div.l', 'PRs')),
    h('div.tile', h('div.v', delta(wt.delta, (v) => `${round(fromKg(v, units), 1)} ${units}`)), h('div.l', 'Weight vs last week')),
    h('div.tile', h('div.v', delta(rhr.delta, (v) => `${Math.round(v)}`)), h('div.l', 'Resting HR vs last week')),
  ];
  const card = h('div.card', h('h3', 'Weekly summary'), h('div.tiles', tiles));
  if (plan?.cardioTargetMin || st.weightGoal?.active) {
    const mins = S.cardioMinutes(st.workouts, wk, addDays(wk, 6));
    const target = plan?.cardioTargetMin || 0;
    card.append(h('div.vol-row', h('span', 'Cardio'), bar(mins, Math.max(target, mins, 1), { cls: '.cardio', label: 'Cardio minutes this week' }), h('span.num.small', `${mins}/${target} min`)));
    const steps = st.metrics.filter((m) => Number.isFinite(m.stepsAvg)).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const stepT = plan?.stepTarget || st.weightGoal?.levels?.steps;
    if (stepT) card.append(h('div.vol-row', h('span', 'Steps/day'), bar(steps?.stepsAvg || 0, stepT, { cls: steps && steps.stepsAvg >= stepT ? '.good' : '', label: 'Average daily steps' }),
      h('span.num.small', `${steps ? Math.round(steps.stepsAvg / 100) / 10 + 'k' : '–'}/${stepT / 1000}k`)));
  }
  if (st.weightGoal?.active) {
    const g = st.weightGoal;
    const avg7 = S.recentAverage(S.metricSeries(st.metrics, 'weightKg'), today, 7);
    const pct = W.progressPct(g, avg7);
    card.append(h('div.hr'), h('div.row.between', h('span.small', `Weight goal: ${avg7 !== null ? fmtBodyWeight(avg7, units) : '–'} → ${fmtBodyWeight(g.targetKg, units)}`), h('a.small', { href: '#/progress' }, `${Math.round(pct)}%`)),
      bar(pct, 100, { cls: '.good', label: 'Progress to weight target' }));
  }
  return card;
}

function sessionCard(ctx, s, today) {
  const st = ctx.state;
  const done = workoutForSession(st, s.id);
  const resume = st.activeWorkout?.sessionId === s.id;
  return h('div.card.accent', { class: s.kind === 'cardio' ? 'cardio' : '' },
    h('div.card-head',
      h('div', h('div.small.muted', `Today${s.startTime ? ' · ' + s.startTime : ''} · ${profileOf(st, s.profileId).name}`), h('h2', s.name)),
      h('span.small.muted.num', s.kind === 'cardio' ? `${s.minutes} min` : `~${sessionMinutes(s)} min`)),
    h('div.stack.tight.small', sessionLines(st, s)),
    done ? h('div.badge.good', 'Done') :
      ctx.startWorkout ? h('button.btn.primary.block', { type: 'button', onclick: () => ctx.startWorkout(s.id) }, resume ? 'Resume workout' : s.kind === 'cardio' ? 'Start cardio' : 'Start workout') : null);
}
