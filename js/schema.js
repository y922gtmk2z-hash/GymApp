// State schema: defaults, migrations and validation. Pure, Node-testable.
import { MUSCLES, defaultProfiles } from './data.js';
import { uid } from './util.js';

export const VERSION = 2;

export const DEFAULT_PLATES = [25, 20, 15, 10, 5, 2.5, 1.25];

export function defaultFocus() {
  return Object.fromEntries(MUSCLES.map((m) => [m, 'maintain']));
}

export function defaults() {
  return {
    version: VERSION,
    user: { id: uid(), name: '', heightCm: null, birthYear: null },
    settings: {
      units: 'kg',
      theme: 'dark',
      restDefaults: { compound: null, isolation: null },
      restOverrides: {},
      alarmMinutes: 30,
      weekStartsOn: 1,
      stepCap: 10000,
      logEffort: false,
      autoWarmups: true,
      barKg: 20,
      plates: [...DEFAULT_PLATES],
    },
    profiles: defaultProfiles(),
    customExercises: [],
    customActivities: [],
    exercisePrefs: { exclude: [], favourite: [] },
    exerciseNotes: {},
    block: null,
    milestonesSeen: [],
    onboarded: false,
    builder: {
      supersets: false,
      weeks: 1,
      goal: 'muscle',
      focus: defaultFocus(),
      days: [
        { weekday: 1, profileId: 'gym', minutes: 60, startTime: '18:00' },
        { weekday: 3, profileId: 'gym', minutes: 60, startTime: '18:00' },
        { weekday: 5, profileId: 'gym', minutes: 60, startTime: '18:00' },
      ],
    },
    plans: {},
    workouts: [],
    activeWorkout: null,
    timer: null,
    metrics: [],
    targets: {},
    weightGoal: null,
    dismissed: {},
    lastExportAt: null,
    lastDeloadWeek: null,
  };
}

/**
 * Migrations: MIGRATIONS[n] upgrades a version-n document to version n+1.
 * Version 0 = unversioned early drafts (no `version` field).
 */
export const MIGRATIONS = {
  0: (s) => {
    const d = defaults();
    const out = { ...d, ...s, version: 1 };
    out.settings = { ...d.settings, ...(s.settings || {}) };
    out.user = { ...d.user, ...(s.user || {}) };
    if (s.plan && !s.plans) {
      out.plans = { [s.plan.weekStart]: s.plan };
      delete out.plan;
    }
    return out;
  },
};

MIGRATIONS[1] = (s) => {
  const d = defaults();
  const out = { ...s, version: 2 };
  out.settings = { ...d.settings, ...s.settings };
  out.builder = { supersets: false, weeks: 1, ...s.builder };
  out.exercisePrefs = s.exercisePrefs || { exclude: [], favourite: [] };
  out.exerciseNotes = s.exerciseNotes || {};
  out.block = s.block ?? null;
  out.milestonesSeen = s.milestonesSeen || [];
  out.onboarded = s.onboarded ?? (Object.keys(s.plans || {}).length > 0 || (s.workouts || []).length > 0);
  out.profiles = (s.profiles || []).map((p) => ({ weights: { dumbbellMaxKg: null, kettlebellMaxKg: null }, ...p }));
  return out;
};

export function migrate(input) {
  let s = input;
  let v = typeof s.version === 'number' ? s.version : 0;
  if (v > VERSION) throw new Error(`Backup is from a newer app version (${v}). Update the app first.`);
  while (v < VERSION) {
    const m = MIGRATIONS[v];
    if (!m) throw new Error(`No migration from version ${v}`);
    s = m(s);
    v = s.version;
  }
  // Fill any fields added since (forward-compatible defaults).
  const d = defaults();
  for (const k of Object.keys(d)) if (!(k in s)) s[k] = d[k];
  for (const k of Object.keys(d.settings)) if (!(k in s.settings)) s.settings[k] = d.settings[k];
  for (const k of Object.keys(d.user)) if (!(k in s.user)) s.user[k] = d.user[k];
  return s;
}

const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
const isDate = (x) => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x);
const isNumOrNull = (x) => x === null || x === undefined || (typeof x === 'number' && Number.isFinite(x));

