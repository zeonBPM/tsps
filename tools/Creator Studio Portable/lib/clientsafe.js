'use strict';
// Makes a model come out of the game client's own model build unchanged.
//
// The client never uses an NPC or player model file as it is. It rebuilds it face by face (ModelData.merge):
//   * a vertex that no face uses is DROPPED
//   * vertices at exactly the same position become ONE vertex, and the first one met (in face order) keeps its label
// Both change how the model animates, and neither shows up if you only test the file itself:
//   * a joint turns around the average position of the vertices carrying its pivot labels. Hidden "helper" vertices
//     put there to hold a pivot in place have no faces, so the client throws them away and the pivot moves.
//   * two parts that touch at one point (the inner edges of two leg plates, say) end up sharing that vertex. One part
//     now has a corner that follows the other part's bone, and its faces stretch between them.
// check() reports both; fix() repairs both: every unused vertex gets a zero-size face (kept, draws nothing), and
// vertices that share a position but not a label are moved 1 unit apart.
const Model = require('./model');

const key = (m, i) => m.vx[i] + ',' + m.vy[i] + ',' + m.vz[i];
/** Vertices in the order the client meets them (face order), then how they would merge. */
function check(mesh) {
  const used = new Uint8Array(mesh.nv), first = new Map(), clashes = [];
  const meet = (v, f) => {
    if (used[v]) return; used[v] = 1;
    const k = key(mesh, v), w = first.get(k);
    if (w === undefined) { first.set(k, v); return; }
    if (mesh.vskin && mesh.vskin[w] !== mesh.vskin[v]) clashes.push({ vertex: v, keeps: w, face: f, position: [mesh.vx[v], mesh.vy[v], mesh.vz[v]], label: mesh.vskin[v], becomes: mesh.vskin[w] });
  };
  for (let f = 0; f < mesh.nf; f++) { meet(mesh.fa[f], f); meet(mesh.fb[f], f); meet(mesh.fc[f], f); }
  const unused = []; for (let i = 0; i < mesh.nv; i++) if (!used[i]) unused.push(i);
  return { vertices: mesh.nv, faces: mesh.nf, unused, clashes, ok: !unused.length && !clashes.length };
}
/** Average position of the vertices carrying any of these labels. */
function centre(mesh, labels) {
  const set = new Set(labels); let x = 0, y = 0, z = 0, n = 0;
  for (let i = 0; i < mesh.nv; i++) if (set.has(mesh.vskin[i])) { x += mesh.vx[i]; y += mesh.vy[i]; z += mesh.vz[i]; n++; }
  return n ? { x: x / n, y: y / n, z: z / n, count: n } : null;
}
/** How far each joint pivot moves between the file and what the client builds from it. */
function pivotShift(mesh, pivotGroups) {
  const built = Model.merge([Model.clone(mesh)]), out = [];
  for (const labels of pivotGroups) {
    const a = centre(mesh, labels), b = centre(built, labels);
    if (!a && !b) continue;
    out.push({ labels, shift: a && b ? +Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(2) : null, lost: !!a && !b, inFile: a ? a.count : 0, inGame: b ? b.count : 0 });
  }
  return out.sort((p, q) => (q.lost - p.lost) || ((q.shift || 0) - (p.shift || 0)));
}
const OFFSETS = (() => { const o = []; for (let r = 1; r <= 4; r++) for (let x = -r; x <= r; x++) for (let y = -r; y <= r; y++) for (let z = -r; z <= r; z++) { if (Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) !== r) continue; if (x > 0 || (x === 0 && (y > 0 || (y === 0 && z > 0)))) o.push([x, y, z]); } return o; })();
/**
 * Returns a repaired copy and what was done. Real faces keep their order and numbers; zero-size faces go on the end.
 * opt.pivotGroups (from a Rig) lets it also report how far joint pivots sit from the file's design, before and after.
 */
