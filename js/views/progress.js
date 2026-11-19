// Progress tab: body metrics and check-ins, lifts, volume, targets, weight-loss goal.
import { h, segmented, sheet, toast, confirmSheet, field, numInput, empty, bar } from '../ui.js';
import * as store from '../store.js';
import * as C from '../charts.js';
import * as S from '../stats.js';
import * as W from '../weight.js';
import * as E from '../engine.js';
import { MUSCLES, MUSCLE_LABEL } from '../data.js';
import { fromKg, toKg, fmtWeight, fmtBodyWeight } from '../units.js';
import { today as todayFn, addDays, fmtDate, parseNum, uid, weekStart, round } from '../util.js';
import { exName, exById, planFor } from './common.js';

export const METRICS = [
  { key: 'weightKg', label: 'Weight', unit: 'kg', weight: true, dp: 1, core: true },
  { key: 'restingHr', label: 'Resting heart rate', unit: 'bpm', dp: 0, core: true },
  { key: 'waistCm', label: 'Waist circumference', unit: 'cm', dp: 1, core: true },
  { key: 'stepsAvg', label: 'Steps (daily average)', unit: 'steps', dp: 0, hint: 'Apple Health > Steps > W shows the daily average' },
  { key: 'hrvMs', label: 'Heart rate variability', unit: 'ms', dp: 0 },
  { key: 'vo2max', label: 'Cardio fitness (VO₂ max)', unit: 'mL/kg·min', dp: 1 },
  { key: 'sleepHrs', label: 'Sleep (nightly average)', unit: 'hr', dp: 1 },
  { key: 'bodyFatPct', label: 'Body fat percentage', unit: '%', dp: 1 },
  { key: 'chestCm', label: 'Chest', unit: 'cm', dp: 1, appOnly: true },
  { key: 'armCm', label: 'Arm', unit: 'cm', dp: 1, appOnly: true },
  { key: 'thighCm', label: 'Thigh', unit: 'cm', dp: 1, appOnly: true },
  { key: 'hipCm', label: 'Hips', unit: 'cm', dp: 1, appOnly: true },
];
const metricDef = (k) => METRICS.find((m) => m.key === k);

const ui = { tab: 'body', metric: 'weightKg', range: '3m', lift: null, muscle: 'chest' };

const unitOf = (def, units) => (def.weight ? units : def.unit);
const toDisplay = (def, v, units) => (v === null || v === undefined ? null : def.weight ? fromKg(v, units) : v);
const fromDisplay = (def, v, units) => (v === null || v === undefined ? null : def.weight ? toKg(v, units) : v);
const fmtMetric = (def, v, units) => (v === null || v === undefined ? '–' : `${round(toDisplay(def, v, units), def.dp).toLocaleString('en-GB')} ${unitOf(def, units)}`);

export function render(root, ctx) {
  const st = ctx.state;
  ctx.setTitle('Progress');
  ctx.setActions(h('button.btn.small.primary', { type: 'button', onclick: () => checkInSheet() }, 'Check in'));
  const stack = h('div.stack');
  root.append(stack);
  stack.append(segmented({ label: 'Progress section', value: ui.tab,
    options: [{ value: 'body', label: 'Body' }, { value: 'lifts', label: 'Lifts' }, { value: 'volume', label: 'Training' }],
    onChange: (v) => { ui.tab = v; ctx.rerender(); } }));
  stack.append(segmented({ small: true, label: 'Range', value: ui.range, options: C.RANGES.map((r) => ({ value: r.id, label: r.label })), onChange: (v) => { ui.range = v; ctx.rerender(); } }));
  if (ui.tab === 'body') renderBody(stack, ctx);
  else if (ui.tab === 'lifts') renderLifts(stack, ctx);
  else renderVolume(stack, ctx);
}

// ---------- Shared chart box ----------

function chartBox(result, { legend = null } = {}) {
  if (!result.svg) return h('p.muted.small', 'Not enough data in this range.');
  const holder = h('div', { html: result.svg });
  const caption = h('div.small.muted', { 'aria-live': 'polite', style: { minHeight: '1.4em' } }, 'Tap the chart to see values');
  const svg = holder.querySelector('svg');
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    const vb = svg.viewBox.baseVal;
    const x = ((e.clientX - r.left) / r.width) * vb.width;
    let best = null;
    for (const hit of result.hits) if (!best || Math.abs(hit.px - x) < Math.abs(best.px - x)) best = hit;
    if (!best) return;
    caption.textContent = best.label;
    const sel = svg.querySelector('.sel');
    sel.setAttribute('cx', best.px); sel.setAttribute('cy', best.py); sel.setAttribute('r', 5);
  });
  return h('div', holder, legend, caption);
}

