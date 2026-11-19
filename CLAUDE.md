# CLAUDE.md

Offline-first gym PWA for iPhone. Read `BRIEF.md` (what) and `PLAN.md` (how) before changing behaviour.

## Hard constraints (never break)
- **No build step, no dependencies.** Plain HTML, CSS, ES modules. `package.json` exists only to name scripts; never add `dependencies`.
- **Static hosting on GitHub Pages under a sub-path.** All URLs relative (`./`, `js/...`). Hash routing only.
- **No backend, accounts, API keys, analytics or AI/LLM calls.** All logic is deterministic rules.
- **Offline-first.** Every shell file is precached by `sw.js`.
- **Data stays on device** (IndexedDB, localStorage fallback). Storage is kg; lb is display only.
- **No calorie counting.** No kcal fields, estimates or wording anywhere (a test enforces this).
- **No Apple Health integration.** Field names and units mirror Health for manual copying.

## Module rules
- `js/engine.js`, `js/weight.js`, `js/stats.js`, `js/schema.js`, `js/ics.js`, `js/charts.js`, `js/units.js`, `js/data.js`, `js/util.js` are **pure and DOM-free**. They take `today`/`now` as arguments, never read the clock or the store. Tested in Node.
- Views (`js/views/*`) render with `h()` from `js/ui.js`, read `ctx.state`, and change state only via `ctx.commit(fn)`. Use `{ silent: true }` for keystroke-level edits so the view does not re-render under the cursor.
- Dates are local `YYYY-MM-DD` strings. Never `new Date('YYYY-MM-DD')`; use `util.parseDate`.

## Layout
- `js/app.js` boots the store, router and service worker. Views live in `js/views/` (`today`, `plan`, `progress`, `more`, `workout` overlay, `banners` for Today suggestions, `common` helpers).
- Suggestions (deload, weekly review, backup reminder) are always dismissible, never forced.
- In-progress workouts commit with `{ flush: true }` so nothing is lost if iOS kills the app.
- `js/sample.js` builds deterministic demo data (More > Settings > Load sample data); keep it valid (`tests/schema.test.js`).

## Service worker
- When you add, remove or change any shell file, **bump `VERSION` in `sw.js`** and keep the `SHELL` list in sync. `tests/sw.test.js` fails if the list and disk differ.

## Schema
- Changing the state shape: bump `VERSION` in `js/schema.js`, add a `MIGRATIONS[n]` step, extend `validate()` and add a test in `tests/schema.test.js`.

## Commands
- Tests: `node --test` (Node 18+, no installs).
- Serve: `python3 -m http.server 8080` then open http://localhost:8080/.
- Icons: `node tools/make-icons.mjs` (only when the artwork changes).

## Workflow
- Keep the app runnable after every commit. Run the tests before committing.
