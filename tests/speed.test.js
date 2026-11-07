// Pruebas del GPS: los puntos imposibles no deben colarse en la velocidad ni en los máximos.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeedEstimator } from '../js/speed.js';
import { kmh } from './helpers.js';

const M_PER_DEG = 110574;   // m por grado de latitud

/**
 * Un punto GPS cada segundo; `speed` null como cuando el iPhone no da la velocidad.
 * Devuelve la velocidad más alta que llegó a dar la estimación (lo que acabaría en los máximos).
 */
function feed(est, points, sensorsLive = false) {
  let t = 0, top = 0;
  for (const [x, speed, accuracy = 5] of points) {
    t += 1;
    est.correct({ latitude: 40 + x / M_PER_DEG, longitude: -3, speed, accuracy }, t * 1000, t, t * 1000, sensorsLive);
    top = Math.max(top, est.v);
  }
  return top;
}

test('un salto de posición al recuperar la señal no da una velocidad imposible', () => {
  const est = new SpeedEstimator();
  // parado, y de repente la posición salta 1,7 km en un segundo (punto por wifi/antenas)
  const top = feed(est, [[0, null], [0, null], [0, null], [1760, null, 30], [1762, null, 10]]);
  assert.ok(top < kmh(20), `llegó a ${(top * 3.6).toFixed(0)} km/h`);
  assert.ok(est.rejected >= 1);
});

test('descarta una velocidad GPS absurda', () => {
  const est = new SpeedEstimator();
  const top = feed(est, [[0, kmh(50)], [14, kmh(50)], [28, kmh(6345)], [42, kmh(50)]]);
  assert.ok(top < kmh(51), `llegó a ${(top * 3.6).toFixed(0)} km/h`);
});

test('descarta un cambio de velocidad que ninguna moto puede hacer', () => {
  const est = new SpeedEstimator();
  const top = feed(est, [[0, kmh(60)], [17, kmh(60)], [34, kmh(250)], [51, kmh(62)]]);   // +190 km/h en 1 s
  assert.ok(top < kmh(63), `llegó a ${(top * 3.6).toFixed(0)} km/h`);
});

test('acepta una aceleración fuerte de verdad (1,2 G)', () => {
  const est = new SpeedEstimator();
  const a = 1.2 * 9.81;
  feed(est, [0, 1, 2, 3, 4].map((s) => [0.5 * a * s * s, a * s]));
  assert.equal(est.rejected, 0);
  assert.ok(Math.abs(est.v - 4 * a) < 0.01);
});
