# Gym PWA: Project Brief

> For Claude Code. Build in the phases at the bottom, commit after each phase, and keep the app runnable at every step. See `PLAN.md` for the implementation plan.

**Revision 2 (2026-11-18):** adds a weight-loss phase driven by exercise only (no calorie counting): weight targets, cardio and step targets, progress measurement and rule-based plan suggestions. New or changed text is marked **[R2]**.

## 1. Purpose
A free, offline-first iPhone app (installable PWA) that:
1. builds my workout plan and gym schedule from what I want to train,
2. logs workouts with a rest timer,
3. tells me what to lift next using rules (no AI),
4. tracks progress over time,
5. **[R2]** helps me lose weight through exercise alone: I set a weight target, it suggests a plan (strength + cardio + daily steps), measures my progress against the target and suggests adjustments week by week. No food logging or calorie counting.

## 2. Hard constraints
- **Free to build, host and run.** Static site on GitHub Pages.
- **PWA, installed via Safari > Share > Add to Home Screen.** No App Store, no native build.
- **No backend, no accounts, no API keys, no AI/LLM calls.** All logic is deterministic rules.
- **Offline-first.** Fully usable with no signal (gyms are often basements).
- **No build step, no dependencies.** Plain HTML, CSS and ES modules. Must run by opening a static server and deploy as-is to GitHub Pages (relative paths, works under a sub-path like `/repo-name/`).
- **Data stays on the device** (IndexedDB). Single user, but keep the data model clean (a `user` profile object, no hard-coded assumptions) so friends could use it later.
- **No Apple Health integration.** Metric fields and units should align with Apple Health so I can copy figures across by hand (I have an Apple Watch).
- **[R2] No calorie counting.** No food logging, no calorie budgets, and no calories-burned estimates. Weight-loss progress is judged only from measured body weight and waist trends.

## 3. Defaults
- Units: **kg** (stored internally in kg; lb is a display setting).
- Theme: **dark first**, with Auto/Light options. Mobile-first, one-handed use, large tap targets, safe-area insets, no hover dependence.
- Mixed training environment: **Gym** and **Home** equipment profiles.

## 4. Core features

### 4.1 Exercise library
- Built-in library of about 80+ exercises.
- Each exercise: id, name, primary muscle, secondary muscles, required equipment tags, compound or isolation, movement pattern, suggested alternatives.
- Muscles: chest, back, shoulders, biceps, triceps, quads, hamstrings, glutes, calves, core.
- Equipment tags: barbell, rack, bench, dumbbell, cable, machine, pullup bar, bodyweight, kettlebell, bands. **[R2]** Plus cardio kit: treadmill, bike, rower, elliptical, stair machine, jump rope, outdoors.
- Library order doubles as preference order (best compounds first).
- User can add custom exercises. Search and filter by muscle and equipment.
- **[R2]** A separate list of about 12 cardio activities (walk, incline treadmill walk, run, bike, rower, elliptical, stair climber, jump rope, hike, kettlebell circuit, bodyweight circuit, swim) with equipment tags, impact level (low/high) and the intensities each suits (steady, intervals). Low-impact activities come first in preference order. User can add custom activities.

### 4.2 Equipment profiles
- **Gym** (everything on by default) and **Home** (default: dumbbells, bench, bodyweight, pull-up bar; **[R2]** plus outdoors; fully editable).
- User can add custom profiles. Each training day is assigned a profile, and the plan only uses exercises available in that profile.

### 4.3 Plan builder (the main feature)
**Inputs**
- Goal mode: **Muscle / Strength / General** (mixed is possible by changing mode between blocks).
- Focus per muscle: **Priority / Maintain / Minimal**.
- Training days this week (2-6): which weekdays, session length (30/45/60/90 min), profile per day (Gym/Home), preferred start time.
- Days vary week to week, so the builder is run per week with the last settings pre-filled.
- **[R2] Weight-loss phase** (on/off, works with any goal mode): when on, the builder also takes cardio days (weekdays, length, profile, start time) and whether to add cardio finishers to lifting sessions, and adds cardio sessions, finishers and a daily step target to the week (see 4.10).

