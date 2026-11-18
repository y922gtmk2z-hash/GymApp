# Gym PWA: Implementation Plan

Companion to the project brief. It turns the brief into a file layout, module contracts, exact rules for the parts the brief leaves open, and a task list per phase. Each phase ends with a commit and leaves the app runnable.

---

## 0. Decisions that fill gaps in the brief

These are the defaults I will build unless you say otherwise. Each one is a single constant or function, so it is cheap to change later.

| Topic | Decision |
|---|---|
| Week start | Monday. Weeks are keyed by the ISO date of their Monday (`2026-11-16`). |
| Dates | Stored as local calendar strings `YYYY-MM-DD`, never parsed with `new Date('YYYY-MM-DD')` (which parses as UTC and shifts the day). Times are `HH:MM`. Timestamps (workout start/end, timer end) are epoch ms. |
| "Priority 12-14" | Targets are stored as `{min, max}`. The allocator aims for `max`. The time-budget trimmer may cut a Priority muscle down to `min` before it touches anything at Priority again (see 3.6). The other cells are `{min: n, max: n}`. |
| Which muscles go on which day | Full: all 10. Upper: chest, back, shoulders, biceps, triceps. Lower: quads, hamstrings, glutes, calves, core. Push: chest, shoulders, triceps. Pull: back, biceps, core. Legs: quads, hamstrings, glutes, calves, core. |
| Equipment requirement | Each exercise has `equip`: a list of alternatives, each an all-of set. `[["barbell","rack"]]` needs both. `[["dumbbell"],["kettlebell"]]` needs either. Empty list or `[["bodyweight"]]` means no kit. |
| Sets per muscle per session | Capped at 12 (3 exercises x 4 sets) by rule 4 of the brief. Anything above the cap moves to the muscle's other appearances, otherwise it is dropped and shown as a deficit. |
| Time estimate | `300 + sum over sets of (40 + restSec)` seconds, per the brief. No per-exercise changeover time (add one constant if real sessions run long). |
| Weight increments | Barbell, machine, cable: +2.5 kg. Dumbbell: +2 kg. Kettlebell: +4 kg. Bodyweight and bands: reps only (the weight field means added load, normally 0). In lb mode: +5 lb for every loaded type. The increment is picked from the exercise's first equipment alternative. |
| +1 rep rule | If every working set reached `repMin` but not all reached `repMax`, keep the weight and target `min(repMax, lastReps + 1)` per set. |
| Below range | If any set missed `repMin`, repeat the same weight and reps. The stall rule decides when to drop. |
| "Repeated stalls across lifts" | 3 or more different exercises in stall state within the last 14 days. |
| "6 consecutive training weeks" | 6 consecutive calendar weeks, each with at least one finished workout, since the last deload (or since the first workout). |
| Deload week | Sets per exercise `max(1, round(sets x 0.6))`. Suggested weights x 0.9, rounded down to the increment. |
| e1RM | Epley `w x (1 + r/30)`, with `r = 1` giving `w`. Sets above 12 reps are excluded from e1RM (Epley gets unreliable) but still count for rep PRs and volume. |
| Volume | Sum of `kg x reps` over done, non-warm-up sets. Sets per muscle count primary muscle only (direct sets), as the brief says. |
| Routing | Hash routes (`#/today`, `#/plan`, `#/progress`, `#/more`, `#/workout`) so it works under any GitHub Pages sub-path with no server config. |
| IDs | `crypto.randomUUID()` with a small fallback. Plan session IDs are deterministic (see 3.9) so calendar UIDs are stable. |
| Tests | Node's built-in `node:test` and `node:assert`. Run with `node --test tests/`. No `package.json` needed (one may exist only to name the test script, with zero dependencies). |
| Rendering | Plain DOM. A tiny `h(tag, attrs, ...children)` helper and one `render()` per view, re-run on state change. No virtual DOM, no framework. |

---

## 1. File layout

