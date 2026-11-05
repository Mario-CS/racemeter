// Simulación de una moto dando vueltas a un circuito. Genera las mismas señales que daría
// el iPhone (acelerómetro, giroscopio y GPS) para el modo demo y para las pruebas automáticas.
// No depende del navegador.

import { G, D2R, R2D, scale, add, cross, normalize, perpTo } from './util.js';

/** Generador pseudoaleatorio con semilla (para que las pruebas den siempre lo mismo). */
export function seededRandom(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ejes de la moto vistos por un móvil montado en vertical, inclinado `betaDeg` hacia atrás. */
export function mountAxes(betaDeg = 72) {
  const b = betaDeg * D2R;
  const U = [0, Math.sin(b), Math.cos(b)];
  const F = normalize(perpTo([0, 0, -1], U));
  return { U, F, L: cross(U, F) };
}

/**
 * Señales de los sensores para un estado de la moto (convención W3C).
 * @param {{U,F,L}} axes
 * @param {{a:number, yawRate:number, lean:number, leanRate:number, v:number}} s
 *   a: aceleración (m/s²), yawRate: giro (rad/s, + derecha), lean: inclinación (rad, + derecha)
 * @returns {{raw:number[], wr:number[]}}  accelerationIncludingGravity y rotationRate [alpha,beta,gamma] (rad/s)
 */
export function sensorSample({ U, F, L }, { a, yawRate, lean, leanRate, v }, rnd = Math.random, noise = 1) {
  const up = add(scale(U, Math.cos(lean)), scale(L, Math.sin(lean)));       // vertical real vista desde la moto
  const right = add(scale(L, -Math.cos(lean)), scale(U, Math.sin(lean)));   // horizontal derecha real
  const f = add(add(scale(up, G), scale(F, a)), scale(right, v * yawRate));
  const w = add(scale(up, -yawRate), scale(F, leanRate));
  const n = (amp) => (rnd() - 0.5) * amp * noise;
  return {
    raw: [f[0] + n(0.4), f[1] + n(0.4), f[2] + n(0.4)],
    wr: [w[2] + n(0.02), w[0] + n(0.02), w[1] + n(0.02)],   // [alpha, beta, gamma] = [z, x, y]
  };
}

/**
 * Circuito cerrado: 4 curvas de 90° a derechas (R50) y 2 chicanes izquierda-derecha (R40).
 * Tramos: l = longitud (m), k = curvatura (1/m, + derecha), vc = velocidad de paso (m/s).
 */
export function buildCircuit() {
  const seg = [];
  const straight = (l) => seg.push({ l, k: 0 });
  const arc = (deg, r, dir, latG) => seg.push({ l: deg * D2R * r, k: dir / r, latG });
  const side = () => {
    straight(220); arc(45, 40, -1, 1.0); arc(45, 40, 1, 1.0);
    straight(220); arc(90, 50, 1, 1.15); straight(150); arc(90, 50, 1, 1.15);
  };
  side(); side();
  let s = 0;
  for (const g of seg) {
    g.s = s; s += g.l;
    if (g.k) g.vc = Math.sqrt((g.latG * G) / Math.abs(g.k));
  }
  return { seg, total: s };
}

const BRAKE = 9.3;            // m/s²
const TOP_SPEED = 78;         // m/s
const LOOKAHEAD = 400;        // m
const LEAN_TAU = 0.18;        // s, lo que tarda el piloto en tumbar

export class CircuitSim {
  constructor({ seed = 1, startDelay = 3, gpsLatency = 0.3, origin = { lat: 37.2306, lon: -1.2152 }, epochMs = Date.now(), noise = 1 } = {}) {
    this.rnd = seededRandom(seed);
    this.noise = noise;
    this.axes = mountAxes();
    this.circuit = buildCircuit();
    this.startDelay = startDelay;
    this.gpsLatency = gpsLatency;
    this.origin = origin;
    this.epochMs = epochMs;
    this.t = 0; this.pos = 0; this.v = 0; this.a = 0;
    this.x = 0; this.y = 0; this.heading = 0; this.lean = 0;
    this.hist = [];
    this.lastGps = -1;
  }

  _segmentAt(p) {
    const { seg } = this.circuit;
    const i = seg.findIndex((g) => p >= g.s && p < g.s + g.l);
    return i < 0 ? 0 : i;
  }

  /** Velocidad máxima permitida ahora para poder frenar a tiempo para las próximas curvas. */
  _allowedSpeed(i, p) {
    const { seg } = this.circuit;
    const cur = seg[i];
    let vAllow = TOP_SPEED;
    for (let j = 0, d = 0; j < seg.length && d < LOOKAHEAD; j++) {
      const g = seg[(i + j) % seg.length];
      const dist = j === 0 ? 0 : d;
      if (g.k) vAllow = Math.min(vAllow, Math.sqrt(g.vc * g.vc + 2 * BRAKE * dist));
      d += j === 0 ? cur.s + cur.l - p : g.l;
    }
    return vAllow;
  }

  /**
   * Avanza la simulación `dt` segundos.
   * @returns {{raw, wr, t, nowMs, gps: null|{coords, timestamp}}}
   */
  step(dt) {
    this.t += dt;
    const { seg, total } = this.circuit;
    const p = this.pos % total;
    const i = this._segmentAt(p);
    const cur = seg[i];
    const vAllow = this._allowedSpeed(i, p);

    let a = 0;
    if (this.t < this.startDelay) a = 0;
    else if (this.v > vAllow + 0.05) a = -BRAKE;
    else a = Math.min(Math.max(1.2, 8.8 - this.v * 0.1), (vAllow - this.v) / dt);
    this.v = Math.max(0, this.v + a * dt);
    this.pos += this.v * dt;
    this.a = a;

    // Trayectoria (geometría del circuito)
    const pathYaw = this.v * cur.k;
    this.heading += pathYaw * dt;
    this.x += this.v * Math.sin(this.heading) * dt;
    this.y += this.v * Math.cos(this.heading) * dt;

    // El piloto tumba con cierto retraso; en una moto real el giro es consecuencia de la
    // inclinación: ω = g·tan(φ)/v.
    const target = Math.atan((this.v * pathYaw) / G);
    const lean = this.lean + (target - this.lean) * (1 - Math.exp(-dt / LEAN_TAU));
    const leanRate = (lean - this.lean) / dt;
    this.lean = lean;
    const yawRate = this.v > 0.5 ? (G * Math.tan(lean)) / this.v : 0;

    const { raw, wr } = sensorSample(this.axes, { a, yawRate, lean, leanRate, v: this.v }, this.rnd, this.noise);

    // GPS: un punto por segundo, con el estado de hace `gpsLatency` segundos
    this.hist.push([this.t, this.v, this.x, this.y]);
    while (this.hist.length && this.hist[0][0] < this.t - 1.5) this.hist.shift();
    let gps = null;
    if (this.t - this.lastGps >= 1) {
      this.lastGps = this.t;
      const old = this.hist.find((h) => h[0] >= this.t - this.gpsLatency) || this.hist[0];
      const lat = this.origin.lat + old[3] / 110574;
      const lon = this.origin.lon + old[2] / (111320 * Math.cos(this.origin.lat * D2R));
      const speed = Math.max(0, old[1] + (old[1] > 0 ? (this.rnd() - 0.5) * 0.2 * this.noise : 0));
      gps = {
        coords: { latitude: lat, longitude: lon, speed, accuracy: 4, heading: this.heading * R2D },
        timestamp: this.epochMs + (this.t - this.gpsLatency) * 1000,
      };
    }
    return { raw, wr, t: this.t, nowMs: this.epochMs + this.t * 1000, gps };
  }

  /** Inclinación real en grados (para comprobar). */
  get leanDeg() { return this.lean * R2D; }
}
