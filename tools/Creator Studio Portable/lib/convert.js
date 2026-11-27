'use strict';
// RS3 (build 950) model -> OSRS mesh. A faithful port of the server's scripts/rs3-port/convert.py, so a model
// converted here matches what the Python pipeline produced for the items already in the game.
//   * RS3 units / 4, Y flipped (RS3 is +Y up, OSRS -Y up), face winding swapped
//   * duplicate vertices welded, degenerate faces dropped, optional clustering decimation to a triangle budget
//   * each face gets one flat OSRS colour: the average of its material's diffuse texture, or its vertex colours
//   * worn models carry bone labels (RS3's legacy labels, mapped or kept raw)
const Model = require('./model');
const { rint } = require('./rs3');

const f32 = Math.fround;
const WEAPON_LABEL = 50, OSRS_LABELS = new Set([27, 28, 50, 161]);
const mapLabel = (l) => OSRS_LABELS.has(l) ? l : (l >= 160 && l <= 170 ? 161 : WEAPON_LABEL);

function hueV(m1, m2, hue) {
  hue = ((hue % 1) + 1) % 1;
  if (hue < 1 / 6) return m1 + (m2 - m1) * hue * 6;
  if (hue < 0.5) return m2;
  if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
  return m1;
}
/** HSL16 -> [r,g,b] 0..1, the way convert.py reads RS3 vertex colours. */
function hsl16ToRgb(c) {
  const h = ((c >> 10) & 63) / 64 + 1 / 128, s = ((c >> 7) & 7) / 8 + 1 / 16, l = (c & 127) / 128;
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  return [hueV(m1, m2, h + 1 / 3), hueV(m1, m2, h), hueV(m1, m2, h - 1 / 3)];
}
function rgbToHsl16(r, g, b) {
  r = Math.min(1, Math.max(0, r)); g = Math.min(1, Math.max(0, g)); b = Math.min(1, Math.max(0, b));
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sum = mx + mn, range = mx - mn, l = sum / 2;
  let h = 0, s = 0;
  if (mn !== mx) {
    s = l <= 0.5 ? range / sum : range / (2 - mx - mn);
    const rc = (mx - r) / range, gc = (mx - g) / range, bc = (mx - b) / range;
    h = r === mx ? bc - gc : g === mx ? 2 + rc - bc : 4 + gc - rc;
    h = (((h / 6) % 1) + 1) % 1;
  }
  return ((Math.trunc(h * 64) & 63) << 10) | (Math.min(7, Math.trunc(s * 8)) << 7) | Math.min(127, Math.max(0, rint(l * 127)));
}
const greyCache = new WeakMap();
function texStats(img) {
  let st = greyCache.get(img);
  if (!st) {
    let sat = 0, sum = 0; const n = img.width * img.height, d = img.data;
    for (let i = 0; i < n; i++) {
      const r = d[i * 4] / 255, g = d[i * 4 + 1] / 255, b = d[i * 4 + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
      sat += (mx - mn) / (mx + 1e-6); sum += r + g + b;
    }
    st = { grey: sat / n < 0.05, mean: sum / (n * 3) }; greyCache.set(img, st);
  }
  return st;
}
/** Per-face colour and alpha for every visible RS3 mesh. Returns { faces:[[a,b,c]], cols:[], alphas:[] }. */
function findMarkers(m) {
  const count = new Map(), faces = new Set(), verts = new Set();
  for (const mesh of m.meshes) for (const i of mesh.tris) count.set(m.label[i], (count.get(m.label[i]) || 0) + 1);
  m.meshes.forEach((mesh, k) => {
    if (mesh.material >= 0 && !mesh.hidden) return;
    for (let t = 0; t < mesh.tris.length; t += 3) {
      const l = m.label[mesh.tris[t]];
      if (l === 0xffff || l !== m.label[mesh.tris[t + 1]] || l !== m.label[mesh.tris[t + 2]] || count.get(l) > 12) continue;
      faces.add(k + ':' + t); for (let j = 0; j < 3; j++) verts.add(mesh.tris[t + j]);
    }
  });
  return { faces, verts };
}
function faceColours(rs3, m, opt) {
  const keep = opt.keep || new Set(), skip = opt.skip || new Set(), skipFaces = opt.skipFaces || new Set();
  const faces = [], cols = [], alphas = [], meshOf = [];
  m.meshes.forEach((mesh, k) => {
    const tris = mesh.tris;
    if (!tris.length || mesh.hidden || skip.has(k)) return;
    const img = rs3.diffuse(mesh.material), st = img ? texStats(img) : null;
    for (let t = 0; t < tris.length; t += 3) {
      if (skipFaces.has(k + ':' + t)) continue;
      const v = [tris[t], tris[t + 1], tris[t + 2]];
      let rgb;
      const vertexRgb = () => { const c = v.map((i) => hsl16ToRgb(m.colour[i])); return [0, 1, 2].map((ch) => (c[0][ch] + c[1][ch] + c[2][ch]) / 3); };
      if (img) {
        const u = v.map((i) => m.uv[i * 2]), w = v.map((i) => m.uv[i * 2 + 1]);
        const mu = f32(f32(f32(u[0] + u[1]) + u[2]) / 3), mw = f32(f32(f32(w[0] + w[1]) + w[2]) / 3);
        const pu = [u[0], u[1], u[2], mu, f32(f32(u[0] + mu) / 2), f32(f32(u[1] + mu) / 2), f32(f32(u[2] + mu) / 2)];
        const pw = [w[0], w[1], w[2], mw, f32(f32(w[0] + mw) / 2), f32(f32(w[1] + mw) / 2), f32(f32(w[2] + mw) / 2)];
        const acc = [0, 0, 0];
        for (let s = 0; s < 7; s++) {
          let uu = pu[s] % 1; if (uu < 0) uu += 1; uu = f32(uu);
          let ww = pw[s] % 1; if (ww < 0) ww += 1; ww = f32(ww);
          const x = Math.min(img.width - 1, Math.max(0, Math.trunc(f32(uu * img.width)))), y = Math.min(img.height - 1, Math.max(0, Math.trunc(f32(ww * img.height))));
          const o = (y * img.width + x) * 4;
          for (let ch = 0; ch < 3; ch++) acc[ch] = f32(acc[ch] + f32(img.data[o + ch] / 255));
        }
        rgb = acc.map((a) => f32(a / 7));
        if (opt.tint && st.grey) {
          const lum = f32(f32(f32(f32(rgb[0] + rgb[1]) + rgb[2]) / 3) / Math.max(1e-3, st.mean));
          rgb = vertexRgb().map((c) => Math.min(1, Math.max(0, c * lum)));
        }
      } else rgb = vertexRgb();
      let col = rgbToHsl16(rgb[0], rgb[1], rgb[2]);
      if (keep.size) {
        const hit = v.map((i) => m.colour[i]).filter((c) => keep.has(c));
        if (hit.length) { const cnt = new Map(); let best = hit[0]; for (const c of hit) { cnt.set(c, (cnt.get(c) || 0) + 1); } for (const [c, n] of cnt) if (n > cnt.get(best)) best = c; col = best; }
        else if (keep.has(col)) col = (col & 127) ? col - 1 : col + 1;
      }
      faces.push(v); cols.push(col); alphas.push(255 - Math.min(m.alpha[v[0]], m.alpha[v[1]], m.alpha[v[2]])); meshOf.push(k);
    }
  });
  return { faces, cols, alphas, meshOf };
}
/** Unique rows in lexicographic order (numpy.unique axis=0): returns { rows, inv }. */
function uniqueRows(rows, width) {
  const n = rows.length / width, order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => { for (let k = 0; k < width; k++) { const d = rows[a * width + k] - rows[b * width + k]; if (d) return d; } return 0; });
  const inv = new Int32Array(n), out = [];
  let last = -1;
  for (let j = 0; j < n; j++) {
    const i = order[j];
    let same = last >= 0;
    if (same) for (let k = 0; k < width; k++) if (rows[i * width + k] !== rows[last * width + k]) { same = false; break; }
    if (!same) { out.push(Array.from(rows.subarray ? rows.subarray(i * width, i * width + width) : rows.slice(i * width, i * width + width))); last = i; }
    inv[i] = out.length - 1;
  }
  return { rows: out, inv };
}
const degenerate = (f) => f[0] === f[1] || f[1] === f[2] || f[0] === f[2];
/** Vertex-clustering decimation: grow the grid cell until the face count fits the budget. */
function decimate(verts, faces, maxTris, keys) {
  let cell = 1.0;
  const w = keys ? 4 : 3;
  for (;;) {
    const q = new Float64Array(verts.length * w);
    verts.forEach((v, i) => { q[i * w] = rint(v[0] / cell); q[i * w + 1] = rint(v[1] / cell); q[i * w + 2] = rint(v[2] / cell); if (keys) q[i * w + 3] = keys[i]; });
    const { rows, inv } = uniqueRows(q, w);
    const seen = new Set(), sel = [];
    faces.forEach((f, i) => {
      const g = [inv[f[0]], inv[f[1]], inv[f[2]]];
      if (degenerate(g)) return;
      const key = g.slice().sort((a, b) => a - b).join(',');
      if (!seen.has(key)) { seen.add(key); sel.push(i); }
    });
    if (sel.length <= maxTris || cell > 64) {
      const sum = rows.map(() => [0, 0, 0, 0]);
      verts.forEach((v, i) => { const s = sum[inv[i]]; s[0] += v[0]; s[1] += v[1]; s[2] += v[2]; s[3]++; });
      return { verts: sum.map((s) => [rint(s[0] / s[3]), rint(s[1] / s[3]), rint(s[2] / s[3])]), sel, inv, cell };
    }
    cell *= 1.15;
  }
}
/**
 * opts: equip (keep labels), maxTris, label (force one), rawLabels (keep RS3 labels), centreXY [x,y], recolor [[from,to]],
 *       retexture [[from,to]], tint, keep (Set of slot colours), skipMeshes (Set), keepSkin (carry RS3 bone weights along)
 * returns { mesh, info, extra } where extra.rs3Label / extra.skin are per output vertex.
 */
