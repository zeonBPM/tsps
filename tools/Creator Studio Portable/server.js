'use strict';
// TSPS Creator Studio - the web app. Its own process on its own port; it only listens on this computer.
// It reads the game's caches and data files, and writes into the game server only when you press "Port to game".
// With no game server set it runs standalone: the same files are written to the Studio's own export folder instead.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Studio, ROOT } = require('./lib/studio');
const Model = require('./lib/model');
const Player = require('./lib/player');
const png = require('./lib/png');
const { convert } = require('./lib/convert');
const { DEFAULT_ANIMS } = require('./lib/stretch');
const { EQUIPMENT_TYPES, BONUS_NAMES, SKILL_NAMES } = require('./lib/serverdata');

let studio = new Studio();
const PORT = +process.env.STUDIO_PORT || studio.config.port || 4777;
/** After the folders change: start again from config.json, so every cache and list is read fresh. */
function reload() { try { if (studio._osrs && studio._osrs.cache && studio._osrs.cache.close) studio._osrs.cache.close(); } catch { /* nothing open */ } studio = new Studio(); buildCache.clear(); return studio; }
const ANIM_NAMES = { 808: 'Stand', 819: 'Walk', 824: 'Run', 820: 'Turn 180', 821: 'Turn right', 822: 'Turn left', 711: 'Cast (standard)', 1979: 'Cast (ancient barrage)', 1162: 'Cast (strike)',
  422: 'Punch', 423: 'Kick', 390: 'Sword slash', 386: 'Sword stab', 395: 'Axe swing', 400: 'Pickaxe/2h crush', 401: 'Mace/hammer', 426: 'Bow', 4230: 'Crossbow', 428: 'Spear', 419: 'Staff bash', 424: 'Block', 829: 'Eat', 863: 'Wave', 858: 'Bow (emote)' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.md': 'text/plain; charset=utf-8' };
const b64 = (buf) => Buffer.from(buf).toString('base64');
const buildCache = new Map();

function itemInfo(id) {
  const custom = studio.server.item(id);
  if (custom) {
    const o = custom.objType || {}, base = Number.isInteger(custom.baseItemId) ? studio.osrs.item(custom.baseItemId) : null, pick = (k) => o[k] !== undefined ? o[k] : (base ? base[k] : undefined);
    const model = (field) => { const v = o[field] !== undefined ? o[field] : (base ? base[field] : -1); return v >= 1000000 ? { type: 'custom', file: custom.models && custom.models[v], id: v } : v >= 0 ? { type: 'osrs', id: v } : null; };
    return { id, custom: true, name: o.name, examine: o.examine || '', base: base ? { id: base.id, name: base.name } : null, wearPos: pick('wearPos'), wearPos2: pick('wearPos2'), wearPos3: pick('wearPos3'),
      icon: { zoom2d: pick('zoom2d'), xan2d: pick('xan2d'), yan2d: pick('yan2d'), zan2d: pick('zan2d'), offsetX2d: pick('offsetX2d'), offsetY2d: pick('offsetY2d') },
      recolorFrom: o.recolorFrom || (base ? base.recolorFrom : []), recolorTo: o.recolorTo || (base ? base.recolorTo : []), actions: o.inventoryActions || (base ? base.inventoryActions : []),
      models: { ground: model('model'), male: model('maleModel'), female: model('femaleModel'), male1: model('maleModel1'), female1: model('femaleModel1'), male2: model('maleModel2'), female2: model('femaleModel2') }, row: custom };
  }
  const d = studio.osrs.item(id);
  if (!d || d.error) return null;
  const m = (v) => v >= 0 ? { type: 'osrs', id: v } : null;
  return { id, custom: false, name: d.name, examine: d.examine, base: null, wearPos: d.wearPos, wearPos2: d.wearPos2, wearPos3: d.wearPos3, members: d.members, tradable: d.tradable, price: d.price,
    icon: { zoom2d: d.zoom2d, xan2d: d.xan2d, yan2d: d.yan2d, zan2d: d.zan2d, offsetX2d: d.offsetX2d, offsetY2d: d.offsetY2d }, recolorFrom: d.recolorFrom, recolorTo: d.recolorTo, actions: d.inventoryActions, manwear: d.manwear, womanwear: d.womanwear,
    models: { ground: m(d.model), male: m(d.maleModel), female: m(d.femaleModel), male1: m(d.maleModel1), female1: m(d.femaleModel1), male2: m(d.maleModel2), female2: m(d.femaleModel2) } };
}
function search(kind, q) {
  if (kind === 'rs3') return studio.rs3.searchItems(q, 80).map((r) => ({ id: r.id, name: r.name, note: [r.slot, r.worn ? 'wearable' : null].filter(Boolean).join(', ') }));
  if (kind === 'npc') {
    const w = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
    const extra = [...studio.extraNpcs().values()].filter((d) => !w.length || w.every((x) => d.name.toLowerCase().includes(x)) || String(d.id) === String(q).trim()).map((d) => ({ id: d.id, name: d.name, note: d.from.type === 'bundle' ? 'boss / added NPC' : 'custom' }));
    return extra.concat(studio.osrs.search('npc', q, 80).map((d) => ({ id: d.id, name: d.name, note: d.combatLevel > 0 ? 'level ' + d.combatLevel : '' })));
  }
  if (kind === 'anim') {
    const text = String(q || '').trim().toLowerCase(), out = [];
    for (const id of studio.osrs.customSeqIds()) { const a = studio.osrs.animation(id), name = a.name || `Custom animation ${id}`; if (!text || name.toLowerCase().includes(text) || String(id) === text) out.push({ id, name, note: a.skeletal !== -1 ? 'skeletal' : `${(a.delays.reduce((x, y) => x + y, 0) * 0.02).toFixed(1)}s` }); }
    if (/^\d+$/.test(text) && !studio.osrs.customSeq(+text)) { const a = studio.osrs.animation(+text); if (a) out.unshift({ id: +text, name: `Game animation ${text}`, note: `${a.frames.length} frames` }); }
    return out;
  }
  if (kind === 'custom') { const w = String(q || '').toLowerCase().split(/\s+/).filter(Boolean); return studio.server.items().filter((r) => { const n = ((r.objType && r.objType.name) || '').toLowerCase(); return w.every((x) => n.includes(x) || String(r.id) === x); }).slice(0, 400).map((r) => ({ id: r.id, name: r.objType.name, note: 'custom' })); }
  const w = String(q || '').toLowerCase().split(/\s+/).filter(Boolean);
  const custom = w.length ? studio.server.items().filter((r) => { const n = ((r.objType && r.objType.name) || '').toLowerCase(); return w.every((x) => n.includes(x)) || String(r.id) === String(q).trim(); }).slice(0, 30).map((r) => ({ id: r.id, name: r.objType.name, note: 'custom' })) : [];
  return custom.concat(studio.osrs.search('item', q, 80).map((d) => ({ id: d.id, name: d.name, note: d.wearPos >= 0 ? (Player.SLOT_NAMES[d.wearPos] || 'wearable') : '' })));
}
function animTarget(tg) {
  return { for: tg.spec, name: tg.name, skeleton: studio.osrs.skeletonOf(tg.baseId), model: b64(Model.encode(tg.mesh)), base: { types: tg.base.types, labels: tg.base.labels },
    controls: studio.anim.controls(tg).map((c) => ({ id: c.id, kind: c.kind, name: c.name, known: c.known, extra: c.extra, labels: c.labels, moves: c.moves, where: c.where })) };
}
function buildDraft(draft) {
  const build = studio.build(draft), out = { kind: build.kind, problems: build.problems, warnings: build.warnings, row: build.row };
  if (build.kind === 'anim') return Object.assign(out, { target: animTarget(build.target), anim: { frames: build.frames, delays: build.lengths }, ticks: build.ticks, seconds: +(build.ticks * 0.02).toFixed(2), fine: build.fine, bytes: build.encoded.reduce((n, b) => n + b.length, 0) });
  if (build.kind === 'item') {
    out.icon = build.icon; out.iconPng = build.iconImage ? b64(png.encode(build.iconImage.width, build.iconImage.height, build.iconImage.data)) : null;
    out.base = build.base ? { id: build.base.id, name: build.base.name, wearPos: build.base.wearPos, wearPos2: build.base.wearPos2, wearPos3: build.base.wearPos3 } : null;
    out.slots = {};
    for (const [slot, b] of Object.entries(build.slots)) out.slots[slot] = { mode: b.mode, info: b.info, report: b.report, cacheModel: b.cacheModel, model: b64(b.bytes || Model.encode(studio.builder.bake(b.mesh))),
      colours: Model.colourCounts(b.mesh).slice(0, 40), labels: Model.labelCounts(b.mesh) };
  } else {
    out.base = build.base ? { id: build.base.id, name: build.base.name } : null; out.combat = build.combat; out.baseModels = build.base ? build.base.models : [];
    { const counts = new Map(); const ms = build.models.length ? build.models.map((m) => m.mesh) : (build.base ? build.base.models.map((id) => studio.osrs.mesh(id)).filter(Boolean) : []);
      const rf = build.row.fields.recolorFrom || (build.base ? build.base.recolorFrom : []), rt = build.row.fields.recolorTo || (build.base ? build.base.recolorTo : []);
      for (const m of ms) { const c = Model.clone(m); rf.forEach((f, i) => Model.recolor(c, f, rt[i])); for (const e of Model.colourCounts(c)) counts.set(e.colour, (counts.get(e.colour) || 0) + e.faces); }
      out.colours = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40).map(([colour, faces]) => ({ colour, faces })); }
    const base = build.base || {}, f = Object.assign({}, build.row.fields);
    out.view = { models: build.models.length ? build.models.map((m) => b64(m.bytes || Model.encode(studio.builder.bake(m.mesh)))) : (base.models || []).map((id) => b64(studio.osrs.modelBytes(id))),
      recolorFrom: f.recolorFrom || base.recolorFrom || [], recolorTo: f.recolorTo || base.recolorTo || [], widthScale: f.widthScale || base.widthScale || 128, heightScale: f.heightScale || base.heightScale || 128,
      idleSeq: f.idleSeqId !== undefined ? f.idleSeqId : base.idleSeq, walkSeq: f.walkSeqId !== undefined ? f.walkSeqId : base.walkSeq, size: f.size || base.size || 1 };
  }
  return out;
}
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });

