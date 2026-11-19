// Today tab: today's planned session, week strip, upcoming sessions.
import { h, empty, bar, sheet, toast } from '../ui.js';
import { today as todayFn, weekStart, addDays, fmtDate, daysBetween, round, WEEKDAY_SHORT } from '../util.js';
import { rebuildWeek } from './plan.js';
import * as S from '../stats.js';
import * as W from '../weight.js';
import { fmtWeight, fromKg, fmtBodyWeight } from '../units.js';
import { checkInSheet } from './progress.js';
import { planFor, weekStrip, sessionLines, profileOf, sessionMinutes, workoutForSession, dayLabel } from './common.js';

/** Extra cards other modules add (summary, banners). Each: (ctx, {today, wk}) => Node|null */
export const extras = { top: [], bottom: [] };

let showAllBanners = false;

export function render(root, ctx) {
  const st = ctx.state;
  const today = todayFn();
  const wk = weekStart(today);
  const plan = planFor(st, wk);
  ctx.setTitle(st.user.name ? `Hi ${st.user.name}` : 'Today');
  const stack = h('div.stack');
  root.append(stack);

  if (!st.onboarded && !Object.keys(st.plans).length && !st.workouts.length) {
    stack.append(welcomeCard(ctx));
    return;
  }

  // 1. Today's session comes first.
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

  // 2. Suggestions: one at a time, the rest behind a link.
  const nextWeek = planFor(st, addDays(wk, 7));
  const banners = [
    ...extras.top.map((f) => f(ctx, { today, wk })),
    weighInNudge(st, today),
    plan && !nextWeek && today >= addDays(wk, 4) ? h('div.banner.info', h('strong', 'Plan next week'), h('span.small', 'Your settings are pre-filled from this week.'),
      h('a.btn.small', { href: '#/plan/' + addDays(wk, 7) }, 'Plan next week')) : null,
    ...extras.bottom.map((f) => f(ctx, { today, wk })),
  ].filter(Boolean);
  if (banners.length) {
    stack.append(banners[0]);
    if (banners.length > 1) {
      if (showAllBanners) stack.append(...banners.slice(1));
      stack.append(h('button.btn.small.ghost', { type: 'button', style: { alignSelf: 'flex-start', color: 'var(--accent)' }, 'aria-expanded': String(showAllBanners), onclick: () => { showAllBanners = !showAllBanners; ctx.rerender(); } },
        showAllBanners ? 'Show fewer suggestions' : `${banners.length - 1} more suggestion${banners.length > 2 ? 's' : ''}`));
    }
  }

  // 3. The week.
  stack.append(h('div.card', h('div.card-head', h('h3', 'This week'), h('a.small', { href: '#/plan' }, plan ? 'Plan' : 'Build plan')), weekStrip(st, wk, today)));
  const upcoming = (plan?.sessions || []).filter((s) => s.date > today && !s.skipped);
  if (upcoming.length) {
    stack.append(h('div.section-title', 'Coming up'));
    stack.append(h('div.card', upcoming.map((s) => h('div.row.between.nowrap', { style: { padding: '6px 0' } },
      h('span', h('strong', s.name), h('span.small.muted', ` · ${dayLabel(s.date, today)}`)),
      h('span.small.muted', s.kind === 'cardio' ? `${s.minutes} min` : `${s.exercises.length} exercises`)))));
  }
  stack.append(summaryCard(st, plan, today, wk));
}

// ---------- First-run setup ----------

function welcomeCard(ctx) {
  return h('div.card.accent',
    h('h2', 'Welcome'),
    h('p', 'Answer three quick questions and your first week of training is planned for you. You can change everything later.'),
    h('button.btn.primary.block', { type: 'button', onclick: () => setupWizard(ctx) }, 'Get started'),
    h('button.btn.ghost.block', { type: 'button', onclick: () => ctx.commit((s) => { s.onboarded = true; }) }, 'Skip, I\'ll set it up myself'),
    h('p.tiny.muted', 'Or look around first: More > Settings > Load sample data.'));
}

