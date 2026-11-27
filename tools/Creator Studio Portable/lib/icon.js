'use strict';
// Inventory icon maths: the client's item-sprite projection (port of icon.py), a fitter for zoom/offsets and a renderer.
const Model = require('./model');
const SIN = (a) => Math.sin(a * 2 * Math.PI / 2048), COS = (a) => Math.cos(a * 2 * Math.PI / 2048);

function project(m, zoom, xan, yan, zan, ox, oy) {
  let minY = Infinity; for (let i = 0; i < m.nv; i++) if (m.vy[i] < minY) minY = m.vy[i];
  const height = Math.max(1, -minY), out = new Float64Array(m.nv * 3);
  for (let i = 0; i < m.nv; i++) {
    let x = m.vx[i], y = m.vy[i], z = m.vz[i], t;
    if (zan) { t = y * SIN(zan) + x * COS(zan); y = y * COS(zan) - x * SIN(zan); x = t; }
    if (yan) { t = z * SIN(yan) + x * COS(yan); z = z * COS(yan) - x * SIN(yan); x = t; }
    x += ox; y += height / 2 + zoom * SIN(xan) + oy; z += zoom * COS(xan) + oy;
    t = y * COS(xan) - z * SIN(xan); z = y * SIN(xan) + z * COS(xan); y = t;
    out[i * 3] = 16 + x * 512 / z; out[i * 3 + 1] = 16 + y * 512 / z; out[i * 3 + 2] = z;
  }
  return out;
}
function span(p, n) {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) { const x = p[i * 3], y = p[i * 3 + 1]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { x0, x1, y0, y1 };
}
/** Pick zoom so the model spans about `target` px, then centre it with offsets. */
function fit(m, xan, yan, zan, target) {
  target = target || 30;
  let zoom = 2000;
  for (let k = 0; k < 30; k++) { const s = span(project(m, zoom, xan, yan, zan, 0, 0), m.nv); zoom = Math.trunc(zoom * Math.max(s.x1 - s.x0, s.y1 - s.y0) / target); if (zoom < 1) { zoom = 1; break; } }
  let best = null;
  for (let ox = -60; ox <= 60; ox += 2) for (let oy = -60; oy <= 60; oy += 2) {
    const s = span(project(m, zoom, xan, yan, zan, ox, oy), m.nv), cx = (s.x0 + s.x1) / 2 - 16, cy = (s.y0 + s.y1) / 2 - 16, e = cx * cx + cy * cy;
    if (!best || e < best[0]) best = [e, ox, oy];
  }
  return { zoom2d: zoom, offsetX2d: best[1], offsetY2d: best[2] };
}
/** Draws the 36x32 inventory icon (scaled up `scale` times) with the client's outline and shadow. Returns RGBA. */
function render(m, def, scale) {
  scale = scale || 4;
  const W = 36 * scale, H = 32 * scale, p = project(m, def.zoom2d, def.xan2d || 0, def.yan2d || 0, def.zan2d || 0, def.offsetX2d || 0, def.offsetY2d || 0);
  const lit = Model.light(m, 64 + (def.ambient || 0), 768 + (def.contrast || 0), -50, -10, -50);
  const rgba = new Uint8Array(W * H * 4), zb = new Float64Array(W * H).fill(Infinity);
  for (let f = 0; f < m.nf; f++) {
    if (lit[f * 3] === -2) continue;
    const a = m.fa[f], b = m.fb[f], c = m.fc[f];
    const X = [p[a * 3] * scale, p[b * 3] * scale, p[c * 3] * scale], Y = [p[a * 3 + 1] * scale, p[b * 3 + 1] * scale, p[c * 3 + 1] * scale], Z = [p[a * 3 + 2], p[b * 3 + 2], p[c * 3 + 2]];
    if (Z[0] < 50 || Z[1] < 50 || Z[2] < 50) continue;
    const d = (X[1] - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (Y[1] - Y[0]);
    if (Math.abs(d) < 1e-9) continue;
    const C = [0, 1, 2].map((k) => Model.hslToRgb(lit[f * 3 + k]));
    const x0 = Math.max(0, Math.floor(Math.min(...X))), x1 = Math.min(W - 1, Math.ceil(Math.max(...X))), y0 = Math.max(0, Math.floor(Math.min(...Y))), y1 = Math.min(H - 1, Math.ceil(Math.max(...Y)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((px - X[0]) * (Y[2] - Y[0]) - (X[2] - X[0]) * (py - Y[0])) / d, w2 = ((X[1] - X[0]) * (py - Y[0]) - (px - X[0]) * (Y[1] - Y[0])) / d, w0 = 1 - w1 - w2;
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;
      const z = w0 * Z[0] + w1 * Z[1] + w2 * Z[2], i = y * W + x;
      if (z >= zb[i]) continue;
      zb[i] = z;
      rgba[i * 4] = w0 * (C[0] >> 16 & 255) + w1 * (C[1] >> 16 & 255) + w2 * (C[2] >> 16 & 255);
      rgba[i * 4 + 1] = w0 * (C[0] >> 8 & 255) + w1 * (C[1] >> 8 & 255) + w2 * (C[2] >> 8 & 255);
      rgba[i * 4 + 2] = w0 * (C[0] & 255) + w1 * (C[1] & 255) + w2 * (C[2] & 255);
      rgba[i * 4 + 3] = 255;
    }
  }
  // 1px (scaled) black outline, then a soft drop shadow, like the client's item sprites
  const filled = (x, y) => x >= 0 && y >= 0 && x < W && y < H && rgba[(y * W + x) * 4 + 3] === 255;
  const out = Uint8Array.from(rgba), s = scale;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (filled(x, y)) continue;
    const i = (y * W + x) * 4;
    if (filled(x - s, y) || filled(x + s, y) || filled(x, y - s) || filled(x, y + s)) { out[i] = out[i + 1] = out[i + 2] = 1; out[i + 3] = 255; }
    else if (filled(x - s, y - s)) { out[i] = 48; out[i + 1] = 32; out[i + 2] = 32; out[i + 3] = 255; }
  }
  return { width: W, height: H, data: out };
}
module.exports = { project, fit, render };
