'use strict';
// Builds a worn (equipped) model from an RS3 model so that it animates correctly on the OSRS player.
//   labels : RS3's own classic labels where OSRS uses the same ones, otherwise the vertex follows its strongest RS3 bone
//   pivots : RS3 models carry tiny hidden "marker" triangles for their joint pivots; they are kept (the old converter
//            dropped them, which left the shoulder and waist pivots empty in game)
//   check  : the result is played on the real in-game player and anything still stretching becomes rigid plates
const Model = require('./model');
const { convert } = require('./convert');
const S = require('./stretch');

function fitMesh(mesh, fit) {
  if (!fit) return mesh;
  const s = fit.scale === undefined ? 1 : fit.scale, t = fit.offset || [0, 0, 0];
  if (s !== 1 || t[0] || t[1] || t[2]) Model.transform(mesh, { scale: s, translate: t });
  return mesh;
}
const fitPoint = (p, fit) => { if (!fit) return p; const s = fit.scale === undefined ? 1 : fit.scale, t = fit.offset || [0, 0, 0]; return [Math.round(p[0] * s + t[0]), Math.round(p[1] * s + t[1]), Math.round(p[2] * s + t[2])]; };

/**
 * opt: { model (RS3 model id), female, refDef (OSRS item it plays as), maxTris, tint, recolor, retexture, fit:{scale,offset},
 *        threshold, pivots: 'auto' | 'source' | 'reference', plates: true|false, wear: other worn items }
 */
// The human skeleton's arm joints: shoulder pivot label, elbow pivot label, and the chest "pauldron" label on that side.
const ARMS = [{ shoulder: 21, elbow: 17, upper: [18, 20, 21, 17], pad: 60 }, { shoulder: 25, elbow: 23, upper: [24, 26, 25, 23], pad: 59 }];
const TORSO = 8;
/**
 * Shoulder pads. RS3 hangs a whole pauldron on the upper-arm bone; under OSRS attack animations (arms go right up)
 * that flips the pauldron over the head. 'chest' moves everything above the middle of the upper arm onto the chest
 * pauldron labels (59 / 60) so it stays put, as OSRS platebodies do; 'arm' leaves RS3's choice; 'auto' picks 'chest'
 * when the piece really has big pauldrons.
 */
function shoulderPads(src, labels, valid, mode) {
  const info = { mode, applied: false, moved: 0, big: 0 };
  if (mode === 'arm') return info;
  const y = (i) => -src.pos[i * 3 + 1] / 4, x = (i) => src.pos[i * 3] / 4;
  const plan = [];
  for (const arm of ARMS) {
    const mean = (label) => { let s = 0, sx = 0, n = 0; for (let i = 0; i < src.vc; i++) if (labels[i] === label) { s += y(i); sx += x(i); n++; } return n ? { y: s / n, x: sx / n } : null; };
    const sh = mean(arm.shoulder), el = mean(arm.elbow);
    if (!sh || !el) continue;
    const cut = (sh.y + el.y) / 2, upper = new Set(arm.upper), verts = [];
    for (let i = 0; i < src.vc; i++) if (upper.has(labels[i]) && labels[i] !== arm.shoulder && labels[i] !== arm.elbow && y(i) < cut) { verts.push(i); if (y(i) < sh.y - 10 || Math.abs(x(i)) > Math.abs(sh.x) + 18) info.big++; }
    plan.push({ arm, verts });
  }
  if (mode === 'auto' && info.big < 30) return info;
  for (const { arm, verts } of plan) { const to = valid.has(arm.pad) ? arm.pad : TORSO; for (const i of verts) { labels[i] = to; info.moved++; } }
  info.applied = info.moved > 0;
  return info;
}
function buildWorn(osrs, rs3, rig, opt) {
  const src = rs3.model(opt.model);
  const valid = S.validLabels(osrs, opt.refDef, opt.female);
  const labels = S.mapLabels(src, valid, rig.info.pivotLabels);
  const pads = shoulderPads(src, labels, valid, opt.pads || 'auto');
  const c = convert(rs3, src, { labels, clusterByLabel: true, markers: true, maxTris: opt.maxTris, tint: opt.tint, recolor: opt.recolor, retexture: opt.retexture, keep: opt.keep });
  const mesh = fitMesh(c.mesh, opt.fit);
  const markers = c.extra.helpers.filter((h) => rig.info.pivotLabels.has(h.rs3Label) && valid.has(h.rs3Label)).map((h) => ({ pos: fitPoint(h.pos, opt.fit), label: h.rs3Label }));
  const run = (useMarkers) => S.fix(osrs, rig, Model.clone(mesh), { female: opt.female, refDef: opt.refDef, threshold: opt.threshold, wear: opt.wear, plates: opt.plates, extraAnchors: useMarkers ? markers : [] });
  const mode = opt.pivots || 'auto';
  let result, used;
  if (mode === 'source' || (mode === 'auto' && !markers.length)) { result = run(markers.length > 0); used = markers.length ? 'source' : 'reference'; }
  else if (mode === 'reference') { result = run(false); used = 'reference'; }
  else {
    const a = run(true), b = run(false);
    // fewer stretched faces wins; ties go to the smaller worst case
    const score = (r) => r.beyondLimit * 100000 + r.after.over * 10 + r.after.worst;
    if (score(a) <= score(b)) { result = a; used = 'source'; } else { result = b; used = 'reference'; }
    result.alternatives = { source: S.summary(a.after), reference: S.summary(b.after) };
  }
  result.pivotSource = used; result.pads = pads;
  result.info = Object.assign({}, c.info, { vertices: result.mesh.nv, tris: result.mesh.nf, anchors: result.mesh.anchors || 0, sourceMarkers: markers.length,
    labels: Model.labelCounts(result.mesh).map((l) => l.label) });
  result.emitters = c.extra.emitterCount;
  return result;
}
module.exports = { buildWorn, fitMesh, fitPoint };
