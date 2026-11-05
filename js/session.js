// Sesión de medida: el recorrido de cada dato desde el sensor hasta los resultados.
//   muestra de movimiento → fusión → velocidad → máximos / estela / grabación → cronos
//   punto GPS → corrección de velocidad → (sin acelerómetro) cronos solo con GPS
// La usan tanto la app como las pruebas automáticas, así que lo probado es lo que corre.

import { KMH } from './util.js';
import { SpeedEstimator } from './speed.js';
import { emptyMaxima, updateMaxima } from './stats.js';

const SENSOR_LIVE_AGE = 0.5;   // s sin muestras para considerar que el acelerómetro no llega
const TRAIL_POINTS = 90;       // puntos de la estela del G-ball (cada 2 muestras)

export function createSession({ fusion, timer, speed = new SpeedEstimator(), maxima = emptyMaxima(), recorder = null }) {
  return {
    fusion, timer, speed, maxima, recorder,
    trail: [],
    lastMotion: -99,
    sensorHz: 0,
    _lastT: 0, _hzCount: 0, _hzT: 0, _trailCount: 0,
  };
}

export const sensorsLive = (s, t) => s.fusion.calibrated && t - s.lastMotion < SENSOR_LIVE_AGE;

/** Una muestra del acelerómetro/giroscopio (unas 60 por segundo). */
export function processSample(s, raw, wr, t) {
  let dt = s._lastT ? t - s._lastT : 0.016;
  s._lastT = t;
  if (!(dt > 0) || dt > 0.25) dt = 0.016;
  s.lastMotion = t;
  s._hzCount++;
  if (t - s._hzT >= 1) { s.sensorHz = s._hzCount / (t - s._hzT); s._hzCount = 0; s._hzT = t; }

  const { fusion: f, speed } = s;
  if (!f.update(raw, wr, dt, t, { speed: speed.v, gpsGood: speed.isGood(t) })) return false;

  const gpsGood = speed.isGood(t);
  speed.predict(f.lonG, dt, t);
  updateMaxima(s.maxima, f, speed.v, gpsGood);
  if (++s._trailCount % 2 === 0) {
    s.trail.push([f.latGs, f.lonGs]);
    if (s.trail.length > TRAIL_POINTS) s.trail.shift();
  }
  if (s.recorder) s.recorder.tick(t, { lat: speed.lat, lon: speed.lon, kmh: speed.v * KMH, lonG: f.lonGs, latG: f.latGs, lean: f.lean, pitch: f.pitch });
  if (gpsGood) s.timer.tick(t, speed.v, f.lonGs, dt, true);
  return true;
}

/** Un punto GPS (aprox. 1 por segundo). */
export function processGpsFix(s, coords, timestamp, t, nowMs) {
  const gpsOnly = s.speed.correct(coords, timestamp, t, nowMs, sensorsLive(s, t), s.fusion.lonGs);
  // Sin acelerómetro se cronometra solo con el GPS (menos preciso)
  if (gpsOnly) s.timer.tick(t, s.speed.v, gpsOnly.aG, gpsOnly.dt, false);
}
