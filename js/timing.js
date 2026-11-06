// Cronometraje automático: salida parada (0-50…0-200, 100/201/402 m), recuperaciones
// (60-100, 80-120, 100-200, más las que elija el usuario) y frenada 100-0. Recibe la velocidad muestra a muestra y avisa
// con eventos. No depende del navegador.

import { KMH, crossingTime } from './util.js';

export const SPEED_TARGETS = [50, 100, 150, 200];                                  // km/h
export const DIST_TARGETS = [[100, '100 m'], [201.168, '201 m'], [402.336, '402 m']];  // m (1/8 y 1/4 de milla)
export const ROLL_INTERVALS = [[60, 100], [80, 120], [100, 200]];                   // km/h
export const CUSTOM_MAX = 6;                                                        // intervalos personalizados
const CUSTOM_TOP_KMH = 300;
const CUSTOM_MIN_GAP = 5;       // km/h mínimos entre el inicio y el final

const ARM_MAX_KMH = 2;          // parado por debajo de esto
const ARM_STILL_TIME = 1;       // s parado para armar el crono
const CALM_G = 0.04;            // por debajo: aún no ha arrancado
const LAUNCH_G = 0.12;          // por encima (varias muestras): ha arrancado
const LAUNCH_SAMPLES = 4;
const LAUNCH_KMH = 4;           // o ya va a más de esto
const CALM_LOOKBACK = 3;        // s máximos entre la última calma y el arranque
const CREEP_TIMEOUT = 2;        // s moviéndose despacio sin arrancar → desarmar
const FALSE_START_TIME = 3;     // s
const FALSE_START_KMH = 6;
const LIFT_KMH = 15;            // si cae esto por debajo del máximo, la pasada ha terminado
const MAX_RUN_TIME = 120;       // s
const ROLL_DROP_KMH = 3;        // margen para anular una recuperación
const ROLL_TIMEOUT = 60;
const BRAKE_FROM_KMH = 100;
const BRAKE_ABORT_KMH = 103;
const BRAKE_TIMEOUT = 20;
const BRAKE_MIN_TIME = 0.8;
const HISTORY_MAX = 100;

/**
 * Lee un intervalo personalizado escrito por el usuario ("20-120", "20 120", "20 a 120").
 * Devuelve {interval: [desde, hasta]} o {error: 'texto para el usuario'}.
 */
export function parseInterval(text, existing = []) {
  const m = String(text || '').trim().match(/^(\d{1,3})\s*(?:-|–|a|\s)\s*(\d{1,3})(?:\s*km\/?h)?$/i);
  if (!m) return { error: 'Escríbelo así: 20-120' };
  const a = +m[1], b = +m[2];
  if (b <= a) return { error: 'La velocidad final tiene que ser mayor que la inicial' };
  if (b > CUSTOM_TOP_KMH) return { error: `Como mucho ${CUSTOM_TOP_KMH} km/h` };
  if (b - a < CUSTOM_MIN_GAP) return { error: `Deja al menos ${CUSTOM_MIN_GAP} km/h entre las dos velocidades` };
  const key = `${a}-${b}`;
  const builtIn = ROLL_INTERVALS.some(([x, y]) => `${x}-${y}` === key) || (a === 0 && SPEED_TARGETS.includes(b));
  if (builtIn) return { error: `El ${key} ya se mide siempre` };
  if (existing.some(([x, y]) => `${x}-${y}` === key)) return { error: `Ya tienes el ${key}` };
  if (existing.length >= CUSTOM_MAX) return { error: `Como mucho ${CUSTOM_MAX} intervalos personalizados` };
  return { interval: [a, b] };
}

export class PerfTimer {
  /**
   * @param {object} o
   * @param {object} o.records  {bests, lastRes, last, hist} guardados
   * @param {(key:string, value:any)=>void} o.save  guarda un registro (no se llama en modo demo)
   * @param {(ev:object)=>void} o.onEvent  'run' | 'roll' | 'brake' | 'split'
   * @param {number[][]} o.custom  intervalos personalizados [[desde, hasta], …] en km/h
   */
  constructor({ records = {}, save = () => {}, onEvent = () => {}, custom = [] } = {}) {
    this.save = save;
    this.onEvent = onEvent;
    this.demo = false;           // en demo no se guardan récords
    this.custom = custom;
    this.loadRecords(records);
    this.resetState();
  }

