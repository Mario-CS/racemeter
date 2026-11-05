// Estimación de la velocidad: combina el GPS (1 vez por segundo, con retraso) con el
// acelerómetro (60 veces por segundo). Entre puntos GPS se integra la aceleración y cada
// punto GPS corrige el error, teniendo en cuenta el retraso con que llega.

import { G, clamp, haversine } from './util.js';

const FIX_MAX_AGE = 4;          // s: después se considera que no hay GPS
const GOOD_ACCURACY = 50;       // m: precisión mínima para fiarse (cronos, integración)
const GPS_GAIN = 0.6;           // cuánto corrige cada punto GPS (0..1)
const MAX_LATENCY = 1.5;        // s
const HISTORY_SECONDS = 3;
const STOP_SPEED = 0.3;         // m/s: GPS por debajo de esto + sin aceleración → parado
const STOP_MAX_G = 0.04;

export class SpeedEstimator {
  constructor() { this.reset(); }

  reset() {
    this.v = 0;              // velocidad estimada (m/s)
    this.vGps = null;        // última velocidad GPS (m/s)
    this.accuracy = null;    // última precisión GPS (m)
    this.lat = null; this.lon = null;
    this.fixT = -99;         // instante del último punto GPS
    this.dist = 0;           // distancia recorrida (m)
    this.hist = [];          // [t, v] para compensar el retraso del GPS
    this.prev = null;        // punto GPS anterior
  }

  hasFix(t) { return t - this.fixT < FIX_MAX_AGE; }
  isGood(t) { return this.hasFix(t) && this.accuracy != null && this.accuracy < GOOD_ACCURACY; }

  /** Velocidad estimada que había en el instante t (para comparar con un GPS retrasado). */
  speedAt(t) {
    const h = this.hist;
    for (let i = h.length - 1; i >= 0; i--) if (h[i][0] <= t) return h[i][1];
    return h.length ? h[0][1] : this.v;
  }

  /** Avanza la estimación con la aceleración longitudinal (G) del acelerómetro. */
  predict(lonG, dt, t) {
    if (this.isGood(t)) {
      this.v = Math.max(0, this.v + lonG * G * dt);
      this.dist += this.v * dt;
    }
    this.hist.push([t, this.v]);
    while (this.hist.length && this.hist[0][0] < t - HISTORY_SECONDS) this.hist.shift();
  }

  /**
   * Incorpora un punto GPS.
   * @param {{latitude,longitude,speed,accuracy}} coords
   * @param {number} timestamp  ms (época) en que se tomó el punto
   * @param {number} t          instante actual (s, reloj de la app)
   * @param {number} nowMs      instante actual (ms, época)
   * @param {boolean} sensorsLive  si llegan datos del acelerómetro
   * @param {number} smoothedLonG  G longitudinal suavizada (para detectar parada)
   * @returns {null|{dt:number, aG:number}}  si no hay acelerómetro, datos para cronometrar solo con GPS
   */
  correct(coords, timestamp, t, nowMs, sensorsLive, smoothedLonG = 0) {
    let sp = coords.speed;
    if (sp == null || !(sp >= 0)) {
      // El iPhone no siempre da velocidad: se calcula con la distancia si supera el error de posición.
      sp = 0;
      if (this.prev) {
        const d = haversine(this.prev.lat, this.prev.lon, coords.latitude, coords.longitude);
        const dtf = (timestamp - this.prev.ts) / 1000;
        if (dtf > 0 && d > (coords.accuracy || 10)) sp = d / dtf;
      }
    }
    const wasGood = this.isGood(t);
    this.vGps = sp; this.accuracy = coords.accuracy;
    this.lat = coords.latitude; this.lon = coords.longitude;
    this.fixT = t;

    let gpsOnly = null;
    if (sensorsLive && wasGood) {
      const age = clamp((nowMs - timestamp) / 1000, 0, MAX_LATENCY);
      this.v = Math.max(0, this.v + (sp - this.speedAt(t - age)) * GPS_GAIN);
      if (sp < STOP_SPEED && Math.abs(smoothedLonG) < STOP_MAX_G) this.v = 0;
    } else {
      const prevV = this.v;
      this.v = sp;
      if (!sensorsLive && this.prev) {
        const dt = Math.max(0.2, t - this.prev.t);
        this.dist += sp * dt;
        gpsOnly = { dt, aG: (sp - prevV) / dt / G };
      }
    }
    this.prev = { lat: coords.latitude, lon: coords.longitude, ts: timestamp, t };
    return gpsOnly;
  }
}
