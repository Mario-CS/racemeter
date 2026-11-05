// Guardado persistente en localStorage (con prefijo). Si no hay localStorage
// (por ejemplo en las pruebas con Node) simplemente no guarda nada.

const PREFIX = 'rm_';

const available = (() => {
  try { return typeof localStorage !== 'undefined' && localStorage !== null; } catch { return false; }
})();

export const storage = {
  get(key, fallback) {
    if (!available) return fallback;
    try {
      const v = localStorage.getItem(PREFIX + key);
      return v == null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    if (!available) return;
    try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* lleno o bloqueado */ }
  },
};
