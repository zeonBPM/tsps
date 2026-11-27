'use strict';
// Custom animations: pose a model at a few moments ("keys") and get every frame in between, in the game's own format.
//
// How the game animates (classic system, used by players and most NPCs):
//   * every vertex of a model carries one bone label
//   * a skeleton ("frame base") is a fixed list of numbered groups; each group is a kind of move (set pivot, move,
//     rotate, scale) and the labels it applies to
//   * a frame is just "group 30: rotate by x,y,z; group 9: rotate ...", always starting from the rest pose
//   * a rotate turns its labels around the last pivot that was set: the average position of the pivot group's vertices
// The server's own animations live in data/definitions/custom-seqs.json: { id, template, frameLengths, frames }.
// "template" is a cache animation whose other settings are copied (priority, what the hands hold, looping).
// A frame lasts frameLengths[i] client ticks of 20 ms.
//
// Smoothness: a classic rotation moves in steps of 1/256 turn (1.4 degrees). Here animations use a copy of the
// skeleton marked "rotationDivisor" (default 16), which the client supports, so rotations are 16x finer, and the
// frames between keys are generated at a fixed step (default every 2 ticks = 25 frames a second).
const Model = require('./model');
const Anim = require('./anim');
const Player = require('./player');
const { Out } = require('./buf');
const { T, IDX } = require('./osrs');

const KIND = { [T.TRANSLATE]: 'move', [T.ROTATE]: 'rotate', [T.SCALE]: 'scale' };
// The human skeleton's well-known joints, by the labels of the pivot each one turns around.
const HUMAN = { '0': 'Whole body', '3+2': 'Head', '29': 'Upper body (waist)', '21': 'Right arm (shoulder)', '17': 'Right forearm (elbow)', '207+27+203': 'Right hand',
  '25': 'Left arm (shoulder)', '23': 'Left forearm (elbow)', '198+204+28': 'Left hand', '40+101+102': 'Left leg (hip)', '35+37': 'Left lower leg (knee)', '47': 'Left foot',
  '122+42+103': 'Right leg (hip)', '34+31': 'Right lower leg (knee)', '48': 'Right foot', '27': 'Weapon in hand', '10': 'Cape, top', '9': 'Cape, upper', '14': 'Cape, lower', '13': 'Cape, tip' };
const DEG = 256 / 360;

