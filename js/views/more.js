import { h, segmented, toast, confirmSheet, field, numInput, sheet } from '../ui.js';
import { makeBackup, parseBackup, summarize } from '../schema.js';
import { saveFile, pickFile } from '../share.js';
import * as store from '../store.js';
import { isPersisted, backend } from '../db.js';
import { workoutVolume, recomputeAllPRs, bestPRsByLift } from '../stats.js';
import { fmtWeight, displayWeight } from '../units.js';
import { fmtDuration } from '../util.js';
import { exName, actName } from './common.js';
import { withSampleData } from '../sample.js';
import { defaults } from '../schema.js';
import { daysBetween, today, isoDate, fmtDate, parseNum, uid, slug } from '../util.js';
import { allExercises, allActivities, MUSCLES, MUSCLE_LABEL, EQUIPMENT_LABEL, STRENGTH_EQUIPMENT, CARDIO_EQUIPMENT, PATTERNS, LIBRARY, ACTIVITIES } from '../data.js';

const lib = { tab: 'exercises', q: '', muscle: '', equip: '' };

export function equipText(equip) {
  return equip.map((alt) => alt.map((t) => EQUIPMENT_LABEL[t] || t).join(' + ')).join(' or ');
}

function renderLibrary(root, ctx) {
  const list = h('div.card');
  const draw = () => {
    list.replaceChildren();
    const q = lib.q.trim().toLowerCase();
    if (lib.tab === 'exercises') {
      const items = allExercises(ctx.state.customExercises).filter((e) =>
        (!q || e.name.toLowerCase().includes(q)) && (!lib.muscle || e.primary === lib.muscle) &&
        (!lib.equip || e.equip.some((alt) => alt.includes(lib.equip))));
      if (!items.length) list.append(h('p.muted', 'No exercises match.'));
      for (const e of items) list.append(h(e.id.startsWith('c_') ? 'button.exercise-item.list-btn' : 'div.exercise-item', { type: 'button', onclick: e.id.startsWith('c_') ? () => editCustomExercise(ctx, e) : undefined },
        h('div.grow', h('div.ex-name', e.name, e.id.startsWith('c_') ? h('span.badge.accent', { style: { marginLeft: '6px' } }, 'Custom') : null),
          h('div.small.muted', `${MUSCLE_LABEL[e.primary]}${e.secondary.length ? ' (+ ' + e.secondary.map((m) => MUSCLE_LABEL[m]).join(', ') + ')' : ''} · ${e.type === 'compound' ? 'Compound' : 'Isolation'}`),
          h('div.tiny.muted', equipText(e.equip)))));
    } else {
      const items = allActivities(ctx.state.customActivities).filter((a) => (!q || a.name.toLowerCase().includes(q)) && (!lib.equip || a.equip.some((alt) => alt.includes(lib.equip))));
      if (!items.length) list.append(h('p.muted', 'No activities match.'));
      for (const a of items) list.append(h(a.id.startsWith('c_') ? 'button.exercise-item.list-btn' : 'div.exercise-item', { type: 'button', onclick: a.id.startsWith('c_') ? () => editCustomActivity(ctx, a) : undefined },
        h('div.grow', h('div.ex-name', a.name), h('div.small.muted', `${a.impact === 'low' ? 'Low impact' : 'High impact'} · ${a.intensities.join(', ')}`),
          h('div.tiny.muted', equipText(a.equip)))));
    }
  };
  const muscleSel = h('select', { 'aria-label': 'Filter by muscle', onchange: (e) => { lib.muscle = e.target.value; draw(); } },
    h('option', { value: '' }, 'All muscles'), MUSCLES.map((m) => h('option', { value: m, selected: lib.muscle === m }, MUSCLE_LABEL[m])));
  const equipSel = h('select', { 'aria-label': 'Filter by equipment', onchange: (e) => { lib.equip = e.target.value; draw(); } },
    h('option', { value: '' }, 'All equipment'),
    [...STRENGTH_EQUIPMENT, ...CARDIO_EQUIPMENT].map((t) => h('option', { value: t, selected: lib.equip === t }, EQUIPMENT_LABEL[t])));
  root.append(h('div.stack',
    segmented({ label: 'Library', value: lib.tab, options: [{ value: 'exercises', label: 'Exercises' }, { value: 'activities', label: 'Cardio' }],
      onChange: (v) => { lib.tab = v; muscleSel.hidden = v !== 'exercises'; draw(); } }),
    h('input', { type: 'search', placeholder: 'Search', value: lib.q, 'aria-label': 'Search exercises', oninput: (e) => { lib.q = e.target.value; draw(); } }),
    h('div.grid2', muscleSel, equipSel),
    h('button.btn.block', { type: 'button', onclick: () => (lib.tab === 'exercises' ? editCustomExercise(ctx, null) : editCustomActivity(ctx, null)) }, '+ Add custom'),
    list));
  muscleSel.hidden = lib.tab !== 'exercises';
  draw();
}

