'use strict';
// Software renderer for previews and checks (no browser needed): orthographic, z-buffered, game lighting.
const Model = require('./model');
const png = require('./png');
/**
 * opt: yaw, pitch (radians), size, positions (Float64Array to draw instead of the mesh's own vertices),
 *      faceRgb(f) -> [r,g,b] | null override, bg [r,g,b], centre [x,y,z], scale, hideFace(f)
 * returns { width, height, data RGBA, centre, scale }
 */
function render(m, opt) {
  opt = opt || {};
  const size = opt.size || 360, yaw = opt.yaw === undefined ? 0.6 : opt.yaw, pitch = opt.pitch === undefined ? -0.25 : opt.pitch;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const P = opt.positions, nv = m.nv, X = new Float64Array(nv), Y = new Float64Array(nv), Z = new Float64Array(nv);
  let centre = opt.centre;
  if (!centre) { const b = Model.bounds(m); centre = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]; }
  let ext = 1;
  for (let i = 0; i < nv; i++) {
    const x = (P ? P[i * 3] : m.vx[i]) - centre[0], y = (P ? P[i * 3 + 1] : m.vy[i]) - centre[1], z = (P ? P[i * 3 + 2] : m.vz[i]) - centre[2];
    const x1 = cy * x + sy * z, z1 = -sy * x + cy * z;
    X[i] = x1; Y[i] = cp * y - sp * z1; Z[i] = sp * y + cp * z1;
    ext = Math.max(ext, Math.abs(X[i]), Math.abs(Y[i]));
  }
  const scale = opt.scale || size * 0.46 / ext;
  const bg = opt.bg || [38, 40, 46], data = new Uint8Array(size * size * 4), zb = new Float64Array(size * size).fill(Infinity);
  for (let i = 0; i < size * size; i++) { data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255; }
  let src = m;
  if (P) { src = Model.clone(m); for (let i = 0; i < nv; i++) { src.vx[i] = Math.round(P[i * 3]); src.vy[i] = Math.round(P[i * 3 + 1]); src.vz[i] = Math.round(P[i * 3 + 2]); } }
  const lit = Model.light(src, 64, 850, -30, -50, -30);
  for (let f = 0; f < m.nf; f++) {
    if (lit[f * 3] === -2 || (opt.hideFace && opt.hideFace(f))) continue;
    if (m.alpha && m.alpha[f] >= 250) continue;
    const a = m.fa[f], b = m.fb[f], c = m.fc[f];
    const xs = [X[a] * scale + size / 2, X[b] * scale + size / 2, X[c] * scale + size / 2], ys = [Y[a] * scale + size / 2, Y[b] * scale + size / 2, Y[c] * scale + size / 2], zs = [Z[a], Z[b], Z[c]];
    const d = (xs[1] - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (ys[1] - ys[0]);
    if (Math.abs(d) < 1e-9) continue;
    const over = opt.faceRgb ? opt.faceRgb(f) : null;
    const C = over ? [over, over, over] : [0, 1, 2].map((k) => { const v = Model.hslToRgb(m.ftex && m.ftex[f] !== -1 ? Model.adjust(opt.texColour ? opt.texColour(m.ftex[f]) : 4660, 90) : lit[f * 3 + k]); return [v >> 16 & 255, v >> 8 & 255, v & 255]; });
    const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(size - 1, Math.ceil(Math.max(...xs))), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(size - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const px = x + 0.5, py = y + 0.5;
      const w1 = ((px - xs[0]) * (ys[2] - ys[0]) - (xs[2] - xs[0]) * (py - ys[0])) / d, w2 = ((xs[1] - xs[0]) * (py - ys[0]) - (px - xs[0]) * (ys[1] - ys[0])) / d, w0 = 1 - w1 - w2;
      if (w0 < -1e-6 || w1 < -1e-6 || w2 < -1e-6) continue;
      const z = w0 * zs[0] + w1 * zs[1] + w2 * zs[2], i = y * size + x;
      if (z >= zb[i]) continue;
      zb[i] = z;
      for (let k = 0; k < 3; k++) data[i * 4 + k] = w0 * C[0][k] + w1 * C[1][k] + w2 * C[2][k];
    }
  }
  return { width: size, height: size, data, centre, scale };
}
/** Tile several renders into one sheet and return PNG bytes. labels are not drawn (keep callers' captions). */
function sheet(tiles, cols) {
  cols = cols || tiles.length;
  const w = tiles[0].width, h = tiles[0].height, rows = Math.ceil(tiles.length / cols), out = new Uint8Array(w * cols * h * rows * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  tiles.forEach((t, k) => { const ox = (k % cols) * w, oy = Math.floor(k / cols) * h; for (let y = 0; y < h; y++) out.set(t.data.subarray(y * w * 4, (y + 1) * w * 4), ((oy + y) * w * cols + ox) * 4); });
  return png.encode(w * cols, h * rows, out);
}
module.exports = { render, sheet };
