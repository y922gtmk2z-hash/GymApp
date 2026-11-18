import { h, segmented, toast, confirmSheet, field, numInput } from '../ui.js';
import { makeBackup, parseBackup, summarize } from '../schema.js';
import { saveFile, pickFile } from '../share.js';
import * as store from '../store.js';
import { isPersisted, backend } from '../db.js';
import { daysBetween, today, isoDate, fmtDate, parseNum } from '../util.js';
import { allExercises, allActivities, MUSCLES, MUSCLE_LABEL, EQUIPMENT_LABEL, STRENGTH_EQUIPMENT, CARDIO_EQUIPMENT } from '../data.js';

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
      for (const e of items) list.append(h('div.exercise-item',
        h('div.grow', h('div.ex-name', e.name, e.id.startsWith('c_') ? h('span.badge.accent', { style: { marginLeft: '6px' } }, 'Custom') : null),
          h('div.small.muted', `${MUSCLE_LABEL[e.primary]}${e.secondary.length ? ' (+ ' + e.secondary.map((m) => MUSCLE_LABEL[m]).join(', ') + ')' : ''} · ${e.type === 'compound' ? 'Compound' : 'Isolation'}`),
          h('div.tiny.muted', equipText(e.equip)))));
    } else {
      const items = allActivities(ctx.state.customActivities).filter((a) => (!q || a.name.toLowerCase().includes(q)) && (!lib.equip || a.equip.some((alt) => alt.includes(lib.equip))));
      if (!items.length) list.append(h('p.muted', 'No activities match.'));
      for (const a of items) list.append(h('div.exercise-item',
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
    list));
  muscleSel.hidden = lib.tab !== 'exercises';
  draw();
}

const SECTIONS = [
  { id: 'library', label: 'Exercise library', hint: 'Browse exercises and cardio activities' },
  { id: 'settings', label: 'Settings', hint: 'Units, theme, rest times' },
  { id: 'backup', label: 'Backup', hint: 'Export and import your data' },
];

export function render(root, ctx) {
  const sub = ctx.params[0];
  const section = SECTIONS.find((s) => s.id === sub);
  if (!section) return renderMenu(root, ctx);
  ctx.setTitle(section.label);
  ctx.setActions(h('a.btn.small', { href: '#/more' }, 'Done'));
  ({ library: renderLibrary, settings: renderSettings, backup: renderBackup })[section.id](root, ctx);
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
      field('Calendar alert (minutes before)', numInput({ value: s.alarmMinutes, decimal: false,
        onInput: (v) => { const n = parseNum(v); if (n !== null && n >= 0) ctx.commit((st) => { st.settings.alarmMinutes = Math.round(n); }, { silent: true }); } })),
    ),
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
