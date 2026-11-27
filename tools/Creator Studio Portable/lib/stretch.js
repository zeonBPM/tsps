'use strict';
// Armour stretch tester and fixer.
//
// Why armour stretches in this game: every vertex carries one "label". An animation frame moves whole label
// groups, rotating them around pivots, and each pivot is the average position of the vertices that carry the
// pivot's labels - counted over the whole player as the client builds it (kits that are showing + worn items,
// with vertices at the same position merged and the first model's label kept). So a worn item that hides the
// arms has to supply the shoulder (labels 21 / 25) and elbow (17 / 23) pivots itself. If it has no vertex with
// such a label the pivot falls back to the model origin at the player's feet and the whole arm swings from there.
//
// The tester therefore builds the exact in-game player (hidden kits included) and plays real player animations.
const Model = require('./model');
const Anim = require('./anim');
const Player = require('./player');

// stand, walk, run, turns, casts, unarmed / weapon attacks, block, eat, emotes: all on the human skeleton
const DEFAULT_ANIMS = [808, 819, 824, 820, 821, 822, 711, 1979, 1162, 422, 423, 390, 386, 395, 400, 401, 426, 4230, 428, 419, 424, 829, 863, 858];
const EPS = 3;      // softens the ratio for tiny edges: a 1-unit edge growing to 6 is not a visible problem

class Rig {
  /** opt.anyBase: accept animations on any skeleton (NPCs); players use only the human one (base 0). */
  constructor(osrs, seqIds, opt) {
    this.frames = []; this.seqs = [];
    for (const id of seqIds || DEFAULT_ANIMS) {
      const a = osrs.animation(id);
      if (!a || !a.frames.length || ((osrs.skeletonOf ? osrs.skeletonOf(a.baseId) : a.baseId) !== 0 && !(opt && opt.anyBase))) continue;
      this.seqs.push(id);
      // scaling (type 3) is a deliberate effect (a death shrink, a growing spell), not a fault: leave it out of the measurement
      a.frames.forEach((ops, i) => { if (ops.length) this.frames.push({ seq: id, index: i, ops: ops.filter((o) => o[0] !== Anim.T.SCALE) }); });
    }
    this.info = Anim.rig(this.frames.map((f) => f.ops));
  }
}
function centroid(mesh, labels) {
  const set = new Set(labels); let x = 0, y = 0, z = 0, n = 0;
  if (mesh.vskin) for (let i = 0; i < mesh.nv; i++) if (set.has(mesh.vskin[i])) { x += mesh.vx[i]; y += mesh.vy[i]; z += mesh.vz[i]; n++; }
  return { count: n, pos: n ? [x / n, y / n, z / n] : null };
}
/**
 * Plays every rig frame on the in-game player and measures each face of the worn item under test.
 * cfg: { female, wear:[{tag, meshes, wearPos, wearPos2, wearPos3}], target (tag), threshold }
 */
function measure(osrs, rig, cfg) {
  const threshold = cfg.threshold || 1.4;
  const player = Player.build(osrs, cfg), mesh = player.mesh;
  const target = cfg.target || 'item', faces = [];
  for (let f = 0; f < mesh.nf; f++) if (player.sources[mesh.src[f]] === target) faces.push(f);
  const P0 = Anim.positions(mesh), G = Anim.groups(mesh.vskin, mesh.nv);
  const edge = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const nf = faces.length, rest = new Float64Array(nf * 3), worst = new Float64Array(nf), where = new Int32Array(nf).fill(-1);
  faces.forEach((f, k) => { const a = mesh.fa[f], b = mesh.fb[f], c = mesh.fc[f]; rest[k * 3] = edge(P0, a, b); rest[k * 3 + 1] = edge(P0, b, c); rest[k * 3 + 2] = edge(P0, c, a); });
  rig.frames.forEach((fr, fi) => {
    const P = Anim.apply(P0.slice(), G, fr.ops);
    for (let k = 0; k < nf; k++) {
      const f = faces[k], a = mesh.fa[f], b = mesh.fb[f], c = mesh.fc[f];
      const s = Math.max(Math.abs(Math.log((edge(P, a, b) + EPS) / (rest[k * 3] + EPS))), Math.abs(Math.log((edge(P, b, c) + EPS) / (rest[k * 3 + 1] + EPS))), Math.abs(Math.log((edge(P, c, a) + EPS) / (rest[k * 3 + 2] + EPS))));
      if (s > worst[k]) { worst[k] = s; where[k] = fi; }
    }
  });
  const ratio = Array.from(worst, (w) => Math.exp(w)), sorted = ratio.slice().sort((a, b) => a - b);
  let wi = 0; for (let k = 1; k < nf; k++) if (worst[k] > worst[wi]) wi = k;
  const pivots = rig.info.pivotGroups.map((labels) => Object.assign({ labels }, centroid(mesh, labels)));
  return {
    faces: nf, frames: rig.frames.length, threshold,
    worst: nf ? +ratio[wi].toFixed(3) : 1, p95: nf ? +sorted[Math.floor(nf * 0.95)].toFixed(3) : 1, median: nf ? +sorted[nf >> 1].toFixed(3) : 1,
    over: ratio.filter((r) => r > threshold).length,
    worstAt: nf && where[wi] >= 0 ? { seq: rig.frames[where[wi]].seq, frame: rig.frames[where[wi]].index } : null,
    perFace: ratio, pivots, hidden: player.hidden, player, targetFaces: faces,
  };
}
/**
 * Plays frames on any single model (an NPC) and reports what goes wrong:
 *   originFallbacks - pivots whose labels are on no vertex, so the joint turns around the frame's own offset or the model
 *                     origin at the feet. Normal for some creatures; a fault if a limb or armour piece swings from the floor.
 *   unmoved     - labels on the model that no frame ever moves (parts that stay behind while the rest animates)
 *   faces       - the worst stretching triangles with the labels of their corners (a triangle bridging two limbs shows up here)
 */
