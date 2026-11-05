// Pruebas de la fusión de sensores: calibración, G sin GPS y autodetección de convenciones.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { G, D2R, scale, add, cross, normalize } from '../js/util.js';
import { MotionFusion, defaultSigns } from '../js/fusion.js';
import { mountAxes } from '../js/demo.js';

const DT = 1 / 60;

test('se calibra sola la primera vez que el móvil está quieto', () => {
  const f = new MotionFusion();
  let auto = null;
  f.events.calibrated = (cal, isAuto) => { auto = isAuto; };
  let t = 0;
  for (let i = 0; i < 150; i++) f.update([0, 9.81, 0], [0, 0, 0], DT, (t += DT));
  assert.equal(f.calibrated, true);
  assert.equal(auto, true);
});

test('G lateral sin GPS: sale del acelerómetro (antes daba siempre 0)', () => {
  const f = new MotionFusion({ calibration: { graw: [0, 9.81, 0], fwdraw: null }, learnSigns: false });
  let t = 0;
  // móvil vertical mirando al piloto: izquierda de la moto = −x del móvil → +x es la derecha
  for (let i = 0; i < 90; i++) f.update([3, 9.81, 0], [0, 0, 0], DT, (t += DT), { speed: 0, gpsGood: false });
  assert.ok(Math.abs(f.latGs - 3 / G) < 0.01, `lateral ${f.latGs.toFixed(3)} G (esperado +0,31)`);
  for (let i = 0; i < 90; i++) f.update([-3, 9.81, 0], [0, 0, 0], DT, (t += DT), { speed: 0, gpsGood: false });
  assert.ok(Math.abs(f.latGs + 3 / G) < 0.01, `lateral ${f.latGs.toFixed(3)} G (esperado −0,31)`);
});

test('G longitudinal: acelerar es positivo y frenar negativo', () => {
  const { U, F } = mountAxes();
  const f = new MotionFusion({ calibration: { graw: scale(U, G), fwdraw: null }, learnSigns: false });
  let t = 0;
  for (let i = 0; i < 90; i++) f.update(add(scale(U, G), scale(F, 5)), [0, 0, 0], DT, (t += DT));
  assert.ok(Math.abs(f.lonGs - 5 / G) < 0.01, `acelerando ${f.lonGs.toFixed(3)} G`);
  for (let i = 0; i < 90; i++) f.update(add(scale(U, G), scale(F, -8)), [0, 0, 0], DT, (t += DT));
  assert.ok(Math.abs(f.lonGs + 8 / G) < 0.01, `frenando ${f.lonGs.toFixed(3)} G`);
});

test('detecta un acelerómetro con el signo invertido', () => {
  // Móvil vertical (beta = 90°): la norma dice gravedad = +y; un navegador "invertido" da −y.
  const f = new MotionFusion();
  let t = 0;
  for (let i = 0; i < 400; i++) {
    t += DT;
    f.setOrientation(90 * D2R, 0, t);
    f.update([0, -9.81, 0], [0, 0, 0], DT, t);
  }
  assert.equal(f.signs.acc, -1);
});

/** Móvil girando en la mano: la gravedad vista desde el móvil cumple du/dt = u × ω. */
function spinPhone(f, map) {
  let u = [0, 1, 0], t = 0;
  for (let i = 0; i < 900; i++) {
    t += DT;
    const w = [2 * Math.sin(t * 1.1), 2 * Math.cos(t * 1.7), 1.5 * Math.sin(t * 0.7 + 1)];   // rad/s (x, y, z)
    u = normalize(add(u, scale(cross(u, w), DT)));
    f.update(scale(u, G), map(w), DT, t);
  }
}

test('reconoce el giroscopio según la norma (alpha=z, beta=x, gamma=y)', () => {
  const f = new MotionFusion({ autoCalibrate: false });
  spinPhone(f, (w) => [w[2], w[0], w[1]]);
  assert.equal(f.signs.gmap, 0);
  assert.equal(f.signs.gsign, 1);
  assert.equal(f.signs.gdone, true);
});

test('reconoce un giroscopio con otros ejes y signo invertido', () => {
  const f = new MotionFusion({ autoCalibrate: false });
  spinPhone(f, (w) => [-w[0], -w[1], -w[2]]);   // alpha=x, beta=y, gamma=z, todo al revés
  assert.equal(f.signs.gmap, 1);
  assert.equal(f.signs.gsign, -1);
});

test('invertir izquierda/derecha cambia el signo de la inclinación y la G lateral', () => {
  const f = new MotionFusion({ calibration: { graw: [0, 9.81, 0], fwdraw: null }, learnSigns: false, flipLat: true });
  let t = 0;
  for (let i = 0; i < 90; i++) f.update([3, 9.81, 0], [0, 0, 0], DT, (t += DT));
  assert.ok(f.latGs < -0.3, `con inversión la G lateral debería ser negativa (${f.latGs.toFixed(3)})`);
});

test('las convenciones por defecto son las de la norma', () => {
  assert.deepEqual(defaultSigns(), { acc: 1, accConf: 0, gmap: 0, gsign: 1, gconf: [0, 0], gn: 0, gdone: false });
});