**Rules engine (deterministic, unit-testable pure functions)**
1. **Weekly set targets per muscle**, by goal and focus (direct sets only):

   | Goal | Priority | Maintain | Minimal |
   |---|---|---|---|
   | Muscle | 12-14 | 8 | 4 |
   | Strength | 10 | 6 | 3 |
   | General | 10 | 7 | 4 |

2. **Split by number of days:**
   - 2: Full A / Full B
   - 3: Full A / B / C
   - 4: Upper / Lower / Upper / Lower
   - 5: Upper / Lower / Push / Pull / Legs
   - 6: Push / Pull / Legs x2
3. Spread each muscle's weekly sets evenly across the sessions where it appears. Drop an appearance if it would give fewer than 2 sets.
4. Pick exercises per muscle per session from the active profile's equipment:
   - 1-4 sets = 1 exercise; 5-8 = 2; 9+ = 3, maximum 4 sets per exercise.
   - Compounds first. Rotate exercises between appearances for variety (Strength mode keeps the main lift constant).
5. **Rep ranges and rest by goal:**
   - Muscle: compounds 6-10 reps with 120s rest; isolations 10-15 reps with 75s rest.
   - Strength: compounds 3-6 reps with 180s rest; isolations 6-10 reps with 90s rest.
   - General: compounds 8-12 reps with 90s rest; isolations 10-15 reps with 60s rest.
6. **Time budget:** estimate session time (about 40s per set plus rest, plus 5 min warm-up). If over the chosen length, remove sets from the lowest-focus muscles first. **[R2]** When a session has a cardio finisher, the finisher's minutes come off the budget before the lifting is fitted.
7. Order each session as compounds first, then isolations, with core and calves last.
8. **Re-balance** whenever I swap an exercise, move a session or skip a day.
9. **Weekly re-plan:** propose next week's plan from what I actually did and apply progression. **[R2]** In a weight-loss phase this includes the weekly review in 4.10.

**Plan UI**
- Week calendar view with sessions as cards. **[R2]** Cardio sessions show as their own cards, and the daily step target is shown on the week.
- Edit a session by swapping exercises (suggest same-muscle, same-equipment alternatives), reordering, adding or removing sets, and moving a session to another day.
- Show planned sets per muscle against target (bars). **[R2]** Plus planned cardio minutes against the weekly cardio target.

### 4.4 Progression and deload
- **Double progression:** when all working sets hit the top of the rep range, add weight (barbell/machine/cable +2.5 kg, dumbbell +2 kg, in lb mode +5 lb) and reset to the bottom of the range. If all sets reach at least the bottom of the range, keep the weight and target +1 rep.
- Pre-fill each logged set with the suggested weight and reps, based on the most recent performance of that exercise.
- **Stall rule:** two consecutive sessions with at least half the sets below the minimum reps suggests a 10% drop on that lift.
- **Deload:** suggest a deload week after 6 consecutive training weeks, or on repeated stalls across lifts. A deload week means about 60% of sets and weights -10%. Show it as a suggestion the user can accept or dismiss, never forced.
- No history for an exercise means no suggestion; the user enters the first numbers.

### 4.5 Workout logger
- Start from today's planned session, or an ad-hoc workout.
- Per exercise: set rows with weight, reps and a done tick. Add or remove sets, swap the exercise, add an exercise, reorder, and add a note.
- Show previous performance and the target next to each exercise.
- Finish saves the workout with duration and detects PRs (estimated 1RM via Epley, plus heaviest weight and rep PRs).
- Workouts can be edited or deleted afterwards.
- Warm-up sets are flagged and excluded from volume and progression.
- **[R2] Cardio entries:** a workout can hold cardio entries (activity, minutes, optional distance in km, optional average heart rate in bpm, intensity: steady or intervals). Start a planned cardio session from Today, log a finisher at the end of a lifting session, or quick-log a cardio entry after the fact (for example, a walk tracked on the Apple Watch). Fields match the Apple Watch workout summary so figures can be copied across.

