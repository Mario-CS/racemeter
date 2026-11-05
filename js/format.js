// Formato de números para mostrar en pantalla.

/** G con signo: +0.45 / −0.30 */
export const signedG = (v) => (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(2);

/** G lateral con lado: 0.45 D / 0.30 I */
export const lateralG = (v) => Math.abs(v).toFixed(2) + (v > 0.02 ? ' D' : v < -0.02 ? ' I' : '');

/** Segundos con 2 decimales, o — si no hay dato */
export const seconds = (v) => (v == null ? '—' : v.toFixed(2));

export const shortDate = (ts) => {
  const d = new Date(ts), p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