function convert(rs3, modelId, opts) {
  opts = opts || {};
  const m = typeof modelId === 'object' ? modelId : rs3.model(modelId);
  if (opts.recolor && opts.recolor.length) { const t = new Map(opts.recolor); for (let i = 0; i < m.vc; i++) if (t.has(m.colour[i])) m.colour[i] = t.get(m.colour[i]); }
  if (opts.retexture && opts.retexture.length) { const t = new Map(opts.retexture); for (const mesh of m.meshes) if (t.has(mesh.material)) mesh.material = t.get(mesh.material); }
  const markers = opts.markers ? findMarkers(m) : { faces: new Set(), verts: new Set() };
  // opts.faceData: faces and colours worked out elsewhere (rs3shade.js for creatures), instead of the item rule
  const fc = opts.faceData || faceColours(rs3, m, { tint: !!opts.tint, keep: opts.keep, skip: opts.skipMeshes, skipFaces: markers.faces });
  if (!fc.faces.length) throw new Error('RS3 model has no visible faces');
  let equip = !!opts.equip;
  let labels;
  if (opts.labels) { labels = Array.from(opts.labels); equip = true; }
  else if (opts.rawLabels) { labels = Array.from(m.label, (l) => l === 0xffff ? 0 : l); equip = true; }
  else labels = (opts.label === undefined || opts.label === null) ? Array.from(m.label, mapLabel) : new Array(m.vc).fill(opts.label);
  const width = equip ? 4 : 3, rows = new Float64Array(m.vc * width);
  for (let i = 0; i < m.vc; i++) {
    rows[i * width] = rint(m.pos[i * 3] / 4); rows[i * width + 1] = rint(-m.pos[i * 3 + 1] / 4); rows[i * width + 2] = rint(m.pos[i * 3 + 2] / 4);
    if (equip) rows[i * width + 3] = labels[i];
  }
  const u = uniqueRows(rows, width);
  let verts = u.rows.map((r) => [r[0], r[1], r[2]]), vlabels = u.rows.map((r) => equip ? r[3] : 0);
  // which RS3 vertex each output vertex came from (the last one wins, as in the Python pipeline)
  let source = new Int32Array(verts.length); for (let i = 0; i < m.vc; i++) source[u.inv[i]] = i;
  let faces = [], cols = [], alphas = [], meshOf = [];
  fc.faces.forEach((f, i) => {
    const g = [u.inv[f[0]], u.inv[f[2]], u.inv[f[1]]];          // swap winding
    if (!degenerate(g)) { faces.push(g); cols.push(fc.cols[i]); alphas.push(fc.alphas[i]); meshOf.push(fc.meshOf[i]); }
  });
  let cell = null;
  if (opts.maxTris && faces.length > opts.maxTris) {
    const d = decimate(verts, faces, opts.maxTris, opts.clusterByLabel ? vlabels : null);
    const nl = new Array(d.verts.length).fill(0), ns = new Int32Array(d.verts.length);
    for (let i = 0; i < verts.length; i++) { nl[d.inv[i]] = vlabels[i]; ns[d.inv[i]] = source[i]; }
    faces = d.sel.map((i) => [d.inv[faces[i][0]], d.inv[faces[i][1]], d.inv[faces[i][2]]]);
    cols = d.sel.map((i) => cols[i]); alphas = d.sel.map((i) => alphas[i]); meshOf = d.sel.map((i) => meshOf[i]);
    verts = d.verts; vlabels = nl; source = ns; cell = d.cell;
  }
  const used = [...new Set(faces.flat())].sort((a, b) => a - b), remap = new Int32Array(verts.length).fill(-1);
  used.forEach((v, i) => { remap[v] = i; });
  verts = used.map((v) => verts[v]); vlabels = used.map((v) => vlabels[v]); const src = used.map((v) => source[v]);
  faces = faces.map((f) => [remap[f[0]], remap[f[1]], remap[f[2]]]);
  if (opts.centreXY) {
    const b = [0, 1].map((k) => (Math.min(...verts.map((v) => v[k])) + Math.max(...verts.map((v) => v[k]))) / 2);
    const dx = rint(opts.centreXY[0] - b[0]), dy = rint(opts.centreXY[1] - b[1]);
    verts = verts.map((v) => [v[0] + dx, v[1] + dy, v[2]]);
  }
  const mesh = Model.fromArrays(verts, faces, cols, { alpha: alphas, vskin: equip ? vlabels : null });
  const bb = Model.bounds(mesh);
  const info = { rs3Vertices: m.vc, rs3Tris: m.meshes.reduce((n, x) => n + x.tris.length / 3, 0), vertices: mesh.nv, tris: mesh.nf, cell,
    min: bb.min, max: bb.max, labels: equip ? [...new Set(vlabels)].sort((a, b) => a - b) : null };
  const helpers = [...markers.verts].map((i) => ({ pos: [rint(m.pos[i * 3] / 4), rint(-m.pos[i * 3 + 1] / 4), rint(m.pos[i * 3 + 2] / 4)], rs3Label: m.label[i] }));
  const extra = { rs3Label: src.map((i) => m.label[i]), skin: m.skin ? src.map((i) => m.skin[i]) : null, meshOf, emitterCount: m.counts[2], helpers };
  return { mesh, info, extra, rs3: m };
}
module.exports = { convert, hsl16ToRgb, rgbToHsl16, mapLabel, uniqueRows, findMarkers, faceColours };
