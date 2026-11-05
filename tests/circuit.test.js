// Pruebas con la moto simulada dando vueltas al circuito: inclinación, G lateral y velocidad.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitSim } from '../js/demo.js';
import { calibratedSession, runCircuit } from './helpers.js';

function lap(seed) {
  const sim = new CircuitSim({ seed, epochMs: 0 });
  const { session } = calibratedSession(sim.axes);
  const r = { maxLeanErr: 0, maxTrueLean: 0, maxEstLean: 0, maxSpeedErr: 0 };
  runCircuit(sim, session, 90, () => {
    const err = Math.abs(sim.leanDeg - session.fusion.lean);
    r.maxLeanErr = Math.max(r.maxLeanErr, err);
    r.maxTrueLean = Math.max(r.maxTrueLean, Math.abs(sim.leanDeg));
    r.maxEstLean = Math.max(r.maxEstLean, Math.abs(session.fusion.lean));
    if (sim.t > 5) r.maxSpeedErr = Math.max(r.maxSpeedErr, Math.abs(sim.v - session.speed.v) * 3.6);
  });
  return { ...r, session, sim };
}

test('el ángulo de inclinación sigue al real (error < 1,5°)', () => {
  for (const seed of [1, 2, 3]) {
    const r = lap(seed);
    assert.ok(r.maxTrueLean > 45, `la simulación debería tumbar más de 45° (${r.maxTrueLean.toFixed(1)})`);
    assert.ok(r.maxLeanErr < 1.5, `error máximo de inclinación ${r.maxLeanErr.toFixed(2)}° (semilla ${seed})`);
    assert.ok(Math.abs(r.maxEstLean - r.maxTrueLean) < 1, `máximo medido ${r.maxEstLean.toFixed(1)}° vs real ${r.maxTrueLean.toFixed(1)}°`);
  }
});

test('los máximos de inclinación detectan los dos lados', () => {
  const { session } = lap(1);
  const M = session.maxima;
  assert.ok(M.leanR > 45, `máx. derecha ${M.leanR.toFixed(1)}°`);   // curvas R50 a 1,15 G → 49°
  assert.ok(M.leanL > 40, `máx. izquierda ${M.leanL.toFixed(1)}°`);  // chicane R40 a 1,0 G → 45°
});

test('la G lateral en curva coincide con la física (tan de la inclinación)', () => {
  const { session } = lap(1);
  const M = session.maxima;
  assert.ok(Math.abs(M.r - 1.15) < 0.06, `G lateral derecha máx. ${M.r.toFixed(3)} (esperado ~1,15)`);
  assert.ok(Math.abs(M.l - 1.0) < 0.08, `G lateral izquierda máx. ${M.l.toFixed(3)} (esperado ~1,0)`);
});

test('la velocidad estimada no se separa de la real más de 2 km/h', () => {
  const r = lap(1);
  assert.ok(r.maxSpeedErr < 2, `error máximo de velocidad ${r.maxSpeedErr.toFixed(2)} km/h`);
});

test('mide el 0-100 de la salida desde parado', () => {
  const sim = new CircuitSim({ seed: 4, epochMs: 0 });
  const { session, events } = calibratedSession(sim.axes);
  let launch = null, at100 = null, prevV = 0;
  runCircuit(sim, session, 25, () => {
    if (launch == null && sim.v > 0) launch = sim.t - 1 / 60;
    if (at100 == null && prevV < 100 / 3.6 && sim.v >= 100 / 3.6) at100 = sim.t - (1 / 60) * ((sim.v - 100 / 3.6) / (sim.v - prevV));
    prevV = sim.v;
  });
  const truth = at100 - launch;
  const run = events.find((e) => e.type === 'run')?.run ?? session.timer.res;
  assert.ok(run && run.spd['0-100'] != null, 'debería haber un tiempo 0-100');
  assert.ok(Math.abs(run.spd['0-100'] - truth) < 0.1, `0-100 medido ${run.spd['0-100'].toFixed(3)} s vs real ${truth.toFixed(3)} s`);
});
