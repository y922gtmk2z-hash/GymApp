// Today tab: today's planned session, week strip, upcoming sessions.
import { h, empty } from '../ui.js';
import { today as todayFn, weekStart, addDays, fmtDate } from '../util.js';
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

  for (const f of extras.bottom) { const n = f(ctx, { today, wk }); if (n) stack.append(n); }
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