const legend = (items) => h('div.legend', items.map(([cls, label]) => h('span', h('i', { style: { background: `var(--${cls})` } }), label)));

function targetBlock(ctx, key, { start, current, def, label, fmt }) {
  const t = ctx.state.targets[key];
  const btn = h('button.btn.small', { type: 'button', onclick: () => targetSheet(key, def, label) }, t !== undefined ? 'Edit target' : 'Set target');
  if (t === undefined) return h('div.row.end', btn);
  const p = C.targetProgress(start, current, t);
  return h('div.stack.tight',
    h('div.row.between', h('span.small', `Target ${fmt(t)} · ${Math.round(p)}%`), btn),
    bar(p, 100, { cls: p >= 100 ? '.good' : '', label: `Progress to ${label} target` }));
}

function targetSheet(key, def, label) {
  const st = store.get();
  const units = st.settings.units;
  const cur = st.targets[key];
  const isWeight = def?.weight || key.startsWith('lift:');
  let val = cur !== undefined ? (isWeight ? round(fromKg(cur, units), 1) : cur) : null;
  sheet(`${label} target`, (close) => h('div.stack',
    field(`Target (${isWeight ? units : def?.unit || ''})`, numInput({ value: val ?? '', label: 'Target value', onInput: (v) => { val = parseNum(v); } })),
    h('div.row.end',
      cur !== undefined ? h('button.btn.danger', { type: 'button', onclick: () => { store.commit((s) => { delete s.targets[key]; }); close(); } }, 'Clear') : null,
      h('button.btn.primary', { type: 'button', onclick: () => {
        if (val === null) { toast('Enter a value'); return; }
        store.commit((s) => { s.targets[key] = isWeight ? toKg(val, units) : val; });
        close();
      } }, 'Save'))));
}

// ---------- Body ----------

function renderBody(stack, ctx) {
  const st = ctx.state;
  const units = st.settings.units;
  const today = todayFn();
  if (st.weightGoal?.active) stack.append(goalCard(ctx));
  const def = metricDef(ui.metric);
  const series = S.metricSeries(st.metrics, def.key);
  const from = C.rangeStart(ui.range, today, series[0]?.x);
  const pts = C.filterRange(series, from, today).map((p) => ({ x: p.x, y: toDisplay(def, p.y, units) }));
  const target = st.targets['metric:' + def.key];
  const targetDisp = target !== undefined ? toDisplay(def, target, units) : null;
  const seriesArr = [];
  const leg = [];
  if (def.key === 'weightKg') {
    seriesArr.push({ points: pts, cls: 's0', line: false, dots: true, name: 'weigh-in' });
    const avg = S.rollingAverage(C.filterRange(series, addDays(from, -6), today), 7).filter((p) => p.x >= from).map((p) => ({ x: p.x, y: toDisplay(def, p.y, units) }));
    seriesArr.push({ points: avg, cls: 's0', name: '7-day avg' });
    leg.push(['accent', 'Weigh-ins + 7-day average']);
  } else seriesArr.push({ points: pts, cls: 's0', dots: true });
  let goal = null;
  if (def.key === 'weightKg' && st.weightGoal?.active) {
    goal = W.goalLine(st.weightGoal).map((p) => ({ x: p.x, y: fromKg(p.y, units) }));
    leg.push(['warn', 'Goal path']);
  }
  if (targetDisp !== null) leg.push(['good', 'Target']);
  const chart = C.lineChart({ series: seriesArr, target: targetDisp, goal, from, to: today, fmt: (v) => String(round(v, def.dp)), title: `${def.label} chart` });
  const latest = series[series.length - 1];
  const startVal = pts[0] ? fromDisplay(def, pts[0].y, units) : null;
  const curVal = def.key === 'weightKg' ? S.recentAverage(series, today, 7) : latest?.y ?? null;
  stack.append(h('div.card',
    metricChips(ctx, def),
    h('div.row.between', h('div', h('div.tile', { style: { padding: 0, background: 'none' } }, h('div.v', fmtMetric(def, curVal, units)), h('div.l', def.key === 'weightKg' ? '7-day average' : latest ? `Latest · ${fmtDate(latest.x)}` : 'No entries')))),
    chartBox(chart, { legend: leg.length ? legend(leg) : null }),
    targetBlock(ctx, 'metric:' + def.key, { start: startVal, current: curVal, def, label: def.label, fmt: (v) => fmtMetric(def, v, units) })));

  // Entries
  const entries = [...st.metrics].sort((a, b) => (a.date < b.date ? 1 : -1));
  stack.append(h('div.section-title', 'Check-ins'));
  if (!entries.length) {
    stack.append(h('div.card', empty('No check-ins yet', 'A weekly check-in takes about 30 seconds: weight, resting heart rate and waist.',
      h('button.btn.primary', { type: 'button', onclick: () => checkInSheet() }, 'Check in'))));
    return;
  }
  stack.append(h('div.card', entries.slice(0, 12).map((m) => h('button.list-btn', { type: 'button', onclick: () => checkInSheet(m.id) },
    h('span', h('div.ex-name', fmtDate(m.date, { weekday: true, year: true })),
      h('div.small.muted', METRICS.filter((d) => Number.isFinite(m[d.key])).map((d) => `${d.label.split(' (')[0]} ${fmtMetric(d, m[d.key], units)}`).join(' · '))),
    h('span.muted', '›'))), entries.length > 12 ? h('p.tiny.muted', `${entries.length - 12} older entries not shown.`) : null));
}

