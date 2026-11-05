// Grabación de la sesión a 10 Hz y exportación a CSV.

const RATE_HZ = 10;
const HEADER = 'time,lat,lon,speed_kmh,g_long,g_lat,lean_deg,pitch_deg';

export class Recorder {
  constructor() { this.on = false; this.rows = []; this._lastT = -1; }

  start() { this.on = true; this.rows = []; this._lastT = -1; }
  stop() { this.on = false; }

  /** Añade una fila si toca (máximo 10 por segundo). */
  tick(t, { lat, lon, kmh, lonG, latG, lean, pitch }) {
    if (!this.on || t - this._lastT < 1 / RATE_HZ) return;
    this._lastT = t;
    this.rows.push([
      Date.now(),
      lat != null ? lat.toFixed(6) : '',
      lon != null ? lon.toFixed(6) : '',
      kmh.toFixed(1), lonG.toFixed(3), latG.toFixed(3), lean.toFixed(1), pitch.toFixed(1),
    ]);
  }

  toCsv() {
    return HEADER + '\n' + this.rows.map((r) => [new Date(r[0]).toISOString(), ...r.slice(1)].join(',')).join('\n');
  }

  fileName() {
    const d = new Date(), p = (n) => String(n).padStart(2, '0');
    return `racemeter-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.csv`;
  }

  /** Comparte el CSV (menú de compartir del iPhone) o lo descarga. */
  async exportFile() {
    const name = this.fileName();
    const blob = new Blob([this.toCsv()], { type: 'text/csv' });
    try {
      const file = new File([blob], name, { type: 'text/csv' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
    } catch (e) { if (e && e.name === 'AbortError') return; }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }
}