const SECTIONS = [
  { id: 'workouts', label: 'Workout history', hint: 'Edit or delete past workouts' },
  { id: 'library', label: 'Exercise library', hint: 'Browse exercises and cardio activities' },
  { id: 'profiles', label: 'Equipment profiles', hint: 'Gym, Home and your own setups' },
  { id: 'settings', label: 'Settings', hint: 'Units, theme, rest times' },
  { id: 'backup', label: 'Backup', hint: 'Export and import your data' },
];

export function render(root, ctx) {
  const sub = ctx.params[0];
  const section = SECTIONS.find((s) => s.id === sub);
  if (!section) return renderMenu(root, ctx);
  ctx.setTitle(section.label);
  ctx.setActions(h('a.btn.small', { href: '#/more' }, 'Done'));
  ({ workouts: renderWorkouts, library: renderLibrary, profiles: renderProfiles, settings: renderSettings, backup: renderBackup })[section.id](root, ctx);
}

function renderMenu(root, ctx) {
  ctx.setTitle('More');
  root.append(h('div.card', SECTIONS.map((s) =>
    h('a.list-btn', { href: '#/more/' + s.id, style: { color: 'inherit', textDecoration: 'none' } },
      h('span', h('div.ex-name', s.label), h('div.small.muted', s.hint)), h('span.muted', '›')))));
}