function metricChips(ctx, def) {
  const st = ctx.state;
  const logged = METRICS.filter((m) => m.key === 'weightKg' || st.metrics.some((x) => Number.isFinite(x[m.key])));
  const short = { weightKg: 'Weight', restingHr: 'Resting HR', waistCm: 'Waist', stepsAvg: 'Steps', hrvMs: 'HRV', vo2max: 'VO₂ max', sleepHrs: 'Sleep', bodyFatPct: 'Body fat' };
  const chipList = logged.slice(0, 6);
  return h('div.stack.tight',
    h('div.row', { role: 'group', 'aria-label': 'Metric' }, chipList.map((m) => h('button.chip', { type: 'button', 'aria-pressed': String(m.key === def.key), onclick: () => { ui.metric = m.key; ctx.rerender(); } }, short[m.key] || m.label))),
    h('select', { 'aria-label': 'All metrics', onchange: (e) => { ui.metric = e.target.value; ctx.rerender(); } },
      METRICS.map((m) => h('option', { value: m.key, selected: m.key === def.key }, m.label + (m.appOnly ? ' (app only)' : '')))));
}

function goalCard(ctx) {
  const st = ctx.state;
  const g = st.weightGoal;
  const units = st.settings.units;
  const today = todayFn();
  const series = S.metricSeries(st.metrics, 'weightKg');
  const avg7 = S.recentAverage(series, today, 7);
  const trend = W.weightTrend(st.metrics, today);
  const pct = W.progressPct(g, avg7);
  const proj = trend.reason ? null : W.projectDate(trend, avg7, g.targetKg, today);
  return h('div.card.accent',
    h('div.card-head', h('h3', 'Weight goal'), h('span.badge.cardio', 'Weight-loss phase')),
    h('div.tiles',
      h('div.tile', h('div.v', fmtBodyWeight(g.startKg, units)), h('div.l', `Start · ${fmtDate(g.startDate)}`)),
      h('div.tile', h('div.v', avg7 !== null ? fmtBodyWeight(avg7, units) : '–'), h('div.l', 'Now (7-day avg)')),
      h('div.tile', h('div.v', fmtBodyWeight(g.targetKg, units)), h('div.l', `Target · ${fmtDate(g.targetDate)}`))),
    bar(pct, 100, { cls: '.good', label: 'Progress to weight target' }),
    h('div.small', `${Math.round(pct)}% of the way`),
    trend.reason
      ? h('div.small.muted', `Need 4 weigh-ins in 14 days for a trend (have ${trend.n14}).`)
      : h('div.small', `Pace ${trend.pacePct >= 0 ? '' : '+'}${Math.abs(trend.pacePct).toFixed(2)}%/week ${trend.pacePct >= 0 ? 'down' : 'up'} (target ${g.pacePct}%) · ${proj ? `projected ${fmtDate(proj, { year: true })}` : 'no projection while not losing'}`),
    h('div.row.end', h('a.btn.small', { href: '#/plan' }, 'Edit goal')));
}

