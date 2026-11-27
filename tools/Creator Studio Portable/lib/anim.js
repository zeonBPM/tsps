// The game client's classic (vertex label) animation player, as used for players and most NPCs.
// Runs in Node and in the browser. Positions are Float64Array [x0,y0,z0,x1,...].
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Anim = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const T = { ORIGIN: 0, TRANSLATE: 1, ROTATE: 2, SCALE: 3, ALPHA: 5 };
  /** label -> vertex indices */
  function groups(vskin, nv) {
    const g = [];
    if (!vskin) return g;
    const n = new Int32Array(256);
    for (let i = 0; i < nv; i++) if (vskin[i] >= 0 && vskin[i] < 256) n[vskin[i]]++;
    for (let l = 0; l < 256; l++) g.push(new Int32Array(n[l]));
    n.fill(0);
    for (let i = 0; i < nv; i++) { const l = vskin[i]; if (l >= 0 && l < 256) g[l][n[l]++] = i; }
    return g;
  }
  const RAD = Math.PI * 2 / 256;
  /** Apply one frame (list of [type, labels, x, y, z]) to positions in place. */
  function apply(P, G, ops) {
    let ox = 0, oy = 0, oz = 0;
    for (let k = 0; k < ops.length; k++) {
      const op = ops[k], t = op[0], labels = op[1], tx = op[2], ty = op[3], tz = op[4];
      if (t === T.ORIGIN) {
        let sx = 0, sy = 0, sz = 0, n = 0;
        for (let j = 0; j < labels.length; j++) { const g = G[labels[j]]; if (!g) continue; for (let i = 0; i < g.length; i++) { const v = g[i] * 3; sx += P[v]; sy += P[v + 1]; sz += P[v + 2]; n++; } }
        ox = tx + (n ? sx / n : 0); oy = ty + (n ? sy / n : 0); oz = tz + (n ? sz / n : 0);
        continue;
      }
      if (t === T.TRANSLATE) {
        for (let j = 0; j < labels.length; j++) { const g = G[labels[j]]; if (!g) continue; for (let i = 0; i < g.length; i++) { const v = g[i] * 3; P[v] += tx; P[v + 1] += ty; P[v + 2] += tz; } }
      } else if (t === T.ROTATE) {
        const sx = Math.sin(tx * RAD), cx = Math.cos(tx * RAD), sy = Math.sin(ty * RAD), cy = Math.cos(ty * RAD), sz = Math.sin(tz * RAD), cz = Math.cos(tz * RAD);
        for (let j = 0; j < labels.length; j++) { const g = G[labels[j]]; if (!g) continue; for (let i = 0; i < g.length; i++) {
          const v = g[i] * 3; let x = P[v] - ox, y = P[v + 1] - oy, z = P[v + 2] - oz, q;
          q = sz * y + cz * x; y = cz * y - sz * x; x = q;
          q = cx * y - sx * z; z = sx * y + cx * z; y = q;
          q = sy * z + cy * x; z = cy * z - sy * x; x = q;
          P[v] = x + ox; P[v + 1] = y + oy; P[v + 2] = z + oz;
        } }
      } else if (t === T.SCALE) {
        for (let j = 0; j < labels.length; j++) { const g = G[labels[j]]; if (!g) continue; for (let i = 0; i < g.length; i++) {
          const v = g[i] * 3; P[v] = (P[v] - ox) * tx / 128 + ox; P[v + 1] = (P[v + 1] - oy) * ty / 128 + oy; P[v + 2] = (P[v + 2] - oz) * tz / 128 + oz;
        } }
      }
    }
    return P;
  }
  function positions(m) { const P = new Float64Array(m.nv * 3); for (let i = 0; i < m.nv; i++) { P[i * 3] = m.vx[i]; P[i * 3 + 1] = m.vy[i]; P[i * 3 + 2] = m.vz[i]; } return P; }
  /** Which labels act as joint pivots in a set of frames, and how each label moves (its "motion class"). */
  function rig(frames) {
    const pivots = new Map(), motion = new Map(); let n = 0;
    const lists = new Map();
    for (const ops of frames) for (const op of ops) {
      const key = op[0] + ':' + op[1].join(',');
      if (!lists.has(key)) lists.set(key, { type: op[0], labels: op[1], id: n++ });
    }
    for (const e of lists.values()) {
      if (e.type === T.ORIGIN) { if (e.labels.length && e.labels.length <= 4) pivots.set(e.labels.join(','), e.labels); }
      else if (e.type !== T.ALPHA) for (const l of e.labels) { if (!motion.has(l)) motion.set(l, []); motion.get(l).push(e.id); }
    }
    const cls = new Map();
    for (const [l, ids] of motion) cls.set(l, ids.sort((a, b) => a - b).join(','));
    const pivotLabels = new Set(); for (const ls of pivots.values()) for (const l of ls) pivotLabels.add(l);
    return { pivotGroups: [...pivots.values()], pivotLabels, motionClass: (l) => cls.get(l) || '' };
  }
  return { T, groups, apply, positions, rig };
});