  loadRecords({ bests = {}, lastRes = {}, last = null, hist = [] } = {}) {
    this.bests = bests; this.lastRes = lastRes; this.last = last; this.hist = hist;
  }

  resetState() {
    this.state = 'wait';         // 'wait' → 'armed' → 'run'
    this.stillSince = null; this.calmT = 0; this.launchCount = 0; this.creepSince = null;
    this.t0 = 0; this.d = 0; this.peak = 0; this.res = null;
    this.pk = null; this.pt = null;                // km/h y t de la muestra anterior
    this.lastSplitT = -99;
    this.rolls = {};
    this.setCustomIntervals(this.custom);
    this.brake = { on: false, t: 0, d: 0 };
  }

  /**
   * Cambia los intervalos personalizados. Los que empiezan en 0 se miden dentro de la salida
   * parada (desde que arranca); el resto, como las recuperaciones (al pasar por la velocidad inicial).
   */
  setCustomIntervals(list) {
    this.custom = list.map(([a, b]) => [a, b]);
    const rolls = {};
    for (const [a, b] of [...ROLL_INTERVALS, ...this.custom]) {
      if (a <= 0) continue;
      const key = `${a}-${b}`;
      rolls[key] = this.rolls[key] || { a, b, on: false, tA: 0 };
    }
    this.rolls = rolls;
  }

  clearRecords() {
    this.loadRecords({});
    for (const k of ['hist', 'bests', 'lastRes', 'lastRun']) this.save(k, k === 'hist' ? [] : k === 'lastRun' ? null : {});
  }

  _persist(key, value) { if (!this.demo) this.save(key, value); }

  _setBest(key, time, extra) {
    if (this.demo) return false;
    const b = this.bests[key];
    if (!b || time < b.t) {
      this.bests[key] = { t: time, date: Date.now(), ...extra };
      this._persist('bests', this.bests);
      return true;
    }
    return false;
  }

  /**
   * @param {number} t   instante (s)
   * @param {number} v   velocidad (m/s)
   * @param {number} aG  aceleración longitudinal (G)
   * @param {number} dt  s desde la muestra anterior
   * @param {boolean} highRate  true si viene del acelerómetro (60 Hz), false si solo GPS (1 Hz)
   */
  tick(t, v, aG, dt, highRate) {
    const k = v * KMH;
    const pk = this.pk == null ? k : this.pk;
    const pt = this.pt == null ? t : this.pt;
    this.pk = k; this.pt = t;

    if (this.state === 'wait') this._wait(t, k);
    else if (this.state === 'armed') this._armed(t, k, pk, pt, aG, highRate);
    else if (this.state === 'run') this._run(t, k, pk, pt, dt);

    this._rolling(t, k, pk, pt);
    this._braking(t, k, pk, pt, dt);
  }

  _wait(t, k) {
    if (k < ARM_MAX_KMH) {
      if (this.stillSince == null) this.stillSince = t;
      if (t - this.stillSince > ARM_STILL_TIME) {
        this.state = 'armed'; this.calmT = t; this.launchCount = 0; this.creepSince = null;
      }
    } else this.stillSince = null;
  }

  _armed(t, k, pk, pt, aG, highRate) {
    if (aG < CALM_G) this.calmT = t;
    this.launchCount = aG > LAUNCH_G ? this.launchCount + 1 : 0;
    if ((highRate && this.launchCount >= LAUNCH_SAMPLES) || k > LAUNCH_KMH) {
      // El crono empieza en el último instante "en calma" antes de acelerar
      let t0;
      if (highRate) t0 = t - this.calmT < CALM_LOOKBACK ? this.calmT : crossingTime(pt, pk, t, k, 1);
      else t0 = Math.max(pt - 1, crossingTime(pt, pk, t, k, 0));
      this.state = 'run'; this.t0 = t0; this.d = 0; this.peak = k;
      this.res = { date: Date.now(), spd: {}, dst: {}, peak: k, demo: this.demo || undefined };
    } else if (k >= ARM_MAX_KMH) {
      if (this.creepSince == null) this.creepSince = t;
      if (t - this.creepSince > CREEP_TIMEOUT) { this.state = 'wait'; this.stillSince = null; }
    } else this.creepSince = null;
  }

