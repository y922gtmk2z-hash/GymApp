// Screen Wake Lock during an active workout. Fails silently where unsupported.

let sentinel = null;
let wanted = false;

async function acquire() {
  if (!wanted || !('wakeLock' in navigator) || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    sentinel.addEventListener?.('release', () => { sentinel = null; });
  } catch { sentinel = null; }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted && !sentinel) acquire();
});

export function keepAwake() {
  wanted = true;
  if (!sentinel) acquire();
}

export async function allowSleep() {
  wanted = false;
  try { await sentinel?.release(); } catch { /* ignore */ }
  sentinel = null;
}

export const isAwake = () => !!sentinel;