```
index.html               app shell, meta tags, tab bar, overlay root
styles.css               design tokens, dark/light/auto, layout, components
manifest.webmanifest     name, icons, display: standalone, start_url "./", scope "./"
sw.js                    classic service worker, versioned precache
icons/
  icon.svg               source artwork
  apple-touch-icon.png   180x180
  icon-192.png
  icon-512.png
  icon-maskable-512.png
js/
  app.js                 boot, router, tab bar, store wiring, SW registration, update toast
  store.js               in-memory state, subscribe(), commit(mutator), debounced persist
  db.js                  IndexedDB adapter + localStorage fallback, persist() request
  schema.js              defaults, version, migrations[], validate()  (pure, Node-tested)
  data.js                exercise library, muscles, equipment tags, default profiles (pure)
  engine.js              plan + progression + deload rules (pure, DOM-free, Node-tested)
  stats.js               e1RM series, PRs, weekly volume, summaries, rolling avg (pure, Node-tested)
  ics.js                 .ics generation (pure, Node-tested)
  charts.js              SVG line chart -> string (pure geometry, Node-tested)
  units.js               kg/lb conversion, rounding, formatting (pure)
  util.js                dates (local ISO, week math), ids, debounce, clamp
  ui.js                  h(), sheet/modal, toast, stepper, segmented control, confirm
  share.js               save/share files (Web Share with files, Blob download fallback), file picker
  timer.js               rest timer (timestamp-based), WebAudio beep, flash, vibrate
  wakelock.js            Screen Wake Lock with re-acquire on visibilitychange
  views/
    today.js
    plan.js              builder form, week calendar, session editor, target bars, export
    workout.js           full-screen logger overlay
    progress.js          check-in, metric charts, lift charts, volume, targets
    more.js              library, profiles, settings, backup
tests/
  engine.test.js
  stats.test.js
  ics.test.js
  schema.test.js
  charts.test.js
  data.test.js           library integrity
  sw.test.js             precache list matches files on disk
tools/
  make-icons.mjs         writes the PNG icons with node:zlib (no deps), run once by hand
README.md
CLAUDE.md
PLAN.md
.nojekyll                stops GitHub Pages ignoring files
```

The brief lists the modules at the root. I've put them under `js/` to keep the root tidy. Paths stay relative either way. I also added `store.js`, `schema.js`, `stats.js`, `units.js`, `share.js`, `timer.js` and `wakelock.js` so that every piece of logic that can be pure is pure and tested, and `engine.js` stays focused on rules.

---

## 2. Data model (refined from the brief)

```js
state = {
  version: 1,
  user: { id, name: "" },
  settings: {
    units: "kg",                 // "kg" | "lb" (display only; storage is kg)
    theme: "dark",               // "dark" | "light" | "auto"
    restDefaults: { compound: null, isolation: null }, // null = use goal table
    restOverrides: { [exId]: sec },                    // remembered per exercise
    alarmMinutes: 30,
    weekStartsOn: 1,
  },
  profiles: [ { id: "gym", name: "Gym", equipment: [...all] },
              { id: "home", name: "Home", equipment: ["dumbbell","bench","bodyweight","pullup_bar"] } ],
  customExercises: [ /* same shape as library entries, id prefixed "c_" */ ],
  builder: {                     // last builder inputs, pre-filled next week
    goal: "muscle",              // "muscle" | "strength" | "general"
    focus: { chest: "maintain", ... },   // all 10 muscles
    days: [ { weekday: 1, profileId: "gym", minutes: 60, startTime: "18:00" } ],
  },
  plans: {                       // history, keyed by weekStart
    "2026-11-16": {
      weekStart, goal, focus, deload: false,
      days: [ { date, profileId, minutes, startTime } ],
      sessions: [ { id, date, name, splitKey, profileId, minutes, startTime,
                    skipped: false,
                    exercises: [ { exId, sets, repMin, repMax, restSec } ] } ],
      warnings: [ "No hamstring exercise available in Home" ],
      icsSequence: 0,
    }
  },
  workouts: [ { id, date, startedAt, endedAt, durationSec, sessionId?, name, note,
                exercises: [ { exId, note, restSec,
                               sets: [ { kg, reps, done, warmup } ] } ],
                prs: [ { exId, type: "e1rm"|"weight"|"reps", value, kg?, reps? } ] } ],
  activeWorkout: null,           // the in-progress workout, persisted on every change
  timer: null,                   // { endAt, durationSec, exId } while resting
  metrics: [ { id, date, weightKg, restingHr, waistCm, hrvMs, vo2max, sleepHrs,
               bodyFatPct, chestCm, armCm, thighCm, hipCm } ],
  targets: { "metric:weightKg": 80, "lift:bench_bb:e1rm": 100 },
  dismissed: { deloadSuggestion: "2026-11-16", backupReminder: "2026-11-01" },
  lastExportAt: null,
  lastDeloadWeek: null,
}
```