function renderSettings(root, ctx) {
  const s = ctx.state.settings;
  const set = (fn) => ctx.commit((st) => { fn(st); });
  root.append(h('div.stack',
    h('div.card',
      field('Your name', h('input', { type: 'text', value: ctx.state.user.name, autocomplete: 'given-name',
        oninput: (e) => ctx.commit((st) => { st.user.name = e.target.value; }, { silent: true }) })),
      h('div.field', h('label', 'Units'),
        segmented({ label: 'Units', value: s.units, options: [{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }],
          onChange: (v) => set((st) => { st.settings.units = v; }) })),
      h('div.field', h('label', 'Theme'),
        segmented({ label: 'Theme', value: s.theme, options: [{ value: 'dark', label: 'Dark' }, { value: 'auto', label: 'Auto' }, { value: 'light', label: 'Light' }],
          onChange: (v) => set((st) => { st.settings.theme = v; }) })),
      h('div.grid2',
        field('Height (cm)', numInput({ value: ctx.state.user.heightCm ?? '', label: 'Height in centimetres',
          onInput: (v) => ctx.commit((st) => { st.user.heightCm = parseNum(v); }, { silent: true }) }), 'Optional. Apple Health: Height'),
        field('Birth year', numInput({ value: ctx.state.user.birthYear ?? '', decimal: false, label: 'Birth year',
          onInput: (v) => ctx.commit((st) => { const n = parseNum(v); st.user.birthYear = n && n > 1900 ? Math.round(n) : null; }, { silent: true }) }), 'Optional. For heart-rate zones')),
      h('div.grid2',
        field('Compound rest (s)', numInput({ value: s.restDefaults.compound ?? '', decimal: false, placeholder: 'by goal', label: 'Default compound rest seconds',
          onInput: (v) => ctx.commit((st) => { st.settings.restDefaults.compound = parseNum(v); }, { silent: true }) })),
        field('Isolation rest (s)', numInput({ value: s.restDefaults.isolation ?? '', decimal: false, placeholder: 'by goal', label: 'Default isolation rest seconds',
          onInput: (v) => ctx.commit((st) => { st.settings.restDefaults.isolation = parseNum(v); }, { silent: true }) }))),
      field('Daily step cap', numInput({ value: s.stepCap, decimal: false, label: 'Daily step cap',
        onInput: (v) => { const n = parseNum(v); if (n && n >= 2000) ctx.commit((st) => { st.settings.stepCap = Math.round(n); if (st.weightGoal) st.weightGoal.stepCap = Math.round(n); }, { silent: true }); } }), 'Weight-loss step targets never go above this.'),
      h('div.hr'),
      h('label.check', h('input', { type: 'checkbox', checked: !!s.logEffort, onchange: (e) => ctx.commit((st) => { st.settings.logEffort = e.target.checked; }, { silent: true }) }),
        h('span', 'Log effort ', h('span.small.muted', '(reps in reserve per set: fine-tunes weight jumps)'))),
      h('label.check', h('input', { type: 'checkbox', checked: s.autoWarmups !== false, onchange: (e) => ctx.commit((st) => { st.settings.autoWarmups = e.target.checked; }, { silent: true }) }),
        h('span', 'Add warm-up sets ', h('span.small.muted', '(to the first big lift of a planned session)'))),
      field('Barbell weight (kg)', numInput({ value: s.barKg ?? 20, label: 'Barbell weight in kilograms',
        onInput: (v) => { const n = parseNum(v); if (n !== null && n >= 0) ctx.commit((st) => { st.settings.barKg = n; }, { silent: true }); } }), 'In lb mode a 45 lb bar and standard lb plates are used.'),
      h('div.field', h('label', 'Plates you have (kg)'), h('div.row', [25, 20, 15, 10, 5, 2.5, 2, 1.25, 1, 0.5].map((p) => {
        const b = h('button.chip', { type: 'button', 'aria-pressed': String(s.plates.includes(p)), onclick: () => {
          ctx.commit((st) => { const pl = st.settings.plates; st.settings.plates = pl.includes(p) ? pl.filter((x) => x !== p) : [...pl, p].sort((x, y) => y - x); }, { silent: true });
          b.setAttribute('aria-pressed', String(store.get().settings.plates.includes(p)));
        } }, String(p));
        return b;
      }))),
      h('div.hr'),
      field('Calendar alert (minutes before)', numInput({ value: s.alarmMinutes, decimal: false,
        onInput: (v) => { const n = parseNum(v); if (n !== null && n >= 0) ctx.commit((st) => { st.settings.alarmMinutes = Math.round(n); }, { silent: true }); } })),
    ),
    h('div.card.flat',
      h('h3', 'Try it out'),
      h('p.small.muted', 'Fill the app with 12 weeks of example training, check-ins and a weight-loss phase. This replaces your data, so export a backup first.'),
      h('div.row',
        h('button.btn.small', { type: 'button', onclick: async () => {
          if (!(await confirmSheet('Load sample data?', 'All current data on this device will be replaced.', { ok: 'Load', danger: true }))) return;
          store.replace(withSampleData(defaults(), today())); toast('Sample data loaded');
        } }, 'Load sample data'),
        h('button.btn.small.danger', { type: 'button', onclick: async () => {
          if (!(await confirmSheet('Erase all data?', 'Everything on this device will be deleted. This can\'t be undone.', { ok: 'Erase', danger: true }))) return;
          store.replace(defaults()); toast('All data erased');
        } }, 'Erase all data'))),
  ));
}

function renderBackup(root, ctx) {
  const st = ctx.state;
  const last = st.lastExportAt ? isoDate(new Date(st.lastExportAt)) : null;
  const persisted = h('span.muted', '…');
  isPersisted().then((p) => { persisted.textContent = p ? 'Persistent (protected from automatic clean-up)' : 'Not persistent (iOS may clear it if storage runs low)'; });
  const sum = summarize(st);
  root.append(h('div.stack',
    h('div.card',
      h('h2', 'Export'),
      h('p.muted.small', 'Saves everything (plans, workouts, check-ins, settings) as a JSON file. Keep a copy in Files or iCloud Drive.'),
      h('p.small', last ? `Last export: ${fmtDate(last, { year: true })} (${daysBetween(last, today())} days ago)` : 'Never exported.'),
      h('button.btn.primary.block', { type: 'button', onclick: () => doExport(ctx) }, 'Export backup')),
    h('div.card',
      h('h2', 'Import'),
      h('p.muted.small', 'Replaces all data on this device with the backup. The file is checked first.'),
      h('button.btn.block', { type: 'button', onclick: () => doImport(ctx) }, 'Import backup…')),
    h('div.card.flat',
      h('div.small', `${sum.workouts} workouts · ${sum.metrics} check-ins · ${sum.plans} weekly plans`),
      h('div.small', 'Storage: ', backend(), ' · ', persisted)),
  ));
}

