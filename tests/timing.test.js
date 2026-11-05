// Pruebas de los cronómetros en línea recta: recuperaciones y frenada 100-0.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PerfTimer } from '../js/timing.js';
import { calibratedSession, runStraight, timeWhen, kmh } from './helpers.js';

const ACCEL = 6;     // m/s²
const BRAKE = 9;     // m/s²

// parado 3 s → acelera a 6 m/s² hasta 125 km/h → 2 s a velocidad constante → frena a 9 m/s²
function profile() {
  let phase = 0, cruiseT = 0;
  return (t, v) => {
    if (t < 3) return 0;
    if (phase === 0) { if (v >= kmh(125)) { phase = 1; cruiseT = t; } else return ACCEL; }
    if (phase === 1) { if (t - cruiseT > 2) phase = 2; else return 0; }
    return v > 0 ? -BRAKE : 0;
  };
}

test('recuperaciones 60-100 y 80-120 (error < 0,1 s)', () => {
  const { session, events, axes } = calibratedSession();
  const hist = runStraight(session, axes, 30, profile());
  for (const [a, b] of [[60, 100], [80, 120]]) {
    const truth = timeWhen(hist, kmh(b)) - timeWhen(hist, kmh(a));
    const ev = events.find((e) => e.type === 'roll' && e.key === `${a}-${b}`);
    assert.ok(ev, `debería medirse ${a}-${b}`);
    assert.ok(Math.abs(ev.time - truth) < 0.1, `${a}-${b}: medido ${ev.time.toFixed(3)} s vs real ${truth.toFixed(3)} s`);
  }
});

test('frenada 100-0: distancia (error < 1,5 m) y tiempo (error < 0,15 s)', () => {
  const { session, events, axes } = calibratedSession();
  const hist = runStraight(session, axes, 30, profile());
  const t100 = timeWhen(hist, kmh(100), false);
  const tStop = hist.find(([t, v]) => t > t100 && v === 0)[0];
  const x100 = hist.find(([t]) => t >= t100)[2];
  const xStop = hist[hist.length - 1][2];
  const ev = events.find((e) => e.type === 'brake');
  assert.ok(ev, 'debería medirse la frenada');
  assert.ok(Math.abs(ev.d - (xStop - x100)) < 1.5, `distancia ${ev.d.toFixed(2)} m vs real ${(xStop - x100).toFixed(2)} m`);
  assert.ok(Math.abs(ev.t - (tStop - t100)) < 0.15, `tiempo ${ev.t.toFixed(3)} s vs real ${(tStop - t100).toFixed(3)} s`);
});

test('salida parada: 0-50, 0-100 y 100 m', () => {
  const { session, events, axes } = calibratedSession();
  const hist = runStraight(session, axes, 30, profile());
  const run = events.find((e) => e.type === 'run').run;
  assert.ok(Math.abs(run.spd['0-50'] - kmh(50) / ACCEL) < 0.1, `0-50 ${run.spd['0-50'].toFixed(3)} s`);
  assert.ok(Math.abs(run.spd['0-100'] - kmh(100) / ACCEL) < 0.1, `0-100 ${run.spd['0-100'].toFixed(3)} s`);
  const t100m = hist.find(([, , x]) => x >= 100)[0] - 3;
  assert.ok(Math.abs(run.dst['100 m'].t - t100m) < 0.15, `100 m ${run.dst['100 m'].t.toFixed(3)} s vs ${t100m.toFixed(3)} s`);
});

test('el crono no arranca con un golpe suelto estando parado', () => {
  const timer = new PerfTimer();
  let t = 0;
  for (let i = 0; i < 120; i++) timer.tick((t += 1 / 60), 0, 0, 1 / 60, true);   // 2 s parado → armado
  assert.equal(timer.state, 'armed');
  timer.tick((t += 1 / 60), 0, 0.5, 1 / 60, true);                                  // un solo pico
  for (let i = 0; i < 30; i++) timer.tick((t += 1 / 60), 0, 0, 1 / 60, true);
  assert.equal(timer.state, 'armed');
});

test('en modo demo no se guardan récords', () => {
  const saved = [];
  const timer = new PerfTimer({ save: (k) => saved.push(k) });
  timer.demo = true;
  let t = 0, v = 0;
  for (let i = 0; i < 60; i++) timer.tick((t += 1 / 60), 0, 0, 1 / 60, true);
  for (let i = 0; i < 600; i++) { v += 6 / 60; timer.tick((t += 1 / 60), v, 0.6, 1 / 60, true); }
  assert.deepEqual(saved, []);
  assert.deepEqual(timer.bests, {});
});
