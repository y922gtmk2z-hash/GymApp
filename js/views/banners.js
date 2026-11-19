// Suggestion banners on Today: weekly review, deload, backup reminder. Suggestions only, never forced.
import { h, toast } from '../ui.js';
import * as store from '../store.js';
import * as E from '../engine.js';
import * as W from '../weight.js';
import { addDays, daysBetween, today as todayFn, isoDate, weekStart } from '../util.js';
import { extras } from './today.js';
import { rebuildWeek } from './plan.js';
import { doExport } from './more.js';

function reviewBanner(ctx, { today, wk }) {
  const st = ctx.state;
  const g = st.weightGoal;
  if (!g?.active) return null;
  const reviewed = addDays(wk, -7);
  if (reviewed < weekStart(g.startDate)) return null; // the phase hadn't started that week
  if ((g.reviews || []).some((r) => r.weekStart === reviewed)) return null;
  const r = W.weeklyReview({ goal: g, metrics: st.metrics, workouts: st.workouts, plan: st.plans[reviewed] || null, weekStartStr: reviewed, today });
  const hasChanges = Object.keys(r.changes || {}).length > 0;
  const resolve = (accepted) => {
    store.commit((s) => {
      s.weightGoal = W.resolveReview(s.weightGoal, r, accepted);
      if (accepted && r.changes.end) s.weightGoal = W.endGoal(s.weightGoal, todayFn());
    });
    if (accepted && hasChanges && !r.changes.end && store.get().plans[wk]) {
      toast('Applied. Update this week\'s plan too?', { action: 'Update', ms: 8000, onAction: () => {
        let n = 0;
        for (let i = 0; i < 6; i++) { const w = addDays(wk, 7 * i); if (i === 0 || store.get().plans[w]) { if (store.get().plans[w] || i === 0) { rebuildWeek(w); n++; } } }
        toast(n > 1 ? `${n} planned weeks updated` : 'This week updated');
      } });
    } else if (accepted && r.changes.end) toast('Phase ended. Set a new target any time in Plan.');
  };
  const cls = { on_track: 'good', goal_reached: 'good', recomp: 'good' }[r.kind] || (['adherence', 'need_data', 'ramping'].includes(r.kind) ? 'info' : 'warn');
  return h('div.banner.' + cls, { role: 'region', 'aria-label': 'Weekly review' },
    h('div.tiny.muted', 'Weekly review'),
    h('strong', r.title),
    h('span.small', r.message),
    h('div.row',
      hasChanges ? h('button.btn.small.primary', { type: 'button', onclick: () => resolve(true) }, r.changes.end ? 'End phase' : r.changes.targetDate && !r.changes.cardioMin && !r.changes.steps ? 'Move date' : 'Accept') : null,
      h('button.btn.small', { type: 'button', onclick: () => resolve(!hasChanges) }, hasChanges ? 'Not now' : 'OK')));
}

function deloadBanner(ctx, { today, wk }) {
  const st = ctx.state;
  const next = addDays(wk, 7);
  if (st.dismissed?.deload === wk || st.lastDeloadWeek === next || st.lastDeloadWeek === wk) return null;
  const s = E.deloadSuggestion(st.workouts, today, st.lastDeloadWeek);
  if (!s) return null;
  const why = s.reason === 'weeks' ? `You've trained ${s.weeks} weeks in a row.` : `${s.exIds.length} lifts have stalled recently.`;
  return h('div.banner.warn', { role: 'region', 'aria-label': 'Deload suggestion' },
    h('strong', 'Deload next week?'),
    h('span.small', `${why} A lighter week (about 60% of the sets, weights down 10%) helps you recover and come back stronger.`),
    h('div.row',
      h('button.btn.small.primary', { type: 'button', onclick: () => {
        store.commit((x) => {
          x.lastDeloadWeek = next;
          if (x.plans[next]) x.plans[next] = E.applyDeload(x.plans[next]);
        });
        toast('Next week will be a deload week');
      } }, 'Plan a deload'),
      h('button.btn.small', { type: 'button', onclick: () => store.commit((x) => { x.dismissed.deload = wk; }) }, 'Not now')));
}

function backupBanner(ctx, { today }) {
  const st = ctx.state;
  if (!st.workouts.length && !st.metrics.length) return null;
  const last = st.lastExportAt ? isoDate(new Date(st.lastExportAt)) : null;
  if (last && daysBetween(last, today) < 30) return null;
  if (st.dismissed?.backupReminder && daysBetween(st.dismissed.backupReminder, today) < 7) return null;
  return h('div.banner.info', { role: 'region', 'aria-label': 'Backup reminder' },
    h('strong', 'Back up your data'),
    h('span.small', last ? `Your last backup was ${daysBetween(last, today)} days ago.` : 'You haven\'t backed up yet.', ' Everything lives on this phone, and iOS can delete it if Safari data is cleared.'),
    h('div.row',
      h('button.btn.small.primary', { type: 'button', onclick: () => doExport(ctx) }, 'Export backup'),
      h('button.btn.small', { type: 'button', onclick: () => store.commit((x) => { x.dismissed.backupReminder = today; }) }, 'Later')));
}

extras.top.push(reviewBanner, deloadBanner);
extras.bottom.push(backupBanner);
