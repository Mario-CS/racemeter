// Fusión de sensores de movimiento: a partir del acelerómetro y el giroscopio del móvil
// calcula el ángulo de inclinación, el cabeceo y las fuerzas G de la moto.
// No depende del navegador: recibe muestras y devuelve resultados (se puede probar en Node).
//
// Ejes del móvil (convención W3C): x a la derecha de la pantalla, y hacia arriba, z saliendo
// de la pantalla. Tras calibrar se obtienen los ejes de la moto expresados en ejes del móvil:
//   U = arriba, F = adelante, L = izquierda  (U × F = L)

import { G, R2D, dot, cross, len, scale, add, sub, normalize, perpTo, clamp, lowPass } from './util.js';

/* ---------- parámetros ---------- */
const ACC_LOWPASS = 0.25;          // suavizado de la gravedad medida (por muestra)
const G_SMOOTH_TAU = 0.12;         // s, suavizado de las G que se muestran
const FUSION_TAU = 0.8;            // s, cuánto tarda la referencia en corregir al giroscopio
const QUIET_LINEAR_G = 0.05;       // por debajo de esto no hay aceleración apreciable
const QUIET_NORM_ERR = 0.3;        // m/s², |aceleración| ≈ g
const STILL_GYRO = 0.08;           // rad/s
const STILL_TIME = 0.6;            // s quieto para fiarse del acelerómetro (p.ej. en una cuesta)
const MOTO_REF_MIN_SPEED = 4;      // m/s: por encima, la referencia es la física de la curva
const LAT_PHYSICS_MIN_SPEED = 2;   // m/s: por encima (y con GPS), G lateral = v·ω/g
const MAX_LEAN_REF = 1.25;         // rad (~72°)

const CALIB_TIME = 2;              // s de quietud para calibrar
const CALIB_MAX_GYRO = 0.35;       // rad/s
const CALIB_MAX_NORM_ERR = 1.2;    // m/s²
const AUTO_CALIB_TIME = 1.5;       // s quieto para la calibración automática inicial
const AUTO_CALIB_MAX_GYRO = 0.15;
const AUTO_CALIB_MAX_NORM_ERR = 0.5;

const FWD_MIN_G = 0.12;            // aceleración horizontal mínima para detectar "adelante"
const FWD_TIME = 1.2;              // s acumulados de aceleración
const FWD_TIMEOUT = 90;            // s

// Autodetección de convenciones (no todos los navegadores siguen la norma igual)
const ACC_SIGN_SAMPLES = 300;
const GYRO_DECIDE_SAMPLES = 120;
const GYRO_DONE_SAMPLES = 600;
// Posibles asignaciones de rotationRate [alpha, beta, gamma] a los ejes [x, y, z]
const GYRO_AXIS_MAPS = [[1, 2, 0], [0, 1, 2]];
export const GYRO_MAP_NAMES = ['spec', 'alt'];

export const defaultSigns = () => ({ acc: 1, accConf: 0, gmap: 0, gsign: 1, gconf: [0, 0], gn: 0, gdone: false });

export class MotionFusion {
  /**
   * @param {object} o
   * @param {object|null} o.calibration  {graw:[x,y,z], fwdraw:[x,y,z]|null}
   * @param {object} o.signs             convenciones aprendidas del dispositivo
   * @param {boolean} o.learnSigns       aprender las convenciones a partir de los datos
   * @param {boolean} o.autoCalibrate    calibrarse sola la primera vez que el móvil esté quieto
   */
  constructor({ calibration = null, signs = defaultSigns(), learnSigns = true, autoCalibrate = true, flipFwd = false, flipLat = false } = {}) {
    this.cal = calibration;
    this.signs = { ...defaultSigns(), ...signs };
    this.learnSigns = learnSigns;
    this.autoCalibrate = autoCalibrate;
    this.flipFwd = flipFwd;
    this.flipLat = flipLat;
    this.events = {};            // calibrated(cal, auto), calibrationProgress(p, moving), forwardDetected(cal), forwardFailed(), signsLearned(signs)

    // salidas
    this.roll = 0;               // rad, + = tumbada a la derecha
    this.pitchRad = 0;           // rad, + = morro arriba
    this.lean = 0;               // grados (con el ajuste de inversión aplicado)
    this.pitch = 0;              // grados
    this.lonG = 0; this.latG = 0;            // G instantáneas
    this.lonGs = 0; this.latGs = 0;          // G suavizadas (las que se muestran)

    this._accLp = null;
    this._prevUp = null;
    this._orient = null;
    this._stillT = 0;
    this._autoT = 0;
    this._calib = { active: false, t0: 0, sum: [0, 0, 0], n: 0 };
    this._fwd = { active: false, sum: [0, 0, 0], T: 0, n: 0, t0: 0 };
    this._computeAxes();
  }

