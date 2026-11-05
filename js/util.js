// Constantes y utilidades matemáticas comunes. Sin dependencias del navegador.

export const G = 9.80665;               // gravedad estándar (m/s²)
export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;
export const KMH = 3.6;                 // m/s → km/h

/* ---------- vectores 3D como arrays [x, y, z] ---------- */
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const normalize = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
/** Componente de `a` perpendicular al vector unitario `u`. */
export const perpTo = (a, u) => sub(a, scale(u, dot(a, u)));

export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** Coeficiente de un filtro paso bajo de primer orden con constante de tiempo `tau` (s). */
export const lowPass = (dt, tau) => 1 - Math.exp(-dt / tau);

/**
 * Instante en que una magnitud que vale v0 en t0 y v1 en t1 pasa por x
 * (interpolación lineal). Sirve para afinar cruces de velocidad entre muestras.
 */
export const crossingTime = (t0, v0, t1, v1, x) => (v1 === v0 ? t1 : t0 + ((t1 - t0) * (x - v0)) / (v1 - v0));

/** Distancia en metros entre dos coordenadas (fórmula del haversine). */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * D2R;
  const dLon = (lon2 - lon1) * D2R;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * D2R) * Math.cos(lat2 * D2R) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}
