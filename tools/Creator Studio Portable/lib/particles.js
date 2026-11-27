'use strict';
// RS3 particle effects (cape smoke and sparkles). A port of the server's scripts/rs3-port/rs3particles.py.
// RS3 models carry "emitter" triangles after their meshes; each names a config (index 27 group 0) that says
// how the particles look and move, and configs name effectors (group 1) and a material whose texture is the sprite.
// The game reads all of this from data/definitions/custom-particles.json (RS3CapeParticles.plugin.js).
const png = require('./png');
const FIXED = { 2: 1, 4: 2, 5: 2, 12: 1, 13: 1, 14: 2, 15: 2, 16: 6, 17: 2, 19: 1, 20: 1, 21: 1, 23: 1, 27: 2, 28: 1 };

/** The emitter triangles of an RS3 model: [{ config, corners:[[x,y,z] x3] }] in RS3 units. */
function emitters(m) {
  if (m.counts[0]) throw new Error('model has an extra section this tool cannot read');
  const base = m.counts[1] * 39, out = [], t = m.tail, dv = new DataView(t.buffer, t.byteOffset, t.length);
  if (t.length < base + m.counts[2] * 50) throw new Error('emitter data is cut short');
  for (let k = 0; k < m.counts[2]; k++) {
    const p = base + k * 50, corners = [];
    for (let c = 0; c < 3; c++) corners.push([dv.getFloat32(p + 2 + c * 16, true), dv.getFloat32(p + 6 + c * 16, true), dv.getFloat32(p + 10 + c * 16, true)]);
    out.push({ config: dv.getUint16(p, true), corners });
  }
  return out;
}
function decodeEmitter(d) {
  const o = { unknown: {} }; let p = 0;
  const u8 = () => d[p++], u16 = () => { const v = d.readUInt16BE(p); p += 2; return v; }, s16 = () => { const v = d.readInt16BE(p); p += 2; return v; }, i32 = () => { const v = d.readInt32BE(p); p += 4; return v; }, u32 = () => i32() >>> 0;
  const ids = () => { const n = u8(), a = []; for (let i = 0; i < n; i++) a.push(u16()); return a; };
  for (;;) {
    const op = u8();
    if (op === 0) break;
    if (op === 1) o.angles = [u16(), u16(), u16(), u16()];
    else if (op === 3) o.speed = [i32(), i32()];
    else if (op === 5) { const s = u16(); o.size = [s, s]; }
    else if (op === 6) o.colour = [u32(), u32()];
    else if (op === 7) o.life = [u16(), u16()];
    else if (op === 8) o.rate = [u16(), u16()];
    else if (op === 9) o.localEffectors = ids();
    else if (op === 10) o.globalEffectors = ids();
    else if (op === 15) o.material = u16();
    else if (op === 18) o.colourEnd = u32();
    else if (op === 20) o.colourChangePct = u8();
    else if (op === 21) o.alphaChangePct = u8();
    else if (op === 22) o.speedEnd = i32();
    else if (op === 23) o.speedChangePct = u8();
    else if (op === 25) o.effectors = ids();
    else if (op === 27) o.sizeEnd = u16();
    else if (op === 28) o.sizeChangePct = u8();
    else if (op === 31) o.size = [u16(), u16()];
    else if (op === 29 || op === 35) { const range = u8(); o.unknown[op] = range === 1 ? [s16(), s16()].concat(op === 35 ? [u8()] : []) : [s16()]; }
    else if ([24, 26, 30, 32, 33, 34, 36].includes(op)) o.unknown[op] = true;
    else if (FIXED[op]) { o.unknown[op] = d.subarray(p, p + FIXED[op]).toString('hex'); p += FIXED[op]; }
    else throw new Error('unknown particle config opcode ' + op);
  }
  if (p !== d.length) throw new Error('particle config has trailing bytes');
  return o;
}
function decodeEffector(d) {
  const o = { flags: [] }; let p = 0;
  for (;;) {
    const op = d[p++];
    if (op === 0) break;
    if (op === 1) { o.unk1 = d.readUInt16BE(p); p += 2; }
    else if (op === 3) { o.vector = [d.readInt32BE(p), d.readInt32BE(p + 4), d.readInt32BE(p + 8)]; p += 12; }
    else if (op === 4) { o.mode = d[p]; o.strength = d.readInt32BE(p + 1); p += 5; }
    else if ([2, 5, 6, 7, 8, 9, 10, 11, 12].includes(op)) o.flags.push(op);
    else throw new Error('unknown effector opcode ' + op);
  }
  return o;
}
/**
 * Emitters of the given RS3 worn models, moved into game space, each corner on the bone of the nearest vertex of
 * the built worn mesh. Returns [{ config, corners:[[x,y,z,label] x3] }].
 */
