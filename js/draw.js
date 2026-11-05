// Dibujo de los indicadores en <canvas>: arco de inclinación con el piloto, G-ball y velocímetro.
// Cada función recibe el canvas y los datos que tiene que pintar.

import { D2R, clamp } from './util.js';

const FONT = '-apple-system,BlinkMacSystemFont,"SF Pro Display","Segoe UI",Roboto,sans-serif';
const GOLD = '#f5b62a';
const TAU = Math.PI * 2;

/** Ajusta el canvas a su tamaño en pantalla (nítido en pantallas retina) y lo limpia. */
function prepare(canvas) {
  const r = canvas.getBoundingClientRect();
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
  if (!w || !h) return null;
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, r.width, r.height);
  return { ctx, w: r.width, h: r.height };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function radialTick(ctx, cx, cy, angle, r1, r2) {
  ctx.beginPath();
  ctx.moveTo(cx + r1 * Math.cos(angle), cy + r1 * Math.sin(angle));
  ctx.lineTo(cx + r2 * Math.cos(angle), cy + r2 * Math.sin(angle));
  ctx.stroke();
}

/* ======================= inclinación ======================= */

const LEAN_RANGE = 68;   // grados representados a cada lado

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{lean:number, maxL:number, maxR:number}} d  grados; lean + = derecha
 */
export function drawLean(canvas, { lean, maxL, maxR }) {
  const p = prepare(canvas); if (!p) return;
  const { ctx: x, w, h } = p;
  const cx = w / 2, cy = h * 0.86, R = Math.min(w * 0.4, h * 0.74);
  const A = (deg) => (-90 + deg) * D2R;          // 0° arriba, + a la derecha

  // brillo de fondo
  const glow = x.createRadialGradient(cx, cy - R * 0.35, 0, cx, cy - R * 0.35, R * 0.95);
  glow.addColorStop(0, 'rgba(245,182,42,0.10)');
  glow.addColorStop(1, 'rgba(245,182,42,0)');
  x.fillStyle = glow; x.beginPath(); x.arc(cx, cy - R * 0.35, R * 0.95, 0, TAU); x.fill();

  // arco base, más claro arriba
  x.lineCap = 'round'; x.lineWidth = Math.max(4, R * 0.035);
  for (let a = -LEAN_RANGE; a < LEAN_RANGE; a += 2) {
    const k = 1 - Math.abs(a) / LEAN_RANGE;
    x.strokeStyle = `rgba(${Math.round(70 + 120 * k)},${Math.round(76 + 110 * k)},${Math.round(90 + 90 * k)},${0.35 + 0.4 * k})`;
    x.beginPath(); x.arc(cx, cy, R, A(a), A(Math.min(LEAN_RANGE, a + 2.3))); x.stroke();
  }

  // tramo dorado hasta la inclinación actual
  const va = clamp(lean, -LEAN_RANGE, LEAN_RANGE);
  if (Math.abs(va) > 0.5) {
    x.shadowColor = GOLD; x.shadowBlur = 14; x.strokeStyle = GOLD; x.lineWidth = Math.max(5, R * 0.045);
    x.beginPath();
    if (va > 0) x.arc(cx, cy, R, A(0), A(va)); else x.arc(cx, cy, R, A(va), A(0));
    x.stroke(); x.shadowBlur = 0;
  }

  // marca central y escala
  x.strokeStyle = '#c9d0db'; x.lineWidth = 2.5;
  x.beginPath(); x.moveTo(cx, cy - R - R * 0.07); x.lineTo(cx, cy - R + R * 0.07); x.stroke();
  x.font = `700 ${Math.max(11, R * 0.1)}px ${FONT}`; x.fillStyle = '#c9d0db'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (const a of [-60, -30, 30, 60]) {
    const r = R * 1.16;
    x.fillText(Math.abs(a), cx + r * Math.cos(A(a)), cy + r * Math.sin(A(a)));
  }

  // máximos (rayitas doradas)
  x.strokeStyle = GOLD; x.lineWidth = 3;
  for (const m of [-maxL, maxR]) {
    if (Math.abs(m) < 1) continue;
    radialTick(x, cx, cy, A(clamp(m, -LEAN_RANGE, LEAN_RANGE)), R * 0.91, R * 1.09);
  }

  // punto actual y línea discontinua hacia el piloto
  const ap = A(va), px = cx + R * Math.cos(ap), py = cy + R * Math.sin(ap);
  x.setLineDash([3, 4]); x.strokeStyle = 'rgba(245,182,42,.7)'; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(px, py); x.lineTo(cx + R * 0.62 * Math.cos(ap), cy + R * 0.62 * Math.sin(ap)); x.stroke();
  x.setLineDash([]);
  x.fillStyle = GOLD; x.shadowColor = GOLD; x.shadowBlur = 10;
  x.beginPath(); x.arc(px, py, Math.max(4, R * 0.04), 0, TAU); x.fill(); x.shadowBlur = 0;

  // suelo y piloto
  x.strokeStyle = 'rgba(255,255,255,.22)'; x.lineWidth = 1.5;
  x.beginPath(); x.moveTo(cx - R * 0.62, cy); x.lineTo(cx + R * 0.62, cy); x.stroke();
  drawRider(x, cx, cy, R * 0.62, va);
}

