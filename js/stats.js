// Máximos de la sesión (G, inclinación, caballito/stoppie, velocidad).

const PITCH_MIN_SPEED = 3;   // m/s: caballito y stoppie solo cuentan en marcha
const PITCH_LIMIT = 90;      // grados

export const emptyMaxima = () => ({ acc: 0, brk: 0, l: 0, r: 0, leanL: 0, leanR: 0, up: 0, dn: 0, spd: 0 });

/**
 * Actualiza los máximos con el estado actual.
 * @param {object} M  objeto de máximos (se modifica)
 * @param {{lonGs:number, latGs:number, lean:number, pitch:number}} f  salidas de la fusión
 * @param {number} speed  m/s
 * @param {boolean} gpsGood
 */
export function updateMaxima(M, f, speed, gpsGood) {
  if (f.lonGs > M.acc) M.acc = f.lonGs;
  if (-f.lonGs > M.brk) M.brk = -f.lonGs;
  if (f.latGs > M.r) M.r = f.latGs;
  if (-f.latGs > M.l) M.l = -f.latGs;
  if (f.lean > M.leanR) M.leanR = f.lean;
  if (-f.lean > M.leanL) M.leanL = -f.lean;
  if (gpsGood && speed > PITCH_MIN_SPEED) {
    if (f.pitch > M.up) M.up = Math.min(PITCH_LIMIT, f.pitch);
    if (-f.pitch > M.dn) M.dn = Math.min(PITCH_LIMIT, -f.pitch);
  }
  const kmh = speed * 3.6;
  if (gpsGood && kmh > M.spd) M.spd = kmh;
}
