// Pantallas: vuelca el estado de la app en el HTML. Solo lee el estado, no lo modifica.

import { KMH } from './util.js';
import { SPEED_TARGETS, DIST_TARGETS, ROLL_INTERVALS } from './timing.js';
import { GYRO_MAP_NAMES } from './fusion.js';
import { signedG, lateralG, seconds, shortDate } from './format.js';
import { drawLean, drawGBall, drawSpeedo } from './draw.js';

const $ = (id) => document.getElementById(id);
const ROLL_RESULT_TIME = 6;     // s que se queda en grande el tiempo de la última recuperación

// Solo se toca el DOM cuando un valor cambia (la pantalla se refresca ~15 veces por segundo).
const shown = {};
function text(id, v) { if (shown[id] !== v) { shown[id] = v; const e = $(id); if (e) e.textContent = v; } }
function html(id, v) { if (shown[id] !== v) { shown[id] = v; const e = $(id); if (e) e.innerHTML = v; } }
function setClass(el, cls) { if (el.className !== cls) el.className = cls; }

/* ---------- navegación ---------- */
export function setView(view) {
  document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  document.querySelectorAll('.view').forEach((s) => s.classList.toggle('on', s.id === 'v-' + view));
  for (const k in shown) delete shown[k];
  document.querySelector('main').scrollTop = 0;
}

/* ---------- indicador de estado (arriba a la derecha) ---------- */
function renderStatus(app, t) {
  const { speed, gps } = app;
  let cls = 'ok', label = 'ACTIVO';
  if (!app.started) { cls = 'warn'; label = 'INICIO'; }
  else if (app.demo) { cls = 'warn'; label = 'DEMO'; }
  else if (!app.sensorsReceiving(t)) { cls = 'bad'; label = 'SIN SENSORES'; }
  else if (!app.fusion.calibrated) { cls = 'warn'; label = 'CALIBRAR'; }
  else if (!speed.hasFix(t)) { cls = gps.errCode === 1 ? 'bad' : 'warn'; label = gps.errCode === 1 ? 'GPS DENEGADO' : 'BUSCANDO GPS'; }
  else if (!speed.isGood(t)) { cls = 'warn'; label = 'GPS DÉBIL'; }
  setClass($('status'), 'status ' + cls);
  text('statusT', label);
  $('recDot').hidden = !app.recorder.on;
  renderGpsChip(app, t);
  renderHzChip(app, t);
}

/* Precisión GPS: verde ≤ 10 m, amarillo < 50 m (aún mide tiempos), rojo peor o sin señal. */
function renderGpsChip(app, t) {
  const { speed, gps } = app;
  let cls = 'none', label = 'GPS';
  if (app.started && speed.hasFix(t) && speed.accuracy != null) {
    const acc = Math.round(speed.accuracy);
    label = '±' + acc + ' m';
    cls = acc <= 10 ? 'good' : speed.isGood(t) ? 'fair' : 'poor';
  } else if (app.started && gps.errCode === 1) {
    cls = 'poor'; label = 'GPS ✕';
  }
  setClass($('gpsChip'), 'gps-chip ' + cls);
  text('gpsAcc', label);
}

/* Lecturas por segundo de los sensores de movimiento: verde ≥ 50 Hz, amarillo ≥ 25 Hz, rojo menos o sin datos. */
function renderHzChip(app, t) {
  let cls = 'none', label = 'Hz';
  if (app.started) {
    const hz = app.sensorsReceiving(t) ? Math.round(app.sensorHz) : 0;
    label = hz + ' Hz';
    cls = hz >= 50 ? 'good' : hz >= 25 ? 'fair' : 'poor';
  }
  setClass($('hzChip'), 'gps-chip ' + cls);
  text('hzVal', label);
}