  get calibrated() { return !!this.axes; }
  get calibrating() { return this._calib.active; }
  get detectingForward() { return this._fwd.active; }

  _emit(name, ...args) { const f = this.events[name]; if (f) f(...args); }

  setFlips({ flipFwd = this.flipFwd, flipLat = this.flipLat }) {
    this.flipFwd = flipFwd; this.flipLat = flipLat;
    this._computeAxes();
  }

  setCalibration(cal) { this.cal = cal; this._computeAxes(); this.resetAttitude(); }
  resetAttitude() { this.roll = this.pitchRad = 0; this.lonGs = this.latGs = 0; }
  resetSigns() { this.signs = defaultSigns(); this._prevUp = null; this._computeAxes(); }

  /** Orientación absoluta del navegador (deviceorientation), solo para autodetectar el signo del acelerómetro. */
  setOrientation(betaRad, gammaRad, t) { this._orient = { b: betaRad, g: gammaRad, t }; }

  /** Ejes de la moto en coordenadas del móvil a partir de la calibración. */
  _computeAxes() {
    if (!this.cal) { this.axes = null; return; }
    const g = scale(this.cal.graw, this.signs.acc);
    const U = normalize(g);
    let F = null;
    if (this.cal.fwdraw) {
      const f = perpTo(scale(this.cal.fwdraw, this.signs.acc), U);
      if (len(f) > 0.2) F = normalize(f);
    }
    if (!F) {
      // Por defecto: pantalla mirando al piloto → adelante es la parte trasera del móvil (−z).
      // Si el móvil va tumbado, adelante es la parte de arriba (+y).
      let f = perpTo([0, 0, -1], U);
      if (len(f) < 0.45) f = perpTo([0, 1, 0], U);
      F = normalize(f);
    }
    if (this.flipFwd) F = scale(F, -1);
    this.axes = { U, F, L: cross(U, F), g };
  }

  /* ---------- calibración ---------- */
  startCalibration(t) { Object.assign(this._calib, { active: true, t0: t, sum: [0, 0, 0], n: 0 }); }
  cancelCalibration() { this._calib.active = false; }

  _calibStep(raw, w, t) {
    const c = this._calib;
    if ((w && len(w) > CALIB_MAX_GYRO) || Math.abs(len(raw) - G) > CALIB_MAX_NORM_ERR) {
      Object.assign(c, { t0: t, sum: [0, 0, 0], n: 0 });
      this._emit('calibrationProgress', 0, true);
      return;
    }
    c.sum = add(c.sum, raw); c.n++;
    const p = Math.min(1, (t - c.t0) / CALIB_TIME);
    this._emit('calibrationProgress', p, false);
    if (p >= 1 && c.n > 20) {
      c.active = false;
      this.flipFwd = false;
      this.setCalibration({ graw: scale(c.sum, 1 / c.n), fwdraw: null });
      this._emit('calibrated', this.cal, false);
    }
  }