function fix(mesh, opt) {
  opt = opt || {};
  const m = Model.clone(mesh), before = check(m), steps = [];
  const used = new Uint8Array(m.nv); for (let f = 0; f < m.nf; f++) { used[m.fa[f]] = 1; used[m.fb[f]] = 1; used[m.fc[f]] = 1; }
  // 1. real vertices that share a position but not a label: move the later one 1 unit, towards its own faces
  let moved = 0;
  for (let pass = 0; pass < 6; pass++) {
    const c = check(m); if (!c.clashes.length) break;
    const taken = new Map(); for (let i = 0; i < m.nv; i++) { if (!used[i]) continue; const k = key(m, i); if (!taken.has(k)) taken.set(k, new Set()); taken.get(k).add(m.vskin[i]); }
    for (const clash of c.clashes) {
      const v = clash.vertex;
      let sx = 0, sy = 0, sz = 0, n = 0;
      for (let f = 0; f < m.nf; f++) { const a = m.fa[f], b = m.fb[f], cc = m.fc[f]; if (a !== v && b !== v && cc !== v) continue; for (const w of [a, b, cc]) if (w !== v) { sx += m.vx[w]; sy += m.vy[w]; sz += m.vz[w]; n++; } }
      const d = n ? [sx / n - m.vx[v], sy / n - m.vy[v], sz / n - m.vz[v]] : [1, 0, 0];
      const order = [0, 1, 2].sort((p, q) => Math.abs(d[q]) - Math.abs(d[p])), tries = [];
      for (const axis of order) { const s = Math.sign(d[axis]) || 1; tries.push([axis, s], [axis, -s]); }
      search: for (let reach = 1; reach <= 3; reach++) for (const [axis, s] of tries) {
        const p = [m.vx[v], m.vy[v], m.vz[v]]; p[axis] += s * reach;
        const others = taken.get(p.join(','));
        if (others && [...others].some((l) => l !== m.vskin[v])) continue;
        m.vx[v] = p[0]; m.vy[v] = p[1]; m.vz[v] = p[2];
        if (!taken.has(p.join(','))) taken.set(p.join(','), new Set()); taken.get(p.join(',')).add(m.vskin[v]);
        moved++; break search;
      }
    }
  }
  if (moved) steps.push(`moved ${moved} ${moved === 1 ? 'vertex' : 'vertices'} 1 unit: ${moved === 1 ? 'it' : 'they'} sat exactly on a vertex of another body part, and the game would have joined them (which stretches faces between the two parts)`);
  // 2. unused "helper" vertices hold joint pivots in place. The game keeps one vertex per position, so helpers stacked
  //    on one spot (or sitting on a real vertex) count once. Spread each stack over free spots around it, in mirrored
  //    pairs, so every helper survives and the average position stays exactly where it was.
  const occupied = new Set(); for (let i = 0; i < m.nv; i++) if (used[i]) occupied.add(key(m, i));
  const stacks = new Map(); for (let i = 0; i < m.nv; i++) if (!used[i]) { const k = key(m, i) + '|' + m.vskin[i]; if (!stacks.has(k)) stacks.set(k, []); stacks.get(k).push(i); }
  let spread = 0, extra = [];
  for (const list of stacks.values()) {
    const p = [m.vx[list[0]], m.vy[list[0]], m.vz[list[0]]], free = (q) => !occupied.has(q.join(',')), at = (o, s) => [p[0] + o[0] * s, p[1] + o[1] * s, p[2] + o[2] * s];
    const spots = []; let need = list.length;
    if (need % 2 === 1) {
      if (free(p)) { spots.push(p); need--; }
      else {   // the centre is taken: three spots whose average is the centre
        let found = false;
        for (let i = 0; i < OFFSETS.length && !found; i++) for (let j = i + 1; j < OFFSETS.length && !found; j++) {
          const a = at(OFFSETS[i], 1), b = at(OFFSETS[j], 1), c = [p[0] * 3 - a[0] - b[0], p[1] * 3 - a[1] - b[1], p[2] * 3 - a[2] - b[2]];
          if (free(a) && free(b) && free(c) && c.join() !== a.join() && c.join() !== b.join()) { if (need >= 3) { spots.push(a, b, c); need -= 3; } else { spots.push(a, b, c); extra.push([c, m.vskin[list[0]]], [b, m.vskin[list[0]]]); need -= 1; } found = true; }
        }
      }
    }
    for (const s of spots) occupied.add(s.join(','));
    for (const o of OFFSETS) { if (need < 2) break; const a = at(o, 1), b = at(o, -1); if (free(a) && free(b)) { spots.push(a, b); occupied.add(a.join(',')); occupied.add(b.join(',')); need -= 2; } }
    list.forEach((v, i) => { const q = spots[i] || p; if (q[0] !== m.vx[v] || q[1] !== m.vy[v] || q[2] !== m.vz[v]) spread++; m.vx[v] = q[0]; m.vy[v] = q[1]; m.vz[v] = q[2]; });
  }
  // (a lone helper on a taken spot became three spots; the two spares are new vertices)
  // 3. real vertices on one spot with the SAME label also count once in the game: stand in a helper beside each
  let stoodIn = 0;
  { const seen = new Set();
    for (let f = 0; f < mesh.nf; f++) for (const v of [m.fa[f], m.fb[f], m.fc[f]]) {
      if (seen.has(v)) continue; seen.add(v);
      const k = key(m, v) + '|' + m.vskin[v];
      if (!seen.has(k)) { seen.add(k); continue; }
      for (const o of OFFSETS) { const q = [m.vx[v] + o[0], m.vy[v] + o[1], m.vz[v] + o[2]]; if (!occupied.has(q.join(','))) { occupied.add(q.join(',')); extra.push([q, m.vskin[v]]); stoodIn++; break; } }
    } }
  const fresh = extra;
  if (fresh.length) {
    const nv = m.nv + fresh.length, growV = (arr) => { const a = new Int32Array(nv); a.set(arr); return a; };
    m.vx = growV(m.vx); m.vy = growV(m.vy); m.vz = growV(m.vz); m.vskin = growV(m.vskin);
    fresh.forEach(([q, label], i) => { const v = m.nv + i; m.vx[v] = q[0]; m.vy[v] = q[1]; m.vz[v] = q[2]; m.vskin[v] = label; });
    m.nv = nv;
  }
  const helpers = []; for (let i = 0; i < m.nv; i++) if (i >= used.length || !used[i]) helpers.push(i);
  if (helpers.length) {
    const nf = m.nf + helpers.length, grow = (arr, Type, fill) => { const a = new Type(nf).fill(fill); a.set(arr); return a; };
    m.fa = grow(m.fa, Int32Array, 0); m.fb = grow(m.fb, Int32Array, 0); m.fc = grow(m.fc, Int32Array, 0);
    m.col = grow(m.col, Uint16Array, 0);
    if (m.alpha) m.alpha = grow(m.alpha, Uint8Array, 0);
    if (m.prio) m.prio = grow(m.prio, Int8Array, 0);
    if (m.rtype) m.rtype = grow(m.rtype, Int8Array, 0);
    if (m.fskin) m.fskin = grow(m.fskin, m.fskin.constructor, 0);
    if (m.ftex) m.ftex = grow(m.ftex, Int16Array, -1);
    helpers.forEach((v, i) => { const f = m.nf + i; m.fa[f] = m.fb[f] = m.fc[f] = v; });
    m.nf = nf;
    steps.push(`gave ${helpers.length} hidden helper vertices a zero-size face so the game keeps them (they hold joint pivots in place)${spread ? `; ${spread} of them were stacked on one spot and now sit on free spots around it (the game keeps only one vertex per spot)` : ''}${stoodIn ? `; ${stoodIn} are new, standing in for visible vertices the game joins together` : ''}`);
  }
  const after = check(m), out = { mesh: m, before, after, steps };
  if (opt.pivotGroups) {
    const design = (labels) => centre(mesh, labels), off = (model) => { const built = Model.merge([Model.clone(model)]), list = []; for (const labels of opt.pivotGroups) { const a = design(labels), b = centre(built, labels); if (!a && !b) continue; const shift = a && b ? +Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z).toFixed(2) : null; if (shift === null || shift > 0.25) list.push({ labels, shift, lost: !!a && !b }); } return list.sort((x, y) => (y.shift || 99) - (x.shift || 99)); };
    out.pivotsBefore = off(mesh); out.pivotsAfter = off(m);
  }
  return out;
}
module.exports = { check, fix, pivotShift, centre };