/* ---------- pantallas ---------- */
export function render(app, t) {
  renderStatus(app, t);
  text('bikeName', app.settings.bike);
  const view = app.view;
  if (view === 'track') renderTrack(app, t);
  else if (view === 'speed') renderSpeed(app);
  else if (view === 'g') renderG(app);
  else if (view === 'perf') renderPerf(app, t);
}

function renderTrack(app, t) {
  const f = app.fusion, M = app.maxima;
  $('calBanner').hidden = f.calibrated || !app.started || app.demo;
  text('tLean', Math.round(Math.abs(f.lean)).toString());
  const left = f.lean < 0 ? -f.lean : 0, right = f.lean > 0 ? f.lean : 0;
  text('sideL', Math.round(left).toString());
  text('sideR', Math.round(right).toString());
  $('sideLBox').classList.toggle('on', left > 3);
  $('sideRBox').classList.toggle('on', right > 3);
  text('maxL', Math.round(M.leanL) + '°');
  text('maxR', Math.round(M.leanR) + '°');
  text('tSpd', app.speed.hasFix(t) ? Math.round(app.speed.v * KMH).toString() : '—');
  text('tLat', signedG(f.latGs) + 'G');
  text('tPeak', Math.max(M.l, M.r).toFixed(2) + 'G');
}

function renderSpeed(app) {
  const M = app.maxima, b = app.timer.bests, last = app.timer.last;
  text('sMax', Math.round(M.spd).toString());
  text('sAcc', signedG(app.fusion.lonGs) + 'G');
  text('sDist', (app.speed.dist / 1000).toFixed(1));
  text('s0100', seconds(last && last.spd['0-100']));
  text('s0100b', seconds(b['0-100'] && b['0-100'].t));
  text('s0200b', seconds(b['0-200'] && b['0-200'].t));
}

function renderG(app) {
  const f = app.fusion, M = app.maxima;
  text('gLon', signedG(f.lonGs));
  text('gLat', lateralG(f.latGs));
  text('gTot', Math.hypot(f.lonGs, f.latGs).toFixed(2));
  text('gMA', M.acc.toFixed(2) + ' G'); text('gMB', M.brk.toFixed(2) + ' G');
  text('gML', M.l.toFixed(2) + ' G'); text('gMR', M.r.toFixed(2) + ' G');
  text('gWh', M.up.toFixed(0) + '°'); text('gSt', M.dn.toFixed(0) + '°');
}

function renderPerf(app, t) {
  const timer = app.timer, hasFix = app.speed.hasFix(t), kmh = app.speed.v * KMH;
  const rolling = timer.state === 'run' ? [] : timer.activeRolls();
  const lastRoll = timer.lastRoll && t - timer.lastRoll.t < ROLL_RESULT_TIME ? timer.lastRoll : null;
  let cls = 'perfstate', label;
  if (!hasFix) label = 'ESPERANDO GPS…';
  else if (timer.state === 'armed') { cls += ' armed'; label = 'LISTO · ACELERA CUANDO QUIERAS'; }
  else if (timer.state === 'run') { cls += ' run'; label = 'MIDIENDO…'; }
  else if (rolling.length) { cls += ' run'; label = 'MIDIENDO ' + rolling.map((r) => r.key).join(' · '); }
  else if (lastRoll) label = lastRoll.key + ' KM/H';
  else label = kmh >= 2 ? 'EN MARCHA · ACELERA PARA MEDIR' : 'ESPERANDO…';
  setClass($('perfState'), cls);
  text('perfState', label);

  if (timer.state === 'run') { text('perfTimer', (t - timer.t0).toFixed(2)); text('perfDist', Math.round(timer.d).toString()); }
  else if (timer.state === 'armed') { text('perfTimer', '0.00'); text('perfDist', '0'); }
  else if (rolling.length) text('perfTimer', (t - rolling[0].tA).toFixed(2));
  else if (lastRoll) text('perfTimer', lastRoll.time.toFixed(2));
  else { const r = timer.last; text('perfTimer', r && r.spd['0-100'] != null ? r.spd['0-100'].toFixed(2) : '0.00'); }
  const flash = t - timer.lastSplitT < 1.8;
  $('perfTimer').classList.toggle('flash', flash);
  text('perfSpd', hasFix ? Math.round(kmh).toString() : '—');

  html('perfRun', standingTable(timer));
  html('perfRoll', rollingTable(timer));
  html('perfCustom', customTable(timer));
  html('perfHist', historyList(timer.hist));
}

