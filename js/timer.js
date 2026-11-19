// Rest timer. Timestamp-based: stores the end time, never counts ticks.
// Pure maths at the top (Node-tested); audio/vibration helpers below touch browser APIs only when called.

export const QUICK_CHIPS = [60, 90, 120, 180];

export function startTimer(durationSec, exId = null, now = Date.now()) {
  return { startedAt: now, endAt: now + durationSec * 1000, durationSec, exId, alerted: false };
}

/** Seconds remaining (can be negative once elapsed). */
export function remaining(timer, now = Date.now()) {
  if (!timer) return 0;
  return (timer.endAt - now) / 1000;
}

export const isOver = (timer, now = Date.now()) => !!timer && remaining(timer, now) <= 0;

/** Add or remove seconds; never ends before now. */
export function adjust(timer, deltaSec, now = Date.now()) {
  const endAt = Math.max(now, timer.endAt + deltaSec * 1000);
  return { ...timer, endAt, durationSec: Math.max(0, timer.durationSec + deltaSec), alerted: endAt > now ? false : timer.alerted };
}

export function display(sec) {
  const s = Math.max(0, Math.ceil(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- Browser side ----------

let audioCtx = null;

/** Call from a user gesture to unlock WebAudio on iOS. */
export function unlockAudio() {
  try {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    src.connect(audioCtx.destination);
    src.start(0);
  } catch { /* ignore */ }
}

export function beep() {
  try {
    if (!audioCtx) return;
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t0 = audioCtx.currentTime + 0.02;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.value = i === 2 ? 1320 : 880;
      const t = t0 + i * 0.28;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.6, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.25);
    }
  } catch { /* ignore */ }
}

export function vibrate() {
  try { navigator.vibrate?.([200, 100, 200]); } catch { /* not supported on iOS */ }
}