export async function doExport(ctx) {
  const now = new Date();
  ctx.commit((s) => { s.lastExportAt = now.getTime(); }, { silent: true });
  const text = makeBackup(store.get(), now);
  const res = await saveFile(text, `gym-backup-${isoDate(now)}.json`, 'application/json');
  if (res !== 'cancelled') toast('Backup exported');
  ctx.rerender();
}

async function doImport(ctx) {
  const text = await pickFile();
  if (!text) return;
  const r = parseBackup(text);
  if (!r.ok) {
    toast('Import failed: ' + r.errors.slice(0, 2).join('; '), { ms: 6000 });
    console.warn(r.errors);
    return;
  }
  const s = summarize(r.state);
  const ok = await confirmSheet('Replace all data?',
    `The backup has ${s.workouts} workouts, ${s.metrics} check-ins and ${s.plans} weekly plans. Everything currently on this device will be replaced.`,
    { ok: 'Replace', danger: true });
  if (!ok) return;
  store.replace(r.state);
  toast('Backup imported');
}


// ---------- Profiles ----------

function renderProfiles(root, ctx) {
  const st = ctx.state;
  root.append(h('div.stack',
    h('p.small.muted', 'Each training day uses one profile, and the plan only picks exercises you have the equipment for.'),
    h('div.card', st.profiles.map((p) => h('button.list-btn', { type: 'button', onclick: () => editProfile(ctx, p.id) },
      h('span', h('div.ex-name', p.name), h('div.small.muted', p.equipment.map((t) => EQUIPMENT_LABEL[t]).join(', ') || 'Bodyweight only')), h('span.muted', '›')))),
    h('button.btn.block', { type: 'button', onclick: () => {
      const id = 'p_' + uid().slice(0, 8);
      ctx.commit((s) => { s.profiles.push({ id, name: 'New profile', equipment: ['bodyweight'] }); });
      editProfile(ctx, id);
    } }, '+ Add profile')));
}

function profileInUse(st, id) {
  const t = today();
  if (st.builder.days.some((d) => d.profileId === id)) return true;
  if (st.weightGoal?.cardioDays?.some((d) => d.profileId === id)) return true;
  return Object.values(st.plans).some((p) => p.sessions.some((s) => s.profileId === id && s.date >= t));
}

function editProfile(ctx, id) {
  const store0 = ctx;
  sheet('Equipment profile', (close) => {
    const p = store.get().profiles.find((x) => x.id === id);
    const update = (fn) => store0.commit((s) => { fn(s.profiles.find((x) => x.id === id)); });
    const chips = (tags) => h('div.row', tags.map((t) => {
      const b = h('button.chip', { type: 'button', 'aria-pressed': String(p.equipment.includes(t)), onclick: () => {
        update((x) => { x.equipment = x.equipment.includes(t) ? x.equipment.filter((y) => y !== t) : [...x.equipment, t]; });
        b.setAttribute('aria-pressed', String(store.get().profiles.find((x) => x.id === id).equipment.includes(t)));
      } }, EQUIPMENT_LABEL[t]);
      return b;
    }));
    return h('div.stack',
      field('Name', h('input', { type: 'text', value: p.name, oninput: (e) => update((x) => { x.name = e.target.value || 'Profile'; }) })),
      h('div.section-title', 'Strength'), chips(STRENGTH_EQUIPMENT),
      h('div.section-title', 'Cardio'), chips(CARDIO_EQUIPMENT),
      h('div.section-title', 'Available weights'),
      h('p.tiny.muted', 'Leave blank if you have a full rack. Progression stops at the heaviest weight and adds reps instead.'),
      h('div.grid2',
        field('Heaviest dumbbell (kg)', numInput({ value: p.weights?.dumbbellMaxKg ?? '', label: 'Heaviest dumbbell in kilograms',
          onInput: (v) => update((x) => { x.weights = { ...(x.weights || {}), dumbbellMaxKg: parseNum(v) }; }) })),
        field('Heaviest kettlebell (kg)', numInput({ value: p.weights?.kettlebellMaxKg ?? '', label: 'Heaviest kettlebell in kilograms',
          onInput: (v) => update((x) => { x.weights = { ...(x.weights || {}), kettlebellMaxKg: parseNum(v) }; }) }))),
      p.builtin ? h('p.tiny.muted', 'Built-in profiles can be edited but not deleted.') :
        h('button.btn.danger', { type: 'button', onclick: async () => {
          if (profileInUse(store.get(), id)) { toast('This profile is used by your plan. Change those days first.'); return; }
          if (await confirmSheet('Delete profile?', `Delete ${p.name}?`, { ok: 'Delete', danger: true })) {
            store0.commit((s) => { s.profiles = s.profiles.filter((x) => x.id !== id); });
            close();
          }
        } }, 'Delete profile'));
  });
}