Changes from the sketch, and why:
- `plan` becomes `plans{}` keyed by week. The weekly re-plan, "planned vs done" summaries and past volume-vs-target bars all need earlier weeks.
- `builder` holds the last inputs, so next week is pre-filled.
- `activeWorkout` and `timer` are persisted. iOS can kill a backgrounded PWA at any time, so a workout in progress must survive a reload.
- `restOverrides` covers the "overridable and remembered" rest time.
- `prs` are stored on the workout when it is saved. They are recomputed when a workout is edited or deleted.

**Apple Health alignment** (field, unit, Health name):

| Field | Unit | Apple Health |
|---|---|---|
| weightKg | kg | Weight (Body Mass) |
| restingHr | bpm (count/min) | Resting Heart Rate |
| hrvMs | ms | Heart Rate Variability (SDNN) |
| vo2max | mL/kg·min | Cardio Fitness (VO2 max) |
| sleepHrs | hours, 1 dp | Sleep (time asleep, nightly average) |
| bodyFatPct | % | Body Fat Percentage |
| waistCm | cm | Waist Circumference |
| chestCm, armCm, thighCm, hipCm | cm | Not in Health. App only, labelled as such. |

The UI uses the Health names as labels, so copying a number across by hand is obvious.

---

## 3. Engine specification (`engine.js`)

All functions are pure: input in, new object out, no `Date.now()` inside (the caller passes `today`), no DOM. Every rule below gets tests.

### 3.1 Tables
```js
SET_TARGETS[goal][focus] -> {min, max}
REP_REST[goal][compound|isolation] -> {repMin, repMax, restSec}
SPLITS[n] -> ["full_a","full_b"] ... ; SPLIT_MUSCLES[splitKey] -> muscles[]
```

### 3.2 `selectSplit(nDays)`
Returns the split keys for 2-6 days. Throws on anything else.

### 3.3 `availableExercises(library, profile)`
Keeps an exercise if any of its `equip` alternatives is a subset of `profile.equipment` (`bodyweight` is always available). Library order is kept, so it is the preference order.

### 3.4 `allocateVolume(targets, sessions)`
For each muscle:
1. `appearances` = sessions whose split includes the muscle.
2. `per = target.max / appearances.length`. While `per < 2` and there is more than one appearance, drop the last appearance and recompute. One appearance with fewer than 2 sets is still kept, as the target itself is that small.
3. Split as integers: `floor(per)` each, with the remainder going to the earliest appearances.
4. Cap each appearance at 12. Overflow goes to other appearances under the cap, and anything left is recorded as a deficit.

Output: `{ [sessionIndex]: { [muscle]: sets } }` plus `deficits`.

### 3.5 `pickExercises(muscle, sets, candidates, appearanceIndex, goal)`
- Number of exercises: 1-4 sets gives 1, 5-8 gives 2, 9 or more gives 3. Sets are spread evenly, max 4 each, with the larger shares going to the compounds.
- Candidates are filtered by primary muscle, compounds first, in library order.
- Rotation: the first exercise is taken from the compound list at offset `appearanceIndex mod compounds.length`. In Strength mode it is always offset 0, so the main lift stays constant. The rest are taken in order, skipping ones already used in that session. Isolations fill in if there aren't enough compounds.
- No candidates: return none and add a warning (`"No calves exercise available in Home"`).
- Each item gets `repMin/repMax/restSec` from `REP_REST`, with `restOverrides` taking priority.

### 3.6 `estimateSessionSec(session)` and `fitTimeBudget(session, focus, targets)`
`estimate = 300 + Σ sets x (40 + restSec)`. While `estimate > minutes x 60`, remove one set:
1. Choose the lowest tier that still has sets: Minimal, then Maintain, then Priority sets above `min`, then Priority.
2. Within that tier, take the muscle with the most sets in the session (ties go to the later muscle in `MUSCLES` order).
3. Within that muscle, take it from the last isolation exercise first, then from compounds. An exercise that reaches 0 sets is removed.

This is deterministic and spreads the cuts across a tier instead of wiping out one muscle.

Sanity check for acceptance test 2: 45 min in Muscle mode allows about 2,400 s of work, which is about 15-20 sets. With chest Priority and everything else Maintain, the weekly target is around 86 sets, about 29 per session over 3 days. Heavy trimming of the Maintain muscles is therefore expected and correct. The target bars will show the shortfall plainly, and the UI will add a hint: "45 min x 3 can't fit your targets. Add a day, lengthen sessions or set some muscles to Minimal."