route('GET', '/api/status', () => Object.assign(studio.status(), { anims: DEFAULT_ANIMS.map((id) => ({ id, name: ANIM_NAMES[id] || 'Animation ' + id })), equipmentTypes: EQUIPMENT_TYPES, bonusNames: BONUS_NAMES, skillNames: SKILL_NAMES,
  weaponInterfaces: [...new Set(['DAGGER', 'GODSWORD', 'SHORTBOW', 'STAFF'].concat(studio.server.items().map((r) => r.itemDef && r.itemDef.weaponInterface).filter(Boolean)))].sort(), slotNames: Player.SLOT_NAMES }));
route('GET', '/api/setup', () => ({ config: studio.config, status: studio.status(), found: studio.detect(), root: ROOT, runningPort: PORT }));
route('POST', '/api/setup', (p, q, body) => { const r = studio.setup(body || {}); if (!r.ok) return r; reload(); return Object.assign(r, { status: studio.status(), rs3: studio.hasRs3() ? safe(() => studio.rs3Check()) : null, portChanged: r.config.port !== undefined && r.config.port !== PORT }); });
route('POST', '/api/browse', (p, q, body) => studio.browse(body && body.dir));
route('POST', '/api/find', (p, q, body) => studio.findCaches(body && body.dir));
route('POST', '/api/rs3check', (p, q, body) => studio.rs3Check(body && body.dir));
route('GET', '/api/search', (p, q) => ({ results: search(q.get('kind') || 'item', q.get('q') || '') }));
route('GET', '/api/item/:id', (p) => itemInfo(+p.id) || fail(404, `Item ${p.id} is not in the game`));
route('GET', '/api/npc/:id', (p) => { const d = studio.npcDef(+p.id); if (!d || d.error) fail(404, `NPC ${p.id} is not in the game`); return Object.assign({}, d, { anims: studio.npcAnimations(d).seqs.map((id) => ({ id, name: (studio.osrs.animation(id) || {}).name || (id === d.idleSeq ? 'Stand' : id === d.walkSeq ? 'Walk' : 'Animation ' + id) })) }); });
route('GET', '/api/gamecheck/npc/:id', (p) => studio.gameReport(+p.id, false));
route('POST', '/api/gamefix/npc/:id', (p, q, body) => {
  const rep = studio.gameReport(+p.id, true), files = rep._files; delete rep._files;
  if (!files.length) return { report: rep, write: null };
  return { report: rep, write: studio.porter.writeModels(`gamefix ${rep.npc}`, files, { write: !!(body && body.write), id: +p.id }) };
});
route('GET', '/api/animinfo/:id', (p) => { const a = studio.osrs.animation(+p.id); if (!a) fail(404, `Animation ${p.id} is not in the game`); return { id: a.id, name: a.name || null, custom: !!a.custom, frames: a.frames.length, seconds: +(a.delays.reduce((x, y) => x + y, 0) * 0.02).toFixed(2), skeleton: studio.osrs.skeletonOf(a.baseId), template: a.template, skeletal: a.skeletal !== -1,
  fits: [...studio.extraNpcs().values()].filter((d) => { const i = studio.osrs.animation(d.idleSeq); return i && studio.osrs.skeletonOf(i.baseId) === studio.osrs.skeletonOf(a.baseId); }).map((d) => ({ id: d.id, name: d.name })).slice(0, 8) }; });