function forWorn(rs3, modelIds, mesh) {
  const out = [];
  for (const id of modelIds) {
    if (id === undefined || id < 0) continue;
    let m; try { m = rs3.model(id); } catch { continue; }
    if (!m.counts[2]) continue;
    for (const e of emitters(m)) {
      out.push({ config: e.config, corners: e.corners.map(([x, y, z]) => {
        const p = [x / 4, -y / 4, z / 4]; let best = 0, bd = Infinity;
        for (let v = 0; v < mesh.nv; v++) { const d = (mesh.vx[v] - p[0]) ** 2 + (mesh.vy[v] - p[1]) ** 2 + (mesh.vz[v] - p[2]) ** 2; if (d < bd) { bd = d; best = v; } }
        return [+p[0].toFixed(2), +p[1].toFixed(2), +p[2].toFixed(2), mesh.vskin ? mesh.vskin[best] : 0];
      }) });
    }
  }
  return out;
}
/** Adds everything an item's emitters need (configs, effectors, sprite textures) to the particles document. */
function addItem(doc, rs3, itemId, sexes) {
  doc.version = 1; for (const k of ['configs', 'effectors', 'textures', 'items']) doc[k] = doc[k] || {};
  const cfgFiles = rs3.cache.files(27, 0), effFiles = rs3.cache.files(27, 1);
  for (const list of [sexes.male, sexes.female]) for (const e of list) {
    const key = String(e.config);
    if (doc.configs[key]) continue;
    const raw = cfgFiles.get(e.config); if (!raw) throw new Error(`particle config ${e.config} is not in the RS3 cache`);
    const c = decodeEmitter(raw), img = rs3.diffuse(c.material);
    if (!img) throw new Error(`particle config ${e.config} has no sprite texture`);
    for (const k of ['speed', 'size', 'life', 'rate', 'colour', 'angles']) if (!Array.isArray(c[k])) throw new Error(`particle config ${e.config} has no ${k}`);
    if (!doc.textures[String(img.id)]) { const small = img.width > 64 || img.height > 64 ? png.resize(img, 64, 64) : img; const b64 = png.encode(small.width, small.height, small.data).toString('base64'); if (b64.length > 40000) throw new Error('particle sprite is too large'); doc.textures[String(img.id)] = b64; }
    c.texture = img.id; doc.configs[key] = c;
    for (const ef of [...(c.globalEffectors || []), ...(c.localEffectors || []), ...(c.effectors || [])]) if (!doc.effectors[String(ef)] && effFiles.get(ef)) doc.effectors[String(ef)] = decodeEffector(effFiles.get(ef));
    for (const ef of c.globalEffectors || []) if (!doc.effectors[String(ef)]) throw new Error(`particle config ${e.config} uses effector ${ef}, which is not in the RS3 cache`);
  }
  doc.items[String(itemId)] = { male: sexes.male, female: sexes.female };
  return doc;
}
module.exports = { emitters, decodeEmitter, decodeEffector, forWorn, addItem };