### 4.6 Rest timer
- Starts automatically when a set is ticked, using the exercise's rest time. Quick chips (60/90/120/180s) and a manual start.
- Sticky bar with countdown, +15s / -15s, skip.
- **Timestamp-based** (stores end time, never counts ticks), so it stays accurate when the screen locks or the app is backgrounded.
- On finish: audible beep via WebAudio (unlock audio on the first user tap), strong visual flash, and `navigator.vibrate` where available (not supported on iOS Safari).
- **Screen Wake Lock** during an active workout (re-acquire on visibility change).
- When returning to the app after the timer has elapsed, show "Rest over".
- Per-exercise default rest is overridable and remembered.

### 4.7 Calendar export (substitute for push notifications)
- iOS web apps can't schedule local notifications without a server, so export the plan to Apple Calendar.
- Generate a standards-compliant `.ics` file for the planned week/block: one event per session (title, exercise list in the description, duration from session length, start time from the plan, floating local time) with a `VALARM` (default 30 min before, configurable). **[R2]** Cardio sessions are exported as events too.
- Download via Blob so Safari offers "Add to Calendar". Re-exporting should not duplicate events (stable UIDs).

### 4.8 Progress tracking
**Body metrics, manual, dated entries (back-dating allowed)**
- Weekly check-in (about 30 seconds): body weight, resting heart rate, waist (optional). **[R2]** In a weight-loss phase the check-in also asks for the daily step average for the past week (as shown in Apple Health), and waist becomes recommended. The app prompts for 3 or more weigh-ins a week, because the trend needs them.
- Optional fields matching Apple Health: HRV, VO2 max, average sleep, body fat %, plus tape measurements (chest, arms, thighs, hips).
- Units and naming aligned with Apple Health.
- Edit and delete entries.
- **[R2]** Optional profile fields: height (cm) and birth year. They are used only for the BMI sanity check on a weight target and for heart-rate zones.

**Training progress (auto-captured, no data entry)**
- Estimated 1RM per exercise over time, PR history, weekly sets per muscle against target, sessions per week, total volume. **[R2]** Plus weekly cardio minutes against target.

**Views**
- SVG line charts (no chart library) with range selector: 4 weeks / 3 months / 6 months / 1 year / all. Body weight shows raw points plus a 7-day rolling average.
- Targets for any metric or lift, shown as a line on the chart with a progress bar.
- Home weekly summary: sessions done vs planned, PRs hit, change in key metrics vs the previous period. **[R2]** Plus cardio minutes and average steps against their targets.

### 4.9 Settings and backup
- Units (kg/lb), theme, default rest times, alarm lead time for calendar export, equipment profile editor.
- **JSON export/import of all data**, with schema `version` and migration support. Import validates before overwriting.
- Request `navigator.storage.persist()`. Show a gentle "back up your data" reminder if no export in 30 days (iOS can purge storage if the app is deleted or Safari data is cleared).

### 4.10 [R2] Weight loss (exercise only)
**Setting a target**
- Inputs: target weight and either a target date or a pace (0.25 / 0.5 / 0.75 % of body weight per week, default 0.5 %). The start weight is the current 7-day average.
- A feasibility check before the goal is saved:
  - The required pace is computed. Over 1 % of body weight per week is flagged as too fast, and the app offers the date that a 0.5 % pace gives.
  - If height is set and the target BMI would be under 18.5, the app warns.
- The user can also set a waist target.

**Suggested plan (deterministic rules)**
- **Strength training stays in the plan.** Set targets and progression are unchanged, to hold onto muscle while losing weight.
- **Weekly cardio minutes:**
  - Start at the larger of 60 minutes and what the user says they do now.
  - Build by +15 min per week up to 150 minutes.
  - After that, change only through the weekly review, up to a cap of 300 minutes. That range matches the WHO activity guideline of 150-300 minutes of moderate activity a week.
