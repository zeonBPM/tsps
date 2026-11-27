'use strict';
// Read-only view of the OSRS cache the server runs on: items, NPCs, animations, identity kits, models.
const { Buf } = require('./buf');
const { Dat2Cache } = require('./cache');
const Model = require('./model');

const IDX = { FRAMES: 0, BASES: 1, CONFIG: 2, MODELS: 7, TEXTURES: 9 };
const CFG = { IDK: 3, NPC: 9, ITEM: 10, SEQ: 12 };

function params(b) {
  const out = {};
  for (let n = b.u8(); n > 0; n--) { const isStr = b.u8() === 1, key = b.u24(); out[key] = isStr ? b.str() : b.i32(); }
  return out;
}
function decodeItem(id, d) {
  const o = { id, name: 'null', examine: '', model: -1, zoom2d: 2000, xan2d: 0, yan2d: 0, zan2d: 0, offsetX2d: 0, offsetY2d: 0,
    stackable: false, price: 1, wearPos: -1, wearPos2: -1, wearPos3: -1, members: false, tradable: false,
    maleModel: -1, maleModel1: -1, maleModel2: -1, maleOffset: 0, femaleModel: -1, femaleModel1: -1, femaleModel2: -1, femaleOffset: 0,
    maleHeadModel: -1, maleHeadModel2: -1, femaleHeadModel: -1, femaleHeadModel2: -1,
    groundActions: [null, null, 'Take', null, null], inventoryActions: [null, null, null, null, 'Drop'],
    recolorFrom: [], recolorTo: [], retextureFrom: [], retextureTo: [], note: -1, noteTemplate: -1,
    resizeX: 128, resizeY: 128, resizeZ: 128, ambient: 0, contrast: 0, team: 0, weight: 0, category: -1,
    placeholder: -1, placeholderTemplate: -1, manwear: [0, 0, 0], womanwear: [0, 0, 0], params: {} };
  const b = new Buf(d);
  for (;;) {
    const op = b.u8();
    if (op === 0) break;
    if (op === 1) o.model = b.u16();
    else if (op === 2) o.name = b.str();
    else if (op === 3) o.examine = b.str();
    else if (op === 4) o.zoom2d = b.u16();
    else if (op === 5) o.xan2d = b.u16();
    else if (op === 6) o.yan2d = b.u16();
    else if (op === 7) o.offsetX2d = b.s16();
    else if (op === 8) o.offsetY2d = b.s16();
    else if (op === 9) b.str();
    else if (op === 11) o.stackable = true;
    else if (op === 12) o.price = b.i32();
    else if (op === 13) o.wearPos = b.u8();
    else if (op === 14) o.wearPos2 = b.u8();
    else if (op === 15) o.tradable = false;
    else if (op === 16) o.members = true;
    else if (op === 23) { o.maleModel = b.u16(); o.maleOffset = b.u8(); }
    else if (op === 24) o.maleModel1 = b.u16();
    else if (op === 25) { o.femaleModel = b.u16(); o.femaleOffset = b.u8(); }
    else if (op === 26) o.femaleModel1 = b.u16();
    else if (op === 27) o.wearPos3 = b.u8();
    else if (op >= 30 && op < 35) { const s = b.str(); o.groundActions[op - 30] = s.toLowerCase() === 'hidden' ? null : s; }
    else if (op >= 35 && op < 40) o.inventoryActions[op - 35] = b.str();
    else if (op === 40) { for (let n = b.u8(); n > 0; n--) { o.recolorFrom.push(b.u16()); o.recolorTo.push(b.u16()); } }
    else if (op === 41) { for (let n = b.u8(); n > 0; n--) { o.retextureFrom.push(b.u16()); o.retextureTo.push(b.u16()); } }
    else if (op === 42) b.s8();
    else if (op === 43) { b.u8(); for (;;) { const s = b.u8() - 1; if (s === -1) break; b.str(); } }
    else if (op === 44) o.model = b.i32();
    else if (op === 45) { o.maleModel = b.i32(); o.maleOffset = b.u8(); }
    else if (op === 46) o.maleModel1 = b.i32();
    else if (op === 47) o.maleModel2 = b.i32();
    else if (op === 48) { o.femaleModel = b.i32(); o.femaleOffset = b.u8(); }
    else if (op === 49) o.femaleModel1 = b.i32();
    else if (op === 50) o.femaleModel2 = b.i32();
    else if (op === 51) o.maleHeadModel = b.i32();
    else if (op === 52) o.maleHeadModel2 = b.i32();
    else if (op === 53) o.femaleHeadModel = b.i32();
    else if (op === 54) o.femaleHeadModel2 = b.i32();
    else if (op === 65) o.tradable = true;
    else if (op === 75) o.weight = b.s16();
    else if (op === 78) o.maleModel2 = b.u16();
    else if (op === 79) o.femaleModel2 = b.u16();
    else if (op === 90) o.maleHeadModel = b.u16();
    else if (op === 91) o.femaleHeadModel = b.u16();
    else if (op === 92) o.maleHeadModel2 = b.u16();
    else if (op === 93) o.femaleHeadModel2 = b.u16();
    else if (op === 94) o.category = b.u16();
    else if (op === 95) o.zan2d = b.u16();
    else if (op === 96) b.u8();
    else if (op === 97) o.note = b.u16();
    else if (op === 98) o.noteTemplate = b.u16();
    else if (op >= 100 && op < 110) { b.u16(); b.u16(); }
    else if (op === 110) o.resizeX = b.u16();
    else if (op === 111) o.resizeY = b.u16();
    else if (op === 112) o.resizeZ = b.u16();
    else if (op === 113) o.ambient = b.s8();
    else if (op === 114) o.contrast = b.s8() * 5;
    else if (op === 115) o.team = b.u8();
    else if (op === 125) o.manwear = [b.s8(), b.s8(), b.s8()];
    else if (op === 126) o.womanwear = [b.s8(), b.s8(), b.s8()];
    else if (op === 139 || op === 140) b.u16();
    else if (op === 148) o.placeholder = b.u16();
    else if (op === 149) o.placeholderTemplate = b.u16();
    else if (op === 160 || op === 251) { /* flags */ }
    else if (op === 161) { for (let n = b.u16(); n > 0; n--) b.u16(); }
    else if (op === 249) o.params = params(b);
    else throw new Error(`item ${id}: unknown opcode ${op}`);
  }
  return o;
}
function decodeNpc(id, d) {
  const o = { id, name: 'null', desc: '', models: [], chatheadModels: [], size: 1, idleSeq: -1, walkSeq: -1, walkBackSeq: -1, walkLeftSeq: -1, walkRightSeq: -1,
    turnLeftSeq: -1, turnRightSeq: -1, runSeq: -1, crawlSeq: -1, actions: [null, null, null, null, null], recolorFrom: [], recolorTo: [],
    retextureFrom: [], retextureTo: [], combatLevel: -1, widthScale: 128, heightScale: 128, ambient: 0, contrast: 0, drawMapDot: true,
    attack: -1, defence: -1, strength: -1, hitpoints: -1, ranged: -1, magic: -1, rotationSpeed: 32, interactable: true, clipped: true,
    follower: false, heightOffset: -1, footprintSize: -1, category: -1, transforms: null, params: {} };
  const b = new Buf(d);
  const lvl = () => { const v = b.u16(); return v === 65535 ? -1 : v; };
  for (;;) {
    const op = b.u8();
    if (op === 0) break;
    if (op === 1) { for (let n = b.u8(); n > 0; n--) o.models.push(b.u16()); }
    else if (op === 2) o.name = b.str();
    else if (op === 3) o.desc = b.str();
    else if (op === 12) o.size = b.u8();
    else if (op === 13) o.idleSeq = b.u16();
    else if (op === 14) o.walkSeq = b.u16();
    else if (op === 15) o.turnLeftSeq = b.u16();
    else if (op === 16) o.turnRightSeq = b.u16();
    else if (op === 17) { o.walkSeq = b.u16(); o.walkBackSeq = b.u16(); o.walkLeftSeq = b.u16(); o.walkRightSeq = b.u16(); }
    else if (op === 18) o.category = b.u16();
    else if (op >= 30 && op < 35) { const s = b.str(); o.actions[op - 30] = s.toLowerCase() === 'hidden' ? null : s; }
    else if (op === 40) { for (let n = b.u8(); n > 0; n--) { o.recolorFrom.push(b.u16()); o.recolorTo.push(b.u16()); } }
    else if (op === 41) { for (let n = b.u8(); n > 0; n--) { o.retextureFrom.push(b.u16()); o.retextureTo.push(b.u16()); } }
    else if (op === 44 || op === 45) b.u16();
    else if (op === 60) { for (let n = b.u8(); n > 0; n--) o.chatheadModels.push(b.u16()); }
    else if (op === 61) { o.models = []; for (let n = b.u8(); n > 0; n--) o.models.push(b.i32()); }
    else if (op === 62) { o.chatheadModels = []; for (let n = b.u8(); n > 0; n--) o.chatheadModels.push(b.i32()); }
    else if (op === 74) o.attack = lvl();
    else if (op === 75) o.defence = lvl();
    else if (op === 76) o.strength = lvl();
    else if (op === 77) o.hitpoints = lvl();
    else if (op === 78) o.ranged = lvl();
    else if (op === 79) o.magic = lvl();
    else if (op === 93) o.drawMapDot = false;
    else if (op === 95) o.combatLevel = b.u16();
    else if (op === 97) o.widthScale = b.u16();
    else if (op === 98) o.heightScale = b.u16();
    else if (op === 99 || op === 111 || op === 112 || op === 122 || op === 123 || op === 130 || op === 145 || op === 147) { if (op === 122) o.follower = true; }
    else if (op === 100) o.ambient = b.s8();
    else if (op === 101) o.contrast = b.s8() * 5;
    else if (op === 102) { const mask = b.u8(); for (let i = 0; i < 8; i++) if (mask & (1 << i)) { b.bigsmartNull(); b.smart(); } }
    else if (op === 103) o.rotationSpeed = b.u16();
    else if (op === 106 || op === 118) {
      const t = { varbit: b.u16(), varp: b.u16(), fallback: -1, ids: [] };
      if (op === 118) t.fallback = b.u16();
      for (let n = b.u8() + 1; n > 0; n--) { const v = b.u16(); t.ids.push(v === 65535 ? -1 : v); }
      o.transforms = t;
    }
    else if (op === 107) o.interactable = false;
    else if (op === 109) o.clipped = false;
    else if (op === 114) o.runSeq = b.u16();
    else if (op === 115) { o.runSeq = b.u16(); b.u16(); b.u16(); b.u16(); }
    else if (op === 116) o.crawlSeq = b.u16();
    else if (op === 117) { o.crawlSeq = b.u16(); b.u16(); b.u16(); b.u16(); }
    else if (op === 124) o.heightOffset = b.u16();
    else if (op === 125) b.s8();
    else if (op === 126) o.footprintSize = b.u16();
    else if (op === 146) b.u16();
    else if (op === 164) b.skip(4);
    else if (op === 165 || op === 168) b.u8();
    else if (op >= 170 && op < 176) b.u16();
    else if (op === 251) { b.skip(2); b.str(); }
    else if (op === 252) { b.skip(13); b.str(); }
    else if (op === 253) { b.skip(15); b.str(); }
    else if (op === 249) o.params = params(b);
    else throw new Error(`npc ${id}: unknown opcode ${op}`);
  }
  return o;
}
function decodeSeq(id, d) {
  const s = { id, frames: [], delays: [], skeletal: -1, loopOffset: -1 };
  const b = new Buf(d);
  for (;;) {
    const op = b.u8();
    if (op === 0) break;
    if (op === 1) {
      const n = b.u16();
      for (let i = 0; i < n; i++) s.delays.push(b.u16());
      const lo = []; for (let i = 0; i < n; i++) lo.push(b.u16());
      for (let i = 0; i < n; i++) s.frames.push(((b.u16() << 16) | lo[i]) >>> 0);
    }
    else if (op === 2) s.loopOffset = b.u16();
    else if (op === 3) { for (let n = b.u8(); n > 0; n--) b.u8(); }
    else if (op === 4 || op === 19) { /* flags */ }
    else if (op === 5 || op === 8 || op === 9 || op === 10 || op === 11 || op === 16) b.u8();
    else if (op === 6 || op === 7) b.u16();
    else if (op === 12) { const n = b.u8(); b.skip(n * 4); }
    else if (op === 13) s.skeletal = b.i32();
    else if (op === 14) { for (let n = b.u16(); n > 0; n--) b.skip(8); }
    else if (op === 15) b.skip(4);
    else if (op === 17) { for (let n = b.u8(); n > 0; n--) b.u8(); }
    else if (op === 18) b.str();
    else throw new Error(`seq ${id}: unknown opcode ${op}`);
  }
  return s;
}
function decodeIdk(id, d) {
  const o = { id, bodyPart: -1, models: [], selectable: true, recolorFrom: [], recolorTo: [] };
  const b = new Buf(d);
  for (;;) {
    const op = b.u8();
    if (op === 0) break;
    if (op === 1) o.bodyPart = b.u8();
    else if (op === 2) { for (let n = b.u8(); n > 0; n--) o.models.push(b.u16()); }
    else if (op === 3) o.selectable = false;
    else if (op === 5) { o.models = []; for (let n = b.u8(); n > 0; n--) o.models.push(b.i32()); }
    else if (op === 40) { for (let n = b.u8(); n > 0; n--) { o.recolorFrom.push(b.u16()); o.recolorTo.push(b.u16()); } }
    else if (op === 41) { for (let n = b.u8(); n > 0; n--) b.skip(4); }
    else if (op >= 60 && op < 70) b.skip(2);
    else if (op >= 70 && op < 80) b.skip(4);
    else throw new Error(`idk ${id}: unknown opcode ${op}`);
  }
  return o;
}
const T = { ORIGIN: 0, TRANSLATE: 1, ROTATE: 2, SCALE: 3, ALPHA: 5 };
function decodeBase(d) {
  const b = new Buf(d), n = b.u8();
  const types = []; for (let i = 0; i < n; i++) { const t = b.u8(); types.push(t === 6 ? T.ROTATE : t); }
  const counts = []; for (let i = 0; i < n; i++) counts.push(b.u8());
  const labels = counts.map((c) => { const l = []; for (let i = 0; i < c; i++) l.push(b.u8()); return l; });
  return { types, labels };
}

