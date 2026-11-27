'use strict';
// The only code that writes into the game server. A port:
//   1. checks everything the server's loaders check (ids, model ids, file names, packet sizes) BEFORE writing
//   2. backs up every file it will change to Server/server/backups/creator-studio-<name>-<time>/
//   3. writes the model files first (they do not restart the server), then each JSON file once
//   4. records a manifest so the port can be undone
// It never deletes anything in the project: undo moves files to the _to_delete folder next to the server.
const fs = require('fs');
const path = require('path');
const { ServerData, PACKET_LIMIT, ITEM_ID_START, NPC_ID_START, NPC_ID_END, EQUIPMENT_TYPES } = require('./serverdata');
const { SLOT_FIELDS, SLOT_FILES, slugify } = require('./build');

const MODEL_NAME = /^[a-zA-Z0-9._/-]+\.dat$/;
const stamp = () => { const d = new Date(), p = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`; };
function writeFileSafe(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.cs-${process.pid}.tmp`;
  try { fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
  catch (e) { fs.writeFileSync(file, data); try { fs.unlinkSync(tmp); } catch { /* leftover temp is harmless */ } }
}
/** JSON the way the server's hand-kept files are written: ", " and ": " separators on one line. */
function pyJson(v) {
  if (Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  if (v && typeof v === 'object') return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + pyJson(x)).join(', ') + '}';
  return JSON.stringify(v);
}
/** Adds or replaces one NPC line in npc-combat-defs.json without reformatting the rest of the file. */
function setCombatLine(text, id, entry) {
  const lines = text.split('\n'), line = `    "${id}": ${pyJson(entry)}`, isEntry = (l) => /^    "\d+": \{/.test(l);
  const at = lines.findIndex((l) => l.startsWith(`    "${id}": {`));
  if (at >= 0) lines[at] = line + (lines[at].trimEnd().endsWith(',') ? ',' : '');
  else {
    let last = -1; lines.forEach((l, i) => { if (isEntry(l)) last = i; });
    if (last < 0) throw new Error('npc-combat-defs.json is not laid out as expected');
    if (!lines[last].trimEnd().endsWith(',')) lines[last] = lines[last].trimEnd() + ',';
    lines.splice(last + 1, 0, line);
  }
  const out = lines.join('\n'); JSON.parse(out); return out;
}
const jsonText = (value, like) => JSON.stringify(value, null, 2) + (like === undefined || like.endsWith('\n') ? '\n' : '');
const NPC_FIELDS = { name: 'string', desc: 'string', category: 'int', modelIds: 'int[]', chatheadModelIds: 'int[]', size: 'int', combatLevel: 'int', attackLevel: 'int', defenceLevel: 'int', strengthLevel: 'int',
  hitpoints: 'int', rangedLevel: 'int', magicLevel: 'int', attackSpeed: 'int', recolorFrom: 'int[]', recolorTo: 'int[]', actions: 'actions', idleSeqId: 'seq', walkSeqId: 'seq', walkBackSeqId: 'seq',
  walkLeftSeqId: 'seq', walkRightSeqId: 'seq', runSeqId: 'seq', runBackSeqId: 'seq', runLeftSeqId: 'seq', runRightSeqId: 'seq', crawlSeqId: 'seq', turnLeftSeqId: 'seq', turnRightSeqId: 'seq',
  widthScale: 'int', heightScale: 'int', footprintSize: 'int', heightOffset: 'int', rotationSpeed: 'int', ambient: 'int', contrast: 'int', isVisible: 'boolean', isFollower: 'boolean',
  drawMapDot: 'boolean', isInteractable: 'boolean', isClickable: 'boolean', isClipped: 'boolean' };

class Porter {
  constructor(ctx) { this.ctx = ctx; this.server = ctx.server; this.portsDir = path.join(ctx.workspace, 'ports'); }
  /** Works out ids, file names and the final rows for a build, and lists every problem. Writes nothing. */
  /** Honest warnings about what the target can actually load (ServerData.capabilities). */
  capWarnings(kind, build) {
    const c = this.server.capabilities(), w = [];
    if (c.standalone) return ['Standalone mode: the files are written to the Studio\'s export folder, in the layout a supported server uses. Nothing is installed into a game.'];
    if (kind === 'item' && !c.items) w.push('This server has no plugin that loads custom-items.json. The files will be written, but the game will not show the item until such a loader exists.');
    if (kind === 'npc' && !c.npcs) w.push('This server has no cache-editor plugin to load custom-definitions.json. The row will be written, but the NPC will not exist in game until that loader exists.');
    if (kind === 'anim' && !c.animations) w.push('Nothing in this server sends custom animations to players (dataset "customSeqs"). The animation will be written to custom-seqs.json but will not play until a plugin sends it.');
    if (kind === 'item' && build && build.particles && !c.particles) w.push('This server has no particle plugin (dataset "customParticles"): the item will work, without its particles.');
    if (!c.autoRestart) w.push('This server does not restart itself when files change (no nodemon.json): restart it yourself to load the change.');
    return w;
  }
  /** Ask the server to restart, where that works (a nodemon-watched server). */
  askRestart(by) { const c = this.server.capabilities(); if (c.standalone || !c.autoRestart) return false; writeFileSafe(this.server.files.restart, jsonText({ restartedBy: by, at: new Date().toISOString() })); return true; }
  plan(draft, build, rowsNow) {
    const server = this.server, problems = [...build.problems], warnings = [...build.warnings], files = [], notes = [];
    const prev = draft.ported || null, index = server.modelIndex();
    const p = { kind: draft.kind, problems, warnings, files, notes, json: [] };
    if (draft.kind === 'item') {
      const rows = rowsNow || server.items(), replaceId = draft.item.replaceId !== undefined && draft.item.replaceId !== null ? draft.item.replaceId : (prev ? prev.id : null);
      const old = replaceId !== null ? rows.find((r) => r.id === replaceId) : null;
      const id = old ? old.id : (Number.isInteger(draft.id) && !server.takenItemIds().has(draft.id) && draft.id >= ITEM_ID_START ? draft.id : server.nextItemId());
      if (replaceId !== null && !old && !prev) problems.push(`item ${replaceId} is not in custom-items.json, so there is nothing to replace`);
      const folder = old && Object.values(old.models || {})[0] ? path.posix.dirname(Object.values(old.models)[0]) : (draft.item.folder || slugify(draft.name));
      const need = Object.values(build.slots).filter((b) => b.cacheModel === null);
      const reuse = {}; if (old) for (const [slot, field] of Object.entries(SLOT_FIELDS)) { const v = old.objType && old.objType[field]; if (Number.isInteger(v) && v >= 1000000 && old.models && old.models[v]) reuse[slot] = { id: v, file: old.models[v] }; }
      const fresh = server.nextModelIds(need.filter((b) => !reuse[b.slot]).length); const models = {}, row = JSON.parse(JSON.stringify(build.row));
      row.id = id;
      for (const b of need) {
        const r = reuse[b.slot] || { id: fresh.shift(), file: `${folder}/${SLOT_FILES[b.slot]}` };
        models[r.id] = r.file; row.objType[SLOT_FIELDS[b.slot]] = r.id;
        files.push({ rel: r.file, abs: server.modelFile(r.file), bytes: b.bytes, modelId: r.id, exists: fs.existsSync(server.modelFile(r.file)) });
        const owner = index.get(r.id);
        if (owner && !(old && owner.owner === 'item ' + old.id)) problems.push(`model id ${r.id} is already used by ${owner.owner}`);
        if (!MODEL_NAME.test(r.file)) problems.push(`model file name "${r.file}" has characters the server refuses`);
        if (b.bytes.length < 18 || b.bytes.length > 1024 * 1024) problems.push(`${b.slot} model is ${b.bytes.length} bytes (must be 18 bytes to 1 MiB)`);
        const pkt = ServerData.packetSize('customModels', [{ id: r.id, data: b.bytes.toString('base64') }]);
        if (pkt > PACKET_LIMIT) problems.push(`${b.slot} model packet is ${pkt} bytes, over the ${PACKET_LIMIT} limit: lower its triangle budget`);
        else if (pkt > PACKET_LIMIT * 0.85) warnings.push(`${b.slot} model packet is ${pkt} bytes, close to the ${PACKET_LIMIT} limit`);
      }
      if (Object.keys(models).length) row.models = models;
      for (const [k, v] of Object.entries(row.objType)) if (typeof v === 'string' && v.startsWith('@')) problems.push(`model slot ${k} was not built`);
      // the checks ItemDefinitionLoader makes at start-up (a failure there stops ALL custom content from loading)
      const def = row.itemDef || {};
      for (const [k, v] of Object.entries(def)) {
        if (k === 'equipmentType') { if (!EQUIPMENT_TYPES.includes(v)) problems.push(`equipmentType "${v}" is not one the server knows`); }
        else if (k === 'weaponInterface') { if (typeof v !== 'string') problems.push('weaponInterface must be a name'); }
        else if (k === 'bonuses' || k === 'requirements') { if (!Array.isArray(v) || !v.every(Number.isFinite)) problems.push(`${k} must be a list of numbers`); }
        else if (['doubleHanded', 'stackable', 'tradeable', 'dropable', 'sellable'].includes(k)) { if (typeof v !== 'boolean') problems.push(`${k} must be true or false`); }
        else if (!Number.isFinite(v)) problems.push(`itemDef.${k} must be a number`);
      }
      if (row.specialAttack) { const s = row.specialAttack; if (!(s.from === undefined || (Number.isInteger(s.from) && s.from > 0 && s.from !== id)) || !(s.energy === undefined || (Number.isInteger(s.energy) && s.energy >= 1 && s.energy <= 100))) problems.push('specialAttack needs "from" (another item id) and/or "energy" 1-100'); }
      if (!old && server.takenItemIds().has(id)) problems.push(`item id ${id} is already taken`);
      if (id < ITEM_ID_START || id > 65000) problems.push(`item id ${id} is outside the custom range ${ITEM_ID_START}-65000`);
      const next = rows.filter((r) => r.id !== id).concat([row]).sort((a, b) => a.id - b.id);
      const pkt = ServerData.packetSize('customItems', next);
      if (pkt > PACKET_LIMIT) problems.push(`the customItems packet would be ${pkt} bytes, over the ${PACKET_LIMIT} limit`);
      p.id = id; p.row = row; p.replaces = old || null; p.packet = { customItems: pkt, limit: PACKET_LIMIT };
      p.json.push({ file: server.files.items, value: next });
      if (build.particles) {
        try {
          const doc = server.readJson(server.files.particles, { version: 1, configs: {}, effectors: {}, textures: {}, items: {} });
          if (build.particles.type === 'copy') { const src = doc.items && doc.items[String(build.particles.from)]; if (src) doc.items[String(id)] = JSON.parse(JSON.stringify(src)); else warnings.push(`item ${build.particles.from} has no particles to copy`); }
          else require('./particles').addItem(doc, this.ctx.rs3(), id, build.particles.sexes);
          if (doc.items[String(id)]) { p.json.push({ file: server.files.particles, value: doc }); notes.push(`particles: ${doc.items[String(id)].male.length} emitters`); }
        } catch (e) { warnings.push('particles were left out: ' + e.message); }
      }
      notes.push(old ? `replaces existing item ${id} (${old.objType && old.objType.name})` : `new item id ${id}`);
    } else if (draft.kind === 'npc') {
      const doc = server.definitions(), taken = server.takenNpcIds();
      const old = prev ? doc.rows.find((r) => r.kind === 'npc' && r.id === prev.id) : null;
      const id = old ? old.id : (Number.isInteger(draft.id) && !taken.has(draft.id) && draft.id >= 50000 ? draft.id : server.nextNpcId());
      const folder = draft.npc.folder || 'npc-' + slugify(draft.name), need = build.models.filter((m) => m.cacheModel === null);
      const prevModels = (prev && prev.models) || [], fresh = server.nextModelIds(Math.max(0, need.length - prevModels.length));
      const extra = Object.assign({}, server.customModels()), row = JSON.parse(JSON.stringify(build.row)); row.id = id;
      need.forEach((m, i) => {
        const mid = prevModels[i] !== undefined ? prevModels[i] : fresh.shift(), rel = `${folder}/model-${i}.dat`;
        extra[mid] = rel; row.fields.modelIds = row.fields.modelIds.map((v) => v === '@model' + m.index ? mid : v);
        files.push({ rel, abs: server.modelFile(rel), bytes: m.bytes, modelId: mid, exists: fs.existsSync(server.modelFile(rel)) });
        const owner = index.get(mid); if (owner && !prevModels.includes(mid)) problems.push(`model id ${mid} is already used by ${owner.owner}`);
        const pkt = ServerData.packetSize('customModels', [{ id: mid, data: m.bytes.toString('base64') }]);
        if (pkt > PACKET_LIMIT) problems.push(`NPC model ${i} packet is ${pkt} bytes, over the ${PACKET_LIMIT} limit: lower its triangle budget or split it`);
      });
      const osrs = this.ctx.osrs();
      for (const [k, v] of Object.entries(row.fields)) {
        const t = NPC_FIELDS[k];
        if (!t) { problems.push(`"${k}" is not a field the server accepts on an NPC`); continue; }
        if (t === 'string' && typeof v !== 'string') problems.push(`${k} must be text`);
        if ((t === 'int' || t === 'seq') && !Number.isInteger(v)) problems.push(`${k} must be a whole number`);
        if (t === 'boolean' && typeof v !== 'boolean') problems.push(`${k} must be true or false`);
        if (t === 'int[]' && (!Array.isArray(v) || !v.every(Number.isInteger))) problems.push(`${k} must be a list of whole numbers`);
        if (t === 'actions' && (!Array.isArray(v) || v.length > 5 || !v.every((a) => a === null || typeof a === 'string'))) problems.push('actions must be up to five names (or null)');
        if (t === 'seq' && Number.isInteger(v) && v !== -1 && !osrs.seq(v)) problems.push(`${k}: animation ${v} is not in the cache (the server refuses custom animation ids here)`);
        if (['size', 'widthScale', 'heightScale'].includes(k) && v < 1) problems.push(`${k} must be at least 1`);
      }
      for (const m of row.fields.modelIds || []) if (Number.isInteger(m) && m < 1000000 && !osrs.hasModel(m)) problems.push(`model ${m} is not in the cache`);
      const rf = row.fields.recolorFrom || [], rt = row.fields.recolorTo || [];
      if (rf.length !== rt.length) problems.push('recolorFrom and recolorTo must be the same length');
      if ([...rf, ...rt].some((v) => v < 0 || v > 65535)) problems.push('recolour values must be 0-65535');
      if (row.baseId !== null && !osrs.npc(row.baseId)) problems.push(`base NPC ${row.baseId} does not exist`);
      if (id < 50000 || id > NPC_ID_END) problems.push(`NPC id ${id} is outside 50000-${NPC_ID_END}`);
      if (!old && taken.has(id)) problems.push(`NPC id ${id} is already taken`);
      const rows = doc.rows.filter((r) => !(r.kind === 'npc' && r.id === id)).concat([row]).sort((a, b) => a.kind.localeCompare(b.kind) || a.id - b.id);
      const pkt = ServerData.packetSize('customDefinitions', rows);
      if (pkt > PACKET_LIMIT - 8) problems.push(`the custom definitions packet would be ${pkt} bytes, over the limit`);
      p.id = id; p.row = row; p.replaces = old || null; p.packet = { customDefinitions: pkt, limit: PACKET_LIMIT - 8 }; p.models = need.map((m, i) => files[i].modelId);
      p.json.push({ file: server.files.definitions, value: Object.assign({}, doc, { rows }) });
      if (need.length) p.json.push({ file: server.files.customModels, value: extra });
      const combat = build.combat;
      if (combat && Object.keys(combat).length) {
        p.json.push({ file: server.files.combat, text: setCombatLine(fs.readFileSync(server.files.combat, 'utf8'), id, Object.assign({ name: draft.name }, combat)) });
      }
      if (build.spawns && build.spawns.length) {
        const sp = server.readJson(server.files.spawns, []).filter((s) => s.id !== id);
        for (const s of build.spawns) sp.push({ level: s.level || 0, name: draft.name, x: s.x, y: s.y, id, wanderRadius: s.wanderRadius || 0 });
        p.json.push({ file: server.files.spawns, value: sp, lines: true });
      }
      notes.push(old ? `replaces NPC ${id}` : `new NPC id ${id} (spawn it in game with ::npc ${id})`);
    }
    p.ok = problems.length === 0;
    return p;
  }
  /** Dry run by default; with { write: true } it backs up and writes. */
  port(draft, build, opt) {
    opt = opt || {};
    const plan = this.plan(draft, build);
    const summary = { ok: plan.ok, id: plan.id, kind: plan.kind, standalone: this.server.standalone, target: this.server.dir, problems: plan.problems, warnings: plan.warnings.concat(this.capWarnings(plan.kind, build)), notes: plan.notes, packet: plan.packet, row: plan.row,
      files: plan.files.map((f) => ({ file: 'data/models/' + f.rel, bytes: f.bytes.length, modelId: f.modelId, replaces: f.exists })), written: false };
    if (!plan.ok || !opt.write) return summary;
    const server = this.server, when = stamp(), name = slugify(draft.name), backupDir = path.join(server.backupsDir, `creator-studio-${name}-${when}`);
    const manifest = { when, startedAt: Date.now(), draft: draft.slug, kind: draft.kind, id: plan.id, name: draft.name, backupDir, replaced: !!plan.replaces, oldRow: plan.replaces, files: [], json: [] };
    fs.mkdirSync(backupDir, { recursive: true });
    for (const j of plan.json) if (fs.existsSync(j.file)) fs.copyFileSync(j.file, path.join(backupDir, path.basename(j.file)));
    for (const f of plan.files) {
      if (f.exists) { const b = path.join(backupDir, 'models', f.rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(f.abs, b); }
      manifest.files.push({ rel: f.rel, existed: f.exists, modelId: f.modelId });
    }
    // model files first: they are not .json/.js, so the server does not restart for them
    for (const f of plan.files) writeFileSafe(f.abs, f.bytes);
    for (const j of plan.json) {
      const like = fs.existsSync(j.file) ? fs.readFileSync(j.file, 'utf8') : undefined;
      const text = j.text !== undefined ? j.text : j.lines ? '[\n' + j.value.map((r) => '  ' + JSON.stringify(r)).join(',\n') + '\n]\n' : jsonText(j.value, like);
      JSON.parse(text);
      writeFileSafe(j.file, text);
      manifest.json.push(path.basename(j.file));
    }
    // a change to model files only (same ids and rows) needs the restart asked for
    if (opt.restart === true) this.askRestart('creator-studio');
    fs.mkdirSync(this.portsDir, { recursive: true });
    fs.writeFileSync(path.join(this.portsDir, `${when}-${name}.json`), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(backupDir, 'PORT-INFO.txt'), `Creator Studio port of "${draft.name}" (${draft.kind} ${plan.id}) at ${when}.\nThese are the files as they were BEFORE the port.\nUndo from the app (Ported tab -> Undo) or: node cli.js undo ${when}-${name}\n`);
    return Object.assign(summary, { written: true, backupDir, manifest: `${when}-${name}`, startedAt: manifest.startedAt });
  }
  /** Several item drafts in one go: every model file, then custom-items.json ONCE, so the server restarts once. */
  portBatch(list, opt) {
    opt = opt || {};
    const server = this.server; let rows = server.items(); const plans = [];
    for (const { draft, build } of list) {
      if (draft.kind !== 'item') throw new Error('only items can be ported together');
      const plan = this.plan(draft, build, rows); plans.push({ draft, plan });
      const itemsJson = plan.json.find((j) => j.file === server.files.items); if (plan.ok && itemsJson) rows = itemsJson.value;
      if (plan.json.length > 1) plan.problems.push('items with particles must be ported one at a time'), plan.ok = false;
    }
    const summary = { ok: plans.every((x) => x.plan.ok), written: false, standalone: this.server.standalone, target: this.server.dir, warnings: this.capWarnings('item', null), items: plans.map(({ draft, plan }) => ({ name: draft.name, id: plan.id, ok: plan.ok, problems: plan.problems, warnings: plan.warnings, notes: plan.notes,
      files: plan.files.map((f) => ({ file: 'data/models/' + f.rel, bytes: f.bytes.length, modelId: f.modelId, replaces: f.exists })) })), packet: { customItems: ServerData.packetSize('customItems', rows), limit: PACKET_LIMIT } };
    if (!summary.ok || !opt.write) return summary;
    const when = stamp(), backupDir = path.join(server.backupsDir, `creator-studio-batch-${when}`), startedAt = Date.now();
    fs.mkdirSync(backupDir, { recursive: true }); fs.copyFileSync(server.files.items, path.join(backupDir, 'custom-items.json'));
    const like = fs.readFileSync(server.files.items, 'utf8');
    for (const { plan } of plans) for (const f of plan.files) { if (f.exists) { const b = path.join(backupDir, 'models', f.rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(f.abs, b); } }
    for (const { plan } of plans) for (const f of plan.files) writeFileSafe(f.abs, f.bytes);
    writeFileSafe(server.files.items, jsonText(rows, like));
    fs.mkdirSync(this.portsDir, { recursive: true });
    for (const { draft, plan } of plans) {
      const name = slugify(draft.name);
      fs.writeFileSync(path.join(this.portsDir, `${when}-${name}.json`), JSON.stringify({ when, startedAt, draft: draft.slug, kind: 'item', id: plan.id, name: draft.name, backupDir, replaced: !!plan.replaces, oldRow: plan.replaces,
        files: plan.files.map((f) => ({ rel: f.rel, existed: f.exists, modelId: f.modelId })), json: ['custom-items.json'] }, null, 2));
    }
    fs.writeFileSync(path.join(backupDir, 'PORT-INFO.txt'), `Creator Studio port of ${plans.map((x) => `"${x.draft.name}" (item ${x.plan.id})`).join(', ')} at ${when}.\nThese are the files as they were BEFORE the port. Undo each from the app's Ported tab.\n`);
    return Object.assign(summary, { written: true, backupDir, startedAt });
  }
  /**
   * A custom animation into data/definitions/custom-seqs.json (the "customSeqs" dataset the client plays).
   * Every custom animation in the game travels in ONE packet, so its size is checked before anything is written.
   */
  portAnim(draft, build, opt) {
    opt = opt || {};
    const server = this.server, rows = server.readJson(server.files.seqs, []), problems = [...build.problems], warnings = [...build.warnings], notes = [];
    const prev = draft.ported || null, taken = new Set(rows.filter((r) => r.kind !== 'base').map((r) => r.id));
    let id = prev && taken.has(prev.id) ? prev.id : (Number.isInteger(draft.id) && draft.id >= 61000 && !taken.has(draft.id) ? draft.id : 61000);
    if (!(prev && taken.has(prev.id))) while (taken.has(id)) id++;
    const old = rows.find((r) => r.kind !== 'base' && r.id === id) || null;
    let baseId = build.baseId, addBase = null;
    if (build.baseRow) {
      const same = rows.find((r) => r.kind === 'base' && r.data === build.baseRow.data && (r.rotationDivisor || 1) === build.baseRow.rotationDivisor);
      if (same) baseId = same.id;
      else {
        const used = new Set(rows.filter((r) => r.kind === 'base').map((r) => r.id));
        try { for (const g of Object.values(server.readJson(path.join(server.dir, 'data', 'definitions', 'custom-skeletal.json'), {}))) for (const b of g.bases || []) used.add(b.id); } catch { /* optional file */ }
        baseId = 65300; while (used.has(baseId)) baseId++;
        if (baseId > 65535) problems.push('no free skeleton id left below 65536');
        addBase = { kind: 'base', id: baseId, data: build.baseRow.data, rotationDivisor: build.baseRow.rotationDivisor, copyOf: build.target.baseId };
        notes.push(`adds skeleton ${baseId}: the game's own skeleton ${build.target.baseId} with ${build.baseRow.rotationDivisor}x finer rotations`);
      }
    }
    const frames = build.encoded.map((b) => { const c = Buffer.from(b); c.writeUInt16BE(baseId & 0xffff, 0); return c.toString('base64'); });
    const row = { id, template: draft.anim.template, name: draft.name, frameLengths: build.lengths, frames };
    const next = rows.filter((r) => !(r.kind !== 'base' && r.id === id)).concat(addBase ? [addBase] : [], [row]);
    const pkt = ServerData.packetSize('customSeqs', next), was = ServerData.packetSize('customSeqs', rows);
    if (pkt > PACKET_LIMIT) problems.push(`all custom animations together would be ${pkt} bytes, over the ${PACKET_LIMIT} byte packet limit: raise "step", shorten it, or remove an old custom animation`);
    else if (pkt > 60000) warnings.push(`custom animations would use ${pkt} of ${PACKET_LIMIT} bytes: nearly full`);
    notes.push(old ? `replaces custom animation ${id}` : `new animation id ${id}`, `${build.frames.length} frames, ${(build.ticks * 0.02).toFixed(2)} seconds, adds ${pkt - was} bytes to the animation packet`);
    const summary = { ok: !problems.length, kind: 'anim', id, standalone: this.server.standalone, target: this.server.dir, problems, warnings: warnings.concat(this.capWarnings('anim', build)), notes, packet: { customSeqs: pkt, limit: PACKET_LIMIT }, files: [], written: false };
    if (!summary.ok || !opt.write) return summary;
    const when = stamp(), name = slugify(draft.name), backupDir = path.join(server.backupsDir, `creator-studio-anim-${name}-${when}`), startedAt = Date.now();
    fs.mkdirSync(backupDir, { recursive: true });
    const like = fs.existsSync(server.files.seqs) ? fs.readFileSync(server.files.seqs, 'utf8') : '[]\n';
    if (fs.existsSync(server.files.seqs)) fs.copyFileSync(server.files.seqs, path.join(backupDir, 'custom-seqs.json'));
    const text = JSON.stringify(next, null, 1) + (like.endsWith('\n') ? '\n' : ''); JSON.parse(text);
    writeFileSafe(server.files.seqs, text);
    fs.mkdirSync(this.portsDir, { recursive: true });
    fs.writeFileSync(path.join(this.portsDir, `${when}-${name}.json`), JSON.stringify({ when, startedAt, draft: draft.slug, kind: 'anim', id, name: draft.name, backupDir, replaced: !!old, oldRow: old, baseAdded: addBase ? addBase.id : null, files: [], json: ['custom-seqs.json'] }, null, 2));
    fs.writeFileSync(path.join(backupDir, 'PORT-INFO.txt'), `Creator Studio port of animation "${draft.name}" (${id}) at ${when}.\ncustom-seqs.json here is the file as it was BEFORE.\nUndo from the app (Ported tab -> Undo) or: node cli.js undo ${when}-${name}\n`);
    return Object.assign(summary, { written: true, backupDir, manifest: `${when}-${name}`, startedAt });
  }
  /**
   * Replaces model files that are already in the game (a repaired NPC model, say). Same care as a port: the old
   * files are copied to the backups folder first, a manifest is kept so it can be undone, and the server is asked to
   * restart once so it reads the new files.
   */
  writeModels(name, list, opt) {
    opt = opt || {};
    const server = this.server, when = stamp(), slug = slugify(name), backupDir = path.join(server.backupsDir, `creator-studio-${slug}-${when}`), startedAt = Date.now(), problems = [];
    for (const f of list) {
      if (!MODEL_NAME.test(f.rel) || f.rel.includes('..')) problems.push(`model file name "${f.rel}" has characters the server refuses`);
      if (f.bytes.length < 18 || f.bytes.length > 1024 * 1024) problems.push(`${f.rel} is ${f.bytes.length} bytes (must be 18 bytes to 1 MiB)`);
      const pkt = ServerData.packetSize('customModels', [{ id: f.modelId || 0, data: Buffer.from(f.bytes).toString('base64') }]);
      if (pkt > PACKET_LIMIT) problems.push(`${f.rel} would be a ${pkt} byte packet, over the ${PACKET_LIMIT} limit`);
    }
    const summary = { ok: !problems.length, problems, warnings: this.capWarnings('models', null), standalone: this.server.standalone, target: this.server.dir, written: false, files: list.map((f) => ({ file: 'data/models/' + f.rel, bytes: f.bytes.length, modelId: f.modelId, replaces: fs.existsSync(server.modelFile(f.rel)) })) };
    if (!summary.ok || !opt.write) return summary;
    fs.mkdirSync(backupDir, { recursive: true });
    const files = [];
    for (const f of list) { const abs = server.modelFile(f.rel), existed = fs.existsSync(abs); if (existed) { const b = path.join(backupDir, 'models', f.rel); fs.mkdirSync(path.dirname(b), { recursive: true }); fs.copyFileSync(abs, b); } files.push({ rel: f.rel, existed, modelId: f.modelId }); }
    for (const f of list) writeFileSafe(server.modelFile(f.rel), Buffer.from(f.bytes));
    if (opt.restart !== false) this.askRestart('creator-studio');
    fs.mkdirSync(this.portsDir, { recursive: true });
    fs.writeFileSync(path.join(this.portsDir, `${when}-${slug}.json`), JSON.stringify({ when, startedAt, kind: 'models', id: opt.id !== undefined ? opt.id : null, name, backupDir, replaced: true, files, json: [] }, null, 2));
    fs.writeFileSync(path.join(backupDir, 'PORT-INFO.txt'), `Creator Studio: ${name} at ${when}.\nThese are the model files as they were BEFORE the change.\nUndo from the app (Ported tab -> Undo) or: node cli.js undo ${when}-${slug}\n`);
    return Object.assign(summary, { written: true, backupDir, manifest: `${when}-${slug}`, startedAt });
  }
  ports() {
    try { return fs.readdirSync(this.portsDir).filter((f) => f.endsWith('.json')).sort().reverse().map((f) => Object.assign({ key: f.slice(0, -5) }, JSON.parse(fs.readFileSync(path.join(this.portsDir, f), 'utf8')))); } catch { return []; }
  }
  /** Take a port back out: the old row and model files return (or a new row is removed); nothing is deleted. */
  undo(key) {
    const m = this.ports().find((p) => p.key === key);
    if (!m) throw new Error('No such port: ' + key);
    if (m.undone) throw new Error('That port was already undone');
    const server = this.server, when = stamp(), done = [];
    const safety = path.join(server.backupsDir, `creator-studio-undo-${slugify(m.name)}-${when}`); fs.mkdirSync(safety, { recursive: true });
    if (m.kind === 'item') {
      fs.copyFileSync(server.files.items, path.join(safety, 'custom-items.json'));
      const like = fs.readFileSync(server.files.items, 'utf8');
      let rows = server.items().filter((r) => r.id !== m.id);
      if (m.oldRow) rows.push(m.oldRow);
      rows.sort((a, b) => a.id - b.id);
      writeFileSafe(server.files.items, jsonText(rows, like)); done.push(m.oldRow ? `put back the previous row for item ${m.id}` : `removed item ${m.id}`);
    } else if (m.kind === 'anim') {
      fs.copyFileSync(server.files.seqs, path.join(safety, 'custom-seqs.json'));
      const like = fs.readFileSync(server.files.seqs, 'utf8');
      let rows = server.readJson(server.files.seqs, []).filter((r) => !(r.kind !== 'base' && r.id === m.id));
      if (m.oldRow) rows.push(m.oldRow);
      if (m.baseAdded !== null && m.baseAdded !== undefined) {   // drop its skeleton row too if nothing else uses it
        const usedBy = rows.some((r) => r.kind !== 'base' && (r.frames || []).length && Buffer.from(r.frames[0], 'base64').readUInt16BE(0) === m.baseAdded);
        if (!usedBy) rows = rows.filter((r) => !(r.kind === 'base' && r.id === m.baseAdded));
      }
      writeFileSafe(server.files.seqs, JSON.stringify(rows, null, 1) + (like.endsWith('\n') ? '\n' : ''));
      done.push(m.oldRow ? `put back the previous animation ${m.id}` : `removed animation ${m.id}`);
    } else if (m.kind === 'models') {
      done.push('model files only: no definition rows to change');
    } else {
      fs.copyFileSync(server.files.definitions, path.join(safety, 'custom-definitions.json'));
      const doc = server.definitions(); doc.rows = doc.rows.filter((r) => !(r.kind === 'npc' && r.id === m.id)); if (m.oldRow) doc.rows.push(m.oldRow);
      writeFileSafe(server.files.definitions, jsonText(doc)); done.push(`removed NPC ${m.id} from custom-definitions.json`);
      const ids = new Set(m.files.filter((f) => !f.existed).map((f) => String(f.modelId)));
      if (ids.size && fs.existsSync(server.files.customModels)) {
        fs.copyFileSync(server.files.customModels, path.join(safety, 'custom-models.json'));
        const cm = server.customModels(); for (const id of ids) delete cm[id];
        writeFileSafe(server.files.customModels, jsonText(cm)); done.push('removed its model ids from custom-models.json');
      }
    }
    for (const f of m.files) {
      const abs = server.modelFile(f.rel), backup = path.join(m.backupDir, 'models', f.rel);
      if (!fs.existsSync(abs)) continue;
      if (f.existed && fs.existsSync(backup)) { fs.copyFileSync(abs, path.join(safety, path.basename(f.rel))); writeFileSafe(abs, fs.readFileSync(backup)); done.push(`restored ${f.rel}`); }
      else { const dest = path.join(server.toDeleteDir, `creator-studio-${slugify(m.name)}-${when}`, f.rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.renameSync(abs, dest); done.push(`moved ${f.rel} to the _to_delete folder (not deleted)`); }
    }
    if (m.kind === 'models') this.askRestart('creator-studio undo');
    m.undone = when; const { key: _k, ...rest } = m; void _k;
    fs.writeFileSync(path.join(this.portsDir, key + '.json'), JSON.stringify(rest, null, 2));
    return { ok: true, done, safetyCopy: safety };
  }
}
module.exports = { Porter, writeFileSafe, NPC_FIELDS, setCombatLine, pyJson };