### 3.7 `orderSession(exercises)`
Sort order: compounds, then isolations, then core, then calves. The sort is stable, so allocation order holds within each group.

### 3.8 `buildWeek({ weekStart, goal, focus, days, profiles, library, restOverrides, previousPlan?, deload? })`
1. Sort the days, pick the split, then make one session per day: `name` ("Upper A"), `splitKey`, profile, minutes, start time.
2. Allocate volume, pick exercises per muscle per session, fit the time budget, order the session.
3. If `previousPlan` exists, for each session with the same `splitKey` and an exercise for the same muscle that is still available in the profile, keep last week's choice. This preserves swaps the user made.
4. If `deload` is set, apply `applyDeload(plan)`.
5. Return `{ ...plan, warnings, deficits }`.

### 3.9 Stable session IDs
`id = "s-" + weekStart + "-" + splitKey`. Moving a session to another day keeps its ID. The ICS UID is derived from the ID, so re-exporting updates the event instead of duplicating it.

### 3.10 Re-balance
- `swapExercise(plan, sessionId, idx, newExId)`: same muscle, so the totals don't change. It recomputes rep and rest values for the new exercise's compound/isolation type and re-fits the time budget.
- `moveSession(plan, sessionId, newDate)`: blocks a move onto a date that already has a session (the UI offers to swap the two). Updates the date and leaves volume alone.
- `skipSession(plan, sessionId, today)`: marks it skipped. Each muscle's sets go to the remaining future sessions in the week that train that muscle, up to each session's time budget and the 12-set cap. What doesn't fit becomes a deficit.
- `plannedSetsByMuscle(plan)` vs `weeklyTargets(goal, focus)` gives the bar data.
- `suggestAlternatives(exId, profile, library)`: same primary muscle, available in the profile, same movement pattern first, then the exercise's listed `alternatives`, then the remaining same-muscle exercises.

### 3.11 Weekly re-plan: `proposeNextWeek(state, nextWeekStart)`
Uses `builder` inputs and `plans[lastWeek]` as `previousPlan`. Sets `deload: true` when `deloadSuggestion` fires and the user accepts. Volume from missed sessions does not carry over, which avoids stacking. Weights and reps aren't stored in the plan. They come from `suggestNext` at log time, which is how progression applies.

### 3.12 Progression: `suggestNext(exId, history, planned, units)`
- `history` = finished workouts that contain `exId`, newest first. Only done, non-warm-up sets count.
- No history: return `null` and the UI leaves the fields blank.
- Take the last session's working sets and the planned `repMin/repMax`:
  - All sets ≥ `repMax`: weight + increment (3.0 table, unit-aware), reps = `repMin`.
  - All sets ≥ `repMin`: same weight, reps = `min(repMax, reps + 1)` per set.
  - Otherwise: same weight and reps.
- Apply stall: if `isStalled`, weight x 0.9, rounded down to the increment, with `reason: "stall"`.
- Return `{ kg, reps[], reason: "increase"|"reps"|"repeat"|"stall" }`. The reason is shown as a small label ("+2.5 kg: you hit 10/10/10").

`isStalled(exId, history, repMin)`: the last 2 sessions of that exercise each had at least half of their working sets below `repMin`.

### 3.13 Deload
- `deloadSuggestion(workouts, plans, lastDeloadWeek, today)` returns `{ reason: "weeks"|"stalls", detail }` or `null`.
- `applyDeload(plan)` returns a copy with 60% of sets and a `deload` flag, which `suggestNext` uses to apply 0.9 x weight.
- Only ever a suggestion. Accepting it sets `lastDeloadWeek`. Dismissing it stores the week in `dismissed`, so it isn't shown again that week.

### 3.14 Units (`units.js`)
Storage is always kg. Values entered in lb are converted with `lb x 0.45359237` and stored to 3 dp. Display rounds to 0.5 kg or 1 lb. Increments are applied in the display unit and then converted back, so lb users see +5 lb exactly.

---

## 4. Exercise library (`data.js`)

Shape: `{ id, name, primary, secondary[], equip[[...]], type: "compound"|"isolation", pattern, alternatives[] }`.

Patterns: `h_push, v_push, h_pull, v_pull, squat, hinge, lunge, hip_ext, knee_flex, knee_ext, elbow_flex, elbow_ext, lateral, rear_delt, fly, calf, core_flex, core_anti`.

Draft list (88), in preference order within each muscle:

- **Chest (10):** barbell bench press, incline barbell bench, dumbbell bench press, incline dumbbell press, machine chest press, push-up, decline/deficit push-up, cable fly, dumbbell fly, pec deck
- **Back (11):** pull-up, barbell row, chin-up, lat pulldown, chest-supported dumbbell row, one-arm dumbbell row, seated cable row, machine row, inverted row (rack), straight-arm pulldown, band row
- **Shoulders (10):** overhead barbell press, seated dumbbell press, machine shoulder press, Arnold press, pike push-up, dumbbell lateral raise, cable lateral raise, face pull, rear-delt dumbbell fly, band pull-apart
- **Biceps (7):** barbell curl, dumbbell curl, incline dumbbell curl, hammer curl, cable curl, machine preacher curl, band curl
- **Triceps (8):** close-grip bench press, dip (bench), barbell skull crusher, overhead dumbbell extension, cable pushdown, overhead cable extension, diamond push-up, band pushdown
- **Quads (10):** back squat, front squat, hack squat, leg press, goblet squat (DB or KB), Bulgarian split squat, dumbbell walking lunge, step-up, leg extension, bodyweight split squat
- **Hamstrings (9):** conventional deadlift, Romanian deadlift, dumbbell RDL, single-leg dumbbell RDL, good morning, lying leg curl, seated leg curl, Nordic curl, band leg curl
- **Glutes (9):** barbell hip thrust, dumbbell hip thrust, kettlebell swing, sumo deadlift, glute bridge, single-leg glute bridge, cable kickback, hip abduction machine, band lateral walk
- **Calves (5):** standing calf raise (machine), seated calf raise, leg press calf raise, single-leg dumbbell calf raise, bodyweight calf raise
- **Core (9):** hanging leg raise, cable crunch, Pallof press (cable or band), plank, side plank, dead bug, reverse crunch, crunch, dumbbell side bend

Integrity tests (`data.test.js`): unique IDs, valid muscles, tags and patterns, alternatives resolve to real IDs with the same primary, at least one compound per muscle in the Gym profile, and **at least 2 options per muscle in the default Home profile** (so acceptance test 2 never hits an empty muscle).

Custom exercises use the same shape, with `id = "c_" + slug`. They are merged after the built-ins, so they sit last in preference unless the user picks them.

---

## 5. Platform notes and risks (iOS Safari standalone)

| Area | Plan | Risk / mitigation |
|---|---|---|
| Install | Manifest with `display: standalone`, `start_url: "./"`, `scope: "./"`. Apple meta tags, a 180 px touch icon, `viewport-fit=cover`. | iOS ignores manifest icons for the home screen and uses `apple-touch-icon`, so both are needed. |
| Offline | SW precaches every shell file. Cache name `gym-v{N}`. Cache-first. A new SW installs in the background, and the app shows "Update ready, reload". `activate` deletes old caches. | Forgetting to bump `N` or list a new file. `sw.test.js` checks that the precache list matches the files in `js/`, `icons/` and the root, and CLAUDE.md says to bump `N` on every shell change. |
| Storage | IndexedDB, one store, key `"state"`, whole-document writes debounced to 300 ms, plus an immediate flush on `visibilitychange` going hidden. Falls back to localStorage if IDB fails to open. Calls `navigator.storage.persist()` on first launch. | iOS may still evict data. The backup reminder (30 days) and one-tap export cover this. |
| File export | `share.js`: if `navigator.canShare({files})`, use the share sheet ("Save to Files", Calendar). Otherwise an `<a download>` Blob link. | Blob downloads are unreliable in iOS standalone mode, so Web Share with files is the primary path. |
| `.ics` re-import | Stable `UID`, `SEQUENCE` bumped on each export, `METHOD:PUBLISH`. | Apple Calendar's handling of re-importing a file with the same UID isn't documented. It must be tested on a device in Phase 3. If it duplicates, the fallback is to export only sessions changed since the last export and document "delete the old block first". |
| Timer | Stores `endAt`. The UI ticks with `requestAnimationFrame`/`setInterval` only to repaint, computing `endAt - Date.now()`. On `visibilitychange` going visible: if elapsed, show "Rest over". | JS doesn't run while the phone is locked, so no beep can play then. That is an iOS limitation; the brief's "Rest over" on return is the answer. WebAudio is also muted by the silent switch, so the visual flash is the reliable signal. |
| Audio unlock | Create and resume an `AudioContext` on the first tap in the workout overlay. Play a 1-sample silent buffer. | — |
| Vibrate | Feature-detect and call where available. | Not available on iOS, as the brief notes. |
| Wake lock | Request it when a workout starts, re-request on `visibilitychange`, release on finish. | Wake Lock in installed iOS web apps only works reliably from iOS 18.4. Feature-detect and fail silently. |
| Zoom | `touch-action: manipulation` on controls, 16 px minimum input font (stops focus zoom). | — |
| Inputs | Weight `inputmode="decimal"`, reps `inputmode="numeric"`, `pattern="[0-9]*"`. | iOS decimal keypad uses a comma in some locales, so the parser accepts both `,` and `.`. |

