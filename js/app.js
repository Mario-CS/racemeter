// Punto de entrada: conecta sensores, GPS, cálculos y pantallas.

import { G, D2R, scale } from './util.js';
import { storage } from './storage.js';
import { MotionFusion, defaultSigns } from './fusion.js';
import { SpeedEstimator } from './speed.js';
import { PerfTimer, parseInterval } from './timing.js';
import { emptyMaxima } from './stats.js';
import { createSession, processSample, processGpsFix, sensorsLive } from './session.js';
import { Recorder } from './recorder.js';
import { CircuitSim } from './demo.js';
import * as ui from './ui.js';
import { toast, beep as rawBeep, unlockAudio, keepScreenOn, requestMotionPermission, installViewportFix } from './platform.js';

const now = () => performance.now() / 1000;
const TEXT_REFRESH = 0.07;       // s entre refrescos de los números
const SAVE_EVERY = 3;            // s entre guardados de máximos

/* ======================= estado ======================= */

const settings = { bike: 'Mi moto', flipLat: false, flipFwd: false, gScale: 1.5, sound: true, intervals: [], ...storage.get('settings', {}) };
delete settings.mode;            // de versiones antiguas (coche/moto)
const saveSettings = () => storage.set('settings', settings);

const loadRecords = () => ({
  bests: storage.get('bests', {}), lastRes: storage.get('lastRes', {}),
  last: storage.get('lastRun', null), hist: storage.get('hist', []),
});

const realFusion = createFusion({
  calibration: storage.get('cal', null),
  signs: storage.get('signs', {}),
});

// La app es una sesión de medida (ver session.js) más el estado de la interfaz.
const app = Object.assign(
  createSession({
    fusion: realFusion,
    timer: new PerfTimer({ records: loadRecords(), save: (k, v) => storage.set(k, v), onEvent: onTimerEvent, custom: settings.intervals }),
    maxima: { ...emptyMaxima(), ...storage.get('max', {}) },
    recorder: new Recorder(),
  }),
  {
    started: false,
    demo: false,
    view: 'track',
    settings,
    gps: { watch: null, err: null, errCode: null },
    sensorsReceiving(t) { return t - this.lastMotion < 1; },
    sensorsLive(t) { return sensorsLive(this, t); },
  },
);
if (location.search.includes('debug')) window.__rm = app;   // para depurar desde la consola

const beep = (f, d) => { if (settings.sound) rawBeep(f, d); };

/* ======================= fusión de sensores ======================= */

function createFusion(opts) {
  const f = new MotionFusion({ flipFwd: settings.flipFwd, flipLat: settings.flipLat, ...opts });
  f.events = {
    calibrated(cal, auto) {
      if (app.demo) return;
      storage.set('cal', cal);
      if (auto) {
        toast('Calibrado automático. Para más precisión, calibra con el móvil ya puesto en la moto (Ajustes).', 5000);
        return;
      }
      settings.flipFwd = false; saveSettings();
      resetMaxima(false);
      ui.showCalibration(false);
      ui.renderSettings(app, now());
      toast('Calibrado ✔');
    },
    calibrationProgress: (p, moving) => ui.setCalibrationProgress(p, moving),
    forwardDetected(cal) {
      storage.set('cal', cal);
      settings.flipFwd = false; saveSettings();
      ui.renderSettings(app, now());
      toast('Dirección de marcha detectada ✔'); beep(1400);
    },
    forwardFailed: () => toast('No se detectó aceleración'),
    signsLearned: (signs) => { if (!app.demo) storage.set('signs', signs); },
  };
  return f;
}


function onDeviceMotion(e) {
  if (app.demo) return;
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const r = e.rotationRate;
  const wr = r && r.alpha != null ? [r.alpha * D2R, r.beta * D2R, r.gamma * D2R] : null;
  processSample(app, [a.x, a.y, a.z], wr, now());
}

function onDeviceOrientation(e) {
  if (app.demo || e.beta == null) return;
  app.fusion.setOrientation(e.beta * D2R, e.gamma * D2R, now());
}

/* ======================= GPS ======================= */

const GPS_ERRORS = {
  1: 'Ubicación denegada. Ve a Ajustes › Privacidad y seguridad › Localización: actívala, y en "Sitios web de Safari" (o en la app RaceMeter) elige "Al usar la app" y "Ubicación exacta". Luego cierra y abre la app.',
  2: 'El iPhone no consigue posición GPS. Sal al exterior con cielo despejado.',
  3: 'El GPS tarda en responder…',
};

