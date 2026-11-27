#!/usr/bin/env node
'use strict';
// Creator Studio from the command line. Same engine as the app. Nothing is written into the game unless a
// command is given --write. Run "node cli.js help" for the list; docs/AGENT-GUIDE.md explains each step.
const fs = require('fs');
const path = require('path');
const { Studio } = require('./lib/studio');
const Model = require('./lib/model');
const Anim = require('./lib/anim');
const Player = require('./lib/player');
const R = require('./lib/raster');
const S = require('./lib/stretch');
const png = require('./lib/png');

const argv = process.argv.slice(2), flags = {}, args = [];
for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (a.startsWith('--')) { const k = a.slice(2), n = argv[i + 1]; if (n === undefined || n.startsWith('--')) flags[k] = true; else { flags[k] = n; i++; } } else args.push(a); }
const out = (o) => console.log(typeof o === 'string' ? o : JSON.stringify(o, null, 2));
const HELP = `Creator Studio command line

  status                                   which folders are in use, what this server can load, next free ids, packet sizes
  setup                                    show the folders in use and every server and cache the Studio can find
  setup [--server <folder>] [--osrs-cache <folder>] [--rs3-cache <folder>] [--standalone] [--port <n>]
                                           choose folders (saved in config.json). Give "" to clear one.
                                           --standalone: no game server; ports are written to the Studio's export folder
  find [folder]                            look for RS3 caches, OSRS caches and game servers (Downloads, Desktop,
                                           Documents and the Studio's own folders; or under the folder you give)
  rs3check [folder]                        can the Studio read this RS3 cache? Tests items, models and textures.
                                           Run it on any cache that is not build 950 before porting from it.
  search item|npc|rs3|custom <words>       find things by name or id
  info item|npc|rs3 <id>                   definition of one thing
  new rs3 <rs3 item id> --base <osrs item id> [--name "..."] [--type weapon|armour|cape|other]
  new item <game item id> [--name "..."] [--replace]     custom version of an item already in the game
  new npc <game npc id> [--name "..."]                   custom NPC from a game NPC
  drafts | show <draft> | remove <draft>
  set <draft> <path> <json value>          e.g. set my-sword item.itemDef.value 250000
  build <draft>                            build it and print problems, sizes and the stretch test
  colours <draft> [ground|male|female]     every colour on the model: how many faces and where they are
  recolour <draft> <from> <to>             swap one colour for another everywhere (number or "#rrggbb")
  paint <draft> <slot> --colour <c> (--box x0,y0,z0,x1,y1,z1 | --label <n> | --where <colour> | --faces 1,2,3)
  render <draft | item:<id> | npc:<id>> [--slot ground|male|female] [--poses 808:0,824:2] [--yaw 2.5] [--heat] --out file.png
  diagnose item <id>                       stretch and pivot test of an item already in the game
  diagnose npc <id>                        the same for a game NPC with its own animations
  gamecheck npc <id>                       any NPC (bosses and custom ones too) exactly as the game builds it: joined
                                           vertices, dropped pivot helpers, and every face through all its animations
  gamefix npc <id> [more ids] [--write]    repair what the game's own model build breaks; dry run without --write.
                                           Several NPCs at once are written together (one server restart).
  rs3npc rebuild <npc id> --model <rs3 model id> [--tris 3500] [--limit 1.3] [--out sheet.png] [--write]
                                           rebuild an RS3-ported NPC's model from its RS3 source, OSRS style, so it
                                           moves correctly with its own animations (pivot markers, pivot lock, real
                                           RS3 colours, rigid plates, client-safe). Dry run without --write.
  anim list [words]                        custom animations already in the game
  anim joints <player | npc:<id>>          the joints you can pose on that skeleton: id, name, what each moves
  anim new <name> [--for player|npc:<id>] [--from <animation id>] [--template <id>] [--loop]
                                           new animation draft; --from starts from an existing animation's frames
  anim key <draft> <time> <joint>=<x,y,z> [more joints]
                                           set a pose at a time. time: ticks of 20 ms, or seconds like 0.5s.
                                           joint: id or part of its name ("right arm"). rotate: degrees; move: units
  anim nokey <draft> <time> [joint]        remove a key, or one joint from it
  anim keys <draft>                        list the keys
  anim render <draft> [--times 0,10,20] [--yaw 5.9] --out file.png     frames of the built animation on the model
  port <draft> [more drafts] [--write]     dry run; with --write it backs up, writes and reports.
                                           Several item drafts at once are written together (one server restart).
  ports | undo <port key> | restart-status [since ms]
  colour <number | "#rrggbb">              convert between game colour numbers and web colours
`;
const st = new Studio();
const colourArg = (v) => { const m = /^#?([0-9a-f]{6})$/i.exec(String(v)); if (m && !/^\d+$/.test(String(v))) { const n = parseInt(m[1], 16); return Model.rgbToHsl(n >> 16 & 255, n >> 8 & 255, n & 255); } const n = +v; if (!Number.isInteger(n) || n < 0 || n > 65535) throw new Error(`"${v}" is not a colour (use 0-65535 or "#rrggbb")`); return n; };
const hex = (hsl) => '#' + (Model.hslToRgb(hsl) | 0x1000000).toString(16).slice(1);
function slotMesh(build, slot) { const b = build.slots[slot]; if (!b) throw new Error(`the draft has no ${slot} model (it has: ${Object.keys(build.slots).join(', ')})`); return b; }
function summarise(build) {
  const o = { problems: build.problems, warnings: build.warnings };
  if (build.kind === 'anim') return Object.assign(o, { madeFor: build.target.name, skeleton: build.target.baseId, frames: build.frames.length, seconds: +(build.ticks * 0.02).toFixed(2), ticks: build.ticks,
    rotationPrecision: `${build.fine}x finer than classic`, bytes: build.encoded.reduce((n, b) => n + b.length, 0) });
  if (build.kind === 'item') { o.icon = build.icon; o.models = {}; for (const [k, b] of Object.entries(build.slots)) { o.models[k] = { triangles: b.mesh.nf, points: b.mesh.nv, bytes: b.bytes ? b.bytes.length : 0, usesGameModel: b.cacheModel };
    if (b.report) o.models[k].stretch = { steps: b.report.steps, pads: b.report.pads, pivots: b.report.pivotSource, plateLimit: b.report.limit, afterPivotsOnly: b.report.before, thisItem: b.report.after, reference: b.report.reference, pivotProblems: b.report.pivots.filter((p) => p.problem) }; }
    if (build.particles) o.particles = build.particles.type === 'rs3' ? `${build.particles.sexes.male.length} RS3 emitters` : `copied from item ${build.particles.from}`; }
  else { o.row = build.row; o.combat = build.combat; }
  return o;
}
/** Player wearing a mesh, posed, rendered: returns tiles. */
function wornTiles(mesh, wear, female, poses, yaws, heat) {
  const player = Player.build(st.osrs, { female, wear: [Object.assign({ tag: 'item', meshes: [mesh] }, wear)] });
  const G = Anim.groups(player.mesh.vskin, player.mesh.nv), P0 = Anim.positions(player.mesh), tiles = [];
  const item = player.sources.indexOf('item'); let local = 0; const idx = new Int32Array(player.mesh.nf).fill(-1);
  for (let f = 0; f < player.mesh.nf; f++) if (player.mesh.src[f] === item) idx[f] = local++;
  for (const yaw of yaws) for (const [seq, fi] of poses) {
    const a = st.osrs.animation(seq), P = a && a.frames.length ? Anim.apply(P0.slice(), G, a.frames[Math.min(fi, a.frames.length - 1)]) : P0;
    tiles.push(R.render(player.mesh, { positions: P, yaw, pitch: -0.12, size: 300, centre: [0, -95, 0], scale: 1.45, hideFace: (f) => player.mesh.vy[player.mesh.fa[f]] > 2 && player.mesh.vy[player.mesh.fb[f]] > 2 && player.mesh.vy[player.mesh.fc[f]] > 2,
      faceRgb: heat ? (f) => { const r = idx[f] >= 0 ? heat[idx[f]] : 1; return r > 1.4 ? [235, 70, 50] : r > 1.15 ? [240, 210, 60] : null; } : null }));
  }
  return tiles;
}
const POSES = [[808, 0], [824, 2], [422, 2], [419, 5], [711, 6], [1979, 8]];
const gameReport = (id, repair) => st.gameReport(id, repair);
const parsePoses = (s) => s ? String(s).split(',').map((p) => p.split(':').map(Number)).map(([a, b]) => [a, b || 0]) : POSES;

const commands = {
  help() { out(HELP); },
  status() { out(st.status()); },
  setup() {
    const change = {}, map = { server: 'serverDir', 'osrs-cache': 'osrsCache', 'rs3-cache': 'rs3Cache', port: 'port' };
    for (const [flag, key] of Object.entries(map)) if (flags[flag] !== undefined) change[key] = flags[flag] === true ? '' : flags[flag];
    if (flags.standalone) change.standalone = true;
    if (!Object.keys(change).length) return out({ configFile: st.configFile, inUse: st.status(), found: st.detect(), howTo: 'node cli.js setup --server "<game server folder>" --rs3-cache "<rs3 cache folder>"   (or put a cache in the rs3-cache / osrs-cache folder next to cli.js: it is found by itself)' });
    const r = st.setup(change);
    if (!r.ok) { out(r); process.exitCode = 2; return; }
    const now = new Studio(); out({ saved: st.configFile, config: r.config, nowUsing: now.status() });
  },
  find(dir) { out(st.findCaches(dir)); },
  rs3check(dir) { const r = st.rs3Check(dir); out(r); if (r.verdict === 'no') process.exitCode = 2; },
  search(kind, ...words) {
    const q = words.join(' ');
    if (kind === 'rs3') return out(st.rs3.searchItems(q, 40));
    if (kind === 'custom') return out(st.server.items().filter((r) => (r.objType.name || '').toLowerCase().includes(q.toLowerCase())).map((r) => ({ id: r.id, name: r.objType.name, base: r.baseItemId })));
    out(st.osrs.search(kind === 'npc' ? 'npc' : 'item', q, 40).map((d) => kind === 'npc' ? { id: d.id, name: d.name, level: d.combatLevel, size: d.size } : { id: d.id, name: d.name, slot: Player.SLOT_NAMES[d.wearPos] || null }));
  },
  info(kind, id) {
    if (kind === 'rs3') return out(st.rs3.item(+id));
    if (kind === 'npc') return out(st.osrs.npc(+id));
    out(st.server.item(+id) || st.osrs.item(+id));
  },
  new(kind, id) {
    const opt = { name: typeof flags.name === 'string' ? flags.name : undefined, base: flags.base !== undefined ? +flags.base : undefined, type: typeof flags.type === 'string' ? flags.type : undefined, replace: !!flags.replace };
    const d = kind === 'rs3' ? st.draftFromRs3Item(+id, opt) : kind === 'npc' ? st.draftFromNpc(+id, opt) : st.draftFromGameItem(+id, opt);
    st.saveDraft(d); out({ created: d.slug, name: d.name, kind: d.kind, next: `node cli.js build ${d.slug}` });
  },
  drafts() { out(st.listDrafts()); },
  show(slug) { out(st.loadDraft(slug)); },
  remove(slug) { out(st.removeDraft(slug)); },
  set(slug, p, ...rest) {
    const d = st.loadDraft(slug), raw = rest.join(' '); let v; try { v = JSON.parse(raw); } catch { v = raw; }
    const ks = p.split('.'); let a = d; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] === undefined || a[ks[i]] === null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; }
    if (raw === 'undefined' || raw === '') delete a[ks[ks.length - 1]]; else a[ks[ks.length - 1]] = v;
    st.saveDraft(d); out({ set: p, to: v });
  },
  build(slug) { out(summarise(st.build(st.loadDraft(slug)))); },
  colours(slug, slot) {
    const d = st.loadDraft(slug), b = st.build(d), rows = [];
    const meshes = d.kind === 'npc' ? (b.models.length ? b.models.map((m) => m.mesh) : b.base.models.map((id) => st.osrs.mesh(id))) : [slotMesh(b, slot || 'ground').mesh];
    meshes.forEach((m, mi) => {
      const by = new Map();
      for (let f = 0; f < m.nf; f++) { const c = m.col[f]; if (!by.has(c)) by.set(c, { faces: 0, min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9], labels: new Set() }); const e = by.get(c); e.faces++;
        for (const v of [m.fa[f], m.fb[f], m.fc[f]]) { const q = [m.vx[v], m.vy[v], m.vz[v]]; for (let k = 0; k < 3; k++) { e.min[k] = Math.min(e.min[k], q[k]); e.max[k] = Math.max(e.max[k], q[k]); } if (m.vskin) e.labels.add(m.vskin[v]); } }
      for (const [c, e] of [...by].sort((a, b2) => b2[1].faces - a[1].faces)) rows.push({ model: mi, colour: c, web: hex(c), faces: e.faces, from: e.min, to: e.max, boneLabels: [...e.labels].sort((x, y) => x - y) });
    });
    out({ note: 'x: left/right, y: up is NEGATIVE (head is about -200, feet 0), z: front/back. "from"/"to" is the box each colour sits in.', colours: rows });
  },
  recolour(slug, from, to) {
    const d = st.loadDraft(slug), f = colourArg(from), t = colourArg(to);
    const compose = (pairs) => { const o = pairs.map((p) => (p[1] === f ? [p[0], t] : p.slice())), at = o.findIndex((p) => p[0] === f); if (at >= 0) o[at][1] = t; else o.push([f, t]); return o.filter((p) => p[0] !== p[1]); };
    if (d.kind === 'item') d.item.recolor = compose(d.item.recolor || []);
    else { const base = st.osrs.npc(d.npc.baseNpcId) || { recolorFrom: [], recolorTo: [] }, cur = d.npc.fields.recolorFrom ? d.npc.fields.recolorFrom.map((x, i) => [x, d.npc.fields.recolorTo[i]]) : base.recolorFrom.map((x, i) => [x, base.recolorTo[i]]); const o = compose(cur); d.npc.fields.recolorFrom = o.map((p) => p[0]); d.npc.fields.recolorTo = o.map((p) => p[1]); }
    st.saveDraft(d); out({ swapped: f, for: t, web: hex(t) });
  },
  paint(slug, slot) {
    const d = st.loadDraft(slug), b = st.build(d), colour = colourArg(flags.colour);
    let spec, mesh;
    if (d.kind === 'npc') { if (!d.npc.models) d.npc.models = b.base.models.map((id) => ({ source: { type: 'osrs', model: id } })); const i = +(slot || 0); spec = d.npc.models[i]; mesh = (st.build(d).models[i] || {}).mesh; if (!mesh) throw new Error('no such NPC model index ' + slot); }
    else { spec = d.item.models[slot]; mesh = slotMesh(b, slot).mesh; }
    const pick = [];
    const box = typeof flags.box === 'string' ? flags.box.split(',').map(Number) : null, label = flags.label !== undefined ? +flags.label : null, where = flags.where !== undefined ? colourArg(flags.where) : null, faces = typeof flags.faces === 'string' ? new Set(flags.faces.split(',').map(Number)) : null;
    if (!box && label === null && where === null && !faces) throw new Error('say what to paint: --box, --label, --where or --faces');
    for (let f = 0; f < mesh.nf; f++) {
      const vs = [mesh.fa[f], mesh.fb[f], mesh.fc[f]];
      if (faces && !faces.has(f)) continue;
      if (where !== null && mesh.col[f] !== where) continue;
      if (label !== null && !(mesh.vskin && vs.every((v) => mesh.vskin[v] === label))) continue;
      if (box) { const c = [0, 1, 2].map((k) => vs.reduce((s, v) => s + [mesh.vx[v], mesh.vy[v], mesh.vz[v]][k], 0) / 3); if (c[0] < Math.min(box[0], box[3]) || c[0] > Math.max(box[0], box[3]) || c[1] < Math.min(box[1], box[4]) || c[1] > Math.max(box[1], box[4]) || c[2] < Math.min(box[2], box[5]) || c[2] > Math.max(box[2], box[5])) continue; }
      pick.push(f);
    }
    spec.edits = spec.edits || {}; if (!spec.edits.paint || spec.edits.paint.faces !== mesh.nf) spec.edits.paint = { faces: mesh.nf, list: [] };
    const map = new Map(spec.edits.paint.list); for (const f of pick) map.set(f, colour); spec.edits.paint.list = [...map];
    st.saveDraft(d); out({ painted: pick.length, colour, web: hex(colour), of: mesh.nf });
  },
  render(target) {
    if (typeof flags.out !== 'string') throw new Error('give --out <file.png>');
    const yaw = flags.yaw !== undefined ? +flags.yaw : null; let tiles = [], cols = 1, note = '';
    const ground = (mesh) => { const t = [2.5, 0.6, 4.2, 5.6].map((y) => R.render(mesh, { yaw: yaw === null ? y : yaw + y, pitch: -0.45, size: 300 })); cols = 4; return t; };
    if (target.startsWith('npc:')) {
      const def = st.osrs.npc(+target.slice(4)), mesh = Model.merge(def.models.map((id) => { const m = st.osrs.mesh(id); def.recolorFrom.forEach((f, i) => Model.recolor(m, f, def.recolorTo[i])); return st.builder.bake(m); }));
      const G = Anim.groups(mesh.vskin, mesh.nv), P0 = Anim.positions(mesh), b = Model.bounds(mesh), centre = [0, (b.min[1] + b.max[1]) / 2, 0];
      for (const seq of [def.idleSeq, def.walkSeq]) { const a = st.osrs.animation(seq); if (!a) continue; for (const k of [0, 0.34, 0.67]) { const fr = a.frames[Math.floor(k * a.frames.length)] || []; tiles.push(R.render(mesh, { positions: Anim.apply(P0.slice(), G, fr), yaw: yaw === null ? 2.5 : yaw, pitch: -0.15, size: 300, centre })); } }
      cols = 3; note = 'rows: stand, walk';
    } else {
      let mesh, wear, heat = null, slot = flags.slot || 'ground';
      if (target.startsWith('item:')) {
        const id = +target.slice(5), custom = st.server.item(id), def = custom ? null : st.osrs.item(id), base = custom ? st.osrs.item(custom.baseItemId) : def;
        const field = { ground: 'model', male: 'maleModel', female: 'femaleModel' }[slot], v = custom ? (custom.objType[field] !== undefined ? custom.objType[field] : base[field]) : def[field];
        mesh = v >= 1000000 ? Model.decode(fs.readFileSync(st.server.modelFile(custom.models[v]))) : st.osrs.mesh(v); wear = base;
        if (flags.heat && slot !== 'ground') heat = st.builder.testWorn(st.builder.bake(Model.clone(mesh)), base, slot === 'female').perFace;
      } else { const d = st.loadDraft(target), b = st.build(d), s = slotMesh(b, slot); mesh = s.mesh; wear = b.base; if (flags.heat && s.report) heat = s.report.perFace; (b.row.objType.recolorFrom || []).forEach((f, i) => Model.recolor(mesh, f, b.row.objType.recolorTo[i])); }
      st.builder.bake(mesh);
      if (slot === 'ground') tiles = ground(mesh);
      else { const poses = parsePoses(flags.poses); tiles = wornTiles(mesh, { wearPos: wear.wearPos, wearPos2: wear.wearPos2, wearPos3: wear.wearPos3 }, slot === 'female', poses, yaw === null ? [5.7, 2.6] : [yaw], heat); cols = poses.length; note = `columns: ${poses.map((p) => p.join(':')).join(' ')} (animation:frame); rows: front, back`; }
    }
    fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true });
    fs.writeFileSync(flags.out, R.sheet(tiles, cols)); out({ wrote: path.resolve(flags.out), tiles: tiles.length, note });
  },
  diagnose(kind, id) {
    if (kind === 'npc') {
      const def = st.osrs.npc(+id); if (!def) throw new Error('no such NPC');
      const mesh = Model.merge(def.models.map((m) => st.osrs.mesh(m)).filter(Boolean)), cd = st.server.readJson(st.server.files.combat, {}), extra = ((cd.npcs || {})[String(id)] || {}).anims || {};
      const seqs = [...new Set([def.idleSeq, def.walkSeq, def.runSeq, extra.attack, extra.block, extra.death].filter((v) => Number.isInteger(v) && v >= 0))], rig = new S.Rig(st.osrs, seqs, { anyBase: true });
      const r = S.measureModel(mesh, rig.frames); delete r.perFace; delete r.growth; return out(Object.assign({ npc: def.name, animations: rig.seqs }, r));
    }
    const custom = st.server.item(+id), ref = custom ? st.osrs.item(custom.baseItemId) : st.osrs.item(+id), res = { item: custom ? custom.objType.name : ref.name, reference: ref.name };
    for (const sex of ['male', 'female']) { const field = sex === 'male' ? 'maleModel' : 'femaleModel', v = custom ? (custom.objType[field] !== undefined ? custom.objType[field] : ref[field]) : ref[field]; if (!(v >= 0)) continue;
      const mesh = v >= 1000000 ? Model.decode(fs.readFileSync(st.server.modelFile(custom.models[v]))) : st.osrs.mesh(v); if (!mesh.vskin) continue; const t = st.builder.testWorn(st.builder.bake(mesh), ref, sex === 'female'); delete t.perFace; delete t.before; res[sex] = { thisItem: t.after, reference: t.reference, pivotProblems: t.pivots.filter((p) => p.problem), labels: Model.labelCounts(mesh) }; }
    out(res);
  },
  /** An NPC as the game client builds it (it joins vertices on one spot and drops unused ones), through its animations. */
  gamecheck(kind, id) { out(gameReport(+id, false)); },
  gamefix(kind, ...ids) {
    if (!ids.length) throw new Error('give at least one NPC id');
    const reports = ids.map((id) => gameReport(+id, true)), files = reports.flatMap((r) => r._files);
    for (const r of reports) delete r._files;
    if (!files.length) return out({ reports, note: 'Nothing to repair: the game builds these exactly as their files describe.' });
    // every file in one go, so the server restarts once
    const res = st.porter.writeModels(`gamefix ${reports.filter((r) => r.repairs.length).map((r) => r.npc).join(' and ')}`, files, { write: !!flags.write, id: +ids[0] });
    out({ reports, write: res });
    if (!res.ok) process.exitCode = 2;
  },
  anim(action, ...rest) {
    const kit = st.anim, ticks = (v) => { const m = /^([\d.]+)s$/.exec(String(v)); const t = m ? Math.round(+m[1] * 50) : +v; if (!Number.isFinite(t) || t < 0) throw new Error(`"${v}" is not a time (ticks of 20 ms, or seconds like 0.5s)`); return t; };
    const joint = (controls, token) => {
      if (/^\d+$/.test(token)) { const c = controls.find((x) => x.id === +token); if (!c) throw new Error(`joint ${token} moves nothing on this model (see: anim joints)`); return c; }
      const q = token.toLowerCase().replace(/[_-]/g, ' '), all = controls.filter((x) => x.name.toLowerCase().includes(q)), exact = all.filter((x) => x.name.toLowerCase() === q), first = all.filter((x) => !x.extra), hits = exact.length ? exact : first.length ? first : all, rot = hits.filter((x) => x.kind === 'rotate');
      const pick = rot.length === 1 ? rot : hits; if (pick.length !== 1) throw new Error(pick.length ? `"${token}" matches several joints: ${pick.map((x) => `${x.id} ${x.name}`).join('; ')}` : `no joint called "${token}" (see: anim joints)`);
      return pick[0];
    };
    if (action === 'list') { const q = rest.join(' ').toLowerCase(); return out(st.osrs.customSeqIds().map((id) => { const a = st.osrs.animation(id); return { id, name: a.name || '', frames: a.frames.length, seconds: +(a.delays.reduce((x, y) => x + y, 0) * 0.02).toFixed(2), skeleton: a.baseId, copiesSettingsOf: a.template, skeletal: a.skeletal !== -1 || undefined }; }).filter((r) => !q || String(r.id) === q || r.name.toLowerCase().includes(q))); }
    if (action === 'joints') { const tg = kit.target(rest[0] || 'player'); return out({ madeFor: tg.name, skeleton: tg.baseId, note: 'Rotate values are degrees: x swings forward/back, y twists around the upright axis, z tilts sideways. Model space: x left/right, y up is NEGATIVE, z front/back.',
      joints: kit.controls(tg).filter((c) => flags.all || (c.known && !c.extra) || tg.baseId !== 0).map((c) => ({ id: c.id, name: c.name, kind: c.kind, movesVertices: c.moves, shareOfModel: c.share + '%', turnsAround: c.pivotAt, middleOfWhatItMoves: c.centre, where: c.where })) }); }
    if (action === 'new') { const name = rest.join(' '); if (!name) throw new Error('give the animation a name'); const d = st.draftAnim(name, { for: typeof flags.for === 'string' ? flags.for : 'player', from: flags.from !== undefined ? +flags.from : undefined, template: flags.template !== undefined ? +flags.template : undefined, loop: !!flags.loop }); st.saveDraft(d); return out({ created: d.slug, madeFor: d.anim.for, keys: d.anim.keys.length, copiesSettingsOf: d.anim.template, next: `node cli.js anim key ${d.slug} 0.4s "right arm"=0,0,-80` }); }
    const d = st.loadDraft(rest[0]); if (d.kind !== 'anim') throw new Error(`"${rest[0]}" is not an animation draft`);
    if (action === 'keys') return out(d.anim.keys.slice().sort((a, b) => a.t - b.t).map((k) => ({ time: k.t, seconds: +(k.t * 0.02).toFixed(2), joints: Object.keys(k.pose).length, pose: k.pose })));
    if (action === 'key') {
      const t = ticks(rest[1]), controls = kit.controls(kit.target(d.anim.for)); let k = d.anim.keys.find((x) => x.t === t); if (!k) { k = { t, pose: {} }; d.anim.keys.push(k); }
      const set = [];
      for (const part of rest.slice(2)) { const at = part.lastIndexOf('='); if (at < 0) throw new Error(`"${part}" should look like joint=x,y,z`); const c = joint(controls, part.slice(0, at)), v = part.slice(at + 1).split(',').map(Number); if (v.length !== 3 || !v.every(Number.isFinite)) throw new Error(`"${part}": give three numbers x,y,z`); k.pose[c.id] = v; set.push(`${c.name} (${c.id}) = ${v.join(', ')}`); }
      d.anim.keys.sort((a, b) => a.t - b.t); st.saveDraft(d); return out({ key: t, seconds: +(t * 0.02).toFixed(2), set, keys: d.anim.keys.length });
    }
    if (action === 'nokey') { const t = ticks(rest[1]), k = d.anim.keys.find((x) => x.t === t); if (!k) throw new Error(`no key at ${t}`); if (rest[2]) { const c = joint(kit.controls(kit.target(d.anim.for)), rest[2]); delete k.pose[c.id]; } else d.anim.keys = d.anim.keys.filter((x) => x !== k); st.saveDraft(d); return out({ removed: rest[2] || 'key', at: t }); }
    if (action === 'render') {
      if (typeof flags.out !== 'string') throw new Error('give --out <file.png>');
      const b = st.build(d), tg = b.target, m = tg.mesh, G = Anim.groups(m.vskin, m.nv), P0 = Anim.positions(m), bb = Model.bounds(m), total = b.ticks;
      const times = typeof flags.times === 'string' ? flags.times.split(',').map(ticks) : [0, 1, 2, 3, 4, 5, 6, 7].map((i) => Math.round(i * (d.anim.keys.length ? d.anim.keys[d.anim.keys.length - 1].t : 0) / 7));
      const yaw = flags.yaw !== undefined ? +flags.yaw : 5.9, tiles = times.map((t) => R.render(m, { positions: Anim.apply(P0.slice(), G, kit.poseOps(tg, kit.poseAt(d.anim, t))), yaw, pitch: -0.1, size: 300, centre: [0, (bb.min[1] + bb.max[1]) / 2, 0], scale: 240 / Math.max(bb.max[1] - bb.min[1], bb.max[0] - bb.min[0]), hideFace: tg.baseId === 0 ? (f) => m.vy[m.fa[f]] > 2 && m.vy[m.fb[f]] > 2 && m.vy[m.fc[f]] > 2 : null }));
      fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true }); fs.writeFileSync(flags.out, R.sheet(tiles, Math.min(8, tiles.length)));
      return out({ wrote: path.resolve(flags.out), times, note: `one tile per time (ticks), left to right; the whole animation is ${total} ticks`, problems: b.problems, warnings: b.warnings });
    }
    throw new Error('anim: use list, joints, new, key, nokey, keys or render');
  },
  rs3npc(action, id) {
    if (action !== 'rebuild') throw new Error('use: rs3npc rebuild <npc id> --model <rs3 model id>');
    const def = st.npcDef(+id); if (!def) throw new Error(`NPC ${id} is not in the game`);
    if (flags.model === undefined) throw new Error('give --model <rs3 model id> (the RS3 model this NPC was ported from)');
    const custom = def.models.filter((m) => m >= 1000000), files = st.server.customModels();
    if (custom.length !== 1 || def.models.length !== 1) throw new Error('this command rebuilds NPCs that are one custom model (ported bosses)');
    const anims = st.npcAnimations(def), { buildNpcFromRs3 } = require('./lib/npcport');
    const before = gameReport(+id, false).inGameNow;
    const r = buildNpcFromRs3(st, { model: +flags.model, seqs: anims.seqs, maxTris: flags.tris ? +flags.tris : 3500, plateLimit: flags.limit ? +flags.limit : 1.3 });
    if (typeof flags.out === 'string') {   // a picture of it in a spread of its own animation frames, front and back
      const m = Model.merge([Model.clone(r.mesh)]), G = Anim.groups(m.vskin, m.nv), P0 = Anim.positions(m), b = Model.bounds(m), tiles = [], poses = [];
      for (const sid of anims.seqs.slice(0, 6)) { const a = st.osrs.animation(sid); poses.push([sid, Math.floor(a.frames.length * 0.4)]); }
      for (const yaw of [5.9, 2.75]) for (const [sid, fi] of poses) tiles.push(R.render(m, { positions: Anim.apply(P0.slice(), G, st.osrs.animation(sid).frames[fi]), yaw, pitch: -0.1, size: 300, centre: [0, (b.min[1] + b.max[1]) / 2, 0], scale: 250 / Math.max(b.max[1] - b.min[1], b.max[0] - b.min[0]) }));
      fs.mkdirSync(path.dirname(path.resolve(flags.out)), { recursive: true }); fs.writeFileSync(flags.out, R.sheet(tiles, poses.length));
    }
    const res = st.porter.writeModels(`rebuild ${def.name} from RS3 model ${flags.model}`, [{ rel: files[String(custom[0])], bytes: r.bytes, modelId: custom[0] }], { write: !!flags.write, id: +id });
    out({ npc: def.name, id: +id, rs3Model: +flags.model, inGameBefore: before && before.worstStretch ? { worstStretch: before.worstStretch, typical95: before.typical95, facesGrowingOver6Units: before.facesGrowingOver6Units, largestGrowthUnits: before.largestGrowthUnits, pivotsWithNoVertices: before.pivotsWithNoVertices } : before, rebuilt: r.report, picture: typeof flags.out === 'string' ? path.resolve(flags.out) : undefined, write: res });
    if (!res.ok) process.exitCode = 2;
  },
  port(...slugs) {
    if (slugs.length > 1) {   // several items: one write of custom-items.json, so one server restart
      const list = slugs.map((s) => { const draft = st.loadDraft(s); return { draft, build: st.build(draft) }; }), r = st.porter.portBatch(list, { write: !!flags.write });
      if (r.written) r.items.forEach((it, i) => { const d = list[i].draft; d.id = it.id; d.ported = { id: it.id, when: 'batch', models: it.files.map((f) => f.modelId) }; st.saveDraft(d); });
      out(r); if (!r.ok) process.exitCode = 2; return;
    }
    const d = st.loadDraft(slugs[0]), r = st.port(d, { write: !!flags.write, restart: true }); delete r.row; out(r); if (!r.ok) process.exitCode = 2;
  },
  ports() { out(st.porter.ports().map((p) => ({ key: p.key, name: p.name, kind: p.kind, id: p.id, replaced: p.replaced, undone: p.undone || null, backupDir: p.backupDir }))); },
  undo(key) { out(st.porter.undo(key)); },
  'restart-status'(since) { out(st.server.restartStatus(+since || Date.now() - 10 * 60 * 1000)); },
  colour(v) { const c = colourArg(v); out({ game: c, web: hex(c), hue: c >> 10 & 63, richness: c >> 7 & 7, lightness: c & 127 }); },
};
try {
  const cmd = args.shift() || 'help';
  if (!commands[cmd]) { console.error(`Unknown command "${cmd}".\n`); out(HELP); process.exit(1); }
  commands[cmd](...args);
} catch (e) { console.error('Error: ' + e.message); process.exit(1); }