Local testing: `python3 -m http.server` from the repo root, then open `/` and also a sub-path copy (`/GymApp/`) to prove relative paths work. I'll run automated smoke checks with the Chromium/Playwright already in the dev container. That is tooling outside the repo, not a project dependency. Real-device checks (install, lock-screen timer, Calendar import) are yours, as listed per phase.

---

## 6. UI plan

**Tokens:** dark-first palette as CSS custom properties on `:root`, light overrides under `[data-theme=light]` and under `@media (prefers-color-scheme: light)` for `auto`. Minimum 4.5:1 text contrast. Tap targets 48 px minimum. Body text 17 px. `env(safe-area-inset-*)` padding on the top bar, the tab bar and the workout overlay.

**Tab bar (fixed bottom):** Today · Plan · Progress · More. Each is a hash route and the active one is marked with `aria-current`.

**Today:** today's session card with a "Start workout" button (or "Rest day" plus "Start ad-hoc"), a 7-day week strip (planned, done, skipped, deload badge), the weekly summary (sessions done/planned, PRs, weight and RHR change vs last week), and banners for the deload suggestion, the backup reminder and "Plan next week" from Friday onward.

**Plan:**
- Builder sheet: goal (segmented control), focus per muscle (a 3-way segmented control per row), then one card per training day with weekday chips, a length stepper (30/45/60/90), profile and start time. "Generate week".
- Week view: one card per day with the session name, profile badge, estimated minutes vs budget, and an exercise list (sets x reps).
- Session editor: swap (an alternatives sheet), up/down reorder buttons (no drag needed for one-handed use), sets −/+, remove, add exercise, move to day, skip.
- Volume bars: planned sets per muscle vs the target range, coloured under/in/over.
- Warnings and deficits shown inline.
- "Export to Calendar" button and an alarm lead-time picker.

**Workout overlay (full screen):** a header with the elapsed time and Finish. One card per exercise with the target ("3 x 6-10 @ 60 kg, +2.5 kg"), last time ("57.5 x 10, 10, 9"), and set rows `[W] [kg] [reps] [✓]`, where `W` toggles warm-up. Card actions: add/remove set, swap, note, move up/down. "Add exercise" at the bottom. A sticky rest bar pinned above the safe area with the countdown, −15/+15, skip and quick chips. Finish shows a summary sheet with the duration, volume and PRs found.

**Progress:** segments Body · Lifts · Volume.
- Body: "Weekly check-in" (3 fields, under 30 s), an "More fields" expander, an entry list with edit/delete, and charts for any metric.
- Lifts: pick an exercise to see its e1RM chart and PR list.
- Volume: weekly sets per muscle vs target over time, sessions per week, total volume per week.
- Range selector: 4w / 3m / 6m / 1y / all. Set a target from any chart (it draws as a dashed line, with a progress bar).

**More:** exercise library (search, muscle and equipment filters, add/edit custom), equipment profiles (toggle tags, add/rename/delete, with Gym and Home not deletable), settings (units, theme, rest defaults, alarm minutes, name), and backup (export JSON, import JSON with a validation report and confirm, last export date, storage persisted status).

**Charts (`charts.js`):** `lineChart({ series:[{points:[{x,y}], style}], target?, width, height, range })` returns an SVG string with viewBox scaling, nice axis ticks, raw points as dots, and the 7-day rolling average as a line. Geometry (scales, ticks, path `d`) is pure and tested. Tap a point to show its value in a caption, with no hover needed.

---

## 7. Phases

Each phase lists tasks, the commit, and its done-when checks. Every phase keeps the app loading and usable offline.

