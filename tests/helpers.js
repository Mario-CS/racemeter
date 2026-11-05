// Utilidades para las pruebas: montan una sesión igual que la de la app y la alimentan
// con señales simuladas, sin navegador y sin esperar en tiempo real.

import { G, scale } from '../js/util.js';
import { MotionFusion, defaultSigns } from '../js/fusion.js';
import { PerfTimer } from '../js/timing.js';
import { createSession, processSample, processGpsFix } from '../js/session.js';
import { mountAxes, sensorSample, seededRandom } from '../js/demo.js';

export const DT = 1 / 60;
export const kmh = (v) => v / 3.6;

/** Sesión calibrada para un móvil montado como en la simulación. */
export function calibratedSession(axes = mountAxes()) {
  const fusion = new MotionFusion({
    calibration: { graw: scale(axes.U, G), fwdraw: null },
    signs: { ...defaultSigns(), gdone: true },
    learnSigns: false,
    autoCalibrate: false,
  });
  const events = [];
  const timer = new PerfTimer({ onEvent: (e) => events.push(e) });
  return { session: createSession({ fusion, timer }), events, axes };
}

/** Alimenta la sesión con el simulador de circuito durante `seconds`. */
export function runCircuit(sim, session, seconds, onStep = () => {}) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    const out = sim.step(DT);
    processSample(session, out.raw, out.wr, out.t);
    if (out.gps) processGpsFix(session, out.gps.coords, out.gps.timestamp, out.t, out.nowMs);
    onStep(out);
  }
}

/**
 * Moto en línea recta siguiendo un perfil de aceleración `accelAt(t, v)` (m/s²).
 * Devuelve el historial real [t, v, x] para comparar.
 */
export function runStraight(session, axes, seconds, accelAt, { seed = 7, gpsLatency = 0.3 } = {}) {
  const rnd = seededRandom(seed);
  let t = 0, v = 0, x = 0, lastGps = -1;
  const hist = [];
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    t += DT;
    let a = accelAt(t, v);
    v = Math.max(0, v + a * DT);
    if (v === 0 && a < 0) a = 0;
    x += v * DT;
    hist.push([t, v, x]);
    const { raw, wr } = sensorSample(axes, { a, yawRate: 0, lean: 0, leanRate: 0, v }, rnd);
    processSample(session, raw, wr, t);
    if (t - lastGps >= 1) {
      lastGps = t;
      const old = hist.find((h) => h[0] >= t - gpsLatency) || hist[0];
      const coords = { latitude: 40 + old[2] / 110574, longitude: -3, speed: old[1], accuracy: 4 };
      processGpsFix(session, coords, (t - gpsLatency) * 1000, t, t * 1000);
    }
  }
  return hist;
}

/** Instante (interpolado) en que la serie [t, v] alcanza `target` subiendo o bajando. */
export function timeWhen(hist, target, rising = true) {
  for (let i = 1; i < hist.length; i++) {
    const [t0, v0] = hist[i - 1], [t1, v1] = hist[i];
    if (rising ? v0 < target && v1 >= target : v0 > target && v1 <= target) return t0 + ((t1 - t0) * (target - v0)) / (v1 - v0);
  }
  return null;
}