export function checkInSheet(id = null) {
  const st = store.get();
  const units = st.settings.units;
  const existing = id ? st.metrics.find((m) => m.id === id) : null;
  const d = existing ? { ...existing } : { date: todayFn() };
  const showSteps = st.weightGoal?.active;
  const prevEntry = [...st.metrics].sort((a, b) => (a.date < b.date ? 1 : -1))[0] || null;
  let more = !!existing && METRICS.some((m) => !m.core && m.key !== 'stepsAvg' && Number.isFinite(existing[m.key]));
  const body = h('div.stack');
  const input = (def) => field(`${def.label} (${unitOf(def, units)})${def.appOnly ? ' · app only' : ''}`,
    numInput({ value: d[def.key] !== undefined && d[def.key] !== null ? String(round(toDisplay(def, d[def.key], units), def.dp)) : '', decimal: def.dp > 0, label: def.label,
      onInput: (v) => { d[def.key] = fromDisplay(def, parseNum(v), units); } }), def.hint);
  const draw = (close) => {
    body.replaceChildren(h('div.stack',
      field('Date', h('input', { type: 'date', value: d.date, max: todayFn(), onchange: (e) => { d.date = e.target.value; } })),
      METRICS.filter((m) => m.core).map(input),
      showSteps ? input(metricDef('stepsAvg')) : null,
      st.weightGoal?.active ? h('p.tiny.muted', 'Weigh in 3 or more times a week, same time of day, for a reliable trend.') : null,
      h('div.row',
        h('button.btn.small', { type: 'button', onclick: () => { more = !more; draw(close); } }, more ? 'Fewer fields' : 'More fields (Apple Health and tape)'),
        !existing && prevEntry ? h('button.btn.small', { type: 'button', onclick: () => {
          for (const m of METRICS) if (m.key !== 'weightKg' && Number.isFinite(prevEntry[m.key]) && !Number.isFinite(d[m.key])) d[m.key] = prevEntry[m.key];
          more = true; draw(close); toast('Filled from your last check-in. Change anything that\'s different.');
        } }, 'Same as last time') : null),
      more ? METRICS.filter((m) => !m.core && (m.key !== 'stepsAvg' || !showSteps)).map(input) : null,
      h('div.row.end',
        existing ? h('button.btn.danger', { type: 'button', onclick: async () => {
          if (await confirmSheet('Delete check-in?', `Delete the entry for ${fmtDate(d.date, { year: true })}?`, { ok: 'Delete', danger: true })) {
            store.commit((s) => { s.metrics = s.metrics.filter((m) => m.id !== id); }); close();
          }
        } }, 'Delete') : null,
        h('button.btn.primary', { type: 'button', onclick: () => {
          const vals = Object.fromEntries(METRICS.map((m) => [m.key, Number.isFinite(d[m.key]) ? d[m.key] : null]));
          if (!Object.values(vals).some((v) => v !== null)) { toast('Enter at least one value'); return; }
          store.commit((s) => {
            const clean = Object.fromEntries(Object.entries(vals).filter(([, v]) => v !== null));
            if (existing) {
              const i = s.metrics.findIndex((m) => m.id === id);
              s.metrics[i] = { id, date: d.date, ...clean };
            } else {
              const same = s.metrics.find((m) => m.date === d.date);
              if (same) Object.assign(same, clean);
              else s.metrics.push({ id: uid(), date: d.date, ...clean });
            }
          });
          close();
          toast('Check-in saved');
        } }, 'Save'))));
  };
  const close = sheet(existing ? 'Edit check-in' : 'Check-in', body);
  draw(close);
}

// ---------- Lifts ----------