function startGps() {
  const gps = app.gps;
  if (gps.watch != null) return;
  if (!navigator.geolocation) { gps.err = 'Este navegador no tiene GPS'; return; }
  if (!window.isSecureContext) { gps.err = 'La página no va por HTTPS: el iPhone bloquea el GPS'; toast(gps.err, 6000); return; }
  gps.watch = navigator.geolocation.watchPosition(
    (p) => {
      gps.err = null;
      if (!app.demo) processGpsFix(app, p.coords, p.timestamp, now(), Date.now());
    },
    (err) => {
      const msg = GPS_ERRORS[err.code] || 'Error de GPS: ' + err.message;
      const first = gps.err !== msg;
      gps.err = msg; gps.errCode = err.code;
      if (first && !app.demo) toast(msg, err.code === 1 ? 9000 : 4000);
      if (err.code === 1) stopGps();
    },
    { enableHighAccuracy: true, maximumAge: 0 },
  );
}

function stopGps() {
  if (app.gps.watch != null) { navigator.geolocation.clearWatch(app.gps.watch); app.gps.watch = null; }
}

/* ======================= cronómetros ======================= */

function onTimerEvent(ev) {
  const record = ev.newBest ? ' · ¡récord!' : '';
  beep(ev.newBest ? 1600 : 1200);
  if (ev.type === 'run' && ev.run.spd['0-100'] != null) toast(`0-100: ${ev.run.spd['0-100'].toFixed(2)} s${record}`);
  else if (ev.type === 'roll') toast(`${ev.key} km/h: ${ev.time.toFixed(2)} s${record}`);
  else if (ev.type === 'brake') toast(`Frenada 100-0: ${ev.d.toFixed(1)} m · ${ev.t.toFixed(2)} s${record}`);
}

function resetMaxima(notify = true) {
  Object.assign(app.maxima, emptyMaxima());
  app.trail.length = 0;
  if (!app.demo) storage.set('max', app.maxima);
  if (notify) toast('Máximos reiniciados');
}

/* ======================= modo demo ======================= */

let sim = null, simTimer = null, simLastT = 0, savedMaxima = null;

function enterDemo() {
  if (app.demo) return;
  app.demo = true;
  app.timer.demo = true;
  app.timer.resetState();
  savedMaxima = { ...app.maxima };
  Object.assign(app.maxima, emptyMaxima());
  app.trail.length = 0;
  sim = new CircuitSim({ seed: Date.now() % 1e9, epochMs: Date.now() });
  app.fusion = createFusion({
    calibration: { graw: scale(sim.axes.U, G), fwdraw: null },
    signs: { ...defaultSigns(), gdone: true },
    learnSigns: false, autoCalibrate: false,
  });
  app.speed = new SpeedEstimator();
  app._lastT = 0; simLastT = 0;
  simTimer = setInterval(simTick, 1000 / 60);
  toast('Modo demo: circuito simulado');
}

function simTick() {
  const t = now();
  const dt = simLastT ? Math.min(0.05, t - simLastT) : 1 / 60;
  simLastT = t;
  const s = sim.step(dt);
  processSample(app, s.raw, s.wr, t);
  if (s.gps) processGpsFix(app, s.gps.coords, s.gps.timestamp, t, s.nowMs);
}

function exitDemo() {
  if (!app.demo) return;
  clearInterval(simTimer); simTimer = null; sim = null;
  app.demo = false;
  app.fusion = realFusion;
  app.fusion.setFlips(settings);
  app.speed = new SpeedEstimator();
  Object.assign(app.maxima, savedMaxima);
  app.trail.length = 0;
  app.timer.demo = false;
  app.timer.loadRecords(loadRecords());
  app.timer.resetState();
  app._lastT = 0; app.lastMotion = -99;
  startGps();
  toast('Modo demo desactivado');
}

/* ======================= acciones de la interfaz ======================= */

function setIntervals(list) {
  settings.intervals = list; saveSettings();
  app.timer.setCustomIntervals(list);
}

function setView(view) {
  app.view = view;
  ui.setView(view);
  if (view === 'set') ui.renderSettings(app, now());
}