class AnimKit {
  constructor(studio) { this.st = studio; }
  /** What an animation is made for: { baseId, base, mesh (rest pose, as the game builds it), name }. target: 'player' | 'npc:<id>' */
  target(spec) {
    const st = this.st, osrs = st.osrs;
    if (!spec || spec === 'player' || spec === 'player:female') {
      const p = Player.build(osrs, { female: spec === 'player:female', wear: [] });
      return { spec: spec || 'player', baseId: 0, base: osrs.base(0), mesh: p.mesh, name: 'Player' };
    }
    const m = /^npc:(\d+)$/.exec(spec); if (!m) throw new Error('an animation is made for "player" or "npc:<id>"');
    const def = st.npcDef(+m[1]); if (!def) throw new Error(`NPC ${m[1]} is not in the game`);
    const first = osrs.animation(def.idleSeq) || osrs.animation(def.walkSeq);
    if (!first || first.baseId < 0) throw new Error(`${def.name} has no classic stand or walk animation to take its skeleton from`);
    const parts = def.models.map((id) => st.meshFor(id)).filter(Boolean);
    for (const p of parts) (def.recolorFrom || []).forEach((f, i) => Model.recolor(p, f, def.recolorTo[i]));
    return { spec, baseId: first.baseId, base: osrs.base(first.baseId), mesh: Model.merge(parts.map((p) => st.builder.bake(p))), name: def.name, npc: def };
  }
  /** The joints you can pose: every move / rotate / scale group of the skeleton that moves something on this model. */
  controls(tg) {
    const { base, mesh } = tg, G = Anim.groups(mesh.vskin, mesh.nv), b = Model.bounds(mesh), out = [];
    const centre = (labels) => { let x = 0, y = 0, z = 0, n = 0; for (const l of labels) { const g = G[l]; if (!g) continue; for (const v of g) { x += mesh.vx[v]; y += mesh.vy[v]; z += mesh.vz[v]; n++; } } return n ? { pos: [Math.round(x / n), Math.round(y / n), Math.round(z / n)], n } : { pos: null, n: 0 }; };
    let origin = -1; const seen = new Map();
    for (let i = 0; i < base.types.length; i++) {
      const t = base.types[i];
      if (t === T.ORIGIN) { origin = i; continue; }
      if (!KIND[t]) continue;
      const moved = centre(base.labels[i]); if (!moved.n) continue;
      const pivotLabels = origin >= 0 ? base.labels[origin] : [], pivot = centre(pivotLabels);
      const key = pivotLabels.join('+'), human = tg.baseId === 0 ? HUMAN[key] : null;
      const where = moved.pos ? `${moved.pos[1] < b.min[1] + (b.max[1] - b.min[1]) / 3 ? 'top' : moved.pos[1] > b.max[1] - (b.max[1] - b.min[1]) / 3 ? 'bottom' : 'middle'}${Math.abs(moved.pos[0]) < (b.max[0] - b.min[0]) * 0.08 ? '' : moved.pos[0] < 0 ? ', x-' : ', x+'}` : '';
      let name = (human || `Joint ${i}`) + (KIND[t] === 'rotate' ? '' : ` (${KIND[t]})`); const times = (seen.get(name) || 0) + 1; seen.set(name, times); if (times > 1) name += ` #${times}`;
      out.push({ id: i, kind: KIND[t], name, known: !!human, extra: times > 1, labels: base.labels[i], pivotGroup: origin, pivotLabels,
        pivotAt: pivot.pos, moves: moved.n, share: +(moved.n / mesh.nv * 100).toFixed(1), centre: moved.pos, where });
    }
    return out;
  }
  /** Turns a pose { "<group>": [x, y, z] } (degrees for rotate, units for move, 128 = same size for scale) into frame operations. */
  poseOps(tg, pose) {
    const { base } = tg, ops = []; let reset = -1, last = -1;
    for (let i = 0; i < base.types.length; i++) {
      const t = base.types[i];
      if (t === T.ORIGIN) { reset = i; continue; }
      const v = pose[i]; if (!v || !KIND[t]) continue;
      const dv = t === T.SCALE ? 128 : 0; if (v[0] === dv && v[1] === dv && v[2] === dv) continue;
      if (reset > last) { ops.push([T.ORIGIN, base.labels[reset], 0, 0, 0]); last = reset; }
      ops.push(t === T.ROTATE ? [t, base.labels[i], v[0] * DEG, v[1] * DEG, v[2] * DEG] : [t, base.labels[i], v[0], v[1], v[2]]);
      last = i;
    }
    return ops;
  }
  /** An existing animation as keys (one per frame), so it can be edited. */
  keysFrom(tg, seqId) {
    const a = this.st.osrs.animation(seqId); if (!a || !a.frames.length) throw new Error(`animation ${seqId} has no classic frames`);
    const so = (id) => this.st.osrs.skeletonOf(id);
    if (so(a.baseId) !== so(tg.baseId)) throw new Error(`animation ${seqId} is made for another skeleton (base ${a.baseId}, this one is ${tg.baseId})`);
    const index = new Map(); tg.base.types.forEach((t, i) => index.set(t + ':' + tg.base.labels[i].join(','), i));
    const keys = []; let t = 0;
    a.frames.forEach((ops, f) => {
      const pose = {};
      for (const op of ops) { if (op[0] === T.ORIGIN || !KIND[op[0]]) continue; const i = index.get(op[0] + ':' + op[1].join(',')); if (i === undefined) continue; pose[i] = op[0] === T.ROTATE ? [op[2], op[3], op[4]].map((v) => +(v / DEG).toFixed(2)) : [op[2], op[3], op[4]]; }
      keys.push({ t, pose }); t += a.delays[f] || 1;
    });
    return { keys, length: t };
  }
  /** Pose at any time: values between the keys either side, turning the short way round. */
  poseAt(anim, time) {
    const keys = anim.keys.slice().sort((a, b) => a.t - b.t); if (!keys.length) return {};
    if (time <= keys[0].t) return keys[0].pose; if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].pose;
    let k = 0; while (keys[k + 1].t < time) k++;
    const a = keys[k], b = keys[k + 1]; let u = (time - a.t) / (b.t - a.t);
    if ((b.ease || anim.ease || 'smooth') === 'smooth') u = u * u * (3 - 2 * u);
    const pose = {}, ids = new Set([...Object.keys(a.pose), ...Object.keys(b.pose)]), kindOf = (i) => this._kinds[i];
    for (const i of ids) {
      const dv = kindOf(i) === T.SCALE ? 128 : 0, p = a.pose[i] || [dv, dv, dv], q = b.pose[i] || [dv, dv, dv];
      pose[i] = [0, 1, 2].map((c) => { let d = q[c] - p[c]; if (kindOf(i) === T.ROTATE) { d = ((d + 180) % 360 + 360) % 360 - 180; } return +(p[c] + d * u).toFixed(3); });
    }
    return pose;
  }
  /** One frame in the cache's own format: u16 base, u8 group count, a flag byte per group, then the values. */
  encodeFrame(tg, pose, baseId, fine) {
    const n = tg.base.types.length, flags = new Uint8Array(n), vals = new Out(); let lastUsed = 0;
    const smart = (v) => { if (v >= -64 && v < 64) vals.u8(v + 64); else { if (v < -16384 || v > 16383) throw new Error('a frame value is out of range (-16384 to 16383)'); vals.u16(v + 49152); } };
    for (let i = 0; i < n; i++) {
      const t = tg.base.types[i], v = pose[i]; if (!v || !KIND[t]) continue;
      const dv = t === T.SCALE ? 128 : 0, q = v.map((x) => Math.round(t === T.ROTATE ? x * DEG * fine : x));
      let f = 0; if (q[0] !== dv) f |= 1; if (q[1] !== dv) f |= 2; if (q[2] !== dv) f |= 4;
      if (!f) continue;
      flags[i] = f; lastUsed = i + 1;
      if (f & 1) smart(q[0]); if (f & 2) smart(q[1]); if (f & 4) smart(q[2]);
    }
    const head = new Out(); head.u16(baseId); head.u8(lastUsed);
    return Buffer.concat([head.done(), Buffer.from(flags.subarray(0, lastUsed)), vals.done()]);
  }
  /**
   * Draft -> frames. draft.anim: { for, template, fine (16), step (2), loop, endHold, keys:[{ t, pose, ease }] }
   * returns { target, frames:[ops] (for preview), lengths, encoded:[Buffer], baseRow, problems, warnings, controls }
   */
  build(draft) {
    const an = draft.anim, tg = this.target(an.for), problems = [], warnings = [];
    this._kinds = tg.base.types;
    const custom = tg.base.custom, fine = custom ? (tg.base.rotationDivisor || 1) : Math.max(1, Math.min(64, an.fine || 16));
    const keys = (an.keys || []).slice().sort((a, b) => a.t - b.t);
    if (!keys.length) problems.push('the animation has no keys yet: add at least two poses');
    if (!Number.isInteger(an.template) || !this.st.osrs.seq(an.template)) problems.push(`template animation ${an.template} is not in the game cache`);
    if (!draft.name || !draft.name.trim()) problems.push('the animation needs a name');
    const controls = this.controls(tg), ok = new Set(controls.map((c) => c.id));
    for (const k of keys) for (const id of Object.keys(k.pose || {})) if (!ok.has(+id)) warnings.push(`key at ${k.t}: joint ${id} moves nothing on this model`);
    const step = Math.max(1, Math.round(an.step || 2)), end = keys.length ? keys[keys.length - 1].t : 0, times = [];
    for (let t = keys.length ? keys[0].t : 0; t < end; t += step) times.push(t); times.push(end);
    const frames = [], lengths = [], poses = [];
    times.forEach((t, i) => { const pose = this.poseAt({ keys, ease: an.ease }, t), ops = this.poseOps(tg, pose), len = i + 1 < times.length ? times[i + 1] - t : Math.max(1, Math.round(an.endHold || step));
      const same = frames.length && JSON.stringify(frames[frames.length - 1]) === JSON.stringify(ops);
      if (same) lengths[lengths.length - 1] += len; else { frames.push(ops); lengths.push(len); poses.push(pose); } });
    // skeleton row: the game's own skeleton, marked for fine rotations (custom skeletons such as a ported boss's are used as they are)
    let baseRow = null, baseId = tg.baseId;
    if (!custom && fine > 1) { const data = this.st.osrs.cache.group(IDX.BASES, tg.baseId); baseRow = { kind: 'base', id: null, data: Buffer.from(data).toString('base64'), rotationDivisor: fine }; baseId = null; }
    let encoded = [];
    try { encoded = poses.map((p) => this.encodeFrame(tg, p, 0, fine)); } catch (e) { problems.push(e.message); }
    if (lengths.some((l) => l < 1 || l > 65535)) problems.push('a frame length is out of range');
    if (frames.length > 400) warnings.push(`${frames.length} frames is a lot: raise "step" or shorten the animation (all custom animations share one 64 KB packet)`);
    return { kind: 'anim', target: tg, controls, frames, lengths, encoded, fine, baseRow, baseId, ticks: lengths.reduce((a, b) => a + b, 0), problems, warnings };
  }
}
module.exports = { AnimKit, HUMAN };
