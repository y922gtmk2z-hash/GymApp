// SVG charts without a library. Geometry is pure and returns strings (Node-testable).
import { daysBetween, addDays, fmtDate } from './util.js';

export const RANGES = [
  { id: '4w', label: '4W', days: 28 },
  { id: '3m', label: '3M', days: 91 },
  { id: '6m', label: '6M', days: 182 },
  { id: '1y', label: '1Y', days: 365 },
  { id: 'all', label: 'All', days: null },
];

export function rangeStart(rangeId, today, earliest = null) {
  const r = RANGES.find((x) => x.id === rangeId) || RANGES[1];
  if (!r.days) return earliest || addDays(today, -365);
  return addDays(today, -(r.days - 1));
}

export function filterRange(points, from, to) {
  return points.filter((p) => p.x >= from && p.x <= to);
}

export const scale = (d0, d1, r0, r1) => (v) => (d1 === d0 ? (r0 + r1) / 2 : r0 + ((v - d0) / (d1 - d0)) * (r1 - r0));

/** 'Nice' tick values covering [min, max]. */
export function niceTicks(min, max, count = 4) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1) * mag;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toFixed(10)));
  return ticks;
}

export function pathD(pts) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('');
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const PAD = { l: 38, r: 10, t: 10, b: 22 };

/**
 * Line chart over dates.
 * series: [{points:[{x:'YYYY-MM-DD', y}], cls:'s0', line:true, dots:false}]
 * target: number|null, goal: [{x,y},{x,y}]|null, from/to: date domain.
 * Returns { svg, hits: [{px, label, si}] } where hits are tap targets.
 */
export function lineChart({ series, target = null, goal = null, from, to, width = 340, height = 190, fmt = (v) => String(Math.round(v * 10) / 10), title = 'Chart' }) {
  const all = series.flatMap((s) => s.points.map((p) => p.y));
  if (target !== null && target !== undefined) all.push(target);
  if (goal) for (const g of goal) if (g.x >= from && g.x <= to) all.push(g.y);
  if (!all.length) return { svg: '', hits: [] };
  let min = Math.min(...all), max = Math.max(...all);
  const padY = (max - min) * 0.08 || 1;
  const ticks = niceTicks(min - padY, max + padY, 4);
  min = ticks[0]; max = ticks[ticks.length - 1];
  const totalDays = Math.max(1, daysBetween(from, to));
  const xs = scale(0, totalDays, PAD.l, width - PAD.r);
  const ys = scale(min, max, height - PAD.b, PAD.t);
  const X = (d) => xs(daysBetween(from, d));
  const parts = [];
  for (const t of ticks) {
    const y = ys(t).toFixed(1);
    parts.push(`<line class="grid" x1="${PAD.l}" x2="${width - PAD.r}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text x="${PAD.l - 4}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`);
  }
  // x labels: start, middle, end
  for (const d of [from, addDays(from, Math.round(totalDays / 2)), to]) {
    parts.push(`<text x="${X(d).toFixed(1)}" y="${height - 6}" text-anchor="${d === from ? 'start' : d === to ? 'end' : 'middle'}">${esc(fmtDate(d))}</text>`);
  }
  if (goal) {
    const clip = goal.map((g) => [X(g.x), ys(g.y)]);
    parts.push(`<path class="goal" d="${pathD(clip)}"/>`);
  }
  if (target !== null && target !== undefined) {
    const y = ys(target).toFixed(1);
    parts.push(`<line class="target" x1="${PAD.l}" x2="${width - PAD.r}" y1="${y}" y2="${y}"/>`);
  }
  const hits = [];
  series.forEach((s, si) => {
    const pts = s.points.map((p) => [X(p.x), ys(p.y)]);
    if (s.line !== false && pts.length > 1) parts.push(`<path class="${s.cls || 's0'}" d="${pathD(pts)}"/>`);
    if (s.dots || pts.length === 1) for (const [px, py] of pts) parts.push(`<circle class="pt${s.line === false ? '' : ' solid'}" cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="${s.line === false ? 3 : 3.5}"/>`);
    s.points.forEach((p, i) => hits.push({ px: pts[i][0], py: pts[i][1], label: `${fmtDate(p.x, { year: true })}: ${fmt(p.y)}${s.name ? ' (' + s.name + ')' : ''}`, si }));
  });
  const svg = `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}" preserveAspectRatio="xMidYMid meet">${parts.join('')}<circle class="sel" r="0" cx="0" cy="0"/></svg>`;
  return { svg, hits };
}

/** Column chart. bars: [{label, y, cls?}], target line optional. */
export function barChart({ bars, target = null, width = 340, height = 170, fmt = (v) => String(Math.round(v)), title = 'Chart' }) {
  if (!bars.length) return { svg: '', hits: [] };
  const all = [...bars.map((b) => b.y), 0];
  if (target !== null && target !== undefined) all.push(target);
  const ticks = niceTicks(0, Math.max(...all) || 1, 4);
  const max = ticks[ticks.length - 1];
  const ys = scale(0, max, height - PAD.b, PAD.t);
  const inner = width - PAD.l - PAD.r;
  const bw = inner / bars.length;
  const parts = [];
  for (const t of ticks) {
    const y = ys(t).toFixed(1);
    parts.push(`<line class="grid" x1="${PAD.l}" x2="${width - PAD.r}" y1="${y}" y2="${y}"/>`);
    parts.push(`<text x="${PAD.l - 4}" y="${(+y + 4).toFixed(1)}" text-anchor="end">${esc(fmt(t))}</text>`);
  }
  const hits = [];
  bars.forEach((b, i) => {
    const x = PAD.l + i * bw + bw * 0.15;
    const y = ys(b.y);
    parts.push(`<rect class="colbar ${b.cls || ''}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, ys(0) - y).toFixed(1)}" rx="2"/>`);
    if (bars.length <= 12 || i % Math.ceil(bars.length / 6) === 0) parts.push(`<text x="${(x + bw * 0.35).toFixed(1)}" y="${height - 6}" text-anchor="middle">${esc(b.label)}</text>`);
    hits.push({ px: x + bw * 0.35, py: y, label: `${b.label}: ${fmt(b.y)}` });
  });
  if (target !== null && target !== undefined) {
    const y = ys(target).toFixed(1);
    parts.push(`<line class="target" x1="${PAD.l}" x2="${width - PAD.r}" y1="${y}" y2="${y}"/>`);
  }
  return { svg: `<svg class="chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}">${parts.join('')}<circle class="sel" r="0" cx="0" cy="0"/></svg>`, hits };
}

/** Progress (0-100) from a start value toward a target, either direction. */
export function targetProgress(start, current, target) {
  if ([start, current, target].some((v) => v === null || v === undefined)) return 0;
  if (start === target) return current === target ? 100 : 0;
  const p = ((current - start) / (target - start)) * 100;
  return Math.max(0, Math.min(100, p));
}
