'use strict';
// RS3 creature -> OSRS-style NPC model that moves correctly with the creature's own (converted) animations.
//
// What "correctly" needs, and what earlier ports got wrong (docs/AGENT-GUIDE.md has the full story):
//   1. the model keeps RS3's own bone labels, so RS3's animations drive it
//   2. RS3's hidden pivot markers are kept as invisible anchor vertices, or joints turn around the feet
//   3. each joint's pivot (the average position of the vertices carrying its labels) is held where RS3 has it,
//      even though the low-poly model has far fewer vertices ("pivot lock")
//   4. colours are RS3's real look: texture x vertex colour, effect layers left out, glow lines kept
//   5. faces that would stretch between two bones become rigid plates
//   6. the result is made safe for the game client's own model build (clientsafe.js) and measured AS THE GAME BUILDS IT
const Model = require('./model');
const { convert } = require('./convert');
const { shadeFaces, markerAnchors } = require('./rs3shade');
const S = require('./stretch');
const CS = require('./clientsafe');
const { rint } = require('./rs3');

/** Adds hidden vertices so every joint label's average position is exactly the RS3 model's. */
function pivotLock(mesh, src, pivotLabels, taken) {
  const want = new Map();   // label -> RS3 centre (game space) and count
  for (let i = 0; i < src.vc; i++) { const l = src.label[i] === 0xffff ? 0 : src.label[i]; if (!pivotLabels.has(l)) continue; if (!want.has(l)) want.set(l, { x: 0, y: 0, z: 0, n: 0 }); const e = want.get(l); e.x += src.pos[i * 3] / 4; e.y += -src.pos[i * 3 + 1] / 4; e.z += src.pos[i * 3 + 2] / 4; e.n++; }
  const have = new Map(); for (let i = 0; i < mesh.nv; i++) { const l = mesh.vskin[i]; if (!want.has(l)) continue; if (!have.has(l)) have.set(l, { x: 0, y: 0, z: 0, n: 0 }); const e = have.get(l); e.x += mesh.vx[i]; e.y += mesh.vy[i]; e.z += mesh.vz[i]; e.n++; }
  const occupied = taken || new Set(); for (let i = 0; i < mesh.nv; i++) occupied.add(mesh.vx[i] + ',' + mesh.vy[i] + ',' + mesh.vz[i]);
  const anchors = []; let worst = 0;
  for (const [l, w] of want) {
    const h = have.get(l);
    if (!h) {   // nothing visible carries this label any more (its faces were effect layers), but joints still turn around it
      let p = [rint(w.x / w.n), rint(w.y / w.n), rint(w.z / w.n)], r = 1; while (occupied.has(p.join(',')) && r < 40) { p = [p[0], p[1] + 1, p[2]]; r++; }
      occupied.add(p.join(',')); anchors.push({ pos: p, label: l }); continue;
    }
    const c = [w.x / w.n, w.y / w.n, w.z / w.n], now = [h.x / h.n, h.y / h.n, h.z / h.n], off = Math.hypot(c[0] - now[0], c[1] - now[1], c[2] - now[2]);
    worst = Math.max(worst, off);
    if (off < 0.05) continue;
    // k helpers whose sum makes the total average the RS3 centre: place them symmetrically about the needed mean
    const k = Math.max(2, Math.min(8, Math.ceil(h.n / 6))), total = h.n + k, mean = [0, 1, 2].map((a) => (c[a] * total - [h.x, h.y, h.z][a]) / k);
    const spots = []; let sum = [0, 0, 0];
    for (let i = 0; i < k - 1; i++) { let p = mean.map(rint), r = 1; while (occupied.has(p.join(',')) && r < 40) { p = [rint(mean[0]) + ((i + r) % 3 === 0 ? r : 0), rint(mean[1]) + ((i + r) % 3 === 1 ? r : 0), rint(mean[2]) + ((i + r) % 3 === 2 ? r : 0)]; r++; } occupied.add(p.join(',')); spots.push(p); sum = sum.map((v, a) => v + p[a]); }
    let last = [0, 1, 2].map((a) => rint(mean[a] * k - sum[a])), r = 1; while (occupied.has(last.join(',')) && r < 40) { last = [last[0], last[1] + 1, last[2]]; r++; }
    occupied.add(last.join(',')); spots.push(last);
    for (const p of spots) anchors.push({ pos: p, label: l });
  }
  return { anchors, worstBefore: +worst.toFixed(2) };
}
/**
 * studio: the Studio. opt: { model: RS3 model id, seqs: [animation ids made for this creature], maxTris (3500),
 *   plateLimit (1.5), keepSoft, glow }
 * returns { mesh, bytes, report }
 */