/** Moto y piloto vistos desde atrás, tumbados `leanDeg` y descolgándose hacia el interior. */
function drawRider(x, cx, cy, s, leanDeg) {
  const lr = leanDeg * D2R;
  const side = Math.sign(leanDeg) || 0;
  const hang = clamp(Math.abs(leanDeg) / 45, 0, 1);    // cuánto se descuelga (0..1)

  // sombra
  x.fillStyle = 'rgba(0,0,0,.35)';
  x.beginPath(); x.ellipse(cx + Math.sin(lr) * s * 0.25, cy + 2, s * 0.28, s * 0.045, 0, 0, TAU); x.fill();

  x.save(); x.translate(cx, cy); x.rotate(lr);
  // neumático trasero
  x.fillStyle = '#262c38'; roundRect(x, -s * 0.085, -s * 0.46, s * 0.17, s * 0.46, s * 0.07); x.fill();
  x.strokeStyle = '#3b4352'; x.lineWidth = 1.5; x.stroke();
  // colín y piloto trasero
  x.fillStyle = '#e9edf2';
  x.beginPath(); x.moveTo(-s * 0.16, -s * 0.5); x.lineTo(s * 0.16, -s * 0.5); x.lineTo(s * 0.1, -s * 0.64); x.lineTo(-s * 0.1, -s * 0.64); x.closePath(); x.fill();
  x.fillStyle = '#ff3348'; x.shadowColor = '#ff3348'; x.shadowBlur = 8;
  roundRect(x, -s * 0.09, -s * 0.54, s * 0.18, s * 0.045, s * 0.02); x.fill(); x.shadowBlur = 0;
  // escapes
  x.fillStyle = '#8a93a3';
  roundRect(x, -s * 0.2, -s * 0.42, s * 0.07, s * 0.12, s * 0.02); x.fill();
  roundRect(x, s * 0.13, -s * 0.42, s * 0.07, s * 0.12, s * 0.02); x.fill();

  // piloto
  x.save(); x.translate(0, -s * 0.62); x.rotate(lr * 0.18); x.translate(side * hang * s * 0.12, 0);
  x.strokeStyle = '#dfe4ea'; x.lineCap = 'round'; x.lineWidth = s * 0.09;
  const kneeX = side * (s * 0.14 + hang * s * 0.16);
  x.beginPath(); x.moveTo(side * s * 0.08, -s * 0.02); x.lineTo(kneeX, s * 0.16); x.stroke();      // pierna interior
  if (hang > 0.4) { x.fillStyle = GOLD; x.beginPath(); x.arc(kneeX, s * 0.17, s * 0.04, 0, TAU); x.fill(); }  // deslizadera
  x.beginPath(); x.moveTo(-side * s * 0.08, -s * 0.02); x.lineTo(-side * s * 0.13, s * 0.12); x.stroke();  // pierna exterior
  // espalda
  x.fillStyle = '#f2f5f9';
  x.beginPath(); x.moveTo(-s * 0.17, 0);
  x.quadraticCurveTo(-s * 0.26, -s * 0.26, -s * 0.17, -s * 0.42);
  x.quadraticCurveTo(0, -s * 0.5, s * 0.17, -s * 0.42);
  x.quadraticCurveTo(s * 0.26, -s * 0.26, s * 0.17, 0);
  x.closePath(); x.fill();
  x.fillStyle = '#d23244'; roundRect(x, -s * 0.035, -s * 0.44, s * 0.07, s * 0.4, s * 0.02); x.fill();   // raya del mono
  x.fillStyle = '#2a3140'; roundRect(x, -s * 0.15, -s * 0.05, s * 0.3, s * 0.07, s * 0.03); x.fill();    // cintura
  // brazos
  x.strokeStyle = '#dfe4ea'; x.lineWidth = s * 0.07;
  x.beginPath(); x.moveTo(-s * 0.12, -s * 0.34); x.lineTo(-s * 0.24, -s * 0.2); x.stroke();
  x.beginPath(); x.moveTo(s * 0.12, -s * 0.34); x.lineTo(s * 0.24, -s * 0.2); x.stroke();
  // casco
  x.translate(side * hang * s * 0.06, 0);
  x.fillStyle = '#f7f8fa'; x.beginPath(); x.arc(0, -s * 0.56, s * 0.15, 0, TAU); x.fill();
  x.fillStyle = GOLD; x.fillRect(-s * 0.02, -s * 0.71, s * 0.04, s * 0.3);
  x.restore();
  x.restore();
}