function measureModel(mesh, frames, threshold) {
  threshold = threshold || 1.4;
  const P0 = Anim.positions(mesh), G = Anim.groups(mesh.vskin, mesh.nv), nf = mesh.nf;
  const edge = (P, a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
  const rest = new Float64Array(nf * 3), worst = new Float64Array(nf), where = new Int32Array(nf).fill(-1), growth = new Float64Array(nf);
  for (let f = 0; f < nf; f++) { const a = mesh.fa[f], b = mesh.fb[f], c = mesh.fc[f]; rest[f * 3] = edge(P0, a, b); rest[f * 3 + 1] = edge(P0, b, c); rest[f * 3 + 2] = edge(P0, c, a); }
  frames.forEach((fr, fi) => {
    const P = Anim.apply(P0.slice(), G, fr.ops);
    for (let f = 0; f < nf; f++) {
      const a = mesh.fa[f], b = mesh.fb[f], c = mesh.fc[f];
      const e0 = edge(P, a, b), e1 = edge(P, b, c), e2 = edge(P, c, a);
      const s = Math.max(Math.abs(Math.log((e0 + EPS) / (rest[f * 3] + EPS))), Math.abs(Math.log((e1 + EPS) / (rest[f * 3 + 1] + EPS))), Math.abs(Math.log((e2 + EPS) / (rest[f * 3 + 2] + EPS))));
      if (s > worst[f]) { worst[f] = s; where[f] = fi; }
      const g = Math.max(e0 - rest[f * 3], e1 - rest[f * 3 + 1], e2 - rest[f * 3 + 2]); if (g > growth[f]) growth[f] = g;
    }
  });
  const info = Anim.rig(frames.map((f) => f.ops)), ratio = Array.from(worst, (w) => Math.exp(w)), sorted = ratio.slice().sort((a, b) => a - b);
  const moved = new Set(); for (const fr of frames) for (const op of fr.ops) if (op[0] !== Anim.T.ORIGIN) for (const l of op[1]) moved.add(l);
  const onModel = new Map(); if (mesh.vskin) for (let i = 0; i < mesh.nv; i++) onModel.set(mesh.vskin[i], (onModel.get(mesh.vskin[i]) || 0) + 1);
  const order = ratio.map((r, f) => [r, f]).sort((a, b) => b[0] - a[0]).slice(0, 15).filter((x) => x[0] > threshold);
  return { faces: nf, frames: frames.length, threshold, worst: nf ? +sorted[nf - 1].toFixed(3) : 1, p95: nf ? +sorted[Math.floor(nf * 0.95)].toFixed(3) : 1, over: ratio.filter((r) => r > threshold).length,
    originFallbacks: info.pivotGroups.filter((labels) => centroid(mesh, labels).count === 0).map((l) => l.join('+')),
    unmoved: [...onModel.entries()].filter(([l]) => !moved.has(l)).map(([label, vertices]) => ({ label, vertices })),
    growth, maxGrowth: nf ? +Math.max(...growth).toFixed(1) : 0,
    worstFaces: order.map(([r, f]) => ({ face: f, stretch: +r.toFixed(2), grows: +growth[f].toFixed(1), colour: mesh.col[f], labels: [mesh.fa[f], mesh.fb[f], mesh.fc[f]].map((v) => mesh.vskin ? mesh.vskin[v] : -1), at: where[f] >= 0 ? { seq: frames[where[f]].seq, frame: frames[where[f]].index } : null,
      points: [mesh.fa[f], mesh.fb[f], mesh.fc[f]].map((v) => [mesh.vx[v], mesh.vy[v], mesh.vz[v]]) })), perFace: ratio };
}
/** Compare the pivots of the item under test with the same player wearing the OSRS reference item. */
function pivotReport(test, ref) {
  const out = [];
  test.pivots.forEach((p, i) => {
    const r = ref ? ref.pivots[i] : null;
    const row = { labels: p.labels, vertices: p.count, refVertices: r ? r.count : null, pos: p.pos && p.pos.map((v) => +v.toFixed(1)), ref: r && r.pos ? r.pos.map((v) => +v.toFixed(1)) : null, drift: null, problem: null, note: null };
    if (p.pos && r && r.pos) row.drift = +Math.hypot(p.pos[0] - r.pos[0], p.pos[1] - r.pos[1], p.pos[2] - r.pos[2]).toFixed(1);
    if (r && r.count > 0 && p.count === 0) row.problem = 'EMPTY: nothing carries label ' + p.labels.join('/') + ', so this joint would pivot around the feet';
    else if (row.drift !== null && row.drift > 14) row.note = 'pivot is ' + row.drift + ' units from where the reference item puts it (normal when the model keeps its own pivots)';
    if ((r && r.count) || p.count) out.push(row);
  });
  return out;
}
const summary = (t) => ({ faces: t.faces, worst: t.worst, p95: t.p95, median: t.median, over: t.over, threshold: t.threshold, worstAt: t.worstAt, frames: t.frames, hidden: t.hidden });

/** Add vertices that only exist to steer a pivot. Each gets a zero-area face so the client keeps it. Anchor faces go first. */
function addAnchors(mesh, anchors) {
  if (!anchors.length) return mesh;
  const occupied = new Set();
  for (let i = 0; i < mesh.nv; i++) occupied.add(mesh.vx[i] + ',' + mesh.vy[i] + ',' + mesh.vz[i]);
  const V = [], L = [], F = [], C = [], A = [], Pr = [], Tt = [];
  for (const a of anchors) { const id = V.length; V.push(a.pos.map(Math.round)); L.push(a.label); F.push([id, id, id]); C.push(0); A.push(0); Pr.push(mesh.prio ? 0 : mesh.priority); Tt.push(0); }
  const base = V.length;
  for (let i = 0; i < mesh.nv; i++) { V.push([mesh.vx[i], mesh.vy[i], mesh.vz[i]]); L.push(mesh.vskin ? mesh.vskin[i] : 0); }
  for (let f = 0; f < mesh.nf; f++) { F.push([mesh.fa[f] + base, mesh.fb[f] + base, mesh.fc[f] + base]); C.push(mesh.col[f]); A.push(mesh.alpha ? mesh.alpha[f] : 0); Pr.push(mesh.prio ? mesh.prio[f] : mesh.priority); Tt.push(mesh.rtype ? mesh.rtype[f] : 0); }
  const out = Model.fromArrays(V, F, C, { alpha: A, vskin: L, prio: mesh.prio ? Pr : null, rtype: mesh.rtype ? Tt : null, priority: mesh.priority });
  out.anchors = (mesh.anchors || 0) + anchors.length;
  return out;
}
/** Triangles that stretch more than the threshold become one rigid copy per bone they touch (overlapping plates).
 *  Copies sit one or more whole units inside, because the client merges vertices that share a position. */
function plates(mesh, perFace, threshold, rig) {
  const V = [], L = [], F = [], C = [], A = [], Pr = [], Tt = [];
  const occupied = new Set();
  for (let i = 0; i < mesh.nv; i++) { V.push([mesh.vx[i], mesh.vy[i], mesh.vz[i]]); L.push(mesh.vskin[i]); occupied.add(V[i].join(',')); }
  const cache = new Map(); let made = 0;
  const push = (f, idx) => { F.push(idx); C.push(mesh.col[f]); A.push(mesh.alpha ? mesh.alpha[f] : 0); Pr.push(mesh.prio ? mesh.prio[f] : mesh.priority); Tt.push(mesh.rtype ? mesh.rtype[f] : 0); };
  for (let f = 0; f < mesh.nf; f++) {
    const idx = [mesh.fa[f], mesh.fb[f], mesh.fc[f]];
    if (!(perFace[f] > threshold)) { push(f, idx); continue; }
    const classes = [...new Set(idx.map((v) => rig.info.motionClass(L[v])))];
    if (classes.length < 2) { push(f, idx); continue; }
    const p = idx.map((v) => V[v]);
    let n = [(p[1][1] - p[0][1]) * (p[2][2] - p[0][2]) - (p[1][2] - p[0][2]) * (p[2][1] - p[0][1]), (p[1][2] - p[0][2]) * (p[2][0] - p[0][0]) - (p[1][0] - p[0][0]) * (p[2][2] - p[0][2]), (p[1][0] - p[0][0]) * (p[2][1] - p[0][1]) - (p[1][1] - p[0][1]) * (p[2][0] - p[0][0])];
    const len = Math.hypot(n[0], n[1], n[2]) || 1; n = n.map((v) => v / len);
    made++;
    classes.forEach((cls, k) => {
      const label = L[idx.find((v) => rig.info.motionClass(L[v]) === cls)];
      push(f, idx.map((v) => {
        if (rig.info.motionClass(L[v]) === cls) return v;
        const key = v + ':' + cls;
        if (cache.has(key)) return cache.get(key);
        let pos = null;
        for (let step = 1; step < 12 && !pos; step++) {
          const c = [Math.round(V[v][0] - n[0] * step), Math.round(V[v][1] - n[1] * step), Math.round(V[v][2] - n[2] * step)];
          if (!occupied.has(c.join(','))) pos = c;
        }
        if (!pos) for (let step = 1; !pos; step++) { const c = [V[v][0], V[v][1] + step, V[v][2]]; if (!occupied.has(c.join(','))) pos = c; }
        occupied.add(pos.join(','));
        const id = V.length; V.push(pos); L.push(label); cache.set(key, id);
        return id;
      }));
      void k;
    });
  }
  const out = Model.fromArrays(V, F, C, { alpha: A, vskin: L, prio: mesh.prio ? Pr : null, rtype: mesh.rtype ? Tt : null, priority: mesh.priority });
  out.anchors = mesh.anchors || 0; out.platesMade = made;
  return out;
}
/** Labels the OSRS reference configuration uses for this slot: the reference item plus the kits it hides. */
function validLabels(osrs, refDef, female) {
  const set = new Set();
  for (const m of Player.wornMeshes(osrs, refDef, female)) if (m.vskin) for (const l of m.vskin) set.add(l);
  const kits = osrs.defaultKits(female);
  for (const part of Player.hiddenParts([refDef])) if (kits[part]) for (const id of kits[part].models) { const m = osrs.mesh(id); if (m && m.vskin) for (const l of m.vskin) set.add(l); }
  return set;
}
/**
 * Repairs a labelled worn mesh so it animates on the in-game player:
 *   1. every joint pivot the reference item supplies is supplied here too (anchors copied from the reference);
 *   2. triangles that still stretch past the threshold become rigid plates.
 * opt: { female, refDef (cache item it plays as), wear (extra items), threshold, extraAnchors:[{pos,label}], maxPasses }
 * returns { mesh, before, after, reference, pivots, steps:[text] }
 */
function fix(osrs, rig, mesh, opt) {
  const threshold = opt.threshold || 1.4, steps = [];
  const slot = { wearPos: opt.refDef.wearPos, wearPos2: opt.refDef.wearPos2, wearPos3: opt.refDef.wearPos3 };
  const cfgFor = (m) => ({ female: opt.female, threshold, target: 'item', wear: [Object.assign({ tag: 'item', meshes: [m] }, slot)].concat(opt.wear || []) });
  const refMeshes = Player.wornMeshes(osrs, opt.refDef, opt.female);
  const reference = refMeshes.length ? measure(osrs, rig, { female: opt.female, threshold, target: 'item', wear: [Object.assign({ tag: 'item', meshes: refMeshes }, slot)].concat(opt.wear || []) }) : null;
  const before = measure(osrs, rig, cfgFor(mesh));
  let cur = mesh;
  if (opt.extraAnchors && opt.extraAnchors.length) { cur = addAnchors(cur, opt.extraAnchors); steps.push(`kept ${opt.extraAnchors.length} of the source model's own pivot markers`); }
  // 1. pivots: any joint the reference supplies and this item leaves empty
  if (reference) {
    let test = measure(osrs, rig, cfgFor(cur));
    const need = [];
    test.pivots.forEach((p, i) => {
      if (p.count > 0 || reference.pivots[i].count === 0) return;
      for (const rm of refMeshes) if (rm.vskin) for (let v = 0; v < rm.nv; v++) if (p.labels.includes(rm.vskin[v])) need.push({ pos: [rm.vx[v], rm.vy[v], rm.vz[v]], label: rm.vskin[v] });
    });
    const seen = new Set(), uniq = need.filter((a) => { const k = a.label + ':' + a.pos.join(','); if (seen.has(k)) return false; seen.add(k); return true; });
    if (uniq.length) { cur = addAnchors(cur, uniq); steps.push(`added ${uniq.length} pivot anchors for labels ${[...new Set(uniq.map((a) => a.label))].sort((a, b) => a - b).join(', ')} (copied from ${opt.refDef.name})`); }
  }
  // 2. plates for what still stretches
  let after = measure(osrs, rig, cfgFor(cur));
  const pivotsOnly = after;
  // How much stretch is a fault? OSRS's own clothes stretch on purpose (a robe skirt is cloth pulled between the legs),
  // so the limit is whatever the reference item itself reaches, plus a little. Only faces beyond that become plates.
  const limit = opt.plateLimit || (reference ? Math.max(threshold, reference.worst * 1.1) : threshold);
  const beyond = (t) => t.perFace.filter((r) => r > limit).length;
  for (let pass = 0; pass < (opt.maxPasses || 3) && beyond(after) > 0 && opt.plates !== false; pass++) {
    const next = plates(cur, after.perFace, limit, rig);
    if (!next.platesMade) break;
    steps.push(`turned ${next.platesMade} triangles that stretched past ${limit.toFixed(1)}x into rigid plates`);
    cur = next; after = measure(osrs, rig, cfgFor(cur));
  }
  return { mesh: cur, before, pivotsOnly, after, reference, limit, beyondLimit: beyond(after), pivots: pivotReport(after, reference), pivotsBefore: pivotReport(before, reference), steps };
}
/** Map RS3 vertex labels onto the labels the OSRS skeleton uses for this slot.
 *  Kept when OSRS uses the same label; otherwise the vertex follows its strongest RS3 bone (the label most of that
 *  bone's vertices carry), and failing that the nearest vertex that has a usable label. Pivot labels are never handed out. */
function mapLabels(rs3Model, valid, pivotLabels) {
  const m = rs3Model, vc = m.vc, out = new Int32Array(vc).fill(-1), dom = new Int32Array(vc).fill(-1);
  if (m.skin) for (let i = 0; i < vc; i++) {
    const s = m.skin[i], w = Array.from(s.weights); if (!s.bones.length) continue;
    if (w.length) w[w.length - 1] = 255 - w.slice(0, -1).reduce((a, b) => a + b, 0);
    let best = 0; for (let k = 1; k < s.bones.length; k++) if ((w[k] || 0) > (w[best] || 0)) best = k;
    dom[i] = s.bones[best];
  }
  const usable = (l) => valid.has(l) && !pivotLabels.has(l), votes = new Map();
  for (let i = 0; i < vc; i++) {
    const l = m.label[i];
    if (valid.has(l)) out[i] = l;
    if (usable(l) && dom[i] >= 0) { if (!votes.has(dom[i])) votes.set(dom[i], new Map()); const v = votes.get(dom[i]); v.set(l, (v.get(l) || 0) + 1); }
  }
  const pending = [];
  for (let i = 0; i < vc; i++) {
    if (out[i] >= 0) continue;
    const v = dom[i] >= 0 ? votes.get(dom[i]) : null;
    if (v) { let best = -1, n = 0; for (const [l, c] of v) if (c > n) { n = c; best = l; } out[i] = best; }
    else pending.push(i);
  }
  if (pending.length) {
    const good = []; for (let i = 0; i < vc; i++) if (out[i] >= 0 && usable(out[i])) good.push(i);
    for (const i of pending) {
      let best = -1, bd = Infinity;
      for (const g of good) { const d = (m.pos[g * 3] - m.pos[i * 3]) ** 2 + (m.pos[g * 3 + 1] - m.pos[i * 3 + 1]) ** 2 + (m.pos[g * 3 + 2] - m.pos[i * 3 + 2]) ** 2; if (d < bd) { bd = d; best = g; } }
      out[i] = best >= 0 ? out[best] : 0;
    }
  }
  return out;
}
module.exports = { Rig, measure, measureModel, pivotReport, summary, addAnchors, plates, fix, mapLabels, validLabels, DEFAULT_ANIMS };