class Osrs {
  constructor(dir) { this.dir = dir; this.cache = new Dat2Cache(dir); this._defs = {}; this._bases = new Map(); this._meshes = new Map(); }
  _all(kind, group, decode) {
    if (!this._defs[kind]) {
      const m = new Map();
      for (const [id, d] of this.cache.files(IDX.CONFIG, group)) { try { m.set(id, decode(id, d)); } catch (e) { m.set(id, { id, name: 'null', error: e.message }); } }
      this._defs[kind] = m;
    }
    return this._defs[kind];
  }
  items() { return this._all('item', CFG.ITEM, decodeItem); }
  npcs() { return this._all('npc', CFG.NPC, decodeNpc); }
  idks() { return this._all('idk', CFG.IDK, decodeIdk); }
  item(id) { return this.items().get(id) || null; }
  npc(id) { return this.npcs().get(id) || null; }
  seq(id) { const d = this.cache.file(IDX.CONFIG, CFG.SEQ, id); return d ? decodeSeq(id, d) : null; }
  seqCount() { return this.cache.files(IDX.CONFIG, CFG.SEQ).size; }
  modelBytes(id) { return this.cache.group(IDX.MODELS, id); }
  hasModel(id) { return this.cache.table(IDX.MODELS).has(id); }
  mesh(id) {
    let m = this._meshes.get(id);
    if (!m) { const d = this.modelBytes(id); if (!d) return null; m = Model.decode(d); if (this._meshes.size > 400) this._meshes.clear(); this._meshes.set(id, m); }
    return Model.clone(m);
  }
  /**
   * The server's own animations (data/definitions/custom-seqs.json, sent to players as "customSeqs"): rows
   * { id, template, frameLengths, frames:[base64 cache-format frame], name?, skeletal? } and frame bases
   * { kind:'base', id, data, rotationDivisor }. Once given, animation() and base() know them too.
   */
  setCustomSeqs(rows) {
    this._customSeqs = new Map(); this._customBases = new Map(); this._customAnims = new Map();
    for (const r of rows || []) {
      if (!r || !Number.isInteger(r.id)) continue;
      if (r.kind === 'base') { try { const b = decodeBase(Buffer.from(r.data, 'base64')); b.id = r.id; b.rotationDivisor = r.rotationDivisor > 1 ? r.rotationDivisor : 1; b.custom = true; if (Number.isInteger(r.copyOf)) b.sameAs = r.copyOf; this._customBases.set(r.id, b); } catch { /* unreadable base: its frames will not play here */ } }
      else if (Number.isInteger(r.template) && Array.isArray(r.frames)) this._customSeqs.set(r.id, r);
    }
    return this;
  }
  customSeqIds() { return this._customSeqs ? [...this._customSeqs.keys()].sort((a, b) => a - b) : []; }
  /**
   * Which skeleton a frame base really is. The Studio's own animations use a COPY of a game skeleton with finer
   * rotations (a custom base row); for "does this animation fit this model" the copy counts as the original.
   */
  skeletonOf(baseId) {
    const b = this._customBases && this._customBases.get(baseId); if (!b) return baseId;
    if (b.sameAs === undefined) { b.sameAs = baseId; try { const human = this.base(0); if (human && JSON.stringify([human.types, human.labels]) === JSON.stringify([b.types, b.labels])) b.sameAs = 0; } catch { /* keep its own id */ } }
    return b.sameAs;
  }
  customSeq(id) { return (this._customSeqs && this._customSeqs.get(id)) || null; }
  base(id) {
    if (this._customBases && this._customBases.has(id)) return this._customBases.get(id);
    let b = this._bases.get(id);
    if (!b) { const d = this.cache.group(IDX.BASES, id); if (!d) return null; b = decodeBase(d); b.id = id; this._bases.set(id, b); }
    return b;
  }
  /** One animation frame as a flat list of operations [type, labels, x, y, z]; origin resets are written out. */
  frame(frameId) {
    const d = this.cache.file(IDX.FRAMES, frameId >>> 16, frameId & 0xffff);
    return d ? this.decodeFrame(d) : null;
  }
  /** Decodes frame bytes in the cache's own format (also what custom-seqs.json holds, base64). */
  decodeFrame(d) {
    const b = new Buf(d), baseId = b.u16(), base = this.base(baseId);
    if (!base) return null;
    const n = b.u8(), data = new Buf(d, b.p + n), div = base.rotationDivisor > 1 ? base.rotationDivisor : 1;
    const ops = []; let reset = -1, lastReset = -1;
    for (let i = 0; i < n; i++) {
      const t = base.types[i];
      if (t === T.ORIGIN) reset = i;
      const f = b.u8();
      if (f === 0) continue;
      if (t === T.ORIGIN) lastReset = i;
      const dv = (t === T.SCALE || t === 10) ? 128 : 0;
      const x = f & 1 ? data.smart2() : dv, y = f & 2 ? data.smart2() : dv, z = f & 4 ? data.smart2() : dv;
      if ((t === T.TRANSLATE || t === T.ROTATE || t === T.SCALE) && reset > lastReset) { ops.push([T.ORIGIN, base.labels[reset], 0, 0, 0]); lastReset = reset; }
      // fine-rotation skeletons (RS3 ports) store rotations multiplied up; the client divides them back
      ops.push(t === T.ROTATE && div > 1 ? [t, base.labels[i], x / div, y / div, z / div] : [t, base.labels[i], x, y, z]);
    }
    return { baseId, ops };
  }
  /** A whole animation: { id, delays, frames:[{ops}], baseId, skeletal }. Custom ones add { custom, template, name }. */
  animation(id) {
    const c = this.customSeq(id);
    if (c) {
      let a = this._customAnims.get(id);
      if (!a) {
        const frames = []; let baseId = -1;
        for (const f of c.frames) { let fr = null; try { fr = this.decodeFrame(Buffer.from(f, 'base64')); } catch { fr = null; } if (fr) { frames.push(fr.ops); baseId = fr.baseId; } else frames.push([]); }
        a = { id, delays: (c.frameLengths || []).slice(), frames, baseId, skeletal: c.skeletal ? c.skeletal.id : -1, custom: true, template: c.template, name: c.name || null };
        this._customAnims.set(id, a);
      }
      return a;
    }
    const s = this.seq(id);
    if (!s) return null;
    const frames = []; let baseId = -1;
    for (const f of s.frames) { const fr = this.frame(f); if (fr) { frames.push(fr.ops); baseId = fr.baseId; } else frames.push([]); }
    return { id, delays: s.delays, frames, baseId, skeletal: s.skeletal };
  }
  /** First selectable identity kit for each of the 7 body parts (head, jaw, torso, arms, hands, legs, feet). */
  defaultKits(female) {
    const kits = new Array(7).fill(null);
    const ids = [...this.idks().keys()].sort((a, b) => a - b);
    for (const id of ids) { const k = this.idks().get(id); if (!k.selectable || k.error) continue; const p = k.bodyPart - (female ? 7 : 0); if (p >= 0 && p < 7 && !kits[p]) kits[p] = k; }
    return kits;
  }
  textureColour(id) {
    if (!this._tex) { this._tex = new Map(); try { for (const [tid, d] of this.cache.files(IDX.TEXTURES, 0)) this._tex.set(tid, (d[0] << 8) | d[1]); } catch { /* optional */ } }
    return this._tex.has(id) ? this._tex.get(id) : 4660;
  }
  search(kind, text, limit = 60) {
    const q = String(text || '').trim().toLowerCase(), isId = /^\d+$/.test(q), out = [];
    const src = kind === 'npc' ? this.npcs() : this.items();
    if (isId && src.has(+q)) out.push(src.get(+q));
    const words = q.split(/\s+/).filter(Boolean);
    for (const d of src.values()) {
      if (out.length >= limit) break;
      if (!d.name || d.name === 'null' || (isId && d.id === +q)) continue;
      if (kind === 'item' && d.noteTemplate !== -1) continue;
      const n = d.name.toLowerCase();
      if (!isId && words.every((w) => n.includes(w))) out.push(d);
    }
    return out;
  }
}
module.exports = { Osrs, decodeItem, decodeNpc, decodeSeq, decodeIdk, decodeBase, T, IDX, CFG };