### Phase 1: Scaffold
1. `index.html` with all the iOS meta tags, the tab bar, `<main id="view">`, `<div id="overlay">`, and a module script for `js/app.js`.
2. `styles.css`: tokens, themes, safe areas, base components (card, button, segmented control, stepper, sheet, toast, banner).
3. `manifest.webmanifest`, `tools/make-icons.mjs` (draws a simple dumbbell glyph into PNGs with `node:zlib`), the generated icons, and `.nojekyll`.
4. `sw.js`: precache list, versioned cache, cache-first, update toast via `postMessage`.
5. `util.js` (local dates, week math, ids), `schema.js` (defaults, `version: 1`, `migrations`, `validate`), `db.js`, `store.js`.
6. `app.js`: boot (load, migrate, render), hash router, placeholder views for all 4 tabs, theme application, `storage.persist()`.
7. More > Backup: JSON export through `share.js`, and import with validation, a preview ("12 workouts, 30 metrics… replace current data?") and confirm.
8. `tests/schema.test.js`: defaults validate, a round trip gives deep equality, a bad file is rejected with readable errors, migration from a fake v0 works. Plus `tests/sw.test.js`.
9. `README.md` (run locally, enable Pages: Settings > Pages > deploy from branch, install on iPhone) and `CLAUDE.md` (the brief's constraints, the cache-bump rule, the test command, the module purity rules).

**Done when:** it loads under `/` and `/GymApp/` locally, reloads offline (DevTools offline mode), tests pass, export then import is deep-equal. **You check:** enable Pages, open it in Safari, Add to Home Screen, then airplane mode and launch.

### Phase 2: Library and engine
1. `data.js`: muscles, tags, patterns, 88 exercises, default profiles.
2. `engine.js`: everything in section 3. `units.js`.
3. `tests/data.test.js` and `tests/engine.test.js`, covering:
   - split selection for 2-6 days, and throwing on 1 and 7
   - targets table, every goal x focus combination
   - allocation: even spread, remainder placement, dropping appearances under 2, the 12 cap with overflow
   - equipment filtering: all-of and any-of alternatives, bodyweight always available, Home excludes barbell, cable and machine
   - exercise count by sets (4 → 1, 5 → 2, 8 → 2, 9 → 3, 12 → 3 x 4), compounds first, rotation across appearances, Strength keeps the main lift
   - rep and rest values per goal and type, rest overrides
   - time budget: the estimate formula, trimming order by tier, never exceeding the budget, determinism
   - session ordering (core and calves last)
   - **acceptance scenario**: 3 days, 45 min, chest Priority, Home gives 3 sessions, only Home equipment, each estimate ≤ 2,700 s, chest planned sets ≥ the planned sets of every other muscle
   - re-balance: swap keeps totals, move keeps IDs, skip redistributes within the budget
   - progression: increase, +1 rep, repeat, increments per equipment and unit, no history gives null, warm-ups ignored
   - stall: 2 bad sessions trigger it, 1 doesn't, a good session in between resets it
   - deload: the 6-week trigger, the stall trigger, 60% sets and 0.9 weights, suggestion after a dismissal
4. More > Library view (read-only browse, search and filters) so the phase has something visible.

**Done when:** `node --test tests/` is green and the library is browsable.

### Phase 3: Plan builder UI and calendar export
1. Plan view: builder sheet pre-filled from `builder`, generate, store in `plans[weekStart]`.
2. Week calendar, session cards, editor (swap, reorder, sets ±, add, remove, move, skip), all calling engine functions and recomputing bars and warnings.
3. Volume-vs-target bars.
4. Profiles editor in More (needed so Home can be edited). Custom exercise form.
5. `ics.js`: `VCALENDAR` with `VERSION:2.0`, `PRODID`, `CALSCALE:GREGORIAN`, `METHOD:PUBLISH`. One `VEVENT` per non-skipped session with `UID:<sessionId>@gym-pwa`, `DTSTAMP` (UTC), floating `DTSTART`/`DTEND` (no `Z`, no `TZID`), `SUMMARY`, `DESCRIPTION` (exercise list with `\n`), `SEQUENCE`, and a `VALARM` (`ACTION:DISPLAY`, `TRIGGER:-PT30M`). CRLF line endings, text escaping (`\\ ; , \n`), line folding at 75 octets (UTF-8 safe).
6. `tests/ics.test.js`: structure, escaping, folding (including multibyte characters), stable UIDs across exports, alarm minutes, floating times.
7. Today view shows today's planned session.

**Done when:** acceptance scenario 2 works in the UI. **You check:** export on iPhone, open in Calendar, alerts appear, export again and confirm no duplicates (results decide the fallback in section 5).

### Phase 4: Logger and rest timer
1. Workout overlay. Start from a planned session (pre-filled from `suggestNext`) or ad hoc. `activeWorkout` is persisted on every edit and resumed after a reload.
2. Set rows, warm-up toggle, add/remove sets, swap, add exercise, reorder, notes, previous performance and target labels.
3. `timer.js`: auto-start on tick using the exercise's rest (override > settings > plan), chips, ±15 s, skip, a remembered per-exercise override (when the user adjusts it, ask "Remember 150 s for this exercise?" as a one-tap option), beep, flash, vibrate, and "Rest over" on return.
4. `wakelock.js`, connected to the workout lifecycle.
5. `stats.js`: `epley`, `detectPRs(workout, priorWorkouts)` (e1RM, heaviest weight, most reps at a weight ≥ the previous best at that weight), done on finish.
6. Finish: duration, save, PR summary. History list in Progress > Lifts, or a "Workouts" list in More, with edit (reopens the logger on a saved workout) and delete (recomputes PRs).
7. Tests for `stats.js` (Epley, PR detection, warm-up exclusion, recomputation after a delete) and for the timer's pure maths (`remaining(endAt, now)`, adjust and clamp).

**Done when:** a scripted run (Chromium) can log a session, tick a set to start the timer, fake the clock forward to see "Rest over", finish, and see the suggestion increase next time after top-of-range reps (acceptance 4). **You check:** lock the phone for 60 s mid-rest, unlock, and confirm the countdown is correct or "Rest over" shows (acceptance 3).

### Phase 5: Progress
1. Check-in form (weight, RHR, waist) plus the optional Health-aligned fields, back-dating, and an entry list with edit and delete.
2. `charts.js` with the range selector, the 7-day rolling average for weight, and target lines.
3. Lift view: e1RM over time per exercise, PR history.
4. Volume view: weekly sets per muscle vs target, sessions per week, total volume.
5. Targets: set or clear per metric or lift, with a progress bar (from the first value in range to the target).
6. Today weekly summary: done vs planned, PRs this week, change vs last week (weight uses 7-day averages).
7. Tests: rolling average, range filtering, weekly aggregation (Monday weeks across a year boundary), chart tick and path geometry.

**Done when:** seeded demo data (a dev-only "Load sample data" button in Settings, behind a confirm) renders every chart correctly at phone width.

### Phase 6: Polish
1. Deload banner (accept, which turns next week's plan into a deload, or dismiss). Weekly re-plan prompt using `proposeNextWeek`.
2. Backup reminder after 30 days without an export (dismissible for 7 days). Show the persisted-storage status.
3. Empty states for every view (no plan, no workouts, no metrics, no history for an exercise).
4. Accessibility pass: labels on every input, `aria-live` for the timer and toasts, focus handling in sheets, contrast check in both themes, 48 px targets, honouring reduced motion for the flash.
5. Edge cases: a week with no plan, deleting a profile used by a plan (block it or reassign), a custom exercise used in history then deleted (soft-delete), a unit switch in the middle of a workout.
6. README final pass (screenshots optional), CLAUDE.md update, cache-version bump.
7. Full run-through against the acceptance checklist below.

---

## 8. Acceptance checklist → where it's verified

| Check | Automated | On device (you) |
|---|---|---|
| Installs, launches full-screen offline | SW precache test, offline reload in Chromium | Phase 1 |
| 3 days / 45 min / chest Priority / Home gives a valid week | `engine.test.js` scenario | Phase 3 UI |
| Rest timer accurate after a 60 s lock | timer maths tests, fake-clock smoke run | Phase 4 |
| Top-of-range reps raise the next suggested weight | `engine.test.js` progression, Phase 4 smoke run | — |
| JSON export re-imports to an identical state | `schema.test.js` round trip, UI smoke run | Phase 1 |
| `.ics` opens with alerts, re-export doesn't duplicate | `ics.test.js` | Phase 3 |
| Engine tests pass in Node with no deps | `node --test tests/` | — |

---

## 9. Things I need from you

1. **GitHub Pages:** turn it on for this repo (Settings > Pages > Deploy from branch). Tell me which branch it should serve. I'm working on `claude/affectionate-hawking-jc5nzr`, and Pages usually serves `main`, so the phases will need merging there (or Pages pointed at the work branch while testing).
2. **Device checks** at the end of Phases 1, 3 and 4, as listed above. Those are the only things I can't verify from here.
3. Any changes to the decisions in section 0. Otherwise I'll start Phase 1 with them as written.