// ---------- Custom exercises and activities ----------

function uniqueId(base, taken) {
  let id = 'c_' + (slug(base) || 'exercise');
  let n = 2;
  while (taken.has(id)) id = 'c_' + slug(base) + '_' + n++;
  return id;
}

function editCustomExercise(ctx, existing) {
  const d = existing ? JSON.parse(JSON.stringify(existing)) : { name: '', primary: 'chest', secondary: [], type: 'compound', pattern: 'h_push', equip: [['dumbbell']], alternatives: [] };
  sheet(existing ? 'Edit exercise' : 'Custom exercise', (close) => {
    const tags = new Set(d.equip[0] || []);
    const chips = h('div.row', STRENGTH_EQUIPMENT.map((t) => {
      const b = h('button.chip', { type: 'button', 'aria-pressed': String(tags.has(t)), onclick: () => {
        tags.has(t) ? tags.delete(t) : tags.add(t); b.setAttribute('aria-pressed', String(tags.has(t)));
      } }, EQUIPMENT_LABEL[t]);
      return b;
    }));
    const sec = h('div.row', MUSCLES.map((m) => {
      const b = h('button.chip', { type: 'button', 'aria-pressed': String(d.secondary.includes(m)), onclick: () => {
        d.secondary = d.secondary.includes(m) ? d.secondary.filter((x) => x !== m) : [...d.secondary, m]; b.setAttribute('aria-pressed', String(d.secondary.includes(m)));
      } }, MUSCLE_LABEL[m]);
      return b;
    }));
    return h('div.stack',
      field('Name', h('input', { type: 'text', value: d.name, oninput: (e) => { d.name = e.target.value; } })),
      field('Primary muscle', h('select', { onchange: (e) => { d.primary = e.target.value; } }, MUSCLES.map((m) => h('option', { value: m, selected: d.primary === m }, MUSCLE_LABEL[m])))),
      h('div.field', h('label', 'Type'), segmented({ label: 'Type', value: d.type, options: [{ value: 'compound', label: 'Compound' }, { value: 'isolation', label: 'Isolation' }], onChange: (v) => { d.type = v; } })),
      field('Movement pattern', h('select', { onchange: (e) => { d.pattern = e.target.value; } }, PATTERNS.map((p) => h('option', { value: p, selected: d.pattern === p }, p.replace('_', ' '))))),
      h('div.field', h('label', 'Equipment needed (all of)'), chips),
      h('div.field', h('label', 'Secondary muscles'), sec),
      h('div.row.end',
        existing ? h('button.btn.danger', { type: 'button', onclick: () => {
          ctx.commit((s) => { const x = s.customExercises.find((e) => e.id === existing.id); x.deleted = true; });
          close(); toast('Exercise removed (kept in history)');
        } }, 'Delete') : null,
        h('button.btn.primary', { type: 'button', onclick: () => {
          if (!d.name.trim()) { toast('Give it a name'); return; }
          d.equip = [[...tags].length ? [...tags] : ['bodyweight']];
          d.name = d.name.trim();
          ctx.commit((s) => {
            if (existing) Object.assign(s.customExercises.find((e) => e.id === existing.id), d);
            else s.customExercises.push({ ...d, id: uniqueId(d.name, new Set([...LIBRARY, ...s.customExercises].map((e) => e.id))) });
          });
          close(); toast('Saved');
        } }, 'Save')));
  });
}