- **How the cardio minutes are spread:**
  - Optional 10-15 min finishers on lifting days (taken out of the session's time budget).
  - The rest goes into standalone cardio sessions on the chosen cardio days, each at least 20 minutes and no longer than that day's length.
  - Activities are picked from the day's equipment profile, low impact first, and rotated for variety.
  - Mostly steady, Zone 2 work. At most one interval session a week, only from week 4 of the phase, and never the day before a lower-body or full-body lifting day.
- **Daily steps:** start at the baseline plus 1,000, capped at 10,000 by default (editable). Change through the weekly review in steps of 1,000.
- **Heart-rate guide:** if birth year and resting heart rate are known, show a Zone 2 bpm range (Karvonen method: HRmax = 208 − 0.7 × age, Zone 2 = resting HR + 60-70 % of the reserve). Otherwise show "conversational pace (RPE 3-4)".

**Measuring progress**
- The weight trend is the least-squares slope over the last 21 days. It needs at least 4 weigh-ins in the last 14 days, or the app asks for more weigh-ins instead of guessing.
- Goal card:
  - start weight, current 7-day average and target
  - % of the way to the target
  - actual pace per week vs target pace
  - projected date at the current trend
- Weight chart: the raw points, the 7-day average, a straight goal line from start to target date, and the target line.
- Waist chart, weekly cardio minutes vs target, average steps vs target.

**Weekly review (suggestions, never forced)**
Once a week, after the check-in, the app proposes one of the following. The user can accept or dismiss it.
- **Need more data:** fewer than 4 weigh-ins in the last 14 days.
- **Do the current plan first:** last week's logged cardio minutes were under 80 % of the plan, or steps were under 90 % of the target. The app doesn't step up a plan that isn't being done.
- **On track:** the pace is at least 75 % of the target pace and no more than 1 % of body weight a week. No change.
- **Step up:** two reviews in a row below 50 % of the target pace (or gaining) while the plan was followed. The app alternates between two changes, within the caps: daily steps +1,000, then cardio +30 min a week.
- **Ease off:** two reviews in a row losing more than 1 % of body weight a week. Cardio −30 min a week. Lifting stays the same.
- **Recomposition:** weight is flat but waist is down at least 1 cm over 4 weeks. The app treats this as progress and doesn't step up.
- **Strength warning:** during the phase, estimated 1RM is down 5 % or more on 3 or more lifts compared with 4 weeks ago. The app suggests easing the pace and keeping the lifting volume.
- **Levers maxed:** steps and cardio are both at their caps and the pace is still too slow. The app offers to move the target date to match the current trend. It says plainly that exercise alone has limits and that diet is outside this app.
- **Goal reached:** the 7-day average is at or below the target. The app offers to end the phase, keep the current cardio and steps as a maintenance plan, and set a new target.

## 5. Navigation
Bottom tab bar: **Today** (planned session, week strip, weekly summary) · **Plan** (builder, calendar, export) · **Progress** (metrics, lifts, volume) · **More** (library, profiles, settings, backup). The active workout is a full-screen overlay with the rest timer pinned. **[R2]** Today also shows the step target, the cardio minutes for the week, and the weekly-review card. Progress gets a Weight goal section.

## 6. Technical spec
- Files: `index.html`, `styles.css`, ES modules (`app.js`, `data.js`, `engine.js`, `db.js`, `charts.js`, `ics.js`, `util.js`, view modules), `manifest.webmanifest`, `sw.js`, icons. **[R2]** Plus `weight.js` (weight-loss rules, pure and DOM-free like `engine.js`).
- `engine.js` must be **pure and DOM-free** so it can be tested in Node. Include a small test script covering split selection, volume allocation, equipment filtering, time budgeting and progression and deload rules. **[R2]** Plus tests for the target feasibility check, cardio allocation, trend calculation and every weekly-review outcome.
- Storage: IndexedDB with a versioned state document. LocalStorage fallback.
- Service worker: cache the app shell, versioned cache name, cache-first with update-on-next-load. Relative paths only so it works under a GitHub Pages sub-path.
- iOS PWA essentials: `apple-mobile-web-app-capable`, status bar style, `apple-touch-icon` (180px PNG), 192 and 512 icons, `viewport-fit=cover`, safe-area padding, `theme-color`, standalone display, prevent double-tap zoom on controls, numeric `inputmode` on weight and rep fields.
- Accessibility: sufficient contrast, labels on inputs, large touch targets.
- Include `README.md` (how to deploy to GitHub Pages and install on iPhone) and a `CLAUDE.md` with these constraints.

## 7. Data model (sketch)
```
state {
  version, user { name, heightCm?, birthYear? },            // [R2] height, birthYear
  settings { units, theme, restDefaults, alarmMinutes, stepCap },  // [R2] stepCap
  profiles [ { id, name, equipment[] } ],
  customExercises [], customActivities [],                    // [R2] customActivities
  plan { weekStart, goal, focus{muscle: priority|maintain|minimal},
         deload, days[{date, profileId, minutes, startTime}],
         sessions[{id, date, name, profileId, exercises[{exId, sets, repMin, repMax, restSec}],
                   cardio[{activityId, minutes, intensity, finisher}] }],   // [R2]
         stepTarget, cardioTargetMin },                                     // [R2]
  workouts [ { id, date, sessionId?, name, durationSec,
               exercises[{exId, note, sets[{kg, reps, done, warmup}]}],
               cardio[{activityId, minutes, distanceKm?, avgHr?, intensity}] } ],  // [R2]
  metrics [ { date, weightKg, restingHr, waistCm, hrv, vo2max, sleepHrs, bodyFatPct,
              stepsAvg, ... } ],                                            // [R2] stepsAvg
  targets { metricOrLiftKey: value },
  weightGoal { active, startDate, startKg, targetKg, targetDate, pacePct,   // [R2]
               baselineSteps, baselineCardioMin, levels{cardioMin, steps},
               cardioDays[{weekday, minutes, profileId, startTime}], finishers,
               reviews[{weekStart, pacePct, kind, changes, accepted}] } | null,
  lastExportAt, lastDeloadWeek
}
```

## 8. Out of scope (v1)
AI coach, accounts or sync, PT/client features, Apple Health integration, push notifications, social features, nutrition tracking. **[R2]** Also out: calorie counting, calorie-burn estimates, meal plans, and progress photos.

## 9. Build phases
1. **Scaffold:** PWA shell, manifest, service worker, icons, dark theme, tab navigation, IndexedDB state, JSON export/import. Verify installable on iPhone via GitHub Pages.
2. **Library and engine:** exercise data and `engine.js` with Node tests. **[R2]** Plus cardio activities and `weight.js` with Node tests.
3. **Plan builder UI and calendar export:** inputs, generated week, editing, `.ics`. **[R2]** Plus the weight-loss inputs, cardio sessions and finishers in the week.
4. **Logger and rest timer:** logging, suggestions, PR detection, timer, wake lock. **[R2]** Plus cardio entries and quick-log.
5. **Progress:** check-in, charts, lift progress, volume, targets, weekly summary. **[R2]** Plus the weight goal card, trend and projection, cardio and steps charts.
6. **Polish:** deload suggestions, backup reminder, empty states, accessibility pass, README. **[R2]** Plus the weekly-review flow.

## 10. Acceptance checks
- Installs to the iPhone home screen and launches full-screen offline after first load.
- Selecting 3 days, 45 min, chest Priority, Home profile produces a valid week using only home equipment and fits the time budget.
- Ticking a set starts the rest timer, and it stays accurate after locking the phone for 60s.
- Completing all top-of-range reps on a lift raises the suggested weight next session.
- Exported JSON re-imports to an identical state.
- Exported `.ics` opens in Apple Calendar with alerts, and re-export doesn't duplicate events.
- All engine tests pass in Node with no dependencies.
- **[R2]** Setting a target of 85 → 78 kg in 8 weeks is flagged as too fast and offers a later date at a 0.5 % pace.
- **[R2]** With the weight-loss phase on, 3 lifting days plus 2 cardio days gives a week where planned cardio minutes meet the week's cardio target, finishers fit inside each lifting session's time budget, and cardio uses only each day's profile equipment.
- **[R2]** The weekly review suggests a step-up after two slow reviews when the plan was followed, and suggests "do the current plan first" instead when logged cardio was under 80 % of the plan.
- **[R2]** No screen asks for or shows calories.