/* ======================= G-ball ======================= */

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{lon:number, lat:number, trail:number[][], max:object, scale:number}} d
 *   lon/lat en G (lat + = derecha), trail = [[lat, lon], ...], scale = G del borde
 */
export function drawGBall(canvas, { lon, lat, trail, max: M, scale: S }) {
  const p = prepare(canvas); if (!p) return;
  const { ctx: x, w, h } = p;
  const cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 22;
  const X = (g) => cx + clamp(g / S, -1.1, 1.1) * R;
  const Y = (g) => cy - clamp(g / S, -1.1, 1.1) * R;

  const glow = x.createRadialGradient(cx, cy, 0, cx, cy, R);
  glow.addColorStop(0, 'rgba(245,182,42,.07)'); glow.addColorStop(1, 'rgba(245,182,42,0)');
  x.fillStyle = glow; x.beginPath(); x.arc(cx, cy, R, 0, TAU); x.fill();

  // anillos cada 0,5 G
  x.lineWidth = 1.2;
  for (let g = 0.5; g <= S + 1e-6; g += 0.5) {
    x.beginPath(); x.arc(cx, cy, (R * g) / S, 0, TAU);
    x.strokeStyle = Math.abs(g - 1) < 1e-6 ? 'rgba(255,255,255,.22)' : 'rgba(255,255,255,.09)'; x.stroke();
    x.fillStyle = '#5b6476'; x.font = `600 11px ${FONT}`; x.textAlign = 'left';
    x.fillText(g.toFixed(1) + ' G', cx + 5, cy - (R * g) / S + 13);
  }
  x.strokeStyle = 'rgba(255,255,255,.08)';
  x.beginPath(); x.moveTo(cx - R, cy); x.lineTo(cx + R, cy); x.moveTo(cx, cy - R); x.lineTo(cx, cy + R); x.stroke();
  x.fillStyle = '#8b95a7'; x.font = `700 11px ${FONT}`; x.textAlign = 'center';
  x.fillText('ACELERA', cx, cy - R - 8); x.fillText('FRENA', cx, cy + R + 16);
  x.textAlign = 'left'; x.fillText('IZQ', cx - R + 6, cy - 7);
  x.textAlign = 'right'; x.fillText('DER', cx + R - 6, cy - 7);

  // envolvente de máximos
  x.strokeStyle = 'rgba(245,182,42,.35)'; x.lineWidth = 1.5; x.setLineDash([4, 4]); x.beginPath();
  [[0, M.acc], [M.r, 0], [0, -M.brk], [-M.l, 0]].forEach(([gx, gy], i) => {
    const px = cx + clamp(gx / S, -1.05, 1.05) * R, py = cy - clamp(gy / S, -1.05, 1.05) * R;
    if (i) x.lineTo(px, py); else x.moveTo(px, py);
  });
  x.closePath(); x.stroke(); x.setLineDash([]);

  // estela
  x.fillStyle = GOLD;
  trail.forEach(([gx, gy], i) => {
    x.globalAlpha = (i / trail.length) * 0.6;
    x.beginPath(); x.arc(X(gx), Y(gy), 2.5, 0, TAU); x.fill();
  });
  x.globalAlpha = 1;

  // punto actual
  const px = X(lat), py = Y(lon);
  x.shadowColor = GOLD; x.shadowBlur = 20; x.fillStyle = GOLD;
  x.beginPath(); x.arc(px, py, 12, 0, TAU); x.fill();
  x.shadowBlur = 0; x.fillStyle = '#fff'; x.beginPath(); x.arc(px, py, 4, 0, TAU); x.fill();
}

