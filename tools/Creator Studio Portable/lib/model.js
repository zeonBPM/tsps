// OSRS model codec + mesh helpers. Runs in Node and in the browser (the viewer loads this same file).
// A mesh: { fmt, nv, nf, vx, vy, vz, fa, fb, fc, col, rtype, prio, priority, alpha, fskin, vskin, ftex, bones, weights }
//   col   Uint16Array  HSL16 per face ((hue << 10) | (sat << 7) | light)
//   alpha Uint8Array   0 = opaque ... 255 = invisible (null when no face is transparent)
//   vskin Int32Array   one "label" (bone group) per vertex, or null
//   rtype Int8Array    0 smooth, 1 flat, 2/3 hidden (null = all smooth)
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Model = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const u16 = (d, p) => (d[p] << 8) | d[p + 1];
  function smart2(d, s) { const v = d[s.p]; if (v < 128) { s.p++; return v - 64; } s.p += 2; return ((v << 8) | d[s.p - 1]) - 49152; }

  function readVerts(m, d, flagsOff, xOff, yOff, zOff) {
    const nv = m.nv, vx = m.vx = new Int32Array(nv), vy = m.vy = new Int32Array(nv), vz = m.vz = new Int32Array(nv);
    const sx = { p: xOff }, sy = { p: yOff }, sz = { p: zOff };
    let x = 0, y = 0, z = 0;
    for (let i = 0; i < nv; i++) {
      const f = d[flagsOff + i];
      if (f & 1) x += smart2(d, sx);
      if (f & 2) y += smart2(d, sy);
      if (f & 4) z += smart2(d, sz);
      vx[i] = x; vy[i] = y; vz[i] = z;
    }
    return { xEnd: sx.p, yEnd: sy.p, zEnd: sz.p };
  }
  function readFaces(m, d, typeOff, dataOff) {
    const nf = m.nf, fa = m.fa = new Int32Array(nf), fb = m.fb = new Int32Array(nf), fc = m.fc = new Int32Array(nf);
    const s = { p: dataOff };
    let a = 0, b = 0, c = 0, last = 0;
    for (let i = 0; i < nf; i++) {
      const t = d[typeOff + i];
      if (t === 1) { a = smart2(d, s) + last; b = smart2(d, s) + a; c = smart2(d, s) + b; last = c; }
      else if (t === 2) { b = c; c = smart2(d, s) + last; last = c; }
      else if (t === 3) { a = c; c = smart2(d, s) + last; last = c; }
      else if (t === 4) { const t0 = a; a = b; b = t0; c = smart2(d, s) + last; last = c; }
      fa[i] = a; fb[i] = b; fc[i] = c;
    }
    return s.p;
  }
  const slice8 = (d, off, n) => Uint8Array.from(d.subarray(off, off + n));
  const sliceS8 = (d, off, n) => { const o = new Int8Array(n); for (let i = 0; i < n; i++) o[i] = d[off + i] << 24 >> 24; return o; };
  const sliceI32 = (d, off, n) => { const o = new Int32Array(n); for (let i = 0; i < n; i++) o[i] = d[off + i]; return o; };
  function readCols(d, off, n) { const o = new Uint16Array(n); for (let i = 0; i < n; i++) o[i] = u16(d, off + i * 2); return o; }
  function blank(fmt, nv, nf) {
    return { fmt, nv, nf, vx: null, vy: null, vz: null, fa: null, fb: null, fc: null, col: null, rtype: null, prio: null,
      priority: 0, alpha: null, fskin: null, vskin: null, ftex: null, bones: null, weights: null };
  }
  /** The old/v2 "face info" byte: bit 0 = flat shading, bit 1 = textured (colour holds the texture id). */
  function applyFaceInfo(m, d, off) {
    const nf = m.nf; let anyType = false, anyTex = false;
    const rtype = new Int8Array(nf), ftex = new Int16Array(nf).fill(-1);
    for (let i = 0; i < nf; i++) {
      const v = d[off + i];
      if (v & 1) { rtype[i] = 1; anyType = true; }
      if (v & 2) { ftex[i] = m.col[i]; m.col[i] = 127; if (ftex[i] !== -1) anyTex = true; }
    }
    if (anyType) m.rtype = rtype;
    if (anyTex) m.ftex = ftex;
  }
  function decodeOld(d) {
    const n = d.length, h = n - 18;
    const m = blank('old', u16(d, h), u16(d, h + 2));
    const ntex = d[h + 4], hasInfo = d[h + 5], prio = d[h + 6], hasAlpha = d[h + 7], hasFskin = d[h + 8], hasVskin = d[h + 9];
    const lx = u16(d, h + 10), ly = u16(d, h + 12), lidx = u16(d, h + 16);
    const { nv, nf } = m;
    let o = nv;
    const oType = o; o += nf;
    const oPrio = o; if (prio === 255) o += nf;
    const oFskin = o; if (hasFskin === 1) o += nf;
    const oInfo = o; if (hasInfo === 1) o += nf;
    const oVskin = o; if (hasVskin === 1) o += nv;
    const oAlpha = o; if (hasAlpha === 1) o += nf;
    const oIdx = o; o += lidx;
    const oCol = o; o += nf * 2;
    o += ntex * 6;
    const oX = o, oY = oX + lx, oZ = oY + ly;
    readVerts(m, d, 0, oX, oY, oZ);
    readFaces(m, d, oType, oIdx);
    m.col = readCols(d, oCol, nf);
    if (hasInfo === 1) applyFaceInfo(m, d, oInfo);
    if (prio === 255) m.prio = sliceS8(d, oPrio, nf); else m.priority = prio;
    if (hasAlpha === 1) m.alpha = slice8(d, oAlpha, nf);
    if (hasFskin === 1) m.fskin = sliceI32(d, oFskin, nf);
    if (hasVskin === 1) m.vskin = sliceI32(d, oVskin, nv);
    return m;
  }
  function readMaya(m, d, off) {
    m.bones = new Array(m.nv); m.weights = new Array(m.nv);
    for (let i = 0; i < m.nv; i++) {
      const c = d[off++]; const b = new Uint8Array(c), w = new Uint8Array(c);
      for (let j = 0; j < c; j++) { b[j] = d[off++]; w[j] = d[off++]; }
      m.bones[i] = b; m.weights[i] = w;
    }
  }
  function decodeV2(d) {
    const n = d.length, h = n - 23;
    const m = blank('v2', u16(d, h), u16(d, h + 2));
    const ntex = d[h + 4], hasInfo = d[h + 5], prio = d[h + 6], hasAlpha = d[h + 7], hasFskin = d[h + 8], hasVskin = d[h + 9], hasMaya = d[h + 10];
    const lx = u16(d, h + 11), ly = u16(d, h + 13), lidx = u16(d, h + 17), lvs = u16(d, h + 19);
    const { nv, nf } = m;
    let o = nv;
    const oType = o; o += nf;
    const oPrio = o; if (prio === 255) o += nf;
    const oFskin = o; if (hasFskin === 1) o += nf;
    const oInfo = o; if (hasInfo === 1) o += nf;
    const oVskin = o; o += lvs;
    const oAlpha = o; if (hasAlpha === 1) o += nf;
    const oIdx = o; o += lidx;
    const oCol = o; o += nf * 2;
    o += ntex * 6;
    const oX = o, oY = oX + lx, oZ = oY + ly;
    readVerts(m, d, 0, oX, oY, oZ);
    readFaces(m, d, oType, oIdx);
    m.col = readCols(d, oCol, nf);
    if (hasInfo === 1) applyFaceInfo(m, d, oInfo);
    if (prio === 255) m.prio = sliceS8(d, oPrio, nf); else m.priority = prio;
    if (hasAlpha === 1) m.alpha = slice8(d, oAlpha, nf);
    if (hasFskin === 1) m.fskin = sliceI32(d, oFskin, nf);
    if (hasVskin === 1) m.vskin = sliceI32(d, oVskin, nv);
    if (hasMaya === 1) readMaya(m, d, oVskin + (hasVskin === 1 ? nv : 0));
    return m;
  }
  /** v1 (0xffff) and v3 (0xfffd) share a layout; v3 adds bone weights and a stored vertex-skin length. */
  function decodeNew(d, v3) {
    const n = d.length, h = n - (v3 ? 26 : 23);
    const m = blank(v3 ? 'v3' : 'v1', u16(d, h), u16(d, h + 2));
    const ntex = d[h + 4], hasType = d[h + 5], prio = d[h + 6], hasAlpha = d[h + 7], hasFskin = d[h + 8], hasTex = d[h + 9], hasVskin = d[h + 10];
    const hasMaya = v3 ? d[h + 11] : 0, q = h + (v3 ? 12 : 11);
    const lx = u16(d, q), ly = u16(d, q + 2), lz = u16(d, q + 4), lidx = u16(d, q + 6), ltc = u16(d, q + 8);
    const { nv, nf } = m;
    const lvs = v3 ? u16(d, q + 10) : (hasVskin === 1 ? nv : 0);
    let o = ntex + nv;
    const oRt = o; if (hasType === 1) o += nf;
    const oType = o; o += nf;
    const oPrio = o; if (prio === 255) o += nf;
    const oFskin = o; if (hasFskin === 1) o += nf;
    const oVskin = o; o += lvs;
    const oAlpha = o; if (hasAlpha === 1) o += nf;
    const oIdx = o; o += lidx;
    const oTex = o; if (hasTex === 1) o += nf * 2;
    o += ltc;
    const oCol = o; o += nf * 2;
    const oX = o, oY = oX + lx, oZ = oY + ly;
    readVerts(m, d, ntex, oX, oY, oZ);
    readFaces(m, d, oType, oIdx);
    m.col = readCols(d, oCol, nf);
    if (hasType === 1) m.rtype = sliceS8(d, oRt, nf);
    if (prio === 255) m.prio = sliceS8(d, oPrio, nf); else m.priority = prio;
    if (hasAlpha === 1) m.alpha = slice8(d, oAlpha, nf);
    if (hasFskin === 1) m.fskin = sliceI32(d, oFskin, nf);
    if (hasVskin === 1) m.vskin = sliceI32(d, oVskin, nv);
    if (hasTex === 1) { m.ftex = new Int16Array(nf); for (let i = 0; i < nf; i++) m.ftex[i] = u16(d, oTex + i * 2) - 1; }
    if (hasMaya === 1) readMaya(m, d, oVskin + (hasVskin === 1 ? nv : 0));
    void lz;
    return m;
  }
  function decode(d) {
    const n = d.length;
    if (n < 18) throw new Error('model data too short');
    let m;
    if (d[n - 2] === 0xff && d[n - 1] === 0xfd) m = decodeNew(d, true);
    else if (d[n - 2] === 0xff && d[n - 1] === 0xfe) m = decodeV2(d);
    else if (d[n - 2] === 0xff && d[n - 1] === 0xff) m = decodeNew(d, false);
    else m = decodeOld(d);
    for (let i = 0; i < m.nf; i++) if (m.fa[i] < 0 || m.fb[i] < 0 || m.fc[i] < 0 || m.fa[i] >= m.nv || m.fb[i] >= m.nv || m.fc[i] >= m.nv) throw new Error('model decode: face ' + i + ' out of range');
    return m;
  }

  // ---- encoding (the original footer-less format the game client reads with decodeOld) ----
  function pushSmart2(a, v) {
    if (v >= -64 && v < 64) a.push(v + 64);
    else if (v >= -16384 && v < 16384) { const w = v + 49152; a.push((w >> 8) & 255, w & 255); }
    else throw new Error('model is too large for the game format (a coordinate jump of ' + v + ')');
  }
  /** Mesh -> bytes. Keeps labels, face labels, alpha, per-face priorities and flat-shading flags. Textures are not written. */
  function encode(m) {
    const { nv, nf } = m;
    if (nv > 65535 || nf > 65535) throw new Error('too many vertices or faces for the game format');
    const vflags = [], xs = [], ys = [], zs = [];
    let lx = 0, ly = 0, lz = 0;
    for (let i = 0; i < nv; i++) {
      const dx = m.vx[i] - lx, dy = m.vy[i] - ly, dz = m.vz[i] - lz; let f = 0;
      if (dx) { f |= 1; pushSmart2(xs, dx); }
      if (dy) { f |= 2; pushSmart2(ys, dy); }
      if (dz) { f |= 4; pushSmart2(zs, dz); }
      vflags.push(f); lx = m.vx[i]; ly = m.vy[i]; lz = m.vz[i];
    }
    const idx = []; let last = 0;
    for (let i = 0; i < nf; i++) { pushSmart2(idx, m.fa[i] - last); pushSmart2(idx, m.fb[i] - m.fa[i]); pushSmart2(idx, m.fc[i] - m.fb[i]); last = m.fc[i]; }
    const hasAlpha = !!m.alpha && m.alpha.some((a) => a !== 0);
    const hasInfo = !!m.rtype && m.rtype.some((t) => t === 1);
    const perFacePrio = !!m.prio;
    const out = [];
    for (const f of vflags) out.push(f);
    for (let i = 0; i < nf; i++) out.push(1);
    if (perFacePrio) for (let i = 0; i < nf; i++) out.push(m.prio[i] & 255);
    if (m.fskin) for (let i = 0; i < nf; i++) out.push(m.fskin[i] & 255);
    if (hasInfo) for (let i = 0; i < nf; i++) out.push(m.rtype[i] === 1 ? 1 : 0);
    if (m.vskin) for (let i = 0; i < nv; i++) out.push(m.vskin[i] & 255);
    if (hasAlpha) for (let i = 0; i < nf; i++) out.push(m.alpha[i] & 255);
    for (const b of idx) out.push(b);
    for (let i = 0; i < nf; i++) out.push((m.col[i] >> 8) & 255, m.col[i] & 255);
    for (const b of xs) out.push(b); for (const b of ys) out.push(b); for (const b of zs) out.push(b);
    const w16 = (v) => out.push((v >> 8) & 255, v & 255);
    w16(nv); w16(nf); out.push(0, hasInfo ? 1 : 0, perFacePrio ? 255 : (m.priority & 255), hasAlpha ? 1 : 0, m.fskin ? 1 : 0, m.vskin ? 1 : 0);
    w16(xs.length); w16(ys.length); w16(zs.length); w16(idx.length);
    return Uint8Array.from(out);
  }

  // ---- mesh helpers ----
  function clone(m) {
    const c = Object.assign({}, m);
    for (const k of ['vx', 'vy', 'vz', 'fa', 'fb', 'fc', 'col', 'rtype', 'prio', 'alpha', 'fskin', 'vskin', 'ftex']) if (m[k]) c[k] = m[k].slice();
    if (m.bones) { c.bones = m.bones.map((b) => b.slice()); c.weights = m.weights.map((b) => b.slice()); }
    return c;
  }
  function fromArrays(verts, faces, cols, opt) {
    opt = opt || {};
    const nv = verts.length, nf = faces.length, m = blank('new', nv, nf);
    m.vx = new Int32Array(nv); m.vy = new Int32Array(nv); m.vz = new Int32Array(nv);
    for (let i = 0; i < nv; i++) { m.vx[i] = Math.round(verts[i][0]); m.vy[i] = Math.round(verts[i][1]); m.vz[i] = Math.round(verts[i][2]); }
    m.fa = new Int32Array(nf); m.fb = new Int32Array(nf); m.fc = new Int32Array(nf);
    for (let i = 0; i < nf; i++) { m.fa[i] = faces[i][0]; m.fb[i] = faces[i][1]; m.fc[i] = faces[i][2]; }
    m.col = Uint16Array.from(cols);
    if (opt.alpha && opt.alpha.some((a) => a)) m.alpha = Uint8Array.from(opt.alpha);
    if (opt.vskin) m.vskin = Int32Array.from(opt.vskin);
    if (opt.prio) m.prio = Int8Array.from(opt.prio);
    if (opt.rtype) m.rtype = Int8Array.from(opt.rtype);
    if (opt.priority !== undefined) m.priority = opt.priority;
    return m;
  }
  function bounds(m) {
    const b = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
    for (let i = 0; i < m.nv; i++) {
      const p = [m.vx[i], m.vy[i], m.vz[i]];
      for (let k = 0; k < 3; k++) { if (p[k] < b.min[k]) b.min[k] = p[k]; if (p[k] > b.max[k]) b.max[k] = p[k]; }
    }
    if (!m.nv) { b.min = [0, 0, 0]; b.max = [0, 0, 0]; }
    return b;
  }
  function recolor(m, from, to) { for (let i = 0; i < m.nf; i++) if (m.col[i] === (from & 0xffff)) m.col[i] = to & 0xffff; return m; }
  /** scale = number or [x,y,z]; rotate = [xDeg,yDeg,zDeg]; translate = [x,y,z]. Applied in that order, in place. */
  function transform(m, t) {
    t = t || {};
    const s = typeof t.scale === 'number' ? [t.scale, t.scale, t.scale] : (t.scale || [1, 1, 1]);
    const r = (t.rotate || [0, 0, 0]).map((d) => d * Math.PI / 180), tr = t.translate || [0, 0, 0];
    const [sx, cx, sy, cy, sz, cz] = [Math.sin(r[0]), Math.cos(r[0]), Math.sin(r[1]), Math.cos(r[1]), Math.sin(r[2]), Math.cos(r[2])];
    for (let i = 0; i < m.nv; i++) {
      let x = m.vx[i] * s[0], y = m.vy[i] * s[1], z = m.vz[i] * s[2], q;
      q = y * cx - z * sx; z = y * sx + z * cx; y = q;
      q = x * cy + z * sy; z = -x * sy + z * cy; x = q;
      q = x * cz - y * sz; y = x * sz + y * cz; x = q;
      m.vx[i] = Math.round(x + tr[0]); m.vy[i] = Math.round(y + tr[1]); m.vz[i] = Math.round(z + tr[2]);
    }
    if (s[0] * s[1] * s[2] < 0) for (let i = 0; i < m.nf; i++) { const q = m.fb[i]; m.fb[i] = m.fc[i]; m.fc[i] = q; }
    return m;
  }
  /** Join meshes the way the game client builds a player or NPC: vertices at the same position are shared
   *  and keep the label of the first model that had them. Returns the mesh plus, per face, its source index. */
  function merge(list) {
    const pos = new Map(), V = [], L = [], F = [], C = [], A = [], P = [], T = [], S = [], X = [];
    let anyLabel = false, anyAlpha = false, anyType = false, anyTex = false;
    list.forEach((m, si) => {
      const map = new Int32Array(m.nv).fill(-1);
      const vert = (i) => {
        if (map[i] >= 0) return map[i];
        const key = m.vx[i] + ',' + m.vy[i] + ',' + m.vz[i];
        let id = pos.get(key);
        if (id === undefined) { id = V.length; pos.set(key, id); V.push([m.vx[i], m.vy[i], m.vz[i]]); L.push(m.vskin ? m.vskin[i] : -1); if (m.vskin) anyLabel = true; }
        return (map[i] = id);
      };
      for (let f = 0; f < m.nf; f++) {
        F.push([vert(m.fa[f]), vert(m.fb[f]), vert(m.fc[f])]); C.push(m.col[f]);
        const a = m.alpha ? m.alpha[f] : 0; A.push(a); if (a) anyAlpha = true;
        P.push(m.prio ? m.prio[f] : m.priority);
        const t = m.rtype ? m.rtype[f] : 0; T.push(t); if (t) anyType = true;
        const x = m.ftex ? m.ftex[f] : -1; X.push(x); if (x !== -1) anyTex = true;
        S.push(si);
      }
    });
    const out = fromArrays(V, F, C, { alpha: anyAlpha ? A : null, vskin: anyLabel ? L : null, prio: P, rtype: anyType ? T : null });
    if (anyTex) out.ftex = Int16Array.from(X);
    out.src = Int32Array.from(S);
    return out;
  }
  function colourCounts(m) {
    const c = new Map();
    for (let i = 0; i < m.nf; i++) if (!(m.ftex && m.ftex[i] !== -1)) c.set(m.col[i], (c.get(m.col[i]) || 0) + 1);
    return [...c.entries()].sort((a, b) => b[1] - a[1]).map(([colour, faces]) => ({ colour, faces }));
  }
  function labelCounts(m) {
    const c = new Map();
    if (m.vskin) for (let i = 0; i < m.nv; i++) c.set(m.vskin[i], (c.get(m.vskin[i]) || 0) + 1);
    return [...c.entries()].sort((a, b) => a[0] - b[0]).map(([label, vertices]) => ({ label, vertices }));
  }

  // ---- colour: the client's HSL16 palette ----
  const BRIGHTNESS = 0.8;
  const PALETTE = new Uint32Array(65536);
  (function build() {
    const h2 = (p, q, t) => { if (t < 0) t += 1; if (t > 1) t -= 1; if (6 * t < 1) return p + (q - p) * 6 * t; if (2 * t < 1) return q; if (3 * t < 2) return p + (q - p) * (2 / 3 - t) * 6; return p; };
    for (let i = 0; i < 512; i++) {
      const hue = (i >> 3) / 64 + 0.0078125, sat = (i & 7) / 8 + 0.0625;
      for (let l = 0; l < 128; l++) {
        const lum = l / 128;
        let r = lum, g = lum, b = lum;
        if (sat !== 0) { const q = lum < 0.5 ? lum * (1 + sat) : lum + sat - lum * sat, p = 2 * lum - q; r = h2(p, q, hue + 1 / 3); g = h2(p, q, hue); b = h2(p, q, hue - 1 / 3); }
        const R = Math.pow(r, BRIGHTNESS) * 256 | 0, G = Math.pow(g, BRIGHTNESS) * 256 | 0, B = Math.pow(b, BRIGHTNESS) * 256 | 0;
        PALETTE[(i << 7) | l] = (Math.min(255, R) << 16) | (Math.min(255, G) << 8) | Math.min(255, B);
      }
    }
  })();
  const hslToRgb = (hsl) => PALETTE[hsl & 0xffff];
  function rgbToHsl(r, g, b) {   // 0..255 each -> nearest HSL16 (same maths as the port scripts)
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
    let h = 0, s = 0;
    if (mx !== mn) {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6; else if (mx === g) h = ((b - r) / d + 2) / 6; else h = ((r - g) / d + 4) / 6;
    }
    return ((Math.floor(h * 64) & 63) << 10) | (Math.min(7, Math.floor(s * 8)) << 7) | Math.min(127, Math.max(0, Math.round(l * 127)));
  }
  const adjust = (hsl, light) => { let l = ((hsl & 127) * light) >> 7; if (l < 2) l = 2; else if (l > 126) l = 126; return (hsl & 0xff80) + l; };
  /** The client's lighting: returns per-face corner colours (HSL16) in Int32Array(nf*3); -2 marks a hidden face. */
  function light(m, ambient, contrast, lx, ly, lz) {
    ambient = ambient === undefined ? 64 : ambient; contrast = contrast === undefined ? 850 : contrast;
    lx = lx === undefined ? -30 : lx; ly = ly === undefined ? -50 : ly; lz = lz === undefined ? -30 : lz;
    const { nv, nf } = m, nx = new Float64Array(nv), ny = new Float64Array(nv), nz = new Float64Array(nv), nm = new Int32Array(nv);
    const fnx = new Float64Array(nf), fny = new Float64Array(nf), fnz = new Float64Array(nf);
    for (let i = 0; i < nf; i++) {
      const a = m.fa[i], b = m.fb[i], c = m.fc[i];
      const x1 = m.vx[b] - m.vx[a], y1 = m.vy[b] - m.vy[a], z1 = m.vz[b] - m.vz[a], x2 = m.vx[c] - m.vx[a], y2 = m.vy[c] - m.vy[a], z2 = m.vz[c] - m.vz[a];
      let X = y1 * z2 - y2 * z1, Y = z1 * x2 - z2 * x1, Z = x1 * y2 - x2 * y1;
      while (X > 8192 || Y > 8192 || Z > 8192 || X < -8192 || Y < -8192 || Z < -8192) { X >>= 1; Y >>= 1; Z >>= 1; }
      let len = Math.sqrt(X * X + Y * Y + Z * Z) | 0; if (len <= 0) len = 1;
      X = (X * 256 / len) | 0; Y = (Y * 256 / len) | 0; Z = (Z * 256 / len) | 0;
      fnx[i] = X; fny[i] = Y; fnz[i] = Z;
      if (!m.rtype || m.rtype[i] === 0) for (const v of [a, b, c]) { nx[v] += X; ny[v] += Y; nz[v] += Z; nm[v]++; }
    }
    const mag = Math.sqrt(lx * lx + ly * ly + lz * lz) | 0, att = (mag * contrast) >> 8;
    const out = new Int32Array(nf * 3);
    for (let i = 0; i < nf; i++) {
      const t = m.rtype ? m.rtype[i] : 0, hsl = m.col[i];
      if (t === 0) {
        const vs = [m.fa[i], m.fb[i], m.fc[i]];
        for (let k = 0; k < 3; k++) {
          const v = vs[k], d = att * (nm[v] || 1);
          out[i * 3 + k] = adjust(hsl, ((lx * nx[v] + ly * ny[v] + lz * nz[v]) / d | 0) + ambient);
        }
      } else if (t === 1) {
        const c = adjust(hsl, ((lx * fnx[i] + ly * fny[i] + lz * fnz[i]) / (att + (att >> 1)) | 0) + ambient);
        out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = c;
      } else out[i * 3] = out[i * 3 + 1] = out[i * 3 + 2] = -2;
    }
    return out;
  }
  return { decode, encode, clone, fromArrays, bounds, recolor, transform, merge, colourCounts, labelCounts, hslToRgb, rgbToHsl, light, adjust, PALETTE };
});