  _autoCalibStep(raw, w, dt) {
    if (!this.autoCalibrate || this._calib.active) return;
    if ((!w || len(w) < AUTO_CALIB_MAX_GYRO) && Math.abs(len(raw) - G) < AUTO_CALIB_MAX_NORM_ERR) {
      this._autoT += dt;
      if (this._autoT > AUTO_CALIB_TIME) {
        this.setCalibration({ graw: this._accLp.slice(), fwdraw: null, auto: true });
        this._emit('calibrated', this.cal, true);
      }
    } else this._autoT = 0;
  }

  /* ---------- detección de la dirección de marcha (acelerando en recta) ---------- */
  startForwardDetection(t) { Object.assign(this._fwd, { active: true, sum: [0, 0, 0], T: 0, n: 0, t0: t }); }

  _forwardStep(lin, U, dt, t) {
    const d = this._fwd;
    if (t - d.t0 > FWD_TIMEOUT) { d.active = false; this._emit('forwardFailed'); return; }
    const h = perpTo(lin, U);
    if (len(h) / G > FWD_MIN_G) {
      if (d.n > 10 && dot(normalize(h), normalize(d.sum)) < 0.6) return;   // descarta giros/frenadas
      d.sum = add(d.sum, h); d.n++; d.T += dt;
    }
    if (d.T >= FWD_TIME) {
      d.active = false;
      this.flipFwd = false;
      this.cal = { ...this.cal, fwdraw: scale(normalize(d.sum), this.signs.acc) };
      this._computeAxes();
      this._emit('forwardDetected', this.cal);
    }
  }

  /* ---------- autodetección de convenciones del dispositivo ---------- */
  _learnSigns(raw, wr, dt, t) {
    const s = this.signs;
    const m = len(raw);
    // 1) Signo del acelerómetro: comparar la gravedad medida con el "arriba" que da deviceorientation.
    const o = this._orient;
    if (o && t - o.t < 0.5 && Math.abs(s.accConf) < ACC_SIGN_SAMPLES && Math.abs(m - G) < 0.8 && (!wr || len(wr) < 0.3)) {
      const up = [-Math.sin(o.g) * Math.cos(o.b), Math.sin(o.b), Math.cos(o.g) * Math.cos(o.b)];
      const d = dot(normalize(raw), up);
      if (Math.abs(d) > 0.8) {
        s.accConf += Math.sign(d);
        const sign = s.accConf >= 0 ? 1 : -1;
        if (sign !== s.acc) { s.acc = sign; this._computeAxes(); }
        if (Math.abs(s.accConf) >= ACC_SIGN_SAMPLES) this._emit('signsLearned', s);
      }
    }
    // 2) Ejes y signo del giroscopio: la gravedad vista desde el móvil cumple du/dt = u × ω.
    if (wr && !s.gdone) {
      const u = normalize(this._accLp);
      if (this._prevUp) {
        const du = scale(sub(u, this._prevUp), 1 / dt);
        const wl = len(wr);
        if (wl > 0.6 && Math.abs(m - G) < 2.5) {
          GYRO_AXIS_MAPS.forEach((mp, k) => {
            const w = [wr[mp[0]], wr[mp[1]], wr[mp[2]]];
            s.gconf[k] += clamp(dot(du, cross(u, w)) / (wl * wl), -1.5, 1.5);
          });
          s.gn++;
          if (s.gn >= GYRO_DECIDE_SAMPLES) {
            const a0 = Math.abs(s.gconf[0]), a1 = Math.abs(s.gconf[1]);
            s.gmap = a1 > a0 * 1.4 ? 1 : 0;
            s.gsign = s.gconf[s.gmap] >= 0 ? 1 : -1;
            if (s.gn >= GYRO_DONE_SAMPLES) { s.gdone = true; this._emit('signsLearned', s); }
          }
        }
      }
      this._prevUp = u;
    }
  }