const withSpeed = (time, kmh) => `${time.toFixed(2)}<span class="sub">${Math.round(kmh)} km/h</span>`;

function standingTable(timer) {
  const r = timer.state === 'run' ? timer.res : timer.last, b = timer.bests;
  let h = `<table><tr><th></th><th>${timer.state === 'run' ? 'Actual' : 'Última'}</th><th>Mejor</th></tr>`;
  for (const s of SPEED_TARGETS) {
    const key = '0-' + s;
    h += `<tr><td>${key} km/h</td><td>${seconds(r && r.spd[key])}</td><td class="best">${seconds(b[key] && b[key].t)}</td></tr>`;
  }
  for (const [, name] of DIST_TARGETS) {
    const c = r && r.dst[name], best = b[name];
    h += `<tr><td>${name}</td><td>${c ? withSpeed(c.t, c.v) : '—'}</td><td class="best">${best ? withSpeed(best.t, best.v) : '—'}</td></tr>`;
  }
  return h + '</table>';
}

function rollingTable(timer) {
  const last = timer.lastRes, b = timer.bests;
  let h = '<table><tr><th></th><th>Última</th><th>Mejor</th></tr>';
  for (const [lo, hi] of ROLL_INTERVALS) {
    const key = `${lo}-${hi}`;
    h += `<tr><td>${key} km/h</td><td>${seconds(last[key] && last[key].t)}</td><td class="best">${seconds(b[key] && b[key].t)}</td></tr>`;
  }
  const brake = (x) => (x ? `${x.d.toFixed(1)} m<span class="sub">${x.t.toFixed(2)} s</span>` : '—');
  h += `<tr><td>Frenada 100-0</td><td>${brake(last['100-0'])}</td><td class="best">${brake(b['100-0'])}</td></tr>`;
  return h + '</table>';
}

function customTable(timer) {
  if (!timer.custom.length) return '<p class="note">Elige tus velocidades, por ejemplo 20-120 o 0-120, y se medirán solas como las recuperaciones.</p>';
  const last = timer.lastRes, b = timer.bests;
  let h = '<table><tr><th></th><th>Última</th><th>Mejor</th></tr>';
  for (const [lo, hi] of timer.custom) {
    const key = `${lo}-${hi}`;
    h += `<tr class="del" data-act="delInterval" data-key="${key}"><td>${key} km/h<span class="sub">${lo === 0 ? 'desde parado' : 'lanzado'}</span></td><td>${seconds(last[key] && last[key].t)}</td><td class="best">${seconds(b[key] && b[key].t)}</td></tr>`;
  }
  return h + '</table><p class="note" style="margin-top:8px">Toca uno para quitarlo.</p>';
}

function historyList(hist) {
  let h = '';
  for (const run of hist.slice(0, 15)) {
    const parts = [];
    if (run.spd['0-100'] != null) parts.push(`0-100 <b>${run.spd['0-100'].toFixed(2)}</b>`);
    if (run.spd['0-200'] != null) parts.push(`0-200 <b>${run.spd['0-200'].toFixed(2)}</b>`);
    if (run.dst['402 m']) parts.push(`402 m <b>${run.dst['402 m'].t.toFixed(2)}</b>`);
    if (!parts.length) {         // salida que no llegó a 100 km/h: lo que sí se midió
      if (run.spd['0-50'] != null) parts.push(`0-50 <b>${run.spd['0-50'].toFixed(2)}</b>`);
      if (run.dst['100 m']) parts.push(`100 m <b>${run.dst['100 m'].t.toFixed(2)}</b>`);
      parts.push(`máx ${Math.round(run.peak)} km/h`);
    }
    h += `<div><span style="color:var(--mut)">${shortDate(run.date)}${run.demo ? '<span class="tag">DEMO</span>' : ''}</span><span>${parts.join(' · ')}</span></div>`;
  }
  return h || '<div><span style="color:var(--mut)">Aún no hay tiempos</span></div>';
}

