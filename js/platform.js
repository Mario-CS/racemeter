// Utilidades del navegador/iPhone: avisos (toast), pitidos, pantalla siempre encendida,
// permisos de sensores y corrección de la altura de pantalla en la app instalada.

let audioCtx = null;
let toastTimer = 0;

export function toast(msg, ms = 2600) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}

/** iOS solo deja sonar audio después de un toque del usuario: se llama al pulsar "Empezar". */
export function unlockAudio() {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const buf = audioCtx.createBuffer(1, 1, 22050), src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination); src.start(0);
  } catch { /* sin audio */ }
}

export function beep(freq = 1200, dur = 0.14) {
  if (!audioCtx) return;
  try {
    const o = audioCtx.createOscillator(), g = audioCtx.createGain(), t = audioCtx.currentTime;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t); o.stop(t + dur);
  } catch { /* sin audio */ }
}

/** Mantiene la pantalla encendida mientras la app está visible. */
export async function keepScreenOn() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') await navigator.wakeLock.request('screen');
  } catch { /* no soportado */ }
}

/** Pide permiso para los sensores de movimiento (obligatorio en iPhone, tras un toque). */
export async function requestMotionPermission() {
  const reqs = [];
  for (const E of [window.DeviceMotionEvent, window.DeviceOrientationEvent]) {
    try { if (E && typeof E.requestPermission === 'function') reqs.push(E.requestPermission()); } catch { /* */ }
  }
  const results = await Promise.all(reqs.map((p) => p.catch(() => 'denied')));
  return results.every((r) => r === 'granted');
}

/**
 * En la app instalada (pantalla de inicio) algunas versiones de iOS dan una altura de pantalla
 * más corta de la real y el menú inferior queda flotando a media pantalla. Se corrige midiendo.
 */
export function installViewportFix() {
  const fix = () => {
    let h = window.innerHeight;
    if (navigator.standalone) {
      const landscape = window.innerWidth > window.innerHeight;
      const full = landscape ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
      if (full > h && full - h < 160) h = full;
    }
    document.documentElement.style.setProperty('--app-h', h + 'px');
  };
  fix();
  addEventListener('resize', fix);
  addEventListener('orientationchange', () => setTimeout(fix, 300));
}
