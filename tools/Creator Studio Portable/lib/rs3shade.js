'use strict';
// How an RS3 face really looks, worked out the way RS3 draws it, for porting NPCs and scenery "OSRS style"
// (one flat colour per face, no textures).
//
// RS3 draws a face as  texture colour x vertex colour , cut out by the texture's alpha channel. The item converter
// (convert.js) takes the texture's average colour on its own, which is right for most items but wrong for models
// that are painted with vertex colours over a plain stone or cloth texture: Vorago's rock plates came out pale
// grey instead of dark brown. Three more things matter on big creatures:
//   * coverage  - effect layers (glows, dust streaks, auras) use textures that are mostly transparent. Baked as solid
//                 faces they become big opaque shards. A face whose texture is mostly see-through is left out.
//   * glow      - thin bright lines painted into a dark texture (energy veins) vanish in an average. A face that
//                 a line crosses takes the line's colour instead.
//   * markers   - tiny hidden triangles that only mark where a joint turns (convert.js findMarkers). Never drawn,
//                 but their positions must be kept as joint pivots (see markerAnchors).
const { hsl16ToRgb, rgbToHsl16, findMarkers } = require('./convert');
const { rint } = require('./rs3');

// sample points inside a triangle as barycentric weights: corners pulled in, edge middles, centre and a ring
const SAMPLES = (() => { const s = [[1 / 3, 1 / 3, 1 / 3]]; for (const [a, b, c] of [[0.8, 0.1, 0.1], [0.1, 0.8, 0.1], [0.1, 0.1, 0.8], [0.45, 0.45, 0.1], [0.45, 0.1, 0.45], [0.1, 0.45, 0.45], [0.6, 0.2, 0.2], [0.2, 0.6, 0.2], [0.2, 0.2, 0.6], [0.6, 0.35, 0.05], [0.35, 0.05, 0.6], [0.05, 0.6, 0.35], [0.35, 0.6, 0.05], [0.05, 0.35, 0.6], [0.6, 0.05, 0.35]]) s.push([a, b, c]); return s; })();
const stats = new WeakMap();
function textureStats(img) {
  let st = stats.get(img);
  if (!st) {
    let lum = 0, a = 0, soft = 0; const n = img.width * img.height, d = img.data;
    for (let i = 0; i < n; i++) { lum += (d[i * 4] + d[i * 4 + 1] + d[i * 4 + 2]) / 765; a += d[i * 4 + 3] / 255; if (d[i * 4 + 3] > 40 && d[i * 4 + 3] < 215) soft++; }
    // soft: an effect layer (glow, dust, aura) fades in and out everywhere; a cut-out (leaves, chains) is either there or not
    st = { lum: lum / n, alpha: a / n, soft: soft / n > 0.35 }; stats.set(img, st);
  }
  return st;
}
/**
 * One record per visible RS3 face: { v:[a,b,c], mesh, rgb:[r,g,b] 0..1, colour (game number), cover 0..1, glow }.
 * opts: glow (default true), keepSoft (keep soft effect layers; they are left out by default).
 * Recolours / retextures are expected to be applied to the model already.
 */
function shadeFaces(rs3, m, opts) {
  opts = opts || {};
  const markers = findMarkers(m), out = [];
  m.meshes.forEach((mesh, k) => {
    if (!mesh.tris.length || mesh.hidden) return;
    const img = rs3.diffuse(mesh.material), st = img ? textureStats(img) : null;
    for (let t = 0; t < mesh.tris.length; t += 3) {
      if (markers.faces.has(k + ':' + t)) continue;
      const v = [mesh.tris[t], mesh.tris[t + 1], mesh.tris[t + 2]], vc = v.map((i) => hsl16ToRgb(m.colour[i]));
      const tint = [0, 1, 2].map((ch) => (vc[0][ch] + vc[1][ch] + vc[2][ch]) / 3);
      const va = Math.min(m.alpha[v[0]], m.alpha[v[1]], m.alpha[v[2]]) / 255;
      let rgb = tint, cover = va, glow = false;
      if (img) {
        const acc = [0, 0, 0], bright = [0, 0, 0]; let aSum = 0, wSum = 0, nBright = 0;
        for (const w of SAMPLES) {
          let u = m.uv[v[0] * 2] * w[0] + m.uv[v[1] * 2] * w[1] + m.uv[v[2] * 2] * w[2], q = m.uv[v[0] * 2 + 1] * w[0] + m.uv[v[1] * 2 + 1] * w[1] + m.uv[v[2] * 2 + 1] * w[2];
          u -= Math.floor(u); q -= Math.floor(q);
          const o = (Math.min(img.height - 1, Math.floor(q * img.height)) * img.width + Math.min(img.width - 1, Math.floor(u * img.width))) * 4;
          const r = img.data[o] / 255, g = img.data[o + 1] / 255, b = img.data[o + 2] / 255, a = img.data[o + 3] / 255, lum = (r + g + b) / 3;
          aSum += a; acc[0] += r * a; acc[1] += g * a; acc[2] += b * a; wSum += a;
          if (a > 0.5 && lum > 0.3 && lum > st.lum * 2.4) { nBright++; bright[0] += r; bright[1] += g; bright[2] += b; }
        }
        cover = st.soft && !opts.keepSoft ? 0 : va * aSum / SAMPLES.length;
        const tex = wSum > 0 ? acc.map((c) => c / wSum) : [0, 0, 0];
        rgb = [tex[0] * tint[0], tex[1] * tint[1], tex[2] * tint[2]];
        if (opts.glow !== false && nBright >= 4 && st.lum < 0.3) { glow = true; rgb = bright.map((c) => c / nBright); }
      }
      out.push({ v, mesh: k, rgb, colour: rgbToHsl16(rgb[0], rgb[1], rgb[2]), cover, glow });
    }
  });
  return out;
}
/** Where the RS3 model's hidden marker triangles sit, in game space: joint pivots to keep. [{ pos:[x,y,z], label }] */
function markerAnchors(m) {
  const seen = new Set(), out = [];
  for (const i of findMarkers(m).verts) {
    const pos = [rint(m.pos[i * 3] / 4), rint(-m.pos[i * 3 + 1] / 4), rint(m.pos[i * 3 + 2] / 4)], k = pos.join(',') + '|' + m.label[i];
    if (!seen.has(k)) { seen.add(k); out.push({ pos, label: m.label[i] }); }
  }
  return out;
}
module.exports = { shadeFaces, markerAnchors, textureStats };