function editCustomActivity(ctx, existing) {
  const d = existing ? JSON.parse(JSON.stringify(existing)) : { name: '', equip: [['bodyweight']], impact: 'low', intensities: ['steady'] };
  sheet(existing ? 'Edit activity' : 'Custom activity', (close) => {
    let tag = d.equip[0][0];
    return h('div.stack',
      field('Name', h('input', { type: 'text', value: d.name, oninput: (e) => { d.name = e.target.value; } })),
      field('Equipment', h('select', { onchange: (e) => { tag = e.target.value; } }, [...CARDIO_EQUIPMENT, ...STRENGTH_EQUIPMENT].map((t) => h('option', { value: t, selected: t === tag }, EQUIPMENT_LABEL[t])))),
      h('div.field', h('label', 'Impact'), segmented({ label: 'Impact', value: d.impact, options: [{ value: 'low', label: 'Low' }, { value: 'high', label: 'High' }], onChange: (v) => { d.impact = v; } })),
      h('div.field', h('label', 'Suits'), segmented({ label: 'Suits', value: d.intensities.join('+'),
        options: [{ value: 'steady', label: 'Steady' }, { value: 'intervals', label: 'Intervals' }, { value: 'steady+intervals', label: 'Both' }],
        onChange: (v) => { d.intensities = v.split('+'); } })),
      h('div.row.end',
        existing ? h('button.btn.danger', { type: 'button', onclick: () => { ctx.commit((s) => { s.customActivities.find((a) => a.id === existing.id).deleted = true; }); close(); } }, 'Delete') : null,
        h('button.btn.primary', { type: 'button', onclick: () => {
          if (!d.name.trim()) { toast('Give it a name'); return; }
          d.equip = [[tag]]; d.name = d.name.trim();
          ctx.commit((s) => {
            if (existing) Object.assign(s.customActivities.find((a) => a.id === existing.id), d);
            else s.customActivities.push({ ...d, id: uniqueId(d.name, new Set([...ACTIVITIES, ...s.customActivities].map((a) => a.id))) });
          });
          close(); toast('Saved');
        } }, 'Save')));
  });
}


// ---------- Workout history ----------

function renderWorkouts(root, ctx) {
  const st = ctx.state;
  const list = [...st.workouts].sort((a, b) => (a.date === b.date ? (b.endedAt || 0) - (a.endedAt || 0) : a.date < b.date ? 1 : -1));
  if (!list.length) {
    root.append(h('div.empty', h('h3', 'No workouts yet'), h('p.muted', 'Finished workouts appear here.')));
    return;
  }
  const u = st.settings.units;
  root.append(h('div.card', list.map((w) => {
    const { volume, sets } = workoutVolume(w);
    const mins = (w.cardio || []).reduce((a, c) => a + c.minutes, 0);
    return h('button.list-btn', { type: 'button', onclick: () => workoutSheet(ctx, w.id) },
      h('span', h('div.ex-name', w.name, bestPRsByLift(w.prs).length ? h('span.badge.good', { style: { marginLeft: '6px' } }, `${bestPRsByLift(w.prs).length} PR`) : null),
        h('div.small.muted', [fmtDate(w.date, { weekday: true, year: true }), w.durationSec ? fmtDuration(w.durationSec) : null,
          sets ? `${sets} sets · ${fmtWeight(volume, u)}` : null, mins ? `${mins} min cardio` : null].filter(Boolean).join(' · '))),
      h('span.muted', '›'));
  })));
}

function workoutSheet(ctx, id) {
  const st = store.get();
  const w = st.workouts.find((x) => x.id === id);
  const u = st.settings.units;
  sheet(w.name, (close) => h('div.stack',
    h('div.small.muted', `${fmtDate(w.date, { weekday: true, year: true })}${w.durationSec ? ' · ' + fmtDuration(w.durationSec) : ''}`),
    w.exercises.map((e) => h('div', h('div.ex-name', exName(st, e.exId)),
      h('div.small.muted', e.sets.map((s) => `${s.warmup ? 'W ' : ''}${displayWeight(s.kg, u)}×${s.reps}`).join(', ')),
      e.note ? h('div.small', e.note) : null)),
    (w.cardio || []).map((c) => h('div', h('div.ex-name', actName(st, c.activityId)),
      h('div.small.muted', [`${c.minutes} min`, c.distanceKm ? `${c.distanceKm} km` : null, c.avgHr ? `${c.avgHr} bpm` : null, c.intensity].filter(Boolean).join(' · ')))),
    w.note ? h('p.small', w.note) : null,
    h('div.row.end',
      h('button.btn.danger', { type: 'button', onclick: async () => {
        if (!(await confirmSheet('Delete workout?', 'This can\'t be undone.', { ok: 'Delete', danger: true }))) return;
        ctx.commit((s) => { s.workouts = recomputeAllPRs(s.workouts.filter((x) => x.id !== id)); });
        close(); toast('Workout deleted');
      } }, 'Delete'),
      h('button.btn.primary', { type: 'button', onclick: () => { close(); ctx.editWorkout(id); } }, 'Edit'))));
}
