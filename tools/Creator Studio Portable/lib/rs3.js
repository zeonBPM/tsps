'use strict';
// Read-only view of an RS3 cache in OpenRS2 "flat file" layout (<index>/<group>.dat): models (index 47), items (19),
// materials (26), textures (53), particles (27). Written against build 950; check() says whether another build reads.
const fs = require('fs');
const path = require('path');
const { Buf } = require('./buf');
const { FlatCache } = require('./cache');
const png = require('./png');
const crypto = require('crypto');

/** IEEE half float (big endian) -> number. */
function half(hi, lo) {
  const h = (hi << 8) | lo, s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, f = h & 1023;
  if (e === 0) return s * f * Math.pow(2, -24);
  if (e === 31) return f ? NaN : s * Infinity;
  return s * (1 + f / 1024) * Math.pow(2, e - 15);
}
/** Round half to even, as numpy does (the existing port pipeline rounds this way; keeps output identical). */
function rint(x) { const r = Math.round(x); return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r; }

/** NXT model (format 2). See docs/FORMATS.md for the layout. */
function decodeModel(d) {
  if (d[0] !== 2) throw new Error('unsupported RS3 model format ' + d[0]);
  const m = { version: d[2], counts: [d[4], d[5], d[6], d[7]] };
  const meshCount = d[3], extra = d[4] + d[5] + d[6] + d[7], f = m.vflags = d[9];
  const dv = new DataView(d.buffer, d.byteOffset, d.length);
  const vc = m.vc = dv.getUint32(13, true);
  let p = 17;
  m.pos = new Int32Array(vc * 3);
  if (m.version >= 0x17) { for (let i = 0; i < vc * 3; i++, p += 4) m.pos[i] = rint(dv.getFloat32(p, false)); }
  else { for (let i = 0; i < vc * 3; i++, p += 2) m.pos[i] = dv.getInt16(p, true); }
  p += vc * 3;                  // normals (s8 x 3)
  p += vc * 4;                  // tangents
  m.uv = new Float32Array(vc * 2);
  for (let i = 0; i < vc * 2; i++, p += 2) m.uv[i] = half(d[p], d[p + 1]);
  m.label = new Int32Array(vc).fill(0xffff);
  if (f & 0x0c) for (let i = 0; i < vc; i++, p += 2) m.label[i] = dv.getUint16(p, true);
  m.skin = null;
  if (f & 0x20) {
    m.skin = new Array(vc);
    for (let i = 0; i < vc; i++) {
      let n = dv.getUint16(p, true); p += 2;
      const bones = new Uint16Array(n); for (let k = 0; k < n; k++, p += 2) bones[k] = dv.getUint16(p, true);
      n = dv.getUint16(p, true); p += 2;
      const weights = Uint8Array.from(d.subarray(p, p + n)); p += n;
      m.skin[i] = { bones, weights };
    }
  }
  m.colour = new Int32Array(vc); for (let i = 0; i < vc; i++, p += 2) m.colour[i] = dv.getUint16(p, true);
  m.alpha = Uint8Array.from(d.subarray(p, p + vc)); p += vc;
  m.bone = new Int32Array(vc).fill(0xffff);
  if ((f & 0x0c) === 0x0c) for (let i = 0; i < vc; i++, p += 2) m.bone[i] = dv.getUint16(p, true);
  m.meshes = [];
  for (let k = 0; k < meshCount; k++) {
    const flags = d[p], material = dv.getUint16(p + 5, true) - 1, n = dv.getUint16(p + 8, true);
    p += 10;
    const tris = new Int32Array(n);
    for (let i = 0; i < n; i++, p += 2) { tris[i] = dv.getUint16(p, true); if (tris[i] >= vc) throw new Error('RS3 model: index out of range'); }
    m.meshes.push({ flags, material, tris, hidden: !!(flags & 0x10) });
  }
  if (p > d.length || (p !== d.length && extra === 0)) throw new Error('RS3 model layout mismatch (' + (d.length - p) + ' bytes left)');
  m.tail = d.subarray(p);
  return m;
}
const NONE = new Set([9, 11, 15, 16, 65, 156, 157, 165, 167, 168, 178]);
const U16 = new Set([18, 94, 97, 98, 110, 111, 112, 121, 122, 139, 140, 142, 143, 144, 145, 146, 150, 151, 152, 153, 154, 161, 162, 163, 44, 45]);
/** RS3 item definition, up to and including the name (models, slot, icon angles, recolours). */
function decodeItem(id, d) {
  const o = { id, name: null, model: -1, male: -1, female: -1, male1: -1, female1: -1, male2: -1, female2: -1, recolor: [], retexture: [],
    zoom2d: 2000, xan2d: 0, yan2d: 0, zan2d: 0, offsetX2d: 0, offsetY2d: 0, slot: -1, cost: 0, actions: [] };
  const b = new Buf(d);
  while (b.left > 0) {
    const op = b.u8();
    if (op === 0) break;
    if (NONE.has(op)) continue;
    if (op === 1) o.model = b.smart32();
    else if (op === 2) { o.name = b.str(); break; }
    else if (op === 4) o.zoom2d = b.u16();
    else if (op === 5) o.xan2d = b.u16();
    else if (op === 6) o.yan2d = b.u16();
    else if (op === 7) o.offsetX2d = b.s16();
    else if (op === 8) o.offsetY2d = b.s16();
    else if (op === 12) o.cost = b.i32();
    else if (op === 13) o.slot = b.u8();
    else if (op === 14) o.type = b.u8();
    else if (U16.has(op)) b.u16();
    else if (op === 23) o.male = b.smart32();
    else if (op === 24) o.male1 = b.smart32();
    else if (op === 25) o.female = b.smart32();
    else if (op === 26) o.female1 = b.smart32();
    else if (op === 27 || op === 96 || op === 115 || op === 134) b.u8();
    else if (op >= 30 && op <= 39) { const s = b.str(); if (op >= 35) o.actions[op - 35] = s; }
    else if (op === 40) { for (let n = b.u8(); n > 0; n--) o.recolor.push([b.u16(), b.u16()]); }
    else if (op === 41) { for (let n = b.u8(); n > 0; n--) o.retexture.push([b.u16(), b.u16()]); }
    else if (op === 42) b.skip(b.u8());
    else if (op === 43 || op === 69) b.i32();
    else if (op === 78) o.male2 = b.smart32();
    else if (op === 79) o.female2 = b.smart32();
    else if (op >= 90 && op <= 93) b.smart32();
    else if (op === 95) o.zan2d = b.u16();
    else if (op >= 100 && op <= 109) b.skip(4);
    else if (op === 113 || op === 114) b.s8();
    else if (op >= 125 && op <= 128) b.skip(3);
    else if (op === 129 || op === 130) b.skip(2);
    else if (op === 132) b.skip(2 * b.u8());
    else if (op === 164) b.str();
    else if (op === 181) b.skip(8);
    else if (op >= 190 && op <= 199) b.skip(5);                       // stack-size variants with 3-byte item ids (coins, arrows): u24 item, u16 count
    else if (op >= 201 && op <= 208) b.skip(3);                       // note / lend / bind / shard link and template, as 3-byte item ids
    else if (op === 249) { for (let n = b.u8(); n > 0; n--) { const text = b.u8(); b.skip(3); if (text) b.str(); else b.skip(4); } }   // extra settings ("params")
    else { o.stoppedAt = op; break; }
  }
  return o;
}
const SLOT_NAMES = { 0: 'head', 1: 'cape', 2: 'neck', 3: 'weapon', 4: 'body', 5: 'shield', 7: 'legs', 9: 'hands', 10: 'feet', 12: 'ring', 13: 'ammo', 14: 'aura', 17: 'pocket' };