function renderLifts(stack, ctx) {
  const st = ctx.state;
  const units = st.settings.units;
  const today = todayFn();
  const ids = [...new Set(st.workouts.flatMap((w) => (w.exercises || []).filter((e) => S.entryE1rm(e) > 0 || (e.sets || []).some(S.isWorking)).map((e) => e.exId)))];
  if (!ids.length) {
    stack.append(h('div.card', empty('No lifts yet', 'Finish a workout and your estimated 1RM and PRs show up here.')));
    return;
  }
  ids.sort((a, b) => exName(st, a).localeCompare(exName(st, b)));
  if (!ui.lift || !ids.includes(ui.lift)) ui.lift = ids[0];
  if (S.isBodyweightOnly(ui.lift, st.workouts)) { renderRepsLift(stack, ctx, ids); return; }
  const series = S.e1rmSeries(ui.lift, st.workouts);
  const from = C.rangeStart(ui.range, today, series[0]?.x);
  const pts = C.filterRange(series, from, today).map((p) => ({ x: p.x, y: fromKg(p.y, units) }));
  const key = `lift:${ui.lift}:e1rm`;
  const target = st.targets[key];
  const chart = C.lineChart({ series: [{ points: pts, cls: 's0', dots: true }], target: target !== undefined ? fromKg(target, units) : null, from, to: today, title: 'Estimated 1RM chart' });
  const bests = S.exerciseBests(ui.lift, st.workouts);
  const prs = st.workouts.flatMap((w) => (w.prs || []).filter((p) => p.exId === ui.lift).map((p) => ({ ...p, date: w.date }))).sort((a, b) => (a.date < b.date ? 1 : -1));
  stack.append(h('div.card',
    h('select', { 'aria-label': 'Exercise', onchange: (e) => { ui.lift = e.target.value; ctx.rerender(); } }, ids.map((id) => h('option', { value: id, selected: id === ui.lift }, exName(st, id)))),
    h('div.tiles',
      h('div.tile', h('div.v', fmtWeight(bests.e1rm, units)), h('div.l', 'Best est. 1RM')),
      h('div.tile', h('div.v', fmtWeight(bests.kg, units)), h('div.l', 'Heaviest')),
      h('div.tile', h('div.v', String(bests.sessions)), h('div.l', 'Sessions'))),
    h('div.small.muted', 'Estimated 1RM (Epley), best set each session, sets up to 12 reps.'),
    chartBox(chart),
    targetBlock(ctx, key, { start: series[0]?.y ?? null, current: series[series.length - 1]?.y ?? null, def: { weight: true }, label: 'Est. 1RM', fmt: (v) => fmtWeight(v, units) })));
  stack.append(h('div.section-title', 'PR history'));
  stack.append(h('div.card', prs.length ? prs.slice(0, 20).map((p) => h('div.row.between', { style: { padding: '6px 0' } },
    h('span.small', p.type === 'e1rm' ? `Est. 1RM ${fmtWeight(p.value, units)}` : p.type === 'weight' ? `Heaviest ${fmtWeight(p.kg, units)} × ${p.reps}` : `${p.reps} reps at ${fmtWeight(p.kg, units)}`),
    h('span.small.muted', fmtDate(p.date, { year: true })))) : h('p.small.muted', 'No PRs yet. Your first session sets the baseline.')));
}

function renderRepsLift(stack, ctx, ids) {
  const st = ctx.state;
  const today = todayFn();
  const series = S.repsSeries(ui.lift, st.workouts);
  const from = C.rangeStart(ui.range, today, series[0]?.x);
  const pts = C.filterRange(series, from, today);
  const key = `lift:${ui.lift}:reps`;
  const target = st.targets[key];
  const best = Math.max(0, ...series.map((p) => p.y));
  stack.append(h('div.card',
    h('select', { 'aria-label': 'Exercise', onchange: (e) => { ui.lift = e.target.value; ctx.rerender(); } }, ids.map((id) => h('option', { value: id, selected: id === ui.lift }, exName(st, id)))),
    h('div.tiles',
      h('div.tile', h('div.v', String(best)), h('div.l', 'Best reps in a set')),
      h('div.tile', h('div.v', String(series.length)), h('div.l', 'Sessions'))),
    h('div.small.muted', 'Bodyweight exercise: progress is shown as your best set each session.'),
    chartBox(C.lineChart({ series: [{ points: pts, cls: 's0', dots: true }], target: target ?? null, from, to: today, fmt: (v) => String(Math.round(v)), title: 'Best reps chart' })),
    targetBlock(ctx, key, { start: series[0]?.y ?? null, current: series[series.length - 1]?.y ?? null, def: { unit: 'reps' }, label: 'Reps', fmt: (v) => `${v} reps` })));
}