/* ======================= velocímetro ======================= */

const SPEEDO_MAX = 300;   // km/h

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{kmh:number|null, maxKmh:number}} d  kmh = null si no hay GPS
 */
export function drawSpeedo(canvas, { kmh, maxKmh }) {
  const p = prepare(canvas); if (!p) return;
  const { ctx: x, w, h } = p;
  const cx = w / 2, cy = h * 0.56, R = Math.min(w * 0.42, h * 0.48);
  const a0 = 135 * D2R, span = 270 * D2R;
  const k = kmh ?? 0;

  x.lineCap = 'round'; x.lineWidth = R * 0.07; x.strokeStyle = 'rgba(255,255,255,.07)';
  x.beginPath(); x.arc(cx, cy, R, a0, a0 + span); x.stroke();

  const f = clamp(k / SPEEDO_MAX, 0, 1);
  if (f > 0.003) {
    const grad = x.createLinearGradient(cx - R, 0, cx + R, 0);
    grad.addColorStop(0, '#c98a12'); grad.addColorStop(1, '#ffd36b');
    x.strokeStyle = grad; x.shadowColor = GOLD; x.shadowBlur = 16;
    x.beginPath(); x.arc(cx, cy, R, a0, a0 + span * f); x.stroke(); x.shadowBlur = 0;
  }
  const fm = clamp(maxKmh / SPEEDO_MAX, 0, 1);
  if (fm > 0.01) { x.strokeStyle = '#fff'; x.lineWidth = 3; radialTick(x, cx, cy, a0 + span * fm, R * 0.91, R * 1.09); }

  x.fillStyle = '#5b6476'; x.font = `700 ${Math.max(10, R * 0.075)}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let v = 0; v <= SPEEDO_MAX; v += 50) {
    const a = a0 + (span * v) / SPEEDO_MAX, r = R * 0.8;
    x.fillText(v, cx + r * Math.cos(a), cy + r * Math.sin(a));
  }
  x.fillStyle = '#f2f5f9'; x.font = `800 ${R * 0.55}px ${FONT}`;
  x.fillText(kmh == null ? '—' : Math.round(k), cx, cy - R * 0.02);
  x.fillStyle = '#8b95a7'; x.font = `700 ${R * 0.1}px ${FONT}`;
  x.fillText('KM/H', cx, cy + R * 0.36);
}