route('GET', '/api/animtarget', (p, q) => animTarget(studio.anim.target(q.get('for') || 'player')));
route('GET', '/api/rs3item/:id', (p) => { const d = studio.rs3.item(+p.id); if (!d) fail(404, `RS3 item ${p.id} not found`); return d; });
route('GET', '/api/model/osrs/:id', (p) => {
  if (+p.id >= 1000000) { const rel = studio.server.customModels()[String(+p.id)]; if (!rel) fail(404, 'no such model'); return fs.readFileSync(studio.server.modelFile(rel)); }   // the server's own NPC and object models
  return studio.osrs.modelBytes(+p.id) || fail(404, 'no such model');
});
route('GET', '/api/model/custom', (p, q) => { const rel = q.get('file') || ''; if (!/^[a-zA-Z0-9._/-]+\.dat$/.test(rel) || rel.includes('..')) fail(400, 'bad model path'); return fs.readFileSync(studio.server.modelFile(rel)); });
route('GET', '/api/model/rs3/:id', (p, q) => { const c = convert(studio.rs3, +p.id, { maxTris: +(q.get('maxTris') || 2500), tint: q.get('tint') !== '0', equip: q.get('worn') === '1', rawLabels: q.get('worn') === '1' }); return Buffer.from(Model.encode(c.mesh)); });
route('GET', '/api/kits', (p, q) => {
  const female = q.get('female') === '1', hide = new Set((q.get('hide') || '').split(',').filter(Boolean).map(Number)), kits = studio.osrs.defaultKits(female), out = [];
  kits.forEach((k, part) => { if (!k || hide.has(part)) return; for (const id of k.models) { const m = studio.osrs.mesh(id); if (!m) continue; k.recolorFrom.forEach((f, i) => Model.recolor(m, f, k.recolorTo[i])); out.push({ tag: 'kit:' + Player.PART_NAMES[part], model: b64(Model.encode(studio.builder.bake(m))) }); } });
  return { parts: out };
});
route('GET', '/api/diagnose/item/:id', (p) => {
  const info = itemInfo(+p.id); if (!info) fail(404, `Item ${p.id} is not in the game`);
  const ref = info.base ? studio.osrs.item(info.base.id) : studio.osrs.item(info.id); if (!ref) fail(400, 'No OSRS item to compare against');
  const slot = Object.assign({}, ref, { wearPos: info.wearPos !== undefined ? info.wearPos : ref.wearPos, wearPos2: info.wearPos2 !== undefined ? info.wearPos2 : ref.wearPos2, wearPos3: info.wearPos3 !== undefined ? info.wearPos3 : ref.wearPos3 });
  const out = { reference: ref.name };
  for (const sex of ['male', 'female']) { const m = info.models[sex]; if (!m) continue; const mesh = m.type === 'custom' ? Model.decode(fs.readFileSync(studio.server.modelFile(m.file))) : studio.osrs.mesh(m.id); if (!mesh || !mesh.vskin) continue;
    info.recolorFrom.forEach((f, i) => Model.recolor(mesh, f, info.recolorTo[i])); out[sex] = studio.builder.testWorn(studio.builder.bake(mesh), slot, sex === 'female'); }
  if (!out.male && !out.female) fail(400, 'This item has no worn model with bone labels to test');
  return out;
});
route('GET', '/api/anim/:id', (p) => studio.osrs.animation(+p.id) || fail(404, `Animation ${p.id} is not in the cache`));
route('GET', '/api/texture/:id', (p) => ({ colour: studio.osrs.textureColour(+p.id) }));
route('GET', '/api/drafts', () => ({ drafts: studio.listDrafts() }));
route('GET', '/api/draft/:slug', (p) => studio.loadDraft(p.slug));
route('POST', '/api/draft', (p, q, body) => studio.saveDraft(body));
route('POST', '/api/draft/new', (p, q, body) => {
  const d = body.from === 'anim' ? studio.draftAnim(body.name || 'New animation', { for: body.for, from: body.fromAnim, template: body.template, loop: body.loop }) : body.from === 'rs3' ? studio.draftFromRs3Item(+body.id, body) : body.from === 'npc' ? studio.draftFromNpc(+body.id, body) : studio.draftFromGameItem(+body.id, body);
  return studio.saveDraft(d);
});
route('POST', '/api/draft/:slug/remove', (p) => studio.removeDraft(p.slug));
route('POST', '/api/draft/:slug/build', (p, q, body) => { const d = body && body.kind ? studio.saveDraft(body) : studio.loadDraft(p.slug); return buildDraft(d); });
route('POST', '/api/draft/:slug/port', (p, q, body) => { const d = studio.loadDraft(p.slug); return studio.port(d, { write: !!(body && body.write), restart: body && body.restart }); });
route('GET', '/api/ports', () => ({ ports: studio.porter.ports().map((m) => ({ key: m.key, name: m.name, kind: m.kind, id: m.id, when: m.when, replaced: m.replaced, undone: m.undone || null, backupDir: m.backupDir })) }));
route('POST', '/api/ports/:key/undo', (p) => studio.porter.undo(p.key));
route('GET', '/api/restart', (p, q) => studio.server.restartStatus(+(q.get('since') || 0)));