  _run(t, k, pk, pt, dt) {
    const elapsed = t - this.t0, d0 = this.d;
    this.d += ((pk + k) / 2 / KMH) * dt;
    this.peak = Math.max(this.peak, k);
    const r = this.res;
    r.peak = this.peak;
    for (const s of SPEED_TARGETS) {
      const key = '0-' + s;
      if (r.spd[key] == null && pk < s && k >= s) { r.spd[key] = crossingTime(pt, pk, t, k, s) - this.t0; this.lastSplitT = t; }
    }
    for (const [m, name] of DIST_TARGETS) {
      if (!r.dst[name] && d0 < m && this.d >= m) {
        const f = (m - d0) / (this.d - d0);
        r.dst[name] = { t: pt + (t - pt) * f - this.t0, v: pk + (k - pk) * f };
        this.lastSplitT = t;
      }
    }
    for (const [a, b] of this.custom) {
      const key = `${a}-${b}`;
      if (a <= 0 && r.spd[key] == null && pk < b && k >= b) {
        r.spd[key] = crossingTime(pt, pk, t, k, b) - this.t0;
        this.lastSplitT = t;
        this._rollDone(key, r.spd[key]);
      }
    }
    if (elapsed > FALSE_START_TIME && this.peak < FALSE_START_KMH) { this.state = 'wait'; this.stillSince = null; this.res = null; return; }
    const done = r.spd['0-200'] != null && r.dst['402 m'];
    if (k < this.peak - LIFT_KMH || elapsed > MAX_RUN_TIME || (k < 1 && elapsed > 2) || done) this._finishRun(t);
  }

  _finishRun(t) {
    const r = this.res;
    this.state = 'wait'; this.stillSince = null; this.res = null;
    if (!r || (!Object.keys(r.spd).length && !Object.keys(r.dst).length)) return;
    r.date = Date.now();
    this.last = r;
    let newBest = false;
    const custom = new Set(this.custom.map(([a, b]) => `${a}-${b}`));   // esos ya se guardaron al pasar
    for (const [k, v] of Object.entries(r.spd)) if (!custom.has(k)) newBest = this._setBest(k, v) || newBest;
    for (const [k, v] of Object.entries(r.dst)) newBest = this._setBest(k, v.t, { v: v.v }) || newBest;
    this.hist.unshift(r);
    this.hist = this.hist.slice(0, HISTORY_MAX);
    this._persist('lastRun', r);
    this._persist('hist', this.hist);
    this.lastSplitT = t;
    this.onEvent({ type: 'run', run: r, newBest });
  }

  _rolling(t, k, pk, pt) {
    for (const [key, r] of Object.entries(this.rolls)) {
      const { a, b } = r;
      if (!r.on) {
        if (pk < a && k >= a) { r.on = true; r.tA = crossingTime(pt, pk, t, k, a); }
      } else if (k < a - ROLL_DROP_KMH || t - r.tA > ROLL_TIMEOUT) {
        r.on = false;
      } else if (pk < b && k >= b) {
        r.on = false;
        this._rollDone(key, crossingTime(pt, pk, t, k, b) - r.tA);
      }
    }
  }

  _rollDone(key, time) {
    this.lastRes[key] = { t: time, date: Date.now(), demo: this.demo || undefined };
    this._persist('lastRes', this.lastRes);
    const newBest = this._setBest(key, time);
    this.onEvent({ type: 'roll', key, time, newBest });
  }

  _braking(t, k, pk, pt, dt) {
    const b = this.brake;
    if (!b.on) {
      if (pk >= BRAKE_FROM_KMH && k < BRAKE_FROM_KMH) Object.assign(b, { on: true, t: crossingTime(pt, pk, t, k, BRAKE_FROM_KMH), d: 0 });
      return;
    }
    b.d += ((pk + k) / 2 / KMH) * dt;
    if (k > BRAKE_ABORT_KMH || t - b.t > BRAKE_TIMEOUT) { b.on = false; return; }
    if (k < 1) {
      b.on = false;
      const tEnd = k <= 0 ? crossingTime(pt, pk, t, k, 0) : t;
      const res = { t: tEnd - b.t, d: b.d };
      if (res.t <= BRAKE_MIN_TIME) return;
      this.lastRes['100-0'] = { date: Date.now(), demo: this.demo || undefined, ...res };
      this._persist('lastRes', this.lastRes);
      let newBest = false;
      const best = this.bests['100-0'];
      if (!this.demo && (!best || res.d < best.d)) {        // la mejor frenada es la más corta
        this.bests['100-0'] = { date: Date.now(), ...res };
        this._persist('bests', this.bests);
        newBest = true;
      }
      this.onEvent({ type: 'brake', ...res, newBest });
    }
  }
}