const actions = {
  goSettings: () => setView('set'),
  renameBike() {
    let name = null;
    try { name = prompt('Nombre de tu moto', settings.bike); } catch { toast('No se puede cambiar el nombre aquí'); }
    if (name && name.trim()) { settings.bike = name.trim().slice(0, 30); saveSettings(); ui.renderSettings(app, now()); }
  },
  calib() {
    if (app.demo) return toast('En modo demo no se calibra');
    if (!app.sensorsReceiving(now())) return toast('No llegan datos de los sensores');
    app.fusion.startCalibration(now());
    ui.showCalibration(true);
  },
  cancelCalib() { app.fusion.cancelCalibration(); ui.showCalibration(false); },
  fwd() {
    if (app.demo) return toast('No disponible en modo demo');
    if (!app.fusion.calibrated) return toast('Primero calibra');
    app.fusion.startForwardDetection(now());
    toast('Acelera en línea recta unos segundos…', 5000);
  },
  resetMax: () => resetMaxima(),
  addInterval() {
    let txt = null;
    try { txt = prompt('Velocidad inicial y final en km/h (por ejemplo 20-120)', ''); } catch { return toast('No se puede añadir aquí'); }
    if (txt == null || !txt.trim()) return;
    const { interval, error } = parseInterval(txt, settings.intervals);
    if (error) return toast(error, 3500);
    setIntervals([...settings.intervals, interval].sort((x, y) => x[0] - y[0] || x[1] - y[1]));
    toast(`${interval[0]}-${interval[1]} km/h añadido ✔`);
  },
  delInterval(el) {
    const key = el.dataset.key;
    if (!confirm(`¿Quitar el ${key} km/h? Se borran también sus tiempos.`)) return;
    setIntervals(settings.intervals.filter(([a, b]) => `${a}-${b}` !== key));
    const { bests, lastRes } = app.timer;
    delete bests[key]; delete lastRes[key];
    storage.set('bests', bests); storage.set('lastRes', lastRes);
  },
  rec() {
    const r = app.recorder;
    if (r.on) { r.stop(); toast(`Grabación detenida (${r.rows.length} filas)`); } else { r.start(); toast('Grabando a 10 Hz'); }
    ui.renderSettings(app, now());
  },
  export() {
    if (!app.recorder.rows.length) return toast('No hay datos grabados');
    app.recorder.exportFile();
  },
  retryGps() { stopGps(); app.gps.err = null; app.gps.errCode = null; startGps(); toast('Buscando GPS…'); },
  clearHist() {
    if (!confirm('¿Borrar historial, récords y últimos tiempos?')) return;
    app.timer.clearRecords();
    toast('Borrado');
  },
  demo() { if (app.demo) exitDemo(); else enterDemo(); setView('track'); },
  resetSigns() {
    if (app.demo) return;
    app.fusion.resetSigns();
    storage.set('signs', app.fusion.signs);
    ui.renderDiagnostics(app, now());
    toast('Mueve y gira el móvil unos segundos en la mano');
  },
};

function bindUi() {
  document.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    if (act) { const fn = actions[act.dataset.act]; if (fn) fn(act); return; }
    const nav = e.target.closest('#nav button');
    if (nav) { setView(nav.dataset.v); return; }
    const seg = e.target.closest('#segScale button');
    if (seg) { settings.gScale = +seg.dataset.s; saveSettings(); ui.renderSettings(app, now()); }
  });
  document.getElementById('tFwd').addEventListener('change', (e) => { settings.flipFwd = e.target.checked; saveSettings(); app.fusion.setFlips(settings); });
  document.getElementById('tLat').addEventListener('change', (e) => { settings.flipLat = e.target.checked; saveSettings(); app.fusion.setFlips(settings); });
  document.getElementById('tSnd').addEventListener('change', (e) => {
    settings.sound = e.target.checked; saveSettings();
    if (settings.sound) { unlockAudio(); beep(); }
  });
  document.getElementById('btnStart').addEventListener('click', () => begin(false));
  document.getElementById('btnDemo').addEventListener('click', () => begin(true));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && app.started) keepScreenOn(); });
}

/* ======================= arranque ======================= */

async function begin(withDemo) {
  document.getElementById('start').hidden = true;
  app.started = true;
  unlockAudio();
  if (!withDemo) {
    const granted = await requestMotionPermission();
    if (!granted) toast('Sin permiso de movimiento. Cierra la app y vuelve a abrirla para aceptarlo.', 5000);
    startGps();
    setTimeout(() => {
      if (app.demo) return;
      if (!app.sensorsReceiving(now())) toast('No llegan datos de los sensores de movimiento', 4000);
      else if (!app.fusion.calibrated) toast('Fija el móvil en la moto y calibra en Ajustes', 4000);
    }, 2500);
  }
  addEventListener('devicemotion', onDeviceMotion);
  addEventListener('deviceorientation', onDeviceOrientation);
  keepScreenOn();
  if (withDemo) enterDemo();
}

let lastText = 0, lastSave = 0;
function frame() {
  requestAnimationFrame(frame);
  const t = now();
  if (t - lastText > TEXT_REFRESH) { lastText = t; ui.render(app, t); }
  ui.drawCurrentView(app, t);
  if (t - lastSave > SAVE_EVERY) {
    lastSave = t;
    if (!app.demo) storage.set('max', app.maxima);
    if (app.view === 'set') ui.renderDiagnostics(app, t);
  }
}

installViewportFix();
if (!window.isSecureContext && location.protocol !== 'file:') document.getElementById('httpsWarn').hidden = false;
bindUi();
ui.renderSettings(app, now());
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
if (window.caches) caches.keys().then((ks) => { app.version = ks.filter((k) => k.startsWith('racemeter-')).map((k) => k.slice(10)).join(', '); }).catch(() => {});
