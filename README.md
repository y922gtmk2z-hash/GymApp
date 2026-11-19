# Gym

A free, offline-first workout app for iPhone, installed from Safari as a web app. It builds a weekly training plan from what you want to train, logs workouts with a rest timer, suggests what to lift next using simple rules, supports an exercise-only weight-loss phase, and tracks your progress. Everything stays on your phone. No account, no server, no AI.

- What it does: [`BRIEF.md`](BRIEF.md)
- How it is built: [`PLAN.md`](PLAN.md)

## Using it

1. **Plan** tab > **Build this week**: pick a goal (Muscle, Strength or General), a focus for each muscle, and 2–6 training days with length, equipment profile (Gym or Home) and start time. The week is generated to fit your time and equipment. Edit any session: swap, reorder, change sets, move, or skip (its sets move to later sessions).
2. **Export** (Plan tab, top right) adds the week to Apple Calendar with an alert before each session.
3. **Today** tab > **Start workout**. Weights and reps are pre-filled from your last session using double progression. Tick a set and the rest timer starts. Finish saves the workout and flags PRs.
4. **Progress** tab > **Check in** once a week (weight, resting heart rate, waist). Charts show body metrics, estimated 1RM per lift, weekly sets per muscle, sessions, volume and cardio. Tap **Set target** under any chart.
5. **Weight loss (optional):** in the plan builder, turn on **Weight-loss phase**, enter a target weight and a date or pace, and pick cardio days. The plan adds cardio, finishers and a daily step target. Each week Today shows a review that suggests holding, stepping up or easing off, based only on your weigh-in trend. There is no food or calorie tracking.

Want to look around first? **More > Settings > Load sample data** fills the app with 12 weeks of example data (it replaces your data, so use it before you start or after a backup).

## Run it locally

No install or build step. From the repository folder:

```sh
python3 -m http.server 8080
```

Open http://localhost:8080/. Any static file server works.

Run the tests (Node 18 or newer, no packages needed):

```sh
node --test
```

## Deploy to GitHub Pages

1. Push the repository to GitHub.
2. Go to **Settings > Pages**.
3. Under **Build and deployment**, set **Source** to **Deploy from a branch**, pick `main` and `/ (root)`, and save.
4. After a minute the app is live at `https://<your-user>.github.io/<repo-name>/`.

All paths are relative, so it works under the repository sub-path as is. The `.nojekyll` file stops GitHub from processing the files.

**Updating:** push to `main`. The app checks for a new version on launch and shows **Update ready > Reload**. If you change any app file, bump `VERSION` in `sw.js` so phones pick up the change.

## Install on iPhone

1. Open the GitHub Pages URL in **Safari** (it must be Safari).
2. Tap **Share**, then **Add to Home Screen**, then **Add**.
3. Launch it from the home screen icon. It opens full screen.
4. Open it once with a signal so everything is cached. After that it works with no signal at all.

## Your data

- Data is stored on the phone in the app's own storage. Deleting the home-screen app or clearing Safari website data deletes it.
- **Back up regularly:** More > Backup > Export backup. Save the file to Files or iCloud Drive. Import restores it on any device. The app reminds you if you haven't exported for 30 days.
- Calendar: Plan > Export to Calendar adds your sessions to Apple Calendar with alerts (iOS web apps cannot send notifications on their own).

## Things to check on your iPhone

These can only be confirmed on a real device:

- Add to Home Screen, then open it in airplane mode: it should launch full screen.
- Start a workout, tick a set, lock the phone for 60 s, unlock: the countdown should be correct (or show **Rest over**).
- Export the week to Calendar, check the alerts, then export again: events should update, not duplicate. If your iOS version duplicates them, delete the old events before re-importing.

## Known iOS limits

- The rest-timer beep can't play while the phone is locked. When you unlock, the timer is still accurate and shows **Rest over**. The beep is also silenced by the ring/silent switch; the screen flash always works.
- Vibration isn't available to web apps on iPhone.
- Keeping the screen awake during a workout needs iOS 18.4 or newer when installed to the home screen.