// ---------- Training volume ----------

function renderVolume(stack, ctx) {
  const st = ctx.state;
  const today = todayFn();
  if (!st.workouts.length) {
    stack.append(h('div.card', empty('No training yet', 'Weekly sets, sessions, volume and cardio appear once you log workouts.')));
    return;
  }
  const earliest = st.workouts.reduce((a, w) => (w.date < a ? w.date : a), today);
  const from = C.rangeStart(ui.range, today, earliest);
  const weeks = S.weeksBetween(from, today);
  const label = (wk) => fmtDate(wk).replace(/ \w+$/, (m) => m);
  const short = (wk) => `${Number(wk.slice(8))}/${Number(wk.slice(5, 7))}`;
  const muscleOf = (id) => exById(st, id)?.primary;
  const sets = S.weeklySetsByMuscle(st.workouts, muscleOf);
  const curPlan = planFor(st, weekStart(today)) || Object.values(st.plans).sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))[0];
  const tgt = curPlan ? E.weeklyTargets(curPlan.goal, curPlan.focus)[ui.muscle] : null;
  stack.append(h('div.card',
    h('div.card-head', h('h3', 'Weekly sets'),
      h('select', { 'aria-label': 'Muscle', style: { width: 'auto' }, onchange: (e) => { ui.muscle = e.target.value; ctx.rerender(); } }, MUSCLES.map((m) => h('option', { value: m, selected: m === ui.muscle }, MUSCLE_LABEL[m])))),
    chartBox(C.barChart({ bars: weeks.map((wk) => ({ label: short(wk), y: sets[wk]?.[ui.muscle] || 0 })), target: tgt ? tgt.min : null, title: `Weekly ${ui.muscle} sets` }),
      { legend: tgt ? legend([['accent', 'Done (direct working sets)'], ['good', `Target ${tgt.min === tgt.max ? tgt.max : tgt.min + '–' + tgt.max}`]]) : null })));

  // This week vs plan per muscle
  if (curPlan) {
    const wk = weekStart(today);
    const t = E.weeklyTargets(curPlan.goal, curPlan.focus);
    stack.append(h('div.card', h('h3', 'This week vs target'), MUSCLES.map((m) => {
      const v = sets[wk]?.[m] || 0;
      return h('div.vol-row', h('span', MUSCLE_LABEL[m]), bar(v, Math.max(t[m].max, v), { cls: v >= t[m].min ? '.good' : '', label: `${MUSCLE_LABEL[m]} sets this week` }), h('span.num.small', `${v}/${t[m].min === t[m].max ? t[m].max : t[m].min + '–' + t[m].max}`));
    })));
  }

  const sessions = S.sessionsByWeek(st.workouts);
  const plannedSessions = curPlan ? curPlan.sessions.filter((s) => !s.skipped).length : null;
  stack.append(h('div.card', h('h3', 'Sessions per week'),
    chartBox(C.barChart({ bars: weeks.map((wk) => ({ label: short(wk), y: sessions[wk] || 0 })), target: plannedSessions, title: 'Sessions per week' }))));
  const vol = S.volumeByWeek(st.workouts);
  const units = st.settings.units;
  stack.append(h('div.card', h('h3', `Total volume per week (${units})`),
    chartBox(C.barChart({ bars: weeks.map((wk) => ({ label: short(wk), y: fromKg(vol[wk] || 0, units) })), fmt: (v) => (v >= 1000 ? `${round(v / 1000, 1)}k` : String(Math.round(v))), title: 'Volume per week' }))));
  const cardio = S.cardioMinutesByWeek(st.workouts);
  if (Object.keys(cardio).length || st.weightGoal) {
    stack.append(h('div.card', h('h3', 'Cardio minutes per week'),
      chartBox(C.barChart({ bars: weeks.map((wk) => ({ label: short(wk), y: cardio[wk] || 0, cls: 'cardio' })), target: curPlan?.cardioTargetMin || null, title: 'Cardio minutes per week' }))));
  }
  void label;
}