/* ---------- gráficos ---------- */
export function drawCurrentView(app, t) {
  const f = app.fusion, M = app.maxima;
  if (app.view === 'track') drawLean($('cLean'), { lean: f.lean, maxL: M.leanL, maxR: M.leanR });
  else if (app.view === 'g') drawGBall($('cG'), { lon: f.lonGs, lat: f.latGs, trail: app.trail, max: M, scale: app.settings.gScale });
  else if (app.view === 'speed') drawSpeedo($('cSpd'), { kmh: app.speed.hasFix(t) ? app.speed.v * KMH : null, maxKmh: M.spd });
}

/* ---------- ajustes ---------- */
export function renderSettings(app, t) {
  const s = app.settings;
  document.querySelectorAll('#segScale button').forEach((b) => b.classList.toggle('on', +b.dataset.s === s.gScale));
  $('tFwd').checked = s.flipFwd; $('tLat').checked = s.flipLat; $('tSnd').checked = s.sound;
  $('recLbl').textContent = app.recorder.on ? 'Detener grabación' : 'Iniciar grabación';
  $('expN').textContent = app.recorder.rows.length + ' filas';
  $('demoLbl').textContent = app.demo ? 'Desactivar modo demo' : 'Activar modo demo';
  $('setBike').textContent = s.bike;
  renderDiagnostics(app, t);
}

export function renderDiagnostics(app, t) {
  const { speed, fusion, gps } = app, sg = fusion.signs;
  const gpsLine = speed.hasFix(t)
    ? `±${Math.round(speed.accuracy)} m · ${(speed.vGps * KMH).toFixed(1)} km/h${speed.isGood(t) ? '' : ' (impreciso: no mide tiempos)'}`
    : 'sin posición';
  $('diag').innerHTML = [
    `Sensores: ${app.sensorsReceiving(t) ? Math.round(app.sensorHz) + ' Hz' : 'sin datos'} · calibrado: ${fusion.calibrated ? 'sí' : 'no'}${fusion.cal && fusion.cal.fwdraw ? ' (+dirección)' : ''}`,
    `GPS: ${gpsLine}${speed.rejected ? ` · ${speed.rejected} puntos erróneos descartados` : ''}${gps.restarts ? ` · reiniciado ${gps.restarts} ${gps.restarts === 1 ? 'vez' : 'veces'}` : ''}` + (gps.err ? `<br><span style="color:#ff8a96">${gps.err}</span>` : ''),
    `Acelerómetro ${sg.acc > 0 ? '+' : '−'} (${sg.accConf}) · Giroscopio ${GYRO_MAP_NAMES[sg.gmap]} ${sg.gsign > 0 ? '+' : '−'} (${sg.gn}${sg.gdone ? ' ✔' : ''})`,
    `HTTPS: ${window.isSecureContext ? 'sí' : 'NO'} · versión: ${app.version || '—'}`,
  ].join('<br>');
}

/* ---------- calibración ---------- */
export function showCalibration(on) {
  $('calibOv').hidden = !on;
  if (on) { $('calibMsg').textContent = 'Mantén la moto recta y quieta'; setCalibrationProgress(0, false); }
}
export function setCalibrationProgress(p, moving) {
  $('calibArc').style.strokeDashoffset = String(326.7 * (1 - p));
  if (moving) $('calibMsg').textContent = 'Se está moviendo… mantenlo quieto';
}