function setupWizard(ctx) {
  const d = { name: ctx.state.user.name || '', goal: 'general', days: [1, 3, 5], minutes: 60, where: 'gym' };
  let step = 0;
  const body = h('div.stack');
  const chips = (opts, isOn, onTap) => h('div.row', opts.map(([v, label]) => h('button.chip', { type: 'button', 'aria-pressed': String(isOn(v)), onclick: () => { onTap(v); draw(); } }, label)));
  const draw = () => {
    const steps = [
      () => [h('h3', 'What\'s your main goal?'),
        h('div.stack.tight', [['muscle', 'Build muscle', 'Moderate weights, 6–15 reps'], ['strength', 'Get stronger', 'Heavier weights, 3–10 reps'], ['general', 'General fitness', 'A bit of both, shorter rests']].map(([v, t, sub]) =>
          h('button.list-btn', { type: 'button', 'aria-pressed': String(d.goal === v), style: d.goal === v ? { color: 'var(--accent)' } : undefined, onclick: () => { d.goal = v; draw(); } },
            h('span', h('div.ex-name', t), h('div.small.muted', sub)), h('span', d.goal === v ? '✓' : '')))),
        h('div.field', h('label', { for: 'wiz-name' }, 'Your name (optional)'), h('input#wiz-name', { type: 'text', value: d.name, oninput: (e) => { d.name = e.target.value; } }))],
      () => [h('h3', 'Which days can you train?'), h('p.small.muted', 'Pick 2 to 6. Days can change week to week.'),
        chips([1, 2, 3, 4, 5, 6, 7].map((w) => [w, WEEKDAY_SHORT[w - 1]]), (w) => d.days.includes(w), (w) => { d.days = d.days.includes(w) ? d.days.filter((x) => x !== w) : [...d.days, w].sort(); }),
        h('h3', 'How long per session?'),
        chips([30, 45, 60, 90].map((m) => [m, `${m} min`]), (m) => d.minutes === m, (m) => { d.minutes = m; })],
      () => [h('h3', 'Where do you train?'),
        chips([['gym', 'Gym'], ['home', 'Home']], (v) => d.where === v, (v) => { d.where = v; }),
        h('p.small.muted', d.where === 'home' ? 'Home assumes dumbbells, a bench, a pull-up bar and bodyweight. Edit it in More > Equipment profiles.' : 'Gym assumes the usual equipment. You can make a Home profile for some days later.')],
    ];
    const valid = step !== 1 || (d.days.length >= 2 && d.days.length <= 6);
    body.replaceChildren(h('div.stack',
      h('div.tiny.muted', `Step ${step + 1} of 3`),
      ...steps[step](),
      !valid ? h('div.small.warn', 'Pick between 2 and 6 days.') : null,
      h('div.row.between',
        step ? h('button.btn', { type: 'button', onclick: () => { step--; draw(); } }, 'Back') : h('span'),
        h('button.btn.primary', { type: 'button', disabled: !valid, onclick: () => { if (step < 2) { step++; draw(); } else finishSetup(ctx, d, close); } }, step < 2 ? 'Next' : 'Build my week'))));
  };
  draw();
  const close = sheet('Set up', body);
}

function finishSetup(ctx, d, close) {
  const wk = weekStart(todayFn());
  ctx.commit((s) => {
    s.user.name = d.name.trim();
    s.builder = { ...s.builder, goal: d.goal, days: d.days.map((w) => ({ weekday: w, profileId: d.where, minutes: d.minutes, startTime: '18:00' })) };
    s.onboarded = true;
  }, { silent: true });
  const plan = rebuildWeek(wk);
  if (!plan.sessions.some((x) => x.date >= todayFn())) {
    rebuildWeek(addDays(wk, 7));
    toast('This week\'s days have passed, so next week is planned too.');
  }
  close();
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
  const prs = S.liftsWithPRs(weekW);
  const wt = S.weekOverWeek(st.metrics, 'weightKg', today);
  const rhr = S.weekOverWeek(st.metrics, 'restingHr', today);
  const delta = (d, f) => (d === null ? '–' : `${d > 0 ? '+' : d < 0 ? '−' : '±'}${f(Math.abs(d))}`);
  const tiles = [
    h('div.tile', h('div.v', plan ? `${done}/${planned.length}` : String(done)), h('div.l', 'Sessions')),
    h('div.tile', h('div.v', String(prs)), h('div.l', 'Lifts with a PR')),
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