  /**
   * Procesa una muestra.
   * @param {number[]} raw  accelerationIncludingGravity [x,y,z] (m/s²)
   * @param {number[]|null} wr  rotationRate [alpha,beta,gamma] (rad/s)
   * @param {number} dt  s desde la muestra anterior
   * @param {number} t   instante actual (s)
   * @param {{speed:number, gpsGood:boolean}} ctx  velocidad estimada (m/s) y si el GPS es fiable
   * @returns {boolean} true si hay resultados (está calibrado)
   */
  update(raw, wr, dt, t, { speed = 0, gpsGood = false } = {}) {
    this._accLp = this._accLp ? add(this._accLp, scale(sub(raw, this._accLp), ACC_LOWPASS)) : raw.slice();
    if (this.learnSigns) this._learnSigns(raw, wr, dt, t);

    const mp = GYRO_AXIS_MAPS[this.signs.gmap];
    const w = wr ? scale([wr[mp[0]], wr[mp[1]], wr[mp[2]]], this.signs.gsign) : null;

    if (this._calib.active) this._calibStep(raw, w, t);
    if (!this.axes) { this._autoCalibStep(raw, w, dt); return false; }

    const { U, F, L, g } = this.axes;
    const acc = scale(raw, this.signs.acc);
    const lin = sub(acc, g);                          // aceleración de la moto (m/s²) en ejes del móvil
    if (this._fwd.active) this._forwardStep(lin, U, dt, t);

    const lonG = dot(lin, F) / G;
    const up = normalize(scale(this._accLp, this.signs.acc));   // "arriba" medido por el acelerómetro
    const rollAcc = Math.atan2(dot(up, L), dot(up, U));
    const pitchAcc = Math.atan2(dot(up, F), dot(up, U));
    const horizG = Math.hypot(dot(lin, F), dot(lin, L)) / G;
    const v = speed;

    let yawRate = 0;
    if (w) {
      // Velocidades angulares proyectadas a ejes "nivelados" según la inclinación actual
      const wU = dot(w, U), wL = dot(w, L), c = Math.cos(this.roll), s = Math.sin(this.roll);
      const rollRate = dot(w, F);
      const pitchRate = -wL * c + wU * s;            // morro arriba +
      yawRate = -(wU * c + wL * s);                  // giro respecto a la vertical real (derecha +)

      // Filtro complementario: el giroscopio da la forma y una referencia corrige la deriva.
      //  - En marcha: física de la curva, tan(lean) = v·ω/g.
      //  - Parado o sin aceleraciones: el acelerómetro.
      //  - Con aceleraciones y sin velocidad: solo giroscopio.
      const normOk = Math.abs(len(acc) - G) < QUIET_NORM_ERR;
      this._stillT = v < 0.3 && len(w) < STILL_GYRO && normOk ? this._stillT + dt : 0;
      const quiet = this._stillT > STILL_TIME || (horizG < QUIET_LINEAR_G && normOk);
      const kRef = Math.exp(-dt / FUSION_TAU);
      let rollRef = rollAcc, k = quiet ? kRef : 1;
      if (v > MOTO_REF_MIN_SPEED) { rollRef = clamp(Math.atan((v * yawRate) / G), -MAX_LEAN_REF, MAX_LEAN_REF); k = kRef; }
      this.roll = k * (this.roll + rollRate * dt) + (1 - k) * rollRef;
      const kp = quiet ? kRef : 1;
      this.pitchRad = kp * (this.pitchRad + pitchRate * dt) + (1 - kp) * pitchAcc;
    } else {
      this.roll = rollAcc; this.pitchRad = pitchAcc;
    }

    // G lateral: en marcha (con GPS) sale de velocidad × giro, porque al tumbar el acelerómetro
    // no la ve. Parado o sin GPS se usa el acelerómetro directamente.
    let latG = w && v > LAT_PHYSICS_MIN_SPEED && gpsGood ? (v * yawRate) / G : -dot(lin, L) / G;
    const sideSign = this.flipLat ? -1 : 1;
    latG *= sideSign;

    const a = lowPass(dt, G_SMOOTH_TAU);
    this.lonG = lonG; this.latG = latG;
    this.lonGs += (lonG - this.lonGs) * a;
    this.latGs += (latG - this.latGs) * a;
    this.lean = this.roll * R2D * sideSign;
    this.pitch = this.pitchRad * R2D;
    return true;
  }
}
