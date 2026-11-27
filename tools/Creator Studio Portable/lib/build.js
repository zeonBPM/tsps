'use strict';
// Draft -> finished pieces (model bytes, definition row, reports). Nothing here touches the server; a build only
// reads the caches and returns data. lib/port.js is what writes.
const fs = require('fs');
const Model = require('./model');
const { convert } = require('./convert');
const icon = require('./icon');
const S = require('./stretch');
const W = require('./wear');
const Player = require('./player');
const particles = require('./particles');

const SLOT_FIELDS = { ground: 'model', male: 'maleModel', female: 'femaleModel', male1: 'maleModel1', female1: 'femaleModel1', male2: 'maleModel2', female2: 'femaleModel2' };
const SLOT_FILES = { ground: 'drop.dat', male: 'male.dat', female: 'female.dat', male1: 'male1.dat', female1: 'female1.dat', male2: 'male2.dat', female2: 'female2.dat' };
const slugify = (s) => String(s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';

class Builder {
  constructor(ctx) { this.ctx = ctx; this._rig = null; }
  get osrs() { return this.ctx.osrs(); }
  get rs3() { return this.ctx.rs3(); }
  get server() { return this.ctx.server; }
  rig() { return this._rig || (this._rig = new S.Rig(this.osrs)); }

  /** Faces drawn with a texture get that texture's average colour (the game format written here has no textures). */
  bake(mesh) { if (mesh.ftex) { for (let f = 0; f < mesh.nf; f++) if (mesh.ftex[f] !== -1) mesh.col[f] = this.osrs.textureColour(mesh.ftex[f]); mesh.ftex = null; } return mesh; }
  loadSource(src) {
    if (!src || src.type === 'none') return null;
    if (src.type === 'osrs') { const m = this.osrs.mesh(src.model); if (!m) throw new Error(`OSRS model ${src.model} is not in the cache`); return { mesh: m, bytes: null }; }
    if (src.type === 'custom') { const bytes = fs.readFileSync(this.server.modelFile(src.file)); return { mesh: Model.decode(bytes), bytes }; }
    if (src.type === 'file') { const bytes = fs.readFileSync(src.path); return { mesh: Model.decode(bytes), bytes }; }
    throw new Error('unknown model source ' + src.type);
  }
  applyEdits(mesh, edits) {
    if (!edits) return false;
    let changed = false;
    for (const [from, to] of edits.recolor || []) { if (from !== to) { Model.recolor(mesh, from, to); changed = true; } }
    // hand paint: [face, colour] pairs; only valid for the mesh they were painted on (same face count)
    if (edits.paint && edits.paint.list && edits.paint.list.length) {
      if (edits.paint.faces === mesh.nf) { for (const [f, c] of edits.paint.list) if (f >= 0 && f < mesh.nf) { mesh.col[f] = c & 0xffff; if (mesh.ftex) mesh.ftex[f] = -1; } changed = true; }
      else this.paintDropped = true;
    }
    const t = { scale: edits.scale, rotate: edits.rotate, translate: edits.translate };
    const id = (t.scale === undefined || t.scale === 1 || (Array.isArray(t.scale) && t.scale.every((v) => v === 1))) && (!t.rotate || t.rotate.every((v) => !v)) && (!t.translate || t.translate.every((v) => !v));
    if (!id) { Model.transform(mesh, t); changed = true; }
    return changed;
  }
  /** Every vertex takes the label of the nearest vertex of the OSRS item it plays as (capes bend with the body). */
  nearestLabels(mesh, ref) {
    if (!ref || !ref.vskin) throw new Error('the base item has no worn model with labels to copy from');
    mesh.vskin = new Int32Array(mesh.nv);
    for (let i = 0; i < mesh.nv; i++) {
      let best = 0, bd = Infinity;
      for (let j = 0; j < ref.nv; j++) { const d = (ref.vx[j] - mesh.vx[i]) ** 2 + (ref.vy[j] - mesh.vy[i]) ** 2 + (ref.vz[j] - mesh.vz[i]) ** 2; if (d < bd) { bd = d; best = j; } }
      mesh.vskin[i] = ref.vskin[best];
    }
    return mesh;
  }
  /**
   * One model slot. spec: { source, mode: 'ground'|'weapon'|'armour'|'cape'|'asis', maxTris, tint, label, centre, fit, pads, pivots,
   *                         plates, threshold, fix, edits }
   * returns { mesh, bytes, cacheModel, info, report }
   */
  buildSlot(draft, slot, spec) {
    const item = draft.item, female = slot.startsWith('female'), src = spec.source || { type: 'none' };
    const mode = spec.mode || (slot === 'ground' ? 'ground' : 'asis');
    const refDef = item.baseItemId >= 0 ? this.osrs.item(item.baseItemId) : null;
    const out = { slot, mode, info: {}, report: null, cacheModel: null };
    const worn = slot !== 'ground';
    if (src.type === 'none') return null;
    if (src.type === 'rs3') {
      const common = { maxTris: spec.maxTris || (worn ? 1400 : 1000), tint: !!spec.tint, recolor: item.rs3Recolor, retexture: item.rs3Retexture };
      if (mode === 'armour') {
        if (!refDef) throw new Error('armour needs a base OSRS item (it decides the slot and which body parts are hidden)');
        const r = W.buildWorn(this.osrs, this.rs3, this.rig(), Object.assign({ model: src.model, female, refDef, fit: spec.fit, pads: spec.pads, pivots: spec.pivots, plates: spec.plates, threshold: spec.threshold }, common));
        out.mesh = r.mesh; out.info = r.info; out.report = this.stretchReport(r);
      } else {
        const c = convert(this.rs3, src.model, Object.assign({ equip: worn, label: mode === 'cape' ? 0 : spec.label, centreXY: spec.centre }, common));
        out.mesh = c.mesh; out.info = c.info;
        if (worn && spec.fit) W.fitMesh(out.mesh, spec.fit);
        if (mode === 'cape') this.nearestLabels(out.mesh, refDef ? Player.wornMeshes(this.osrs, refDef, false)[0] : null);
      }
      this.applyEdits(out.mesh, spec.edits);
    } else {
      const loaded = this.loadSource(src);
      out.mesh = loaded.mesh;
      let changed = this.applyEdits(out.mesh, spec.edits);
      if (worn && spec.fit) { W.fitMesh(out.mesh, spec.fit); changed = true; }
      if (worn && mode === 'cape' && spec.relabel) { this.nearestLabels(out.mesh, refDef ? Player.wornMeshes(this.osrs, refDef, false)[0] : null); changed = true; }
      if (worn && mode === 'armour' && spec.fix && refDef && out.mesh.vskin) {
        const r = S.fix(this.osrs, this.rig(), this.bake(out.mesh), { female, refDef, threshold: spec.threshold, plates: spec.plates });
        if (r.steps.length) { out.mesh = r.mesh; changed = true; }
        out.report = this.stretchReport(r);
      }
      if (!changed) { if (src.type === 'osrs') out.cacheModel = src.model; else out.bytes = loaded.bytes; }
      out.info = { vertices: out.mesh.nv, tris: out.mesh.nf };
    }
    if (out.cacheModel === null && !out.bytes) out.bytes = Buffer.from(Model.encode(this.bake(out.mesh)));
    if (worn && mode === 'armour' && !out.report && refDef && out.mesh.vskin) out.report = this.testWorn(out.mesh, refDef, female, spec.threshold);
    out.info.bytes = out.bytes ? out.bytes.length : 0;
    return out;
  }
  stretchReport(r) {
    return { steps: r.steps, pivotSource: r.pivotSource || null, pads: r.pads || null, limit: +r.limit.toFixed(2), beyondLimit: r.beyondLimit, before: S.summary(r.pivotsOnly || r.before), after: S.summary(r.after),
      reference: r.reference ? S.summary(r.reference) : null, pivots: r.pivots, raw: S.summary(r.before), perFace: r.after.perFace.map((v) => +v.toFixed(2)), faceOffset: 0 };
  }
  /** Stretch test of a worn mesh as it is (no changes). */
  testWorn(mesh, refDef, female, threshold) {
    const slot = { wearPos: refDef.wearPos, wearPos2: refDef.wearPos2, wearPos3: refDef.wearPos3 }, rig = this.rig();
    const t = S.measure(this.osrs, rig, { female, threshold, target: 'item', wear: [Object.assign({ tag: 'item', meshes: [mesh] }, slot)] });
    const refMeshes = Player.wornMeshes(this.osrs, refDef, female);
    const ref = refMeshes.length ? S.measure(this.osrs, rig, { female, threshold, target: 'item', wear: [Object.assign({ tag: 'item', meshes: refMeshes }, slot)] }) : null;
    return { steps: [], before: S.summary(t), after: S.summary(t), reference: ref ? S.summary(ref) : null, pivots: S.pivotReport(t, ref), perFace: t.perFace.map((v) => +v.toFixed(2)) };
  }
  /** The whole item: models, icon, and the custom-items.json row with placeholder model ids ('@ground', '@male', ...). */
  buildItem(draft) {
    const item = draft.item, slots = {}, problems = [], warnings = [];
    this.paintDropped = false;
    for (const [slot, spec] of Object.entries(item.models || {})) {
      if (!spec || !SLOT_FIELDS[slot]) continue;
      try { const b = this.buildSlot(draft, slot, spec); if (b) slots[slot] = b; }
      catch (e) { problems.push(`${slot} model: ${e.message}`); }
    }
    const base = item.baseItemId >= 0 ? this.osrs.item(item.baseItemId) : null;
    if (item.baseItemId >= 0 && !base) problems.push(`base item ${item.baseItemId} does not exist in the cache`);
    const ic = Object.assign({ zoom2d: base ? base.zoom2d : 2000, xan2d: base ? base.xan2d : 0, yan2d: base ? base.yan2d : 0, zan2d: base ? base.zan2d : 0, offsetX2d: base ? base.offsetX2d : 0, offsetY2d: base ? base.offsetY2d : 0 }, item.icon || {});
    const ground = slots.ground ? slots.ground.mesh : (base && base.model >= 0 ? this.osrs.mesh(base.model) : null);
    if (ground && (item.icon || {}).auto !== false && slots.ground && slots.ground.cacheModel === null) Object.assign(ic, icon.fit(ground, ic.xan2d, ic.yan2d, ic.zan2d));
    const objType = { name: draft.name, examine: item.examine || '', inventoryActions: item.inventoryActions || [null, slots.male || (base && base.wearPos >= 0) ? 'Wear' : null, null, null, 'Drop'], isTradable: item.isTradable !== false };
    for (const [slot, field] of Object.entries(SLOT_FIELDS)) {
      const b = slots[slot];
      if (b) objType[field] = b.cacheModel !== null ? b.cacheModel : '@' + slot;
      else if (item.models && item.models[slot] === null) objType[field] = -1;       // explicitly "no model here"
    }
    Object.assign(objType, { recolorFrom: (item.recolor || []).map((p) => p[0]), recolorTo: (item.recolor || []).map((p) => p[1]), retextureFrom: [], retextureTo: [],
      zoom2d: ic.zoom2d, xan2d: ic.xan2d, yan2d: ic.yan2d, zan2d: ic.zan2d, offsetX2d: ic.offsetX2d, offsetY2d: ic.offsetY2d });
    for (const k of ['wearPos', 'wearPos2', 'wearPos3', 'resizeX', 'resizeY', 'resizeZ']) if (item[k] !== undefined && item[k] !== null) objType[k] = item[k];
    const row = { id: '@id', objType, itemDef: Object.assign({ tradeable: objType.isTradable, dropable: true }, item.itemDef || {}) };
    if (item.baseItemId >= 0) { row.baseItemId = item.baseItemId; if (item.aliasBase !== false) row.aliasBase = true; }
    if (item.specialAttack && (item.specialAttack.from !== undefined || item.specialAttack.energy !== undefined)) row.specialAttack = item.specialAttack;
    const order = { id: '@id' }; for (const k of ['baseItemId', 'aliasBase', 'objType', 'itemDef', 'specialAttack']) if (row[k] !== undefined) order[k] = row[k];
    for (const b of Object.values(slots)) {
      if (b.report && b.report.beyondLimit > 0) warnings.push(`${b.slot}: ${b.report.beyondLimit} faces still stretch more than the base item ever does (worst ${b.report.after.worst}x, limit ${b.report.limit}x)`);
      if (b.report) for (const p of b.report.pivots) if (p.problem && p.problem.startsWith('EMPTY')) problems.push(`${b.slot}: pivot ${p.labels.join('+')} is empty - ${p.problem.slice(7)}`);
    }
    if (this.paintDropped) warnings.push('some hand paint was left out because the model changed shape since it was painted (clear the paint and paint again)');
    if (!draft.name || !draft.name.trim()) problems.push('the item needs a name');
    // particles: RS3 emitters carried over with the worn model, or copied from another custom item
    let fx = null;
    try {
      if (item.particles === 'rs3' && draft.source && draft.source.type === 'rs3') {
        const it = this.rs3.item(draft.source.id), sexes = {};
        for (const [sex, ids] of [['male', [it.male, it.male1, it.male2]], ['female', [it.female, it.female1, it.female2]]]) sexes[sex] = slots[sex] ? particles.forWorn(this.rs3, ids, slots[sex].mesh) : [];
        if (!sexes.female.length) sexes.female = sexes.male; if (!sexes.male.length) sexes.male = sexes.female;
        if (sexes.male.length) fx = { type: 'rs3', sexes }; else warnings.push('this RS3 item has no particle emitters on its worn models');
      } else if (item.particles && item.particles.copyFrom !== undefined) fx = { type: 'copy', from: item.particles.copyFrom };
    } catch (e) { warnings.push('particles were left out: ' + e.message); }
    let iconImage = null;
    try { if (ground) iconImage = icon.render(this.bake(Model.clone(ground)), ic, 4); } catch { iconImage = null; }
    return { kind: 'item', slots, row: order, icon: ic, iconImage, problems, warnings, base, particles: fx };
  }
}
module.exports = { Builder, SLOT_FIELDS, SLOT_FILES, slugify };