class Rs3 {
  constructor(dir, indexDir) { this.dir = dir; this.cache = new FlatCache(dir); this.indexDir = indexDir; this._tex = new Map(); }
  /** Short id of this cache (its folder and its item table), used to keep saved name lists apart. */
  key() {
    if (this._key) return this._key;
    let tag = ''; try { const st = fs.statSync(path.join(this.dir, '255', '19.dat')); tag = st.size + ':' + Math.round(st.mtimeMs); } catch { /* no item table */ }
    return (this._key = crypto.createHash('sha1').update(path.resolve(this.dir) + '|' + tag).digest('hex').slice(0, 10));
  }
  /**
   * Can the Studio read this cache? Reads a spread of items, then their models and textures, and says plainly what
   * works. Use it on any cache that is not build 950 before trusting a port from it.
   * Returns { folder, verdict: 'works' | 'partly' | 'no', summary, problems[], indexes, items, models, textures, particles }.
   */
  check() {
    const NEED = [[255, 'index tables'], [19, 'items'], [47, 'models'], [26, 'materials (which texture a surface uses)'], [53, 'textures'], [27, 'particles (cape effects)']], LATER = [[16, 'objects'], [18, 'NPCs']];
    const rep = { folder: this.dir, verdict: 'works', summary: '', problems: [], notes: [], indexes: {} }, has = (i) => fs.existsSync(path.join(this.dir, String(i)));
    for (const [i, what] of NEED.concat(LATER)) { let groups = null; if (i !== 255 && has(i)) { try { groups = this.cache.groupIds(i).length; } catch { groups = null; } } rep.indexes[i] = { holds: what, present: has(i), groups }; }
    for (const [i, what] of NEED) if (!rep.indexes[i].present) rep.problems.push(`Folder ${i} (${what}) is missing from the cache.`);
    for (const [i, what] of LATER) if (!rep.indexes[i].present) rep.notes.push(`Folder ${i} (${what}) is not there. Items port without it; the object and NPC tools will want it.`);
    let ids = []; try { ids = this.cache.groupIds(19).sort((a, b) => a - b); } catch (e) { rep.problems.push('The item list could not be read: ' + e.message); }
    const step = Math.max(1, Math.floor(ids.length / 30)), unknown = new Map(), pool = []; let read = 0, named = 0, stopped = 0;
    for (let k = 0; k < ids.length; k += step) {
      let files; try { files = this.cache.files(19, ids[k]); } catch (e) { stopped++; continue; }
      for (const [fid, d] of files) { read++; try { const o = decodeItem(ids[k] * 256 + fid, d); if (o.name) { named++; if (o.model >= 0) pool.push(o); } else if (o.stoppedAt !== undefined) { stopped++; unknown.set(o.stoppedAt, (unknown.get(o.stoppedAt) || 0) + 1); } } catch { stopped++; } }
    }
    rep.items = { groups: ids.length, read, named, notUnderstood: stopped, unknownCodes: [...unknown].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([code, times]) => ({ code, times })) };
    const want = [], every = Math.max(1, Math.floor(pool.length / 40));
    for (let k = 0; k < pool.length && want.length < 60; k += every) { want.push(pool[k].model); if (pool[k].male >= 0) want.push(pool[k].male); }
    const why = new Map(), versions = new Map(); let ok = 0, mats = 0, tex = 0;
    for (const id of want) {
      try { const m = this.model(id); ok++; versions.set(m.version, (versions.get(m.version) || 0) + 1);
        for (const mesh of m.meshes) if (mesh.material >= 0) { mats++; try { if (this.diffuse(mesh.material)) tex++; } catch { /* counted as not found */ } } }
      catch (e) { const r = e.message.replace(/\b\d+\b/g, 'N'); why.set(r, (why.get(r) || 0) + 1); }
    }
    rep.models = { tried: want.length, read: ok, failed: [...why].map(([reason, times]) => ({ reason, times })), formatVersions: Object.fromEntries(versions) };
    rep.textures = { surfacesTried: mats, texturesFound: tex };
    try { rep.particles = { emitters: this.cache.files(27, 0).size, effectors: this.cache.files(27, 1).size }; } catch { rep.particles = null; rep.notes.push('Particle definitions could not be read: capes port without their effects.'); }
    if (read && stopped / read > 0.1) rep.problems.push(`${stopped} of ${read} item definitions tested use codes this Studio does not know (${rep.items.unknownCodes.map((u) => u.code).join(', ')}): this build stores items differently.`);
    if (want.length && ok / want.length < 0.9) rep.problems.push(`${want.length - ok} of ${want.length} test models could not be read (${rep.models.failed.map((f) => `${f.reason}: ${f.times}`).join('; ')}).`);
    if (mats && tex / mats < 0.6) rep.notes.push(`Only ${tex} of ${mats} textured surfaces had a readable texture: colours will come from vertex colours alone and may look flat.`);
    const fatal = !named || !ok || rep.problems.some((p) => /Folder (255|19|47) /.test(p));
    rep.verdict = fatal ? 'no' : rep.problems.length ? 'partly' : 'works';
    rep.summary = fatal ? 'The Studio cannot port from this cache.' : rep.verdict === 'partly' ? 'The Studio reads part of this cache. Read the problems before trusting a port.'
      : `This cache works: ${named} named items in the sample, ${ok} of ${want.length} test models read, ${tex} of ${mats} textures found.`;
    return rep;
  }
  modelBytes(id) { return this.cache.group(47, id); }
  model(id) { const d = this.modelBytes(id); if (!d) throw new Error('RS3 model ' + id + ' is not in the cache'); return decodeModel(d); }
  item(id) { const d = this.cache.file(19, id >> 8, id & 255); return d ? decodeItem(id, d) : null; }
  materials() { return this._mats || (this._mats = this.cache.files(26, 0)); }
  /** Diffuse texture of a material as { width, height, data RGBA }, or null. */
  diffuse(materialId) {
    const d = materialId >= 0 ? this.materials().get(materialId) : null;
    if (!d) return null;
    const off = d[0] === 1 ? 8 : 9, tid = (d[off] << 8) | d[off + 1];
    if (this._tex.has(tid)) return this._tex.get(tid);
    let img = null;
    try { const raw = this.cache.group(53, tid); if (raw && raw[5] === 0x89 && raw[6] === 0x50) { img = png.decode(raw.subarray(5)); img.id = tid; } } catch { img = null; }
    this._tex.set(tid, img);
    return img;
  }
  /** Name index of every RS3 item ([id, name, slot, hasWornModel]); built once, then cached on disk. */
  itemIndex() {
    if (this._items) return this._items;
    const file = this.indexDir ? path.join(this.indexDir, `rs3-items-${this.key()}.json`) : null;   // one name list per cache, so swapping caches never shows stale names
    if (file && fs.existsSync(file)) { try { return (this._items = JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* rebuild */ } }
    const out = [];
    for (const g of this.cache.groupIds(19).sort((a, b) => a - b)) {
      for (const [fid, d] of this.cache.files(19, g)) {
        try { const o = decodeItem(g * 256 + fid, d); if (o.name) out.push([o.id, o.name, o.slot, (o.male >= 0 || o.female >= 0) ? 1 : 0, o.model >= 0 ? 1 : 0]); } catch { /* skip unreadable */ }
      }
    }
    if (file) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(out)); }
    return (this._items = out);
  }
  searchItems(text, limit = 80) {
    const q = String(text || '').trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean), out = [];
    if (/^\d+$/.test(q)) { const it = this.item(+q); if (it && it.name) out.push({ id: it.id, name: it.name, slot: SLOT_NAMES[it.slot] || null, worn: it.male >= 0 || it.female >= 0 }); }
    for (const [id, name, slot, worn, ground] of this.itemIndex()) {
      if (out.length >= limit) break;
      const n = name.toLowerCase();
      if (words.length && words.every((w) => n.includes(w)) && ground) out.push({ id, name, slot: SLOT_NAMES[slot] || null, worn: !!worn });
    }
    return out.sort((a, b) => (b.worn - a.worn) || (a.name.length - b.name.length));
  }
}
module.exports = { Rs3, decodeModel, decodeItem, rint, SLOT_NAMES };