function buildNpcFromRs3(studio, opt) {
  const rs3 = studio.rs3, osrs = studio.osrs, src = rs3.model(opt.model), steps = [];
  const shaded = shadeFaces(rs3, src, { glow: opt.glow, keepSoft: opt.keepSoft });
  const solid = shaded.filter((f) => f.cover >= 0.5);
  const left = shaded.length - solid.length;
  if (left) steps.push(`left out ${left} faces of see-through effect layers (glows, dust, auras) that would have become solid shards`);
  const glow = solid.filter((f) => f.glow).length; if (glow) steps.push(`kept ${glow} glowing faces (bright lines painted into a dark texture)`);
  const faceData = { faces: solid.map((f) => f.v), cols: solid.map((f) => f.colour), alphas: solid.map(() => 0), meshOf: solid.map((f) => f.mesh) };
  const c = convert(rs3, src, { faceData, rawLabels: true, clusterByLabel: true, markers: true, maxTris: opt.maxTris || 3500 });
  let mesh = c.mesh;
  steps.push(`${c.info.rs3Tris} RS3 triangles -> ${mesh.nf} (${mesh.nv} points), every RS3 bone label kept`);
  const rig = new S.Rig(osrs, opt.seqs, { anyBase: true });
  // pivots: RS3's markers, then the pivot lock
  const anchors = markerAnchors(src).filter((a) => rig.info.pivotLabels.has(a.label));
  if (anchors.length) { mesh = S.addAnchors(mesh, anchors); steps.push(`kept ${anchors.length} hidden pivot-marker points for ${new Set(anchors.map((a) => a.label)).size} joints`); }
  const lock = pivotLock(mesh, src, rig.info.pivotLabels);
  if (lock.anchors.length) { mesh = S.addAnchors(mesh, lock.anchors); steps.push(`pivot lock: ${lock.anchors.length} hidden points hold ${new Set(lock.anchors.map((a) => a.label)).size} joint pivots exactly where RS3 has them (they were up to ${lock.worstBefore} units off after simplifying)`); }
  // stretch: measured as the game builds the model
  const limit = opt.plateLimit || 1.5, test = (m) => S.measureModel(Model.merge([Model.clone(m)]), rig.frames, limit);
  // (plates need per-face numbers for the file's own faces: the game keeps face order, so the numbers line up)
  let safe = CS.fix(mesh, {}).mesh, t = test(safe); const before = { worst: t.worst, over: t.over, grows6: t.growth.filter((g) => g > 6).length };
  for (let pass = 0; pass < 3 && t.over > 0 && opt.plates !== false; pass++) {
    const next = S.plates(mesh, Array.from(t.perFace).slice(0, mesh.nf), limit, rig);
    if (!next.platesMade) break;
    steps.push(`turned ${next.platesMade} triangles that stretched past ${limit}x between two bones into rigid plates`);
    mesh = next; safe = CS.fix(mesh, {}).mesh; t = test(safe);
  }
  const fixed = CS.fix(mesh, { pivotGroups: rig.info.pivotGroups });
  for (const s of fixed.steps) steps.push(s);
  const final = test(fixed.mesh), bytes = Buffer.from(Model.encode(fixed.mesh));
  return { mesh: fixed.mesh, bytes, rig, report: { steps, triangles: fixed.mesh.nf, points: fixed.mesh.nv, bytes: bytes.length, animations: rig.seqs, frames: rig.frames.length,
    beforePlates: before, inGame: { worstStretch: final.worst, typical95: final.p95, facesOverLimit: final.over, facesGrowingOver6Units: final.growth.filter((g) => g > 6).length, largestGrowthUnits: final.maxGrowth, pivotsWithNoVertices: final.originFallbacks },
    gameJoins: CS.check(fixed.mesh).clashes.length, unused: CS.check(fixed.mesh).unused.length } };
}
module.exports = { buildNpcFromRs3, pivotLock };
