import { h, segmented, toast, confirmSheet, field, numInput } from '../ui.js';
import { makeBackup, parseBackup, summarize } from '../schema.js';
import { saveFile, pickFile } from '../share.js';
import * as store from '../store.js';
import { isPersisted, backend } from '../db.js';
import { daysBetween, today, isoDate, fmtDate, parseNum } from '../util.js';

const SECTIONS = [
  { id: 'settings', label: 'Settings', hint: 'Units, theme, rest times' },
  { id: 'backup', label: 'Backup', hint: 'Export and import your data' },
];

export function render(root, ctx) {
  const sub = ctx.params[0];
  const section = SECTIONS.find((s) => s.id === sub);
  if (!section) return renderMenu(root, ctx);
  ctx.setTitle(section.label);
  ctx.setActions(h('a.btn.small', { href: '#/more' }, 'Done'));
  ({ settings: renderSettings, backup: renderBackup })[section.id](root, ctx);
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
