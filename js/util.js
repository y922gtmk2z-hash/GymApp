// Pure helpers: local dates, week maths, ids, small utilities. No DOM.

const pad = (n) => String(n).padStart(2, '0');

/** Local calendar date string YYYY-MM-DD for a Date (defaults to now). */
export function isoDate(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Parse YYYY-MM-DD as a LOCAL date at noon (avoids UTC shift and DST edges). */
export function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

export function addDays(s, n) {
  const d = parseDate(s);
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

/** ISO weekday 1 (Mon) .. 7 (Sun). */
export function weekday(s) {
  const w = parseDate(s).getDay();
  return w === 0 ? 7 : w;
}

/** Monday of the week containing s. */
export function weekStart(s) {
  return addDays(s, 1 - weekday(s));
}

/** Date in a week for ISO weekday (1..7). */
export function dateForWeekday(weekStartStr, wd) {
  return addDays(weekStartStr, wd - 1);
}

export function today() {
  return isoDate(new Date());
}

export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(s, { weekday: wd = false, year = false } = {}) {
  const d = parseDate(s);
  let out = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  if (year) out += ` ${d.getFullYear()}`;
  if (wd) out = `${WEEKDAY_SHORT[weekday(s) - 1]} ${out}`;
  return out;
}

export function fmtDuration(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${pad(m)}:${pad(s)}`;
  return `${m}:${pad(s)}`;
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}

export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export function round(x, dp = 0) {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

export function debounce(fn, ms) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
  wrapped.flush = (...args) => {
    clearTimeout(t);
    fn(...args);
  };
  return wrapped;
}

/** Deep clone for plain JSON data. */
export const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)));

export function slug(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

/** Parse a user-typed number, accepting comma decimals. Returns null if empty/invalid. */
export function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function sum(arr, f = (x) => x) {
  let t = 0;
  for (const x of arr) t += f(x);
  return t;
}

export function groupBy(arr, f) {
  const m = {};
  for (const x of arr) (m[f(x)] ||= []).push(x);
  return m;
}