function fail(status, message) { throw Object.assign(new Error(message), { status }); }
function safe(fn) { try { return fn(); } catch (e) { return { verdict: 'no', summary: e.message, problems: [e.message] }; } }
const OPEN_WHEN_NOT_SET_UP = new Set(['/api/status', '/api/setup', '/api/browse', '/api/find', '/api/rs3check']);
function send(res, status, body, type) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body));
  res.writeHead(status, { 'Content-Type': type || (Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json'), 'Content-Length': data.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(data);
}
const server = http.createServer(async (req, res) => {
  try {
    const host = String(req.headers.host || '').split(':')[0];
    if (host !== 'localhost' && host !== '127.0.0.1') return send(res, 403, { error: 'This app only answers on this computer.' });
    const url = new URL(req.url, 'http://localhost'), pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      if (req.method === 'POST' && req.headers['x-studio'] !== '1') return send(res, 403, { error: 'Missing studio header' });
      let body = null;
      if (req.method === 'POST') { const chunks = []; let n = 0; for await (const c of req) { n += c.length; if (n > 8 * 1024 * 1024) fail(413, 'Request too large'); chunks.push(c); } const t = Buffer.concat(chunks).toString('utf8'); body = t ? JSON.parse(t) : {}; }
      if (studio.needsSetup && !OPEN_WHEN_NOT_SET_UP.has(pathname)) return send(res, 409, { error: 'The Studio has no game cache yet. Press "Game folder" at the top and choose your server or an OSRS cache.', needsSetup: true });
      for (const r of routes) { const m = req.method === r.method && r.re.exec(pathname); if (m) return send(res, 200, await r.fn(m.groups || {}, url.searchParams, body)); }
      return send(res, 404, { error: 'No such address: ' + pathname });
    }
    const rel = pathname === '/' ? 'ui/index.html' : pathname.replace(/^\/+/, '');
    const file = path.normalize(path.join(ROOT, rel));
    const allowed = ['ui', 'docs'].some((d) => file.startsWith(path.join(ROOT, d) + path.sep)) || [path.join(ROOT, 'lib', 'model.js'), path.join(ROOT, 'lib', 'anim.js')].includes(file);
    if (!allowed || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, fs.readFileSync(file), TYPES[path.extname(file)] || 'application/octet-stream');
  } catch (e) {
    send(res, e.status || 500, { error: e.message });
    if (!e.status) console.error('[studio]', e.stack || e.message);
  }
});
/** Opens the app in the default browser (the launcher passes --open). */
function openBrowser() {
  if (!process.argv.includes('--open')) return;
  const url = `http://localhost:${PORT}`, { spawn } = require('child_process');
  try {
    const p = process.platform === 'win32' ? spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore', windowsHide: true })
      : spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' });
    p.on('error', () => {}); p.unref();
  } catch { /* the address is printed below either way */ }
}
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') { console.error(`\n  The studio is already running: http://localhost:${PORT}\n  (If that page does not open, another program is using port ${PORT}: change "port" in config.json.)\n`); openBrowser(); setTimeout(() => process.exit(0), 600); return; }
  console.error(e.message); process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  const line = (k, v) => `  ${k.padEnd(19)}: ${v}\n`;
  console.log(`\n  Creator Studio is running:  http://localhost:${PORT}\n\n` +
    line('Game server', studio.standalone ? 'none (standalone: ports are written to ' + studio.serverDir + ')' : studio.serverDir) +
    line('OSRS cache', studio.needsSetup ? 'NOT FOUND - press "Game folder" in the app' : studio.server.cacheDir()) +
    line('RS3 cache', studio.hasRs3() ? studio.rs3Dir : 'none yet - press "RS3 cache" in the app, or put one in ' + path.join(ROOT, 'rs3-cache')) +
    (studio.problems.length ? '\n  ' + studio.problems.join('\n  ') + '\n' : '') +
    `\n  Leave this window open while you use the app. Close it to stop the app.\n  Nothing is changed in the game until you press "Port to game".\n`);
  openBrowser();
});
