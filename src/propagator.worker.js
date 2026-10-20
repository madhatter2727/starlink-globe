// Runs SGP4 for every satellite off the main thread.
// Output is in scene units (Earth radii) and three.js axes: x=ECI x, y=ECI z, z=-ECI y.
import { json2satrec, sgp4 } from 'satellite.js';

const R = 6371;
let satrecs = [];

self.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === 'init') {
    const { fields, rows } = msg;
    satrecs = rows.map((row) => {
      const o = {};
      fields.forEach((f, i) => (o[f] = row[i]));
      try { return json2satrec(o); } catch { return null; }
    });
    self.postMessage({ type: 'ready', n: satrecs.length });
  } else if (msg.type === 'step') {
    const t0 = performance.now();
    const n = satrecs.length;
    const pos = new Float32Array(n * 3);
    const vel = new Float32Array(n * 3);
    const alt = new Float32Array(n);
    const jd = msg.t / 86400000 + 2440587.5;
    let valid = 0;
    for (let i = 0; i < n; i++) {
      const s = satrecs[i];
      const pv = s ? sgp4(s, (jd - s.jdsatepoch) * 1440) : null;
      const p = pv && pv.position;
      if (!p || !Number.isFinite(p.x)) { alt[i] = -1; continue; }
      const r = Math.hypot(p.x, p.y, p.z);
      const h = r - R;
      // Skip decayed or wildly diverged objects.
      if (h < 120 || h > 3000) { alt[i] = -1; continue; }
      const v = pv.velocity;
      pos[i * 3] = p.x / R; pos[i * 3 + 1] = p.z / R; pos[i * 3 + 2] = -p.y / R;
      vel[i * 3] = v.x / R; vel[i * 3 + 1] = v.z / R; vel[i * 3 + 2] = -v.y / R;
      alt[i] = h;
      valid++;
    }
    self.postMessage(
      { type: 'state', t: msg.t, pos, vel, alt, valid, ms: performance.now() - t0 },
      [pos.buffer, vel.buffer, alt.buffer],
    );
  }
};