/** Validate a (migrated) state document. Returns a list of human-readable errors. */
export function validate(s) {
  const errors = [];
  const err = (m) => { if (errors.length < 50) errors.push(m); };
  if (!isObj(s)) return ['Not a JSON object'];
  if (s.version !== VERSION) err(`version must be ${VERSION}`);
  if (!isObj(s.user)) err('user must be an object');
  if (!isObj(s.settings)) err('settings must be an object');
  else {
    if (!['kg', 'lb'].includes(s.settings.units)) err('settings.units must be kg or lb');
    if (!['dark', 'light', 'auto'].includes(s.settings.theme)) err('settings.theme must be dark, light or auto');
    if (typeof s.settings.alarmMinutes !== 'number') err('settings.alarmMinutes must be a number');
  }
  if (!Array.isArray(s.profiles) || !s.profiles.length) err('profiles must be a non-empty list');
  else s.profiles.forEach((p, i) => {
    if (!p || typeof p.id !== 'string' || typeof p.name !== 'string' || !Array.isArray(p.equipment)) err(`profiles[${i}] is malformed`);
  });
  for (const k of ['customExercises', 'customActivities', 'workouts', 'metrics']) {
    if (!Array.isArray(s[k])) err(`${k} must be a list`);
  }
  if (!isObj(s.plans)) err('plans must be an object');
  else for (const [wk, p] of Object.entries(s.plans)) {
    if (!isDate(wk)) err(`plans key ${wk} is not a date`);
    if (!p || !Array.isArray(p.sessions)) err(`plans[${wk}].sessions must be a list`);
  }
  if (Array.isArray(s.workouts)) s.workouts.forEach((w, i) => {
    if (!w || typeof w.id !== 'string' || !isDate(w.date)) { err(`workouts[${i}] needs id and date`); return; }
    if (!Array.isArray(w.exercises)) { err(`workouts[${i}].exercises must be a list`); return; }
    w.exercises.forEach((e, j) => {
      if (!e || typeof e.exId !== 'string' || !Array.isArray(e.sets)) err(`workouts[${i}].exercises[${j}] is malformed`);
      else e.sets.forEach((st, k) => {
        if (!isNumOrNull(st.kg) || !isNumOrNull(st.reps)) err(`workouts[${i}].exercises[${j}].sets[${k}] has non-numeric values`);
      });
    });
    if (w.cardio !== undefined && !Array.isArray(w.cardio)) err(`workouts[${i}].cardio must be a list`);
  });
  if (Array.isArray(s.metrics)) s.metrics.forEach((m, i) => {
    if (!m || !isDate(m.date)) err(`metrics[${i}] needs a date`);
    else for (const [k, v] of Object.entries(m)) {
      if (k !== 'date' && k !== 'id' && !isNumOrNull(v)) err(`metrics[${i}].${k} must be a number`);
    }
  });
  if (!isObj(s.targets)) err('targets must be an object');
  if (!isObj(s.exercisePrefs) || !Array.isArray(s.exercisePrefs.exclude) || !Array.isArray(s.exercisePrefs.favourite)) err('exercisePrefs must have exclude and favourite lists');
  if (!isObj(s.exerciseNotes)) err('exerciseNotes must be an object');
  if (s.block !== null && !isObj(s.block)) err('block must be an object or null');
  if (s.settings && !Array.isArray(s.settings.plates)) err('settings.plates must be a list');
  if (s.weightGoal !== null && s.weightGoal !== undefined && !isObj(s.weightGoal)) err('weightGoal must be an object or null');
  return errors;
}

/** Parse, migrate and validate backup text. Returns {ok, state?, errors[]}. */
export function parseBackup(text) {
  let obj;
  try { obj = JSON.parse(text); } catch { return { ok: false, errors: ['File is not valid JSON'] }; }
  if (!isObj(obj)) return { ok: false, errors: ['Not a JSON object'] };
  if (obj.app !== undefined && obj.app !== 'gym-pwa') return { ok: false, errors: ['This is not a Gym backup file'] };
  const data = obj.app === 'gym-pwa' ? obj.data : obj;
  let state;
  try { state = migrate(structuredCloneSafe(data)); } catch (e) { return { ok: false, errors: [e.message] }; }
  const errors = validate(state);
  return errors.length ? { ok: false, errors } : { ok: true, state, errors: [] };
}

/** Serialise state for backup. */
export function makeBackup(state, now = new Date()) {
  return JSON.stringify({ app: 'gym-pwa', exportedAt: now.toISOString(), data: state }, null, 2);
}

function structuredCloneSafe(x) {
  return JSON.parse(JSON.stringify(x));
}

export function summarize(s) {
  return {
    workouts: s.workouts.length,
    metrics: s.metrics.length,
    plans: Object.keys(s.plans).length,
    customExercises: s.customExercises.length,
  };
}
