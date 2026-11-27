'use strict';
// The studio's core: finds the server and caches, keeps drafts in workspace/, builds and ports them.
// Used by both the web app (server.js) and the command line (cli.js), so they always behave the same.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Osrs } = require('./osrs');
const { Rs3 } = require('./rs3');
const { ServerData } = require('./serverdata');
const { Builder, slugify, SLOT_FIELDS } = require('./build');
const { Porter } = require('./port');
const Model = require('./model');

const ROOT = path.resolve(__dirname, '..');
// Where to look when config.json does not say. Paths are relative to the Studio's own folder.
const SERVER_GUESSES = ['../Server/server', '../server', '../../Server/server', '..', '../..'];
const RS3_GUESSES = ['rs3-cache', '../rs3-cache', '../../950 open source code/950OpenSource/cache', '../950OpenSource/cache'];
const OSRS_GUESSES = ['osrs-cache', '../osrs-cache'];
const EXPORT_SKELETON = { 'custom-items.json': '[]\n', 'custom-models.json': '{}\n', 'custom-definitions.json': '{\n  "version": 1,\n  "rows": []\n}\n', 'custom-seqs.json': '[]\n', 'npc-combat-defs.json': '{\n  "npcs": {\n  }\n}\n' };

class Studio {
  /**
   * Finds its folders in this order: config.json, then a look around its own folder. Two modes:
   *   server      a game server of the supported kind was found: "Port to game" writes into it
   *   standalone  no such server: everything else works from an OSRS cache, and a port writes the same files into
   *               the Studio's own export/ folder for the user to install however their server needs
   * It never throws for a missing folder: status().problems says what is missing and how to set it.
   */
  constructor(opt) {
    opt = opt || {};
    this.configFile = path.join(ROOT, 'config.json');
    let cfg = {}; try { cfg = JSON.parse(fs.readFileSync(this.configFile, 'utf8')); } catch { cfg = {}; }
    this.config = Object.assign({ port: 4777 }, cfg, opt);
    this.root = ROOT;
    this.workspace = path.join(ROOT, 'workspace');
    this.draftsDir = path.join(this.workspace, 'drafts');
    fs.mkdirSync(this.draftsDir, { recursive: true });
    const abs = (p) => path.resolve(ROOT, p), first = (list, ok) => { for (const g of list) if (ok(abs(g))) return abs(g); return null; };
    // a cache folder may hold the cache itself, or one folder per cache: take the first one found
    const firstCache = (list, ok) => { for (const g of list) { const found = ServerData.findCaches(abs(g), ok); if (found.length) return found[0]; } return null; };
    this.problems = [];
    let serverDir = null;
    if (this.config.serverDir) { if (ServerData.looksLikeServer(abs(this.config.serverDir))) serverDir = abs(this.config.serverDir); else this.problems.push(`The game server folder in config.json was not found, or has no data/definitions: ${abs(this.config.serverDir)}`); }
    else if (!this.config.standalone) serverDir = first(SERVER_GUESSES, ServerData.looksLikeServer);
    const osrsCache = this.config.osrsCache ? abs(this.config.osrsCache) : firstCache(OSRS_GUESSES, ServerData.isOsrsCache);
    if (this.config.osrsCache && !ServerData.isOsrsCache(osrsCache)) this.problems.push(`The OSRS cache folder in config.json has no main_file_cache.dat2: ${osrsCache}`);
    this.standalone = !serverDir;
    if (this.standalone) {
      serverDir = path.join(ROOT, 'export');
      const defs = path.join(serverDir, 'data', 'definitions'); fs.mkdirSync(defs, { recursive: true }); fs.mkdirSync(path.join(serverDir, 'data', 'models'), { recursive: true });
      for (const [name, text] of Object.entries(EXPORT_SKELETON)) if (!fs.existsSync(path.join(defs, name))) fs.writeFileSync(path.join(defs, name), text);
      if (!fs.existsSync(path.join(serverDir, ServerData.EXPORT_MARK))) fs.writeFileSync(path.join(serverDir, ServerData.EXPORT_MARK), 'Creator Studio writes here when it has no game server ("Export files").\r\n\r\ndata\\definitions  the rows a supported server reads (custom-items.json and the others)\r\ndata\\models       the model files those rows name (standard OSRS model files)\r\nbackups           what each export replaced, so it can be undone from the Ported tab\r\n\r\nCopy data\\ into a server that can load it, or pass it to whoever runs one. docs\\AGENT-GUIDE.md section 3 says what a server needs for each file.\r\n');
    }
    this.serverDir = serverDir;
    this.server = new ServerData(serverDir, { standalone: this.standalone, osrsCache: osrsCache && ServerData.isOsrsCache(osrsCache) ? osrsCache : null });
    if (!this.server.hasCache()) this.problems.push(this.standalone ? 'No game server and no OSRS cache found yet. Tell the Studio where they are: the Game folder button in the app, or "node cli.js setup".' : `The game server at ${serverDir} has no readable OSRS cache (caches/<name>/main_file_cache.dat2). Set one with "node cli.js setup --osrs-cache <folder>".`);
    this.rs3Dir = this.config.rs3Cache ? abs(this.config.rs3Cache) : (firstCache(RS3_GUESSES, ServerData.isRs3Cache) || abs('rs3-cache'));
    if (this.config.rs3Cache && !ServerData.isRs3Cache(this.rs3Dir)) this.problems.push(`The RS3 cache folder in config.json is not an RS3 flat-file cache (it needs folders 19, 47 and 255): ${this.rs3Dir}`);
    this.needsSetup = !this.server.hasCache();
    const ctx = { osrs: () => this.osrs, rs3: () => this.rs3, server: this.server, workspace: this.workspace };
    this.builder = new Builder(ctx); this.porter = new Porter(ctx);
  }
  get osrs() { return this._osrs || (this._osrs = new Osrs(this.server.cacheDir()).setCustomSeqs(this.server.readJson(this.server.files.seqs, []))); }
  get rs3() {
    if (!this._rs3) { if (!this.hasRs3()) throw new Error(`No RS3 cache found (looked in ${this.rs3Dir}). RS3 porting needs an RS3 flat-file cache: set it with the RS3 cache button in the app or "node cli.js setup --rs3-cache <folder>".`); this._rs3 = new Rs3(this.rs3Dir, path.join(this.workspace, 'cache')); }
    return this._rs3;
  }
  hasRs3() { return ServerData.isRs3Cache(this.rs3Dir); }
  status() {
    const s = this.server, base = { mode: this.standalone ? 'standalone' : 'server', needsSetup: this.needsSetup, problems: this.problems, serverDir: this.standalone ? null : this.serverDir, exportDir: this.standalone ? this.serverDir : null,
      rs3Cache: this.hasRs3() ? this.rs3Dir : null, capabilities: s.capabilities(), drafts: this.listDrafts().length };
    if (this.needsSetup) return Object.assign(base, { cache: null, customItems: 0, nextItemId: null, nextNpcId: null, nextModelId: null, budgets: { customItems: { used: 0, limit: 65535 }, customDefinitions: { used: 0, limit: 65527 } } });
    return Object.assign(base, { cache: path.basename(s.cacheDir()), cacheDir: s.cacheDir(), customItems: s.items().length, nextItemId: s.nextItemId(), nextNpcId: s.nextNpcId(), nextModelId: s.nextModelIds(1)[0], budgets: s.budgets() });
  }
  /** Folders the Studio can see near itself that look right, for the setup screen. */
  detect() {
    const abs = (p) => path.resolve(ROOT, p), uniq = (a) => [...new Set(a)];
    const caches = (list, ok) => uniq(list.flatMap((g) => ServerData.findCaches(abs(g), ok)));
    return { servers: uniq(SERVER_GUESSES.map(abs).filter(ServerData.looksLikeServer)), osrsCaches: caches(OSRS_GUESSES, ServerData.isOsrsCache), rs3Caches: caches(RS3_GUESSES, ServerData.isRs3Cache),
      dropFolders: { rs3: abs('rs3-cache'), osrs: abs('osrs-cache') } };
  }
  /** Places a downloaded cache usually ends up: the Studio's own drop folders, the folder above it, Downloads, Desktop, Documents. */
  searchRoots() {
    const home = os.homedir(), abs = (p) => path.resolve(ROOT, p);
    return [abs('rs3-cache'), abs('osrs-cache'), abs('..'), path.join(home, 'Downloads'), path.join(home, 'Desktop'), path.join(home, 'Documents')].filter((d, i, a) => a.indexOf(d) === i && fs.existsSync(d));
  }
  /** "Find it for me": every RS3 cache, OSRS cache and game server in the usual places (or under `dir`). */
  findCaches(dir) { const roots = dir ? [path.resolve(dir)] : this.searchRoots(); return Object.assign(ServerData.scan(roots, { depth: dir ? 5 : 4 }), { lookedIn: roots }); }
  /** One folder for the folder picker: its sub-folders, what each one is, and shortcuts to the usual places. */
  browse(dir) {
    const home = os.homedir(), places = [['Downloads', path.join(home, 'Downloads')], ['Desktop', path.join(home, 'Desktop')], ['Documents', path.join(home, 'Documents')], ['Home', home], ['Creator Studio folder', ROOT]];
    if (process.platform === 'win32') { for (const c of 'CDEFGHIJKLMNOPQRSTUVWXYZ') { const d = c + ':\\'; try { if (fs.existsSync(d)) places.push([c + ': drive', d]); } catch { /* not there */ } } }
    else places.push(['Whole computer', '/']);
    let here = path.resolve(dir ? String(dir).trim().replace(/^"|"$/g, '') : path.join(home, 'Downloads'));
    if (!fs.existsSync(here)) here = home;
    let names = [], error = null; try { names = fs.readdirSync(here, { withFileTypes: true }); } catch (e) { error = `This folder cannot be opened (${e.code || e.message}).`; }
    const folders = names.filter((e) => e.isDirectory() && !e.name.startsWith('$') && !e.name.startsWith('.')).map((e) => e.name).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
    const up = path.dirname(here);
    return { dir: here, parent: up !== here ? up : null, is: ServerData.kindOf(here), error, more: Math.max(0, folders.length - 400),
      folders: folders.slice(0, 400).map((name) => ({ name, path: path.join(here, name), is: ServerData.kindOf(path.join(here, name)) })),
      inside: ServerData.kindOf(here) ? null : { rs3: ServerData.findCaches(here, ServerData.isRs3Cache), osrs: ServerData.findCaches(here, ServerData.isOsrsCache) },
      places: places.filter((q) => fs.existsSync(q[1])).map(([name, q]) => ({ name, path: q })) };
  }
  /** The RS3 cache check for the cache in use, or for any folder (see Rs3.check). */
  rs3Check(dir) {
    const d = dir ? path.resolve(String(dir)) : this.rs3Dir;
    if (!ServerData.isRs3Cache(d)) { const inside = ServerData.findCaches(d, ServerData.isRs3Cache); return { folder: d, verdict: 'no', summary: inside.length ? `This folder is not a cache itself, but there ${inside.length === 1 ? 'is one' : 'are ' + inside.length} inside it.` : 'This is not an RS3 cache in flat-file layout: it should hold numbered folders (19, 47, 53, 255 ...) full of .dat files.', problems: [], inside }; }
    return (dir && d !== this.rs3Dir ? new Rs3(d, null) : this.rs3).check();
  }
  /**
   * Checks the folders given and saves them to config.json. change: { serverDir, osrsCache, rs3Cache, port, standalone };
   * a key left out is kept, an empty string clears it. Returns { ok, problems, config } and writes only when ok.
   */
  setup(change) {
    const next = Object.assign({}, this.config), problems = [], abs = (p) => path.resolve(ROOT, p);
    for (const k of ['serverDir', 'osrsCache', 'rs3Cache']) if (change[k] !== undefined) { if (change[k] === '' || change[k] === null) delete next[k]; else next[k] = String(change[k]).trim().replace(/^"|"$/g, ''); }
    if (change.port !== undefined && change.port !== '') { const n = +change.port; if (!Number.isInteger(n) || n < 1024 || n > 65535) problems.push('The port must be a whole number from 1024 to 65535.'); else next.port = n; }
    if (change.standalone !== undefined) { if (change.standalone) { next.standalone = true; delete next.serverDir; if (!next.osrsCache && this.server.hasCache()) next.osrsCache = this.server.cacheDir(); } else delete next.standalone; }   // going standalone keeps the cache already in use
    if (next.serverDir) {
      // people often point at the folder above: accept <folder>/server and <folder>/Server/server too
      const tries = [next.serverDir, path.join(next.serverDir, 'server'), path.join(next.serverDir, 'Server', 'server')], hit = tries.find((t) => ServerData.looksLikeServer(abs(t)));
      if (hit) { next.serverDir = hit; delete next.standalone; } else problems.push(`"${abs(next.serverDir)}" is not a game server folder the Studio knows: it should contain data/definitions. Leave it empty to use the Studio without a server.`);
    }
    if (next.osrsCache && !ServerData.isOsrsCache(abs(next.osrsCache))) { const found = ServerData.findCaches(abs(next.osrsCache), ServerData.isOsrsCache); if (found.length) next.osrsCache = found[0]; }
    if (next.osrsCache && !ServerData.isOsrsCache(abs(next.osrsCache))) problems.push(`"${abs(next.osrsCache)}" is not an OSRS cache: it should contain main_file_cache.dat2 and main_file_cache.idx255.`);
    if (next.rs3Cache && !ServerData.isRs3Cache(abs(next.rs3Cache))) {
      const inner = path.join(next.rs3Cache, 'cache');
      const found = ServerData.findCaches(abs(next.rs3Cache), ServerData.isRs3Cache);
      if (ServerData.isRs3Cache(abs(inner))) next.rs3Cache = inner; else if (found.length) next.rs3Cache = found[0]; else problems.push(`"${abs(next.rs3Cache)}" is not an RS3 flat-file cache: it should contain numbered folders including 19, 47, 53 and 255.`);
    }
    if (!next.serverDir && !next.osrsCache && !SERVER_GUESSES.some((g) => ServerData.looksLikeServer(abs(g))) && !OSRS_GUESSES.some((g) => ServerData.findCaches(abs(g), ServerData.isOsrsCache).length)) problems.push('Give a game server folder, or an OSRS cache folder to use the Studio without a server.');
    if (next.standalone && !next.osrsCache && !OSRS_GUESSES.some((g) => ServerData.findCaches(abs(g), ServerData.isOsrsCache).length)) problems.push('To use the Studio without a game server it needs an OSRS cache. Choose an OSRS cache folder first (a folder with main_file_cache.dat2), or put one in the osrs-cache folder next to the app.');
    if (problems.length) return { ok: false, problems, config: this.config };
    const keep = {}; for (const k of ['serverDir', 'osrsCache', 'rs3Cache', 'standalone', 'port']) if (next[k] !== undefined) keep[k] = next[k];
    fs.writeFileSync(this.configFile, JSON.stringify(keep, null, 2) + '\n');
    return { ok: true, problems: [], config: keep };
  }
  // ---- drafts ----
  draftFile(slug) { return path.join(this.draftsDir, slugify(slug) + '.json'); }
  listDrafts() {
    return fs.readdirSync(this.draftsDir).filter((f) => f.endsWith('.json')).map((f) => { try { const d = JSON.parse(fs.readFileSync(path.join(this.draftsDir, f), 'utf8')); return { slug: d.slug, name: d.name, kind: d.kind, id: d.id, updated: d.updated, ported: d.ported ? d.ported.id : null, source: d.source }; } catch { return null; } }).filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
  }
  loadDraft(slug) { const f = this.draftFile(slug); if (!fs.existsSync(f)) throw new Error(`No draft called "${slug}"`); return JSON.parse(fs.readFileSync(f, 'utf8')); }
  saveDraft(draft) {
    if (!draft.slug) { let base = slugify(draft.name), slug = base, n = 2; while (fs.existsSync(this.draftFile(slug))) slug = base + '-' + n++; draft.slug = slug; }
    draft.updated = new Date().toISOString();
    fs.writeFileSync(this.draftFile(draft.slug), JSON.stringify(draft, null, 2));
    return draft;
  }
  /** Drafts are the studio's own files, so removing one just moves it to workspace/trash. */
  removeDraft(slug) { const f = this.draftFile(slug), t = path.join(this.workspace, 'trash'); fs.mkdirSync(t, { recursive: true }); fs.renameSync(f, path.join(t, `${slugify(slug)}-${Date.now()}.json`)); return { ok: true }; }

  // ---- starting points ----
  /** New item draft from an RS3 item. type: weapon | armour | cape | other (worked out from the RS3 slot when left out). */
  draftFromRs3Item(rs3Id, opt) {
    opt = opt || {};
    const it = this.rs3.item(rs3Id); if (!it || !it.name) throw new Error(`RS3 item ${rs3Id} not found`);
    const slot = it.slot, type = opt.type || (slot === 3 || slot === 5 ? 'weapon' : slot === 1 ? 'cape' : [0, 4, 7, 9, 10].includes(slot) ? 'armour' : 'other');
    const mode = type === 'armour' ? 'armour' : type === 'cape' ? 'cape' : 'weapon';
    const models = { ground: { source: { type: 'rs3', model: it.model }, mode: 'ground', maxTris: 1000, tint: type !== 'weapon' } };
    const worn = (id) => id >= 0 ? { source: { type: 'rs3', model: id }, mode, maxTris: type === 'armour' && slot === 0 ? 700 : 1400, tint: type !== 'weapon' } : null;
    if (it.male >= 0 || it.female >= 0) { models.male = worn(it.male >= 0 ? it.male : it.female); models.female = worn(it.female >= 0 ? it.female : it.male); }
    for (const k of ['male1', 'female1', 'male2', 'female2']) models[k] = null;
    const wearAction = type === 'weapon' ? 'Wield' : 'Wear';
    return { kind: 'item', name: opt.name || it.name, id: null, source: { type: 'rs3', id: rs3Id, name: it.name },
      item: { type, baseItemId: opt.base !== undefined ? opt.base : -1, aliasBase: true, examine: opt.examine || '', inventoryActions: models.male ? [wearAction, null, null, null, 'Drop'] : [null, null, null, null, 'Drop'],
        isTradable: true, itemDef: {}, rs3Recolor: it.recolor, rs3Retexture: it.retexture, icon: { xan2d: it.xan2d, yan2d: it.yan2d, zan2d: it.zan2d, auto: true }, models, particles: type === 'cape' ? 'rs3' : undefined } };
  }
  /** "Make a custom version" of an item already in the game: a cache item or one of the server's custom items. */
  draftFromGameItem(id, opt) {
    opt = opt || {};
    const custom = this.server.item(id), slots = {};
    if (custom) {
      const o = custom.objType || {};
      for (const [slot, field] of Object.entries(SLOT_FIELDS)) {
        const v = o[field];
        if (Number.isInteger(v) && v >= 1000000 && custom.models && custom.models[v]) slots[slot] = { source: { type: 'custom', file: custom.models[v] }, mode: slot === 'ground' ? 'ground' : 'asis' };
        else if (Number.isInteger(v) && v >= 0) slots[slot] = { source: { type: 'osrs', model: v }, mode: slot === 'ground' ? 'ground' : 'asis' };
        else if (v === -1) slots[slot] = null;
      }
      const d = { kind: 'item', name: opt.name || o.name, id: null, source: { type: 'custom', id, name: o.name },
        item: { type: 'other', baseItemId: custom.baseItemId !== undefined ? custom.baseItemId : -1, aliasBase: custom.aliasBase !== false, examine: o.examine || '', inventoryActions: o.inventoryActions, isTradable: o.isTradable !== false,
          itemDef: Object.assign({}, custom.itemDef), specialAttack: custom.specialAttack, recolor: (o.recolorFrom || []).map((f, i) => [f, o.recolorTo[i]]),
          icon: { zoom2d: o.zoom2d, xan2d: o.xan2d, yan2d: o.yan2d, zan2d: o.zan2d, offsetX2d: o.offsetX2d, offsetY2d: o.offsetY2d, auto: false }, models: slots } };
      if (opt.replace) d.item.replaceId = id;
      else { const fx = this.server.readJson(this.server.files.particles, {}); if (fx.items && fx.items[String(id)]) d.item.particles = { copyFrom: id }; }
      return d;
    }
    const def = this.osrs.item(id); if (!def || def.error) throw new Error(`Item ${id} is not in the game`);
    for (const [slot, field] of Object.entries(SLOT_FIELDS)) slots[slot] = def[field] >= 0 ? { source: { type: 'osrs', model: def[field] }, mode: slot === 'ground' ? 'ground' : 'asis' } : null;
    return { kind: 'item', name: opt.name || def.name, id: null, source: { type: 'osrs', id, name: def.name },
      item: { type: 'other', baseItemId: id, aliasBase: true, examine: def.examine || '', inventoryActions: def.inventoryActions, isTradable: def.tradable, itemDef: {},
        recolor: def.recolorFrom.map((f, i) => [f, def.recolorTo[i]]), icon: { zoom2d: def.zoom2d, xan2d: def.xan2d, yan2d: def.yan2d, zan2d: def.zan2d, offsetX2d: def.offsetX2d, offsetY2d: def.offsetY2d, auto: false }, models: slots } };
  }
  /** New NPC draft cloned from a game NPC. */
  draftFromNpc(id, opt) {
    opt = opt || {};
    const def = this.osrs.npc(id); if (!def || def.error) throw new Error(`NPC ${id} is not in the game`);
    return { kind: 'npc', name: opt.name || def.name, id: null, source: { type: 'osrs', id, name: def.name },
      npc: { baseNpcId: id, fields: {}, models: null, combat: {}, spawns: [] } };
  }
  // ---- anything in the game, including what the server adds on top of the cache ----
  /** NPCs the server adds: definition bundles (bosses) and the cache-editor overlay rows. id -> definition. */
  extraNpcs() {
    if (this._extraNpcs) return this._extraNpcs;
    const { decodeNpc } = require('./osrs'), m = new Map();
    for (const b of this.server.bundles()) for (const d of b.definitions) {
      if (d.kind !== 'npc') continue;
      try { const def = decodeNpc(d.id, Buffer.from(d.dataBase64, 'base64')); def.from = { type: 'bundle', file: b.file, symbol: d.symbol }; m.set(d.id, def); } catch { /* a bundle row this tool cannot read */ }
    }
    const map = { idleSeqId: 'idleSeq', walkSeqId: 'walkSeq', runSeqId: 'runSeq', modelIds: 'models', hitpoints: 'hitpoints' };
    for (const r of this.server.definitions().rows) {
      if (r.kind !== 'npc') continue;
      const base = r.baseId !== null && r.baseId !== undefined ? this.osrs.npc(r.baseId) : null, def = Object.assign({}, base || { models: [], recolorFrom: [], recolorTo: [], actions: [], size: 1, widthScale: 128, heightScale: 128, idleSeq: -1, walkSeq: -1 }, { id: r.id });
      for (const [k, v] of Object.entries(r.fields || {})) def[map[k] || k] = v;
      def.from = { type: 'overlay', base: r.baseId }; m.set(r.id, def);
    }
    return (this._extraNpcs = m);
  }
  /** Any NPC by id: the cache's, a boss bundle's, or a custom one. */
  npcDef(id) { return this.extraNpcs().get(id) || this.osrs.npc(id); }
  /** Any model by id: the cache's, or one of the server's own files (custom-models.json, ids from 1,000,000). */
  meshFor(id) {
    if (id >= 1000000) { const rel = this.server.customModels()[String(id)]; if (!rel) return null; return Model.decode(fs.readFileSync(this.server.modelFile(rel))); }
    return this.osrs.mesh(id);
  }
  /**
   * The animations that belong to an NPC: its stand / walk / run, its combat ones, their numbered neighbours and the
   * server's custom animations, kept only if they are made for the same skeleton (frame base) as its stand animation.
   */
  npcAnimations(def) {
    const combat = ((this.server.readJson(this.server.files.combat, {}).npcs || {})[String(def.id)] || {}).anims || {};
    const known = [def.idleSeq, def.walkSeq, def.runSeq, combat.attack, combat.block, combat.death].filter((v) => Number.isInteger(v) && v >= 0);
    const first = this.osrs.animation(known[0]); if (!first) return { base: -1, seqs: known };
    const cand = new Set(known), cacheIds = known.filter((v) => !this.osrs.customSeq(v));
    if (cacheIds.length) for (let i = Math.min(...cacheIds) - 14; i <= Math.max(...cacheIds) + 14; i++) if (i >= 0) cand.add(i);
    for (const id of this.osrs.customSeqIds()) cand.add(id);
    const so = (id) => this.osrs.skeletonOf(id);
    const seqs = [...cand].sort((a, b) => a - b).filter((id) => { const a = this.osrs.animation(id); return a && a.frames.length && so(a.baseId) === so(first.baseId); });
    return { base: first.baseId, seqs };
  }
  /**
   * An NPC exactly as the game client builds it (it joins vertices on one spot and drops unused ones), measured through
   * all of its animations. With repair = true it also works out the client-safe repair of its custom model files.
   */
  gameReport(id, repair) {
    const CS = require('./clientsafe'), S = require('./stretch'), st = this, hex = (c) => '#' + (Model.hslToRgb(c) | 0x1000000).toString(16).slice(1);
    const def = st.npcDef(id); if (!def) throw new Error(`NPC ${id} is not in the game (cache, boss bundles or custom NPCs)`);
    const anims = st.npcAnimations(def), rig = new S.Rig(st.osrs, anims.seqs, { anyBase: true });
    const files = st.server.customModels(), parts = def.models.map((mid) => ({ id: mid, file: mid >= 1000000 ? files[String(mid)] : null, mesh: st.meshFor(mid) })).filter((p) => p.mesh);
    if (!parts.length) throw new Error('this NPC has no models this tool can read');
    const describe = (meshes) => { const built = Model.merge(meshes.map((m) => Model.clone(m))), r = S.measureModel(built, rig.frames); let big = 0; for (const g of r.growth) if (g > 6) big++;
      return { worstStretch: r.worst + 'x', typical95: r.p95 + 'x', facesGrowingOver6Units: big, largestGrowthUnits: r.maxGrowth, pivotsWithNoVertices: r.originFallbacks,
        worstFaces: r.worstFaces.slice(0, 8).map((w) => ({ face: w.face, grows: w.grows, stretch: w.stretch + 'x', colour: w.colour, web: hex(w.colour), boneLabels: w.labels, at: w.at, points: w.points })) }; };
    const rep = { npc: def.name, id, animations: anims.seqs, frames: rig.frames.length, skeleton: anims.base,
      models: parts.map((p) => { const c = p.mesh.vskin ? CS.check(p.mesh) : { unused: [], clashes: [] }; return { id: p.id, file: p.file || 'cache', vertices: p.mesh.nv, faces: p.mesh.nf, unusedVerticesTheGameDrops: c.unused.length,
        verticesTheGameJoinsAcrossParts: c.clashes.length, examples: c.clashes.slice(0, 6).map((x) => ({ position: x.position, label: x.label, wouldFollowLabel: x.becomes })) }; }),
      inGameNow: rig.frames.length ? describe(parts.map((p) => p.mesh)) : 'no classic animations found for this NPC (skeletal ones are not measured)', repairs: [] };
    if (!repair) return rep;
    rep._files = [];
    const fixed = parts.map((p) => {
      if (!p.file || !p.mesh.vskin) return p.mesh;
      const r = CS.fix(p.mesh, { pivotGroups: rig.info.pivotGroups });
      if (!r.steps.length) return p.mesh;
      rep.repairs.push({ model: p.id, file: p.file, steps: r.steps, pivotsOffBefore: r.pivotsBefore, pivotsOffAfter: r.pivotsAfter, vertices: r.mesh.nv, faces: r.mesh.nf });
      rep._files.push({ rel: p.file, bytes: Buffer.from(Model.encode(r.mesh)), modelId: p.id });
      return r.mesh;
    });
    if (rep.repairs.length && rig.frames.length) rep.inGameAfterRepair = describe(fixed);
    return rep;
  }
  // ---- build / port ----
  get anim() { return this._anim || (this._anim = new (require('./animedit').AnimKit)(this)); }
  /**
   * New animation draft. opt: { for: 'player' | 'npc:<id>', from: an animation id to start from (its frames become
   * keys), template: cache animation whose settings are copied, loop }
   */
  draftAnim(name, opt) {
    opt = opt || {};
    const target = opt.for || 'player', tg = this.anim.target(target);
    let keys = [], template = opt.template;
    if (opt.from !== undefined && opt.from !== null) {
      const src = this.anim.keysFrom(tg, +opt.from); keys = src.keys;
      const a = this.osrs.customSeq(+opt.from); if (template === undefined) template = a ? a.template : +opt.from;
    }
    if (template === undefined) template = tg.npc ? (this.osrs.customSeq(tg.npc.idleSeq) || {}).template || tg.npc.idleSeq : (opt.loop ? 808 : 863);
    return { kind: 'anim', name, id: null, source: opt.from !== undefined ? { type: 'anim', id: +opt.from } : { type: 'new' }, anim: { for: target, template, fine: 16, step: 2, ease: 'smooth', loop: !!opt.loop, endHold: 2, keys } };
  }
  build(draft) { return draft.kind === 'anim' ? this.anim.build(draft) : draft.kind === 'npc' ? this.buildNpc(draft) : this.builder.buildItem(draft); }
  buildNpc(draft) {
    const npc = draft.npc, base = npc.baseNpcId !== null && npc.baseNpcId !== undefined ? this.osrs.npc(npc.baseNpcId) : null, problems = [], warnings = [], models = [];
    const fields = Object.assign({}, npc.fields, { name: draft.name });
    if (npc.models) {
      fields.modelIds = [];
      npc.models.forEach((spec, index) => {
        try {
          let out;
          if (spec.source.type === 'rs3') { const { convert } = require('./convert'); const c = convert(this.rs3, spec.source.model, { maxTris: spec.maxTris || 3000, tint: !!spec.tint, rawLabels: !!spec.rawLabels }); this.builder.applyEdits(c.mesh, spec.edits); out = { mesh: c.mesh, bytes: Buffer.from(Model.encode(c.mesh)), cacheModel: null }; }
          else { const l = this.builder.loadSource(spec.source), changed = this.builder.applyEdits(l.mesh, spec.edits); out = { mesh: l.mesh, cacheModel: !changed && spec.source.type === 'osrs' ? spec.source.model : null, bytes: !changed && l.bytes ? l.bytes : null }; if (out.cacheModel === null && !out.bytes) out.bytes = Buffer.from(Model.encode(this.builder.bake(l.mesh))); }
          out.index = index; models.push(out); fields.modelIds.push(out.cacheModel !== null ? out.cacheModel : '@model' + index);
        } catch (e) { problems.push(`model ${index + 1}: ${e.message}`); }
      });
    }
    if (!draft.name || !draft.name.trim()) problems.push('the NPC needs a name');
    if (!base && !fields.modelIds) problems.push('an NPC with no base needs at least one model');
    const row = { kind: 'npc', id: '@id', baseId: base ? base.id : null, fields };
    const combat = {}; const c = npc.combat || {};
    if (c.anims && Object.values(c.anims).some((v) => Number.isInteger(v))) combat.anims = Object.fromEntries(Object.entries(c.anims).filter(([, v]) => Number.isInteger(v)));
    for (const k of ['respawn', 'deathTicks', 'huntRange', 'maxHit', 'projectile']) if (Number.isInteger(c[k])) combat[k] = c[k];
    if (c.attackType) combat.attackType = c.attackType;
    if (!combat.anims && Object.keys(combat).length) warnings.push('combat values without attack/block/death animations: the server will guess the animations from the base NPC');
    return { kind: 'npc', row, models, combat, spawns: npc.spawns || [], problems, warnings, base };
  }
  /** Dry run unless write is true. */
  port(draft, opt) {
    if (draft.kind === 'anim') { const res = this.porter.portAnim(draft, this.build(draft), opt); if (res.written) { draft.id = res.id; draft.ported = { id: res.id, when: res.manifest }; this.saveDraft(draft); this._osrs = null; } return res; }
    const build = this.build(draft), res = this.porter.port(draft, build, opt);
    if (res.written) { draft.id = res.id; draft.ported = { id: res.id, when: res.manifest, models: res.files.map((f) => f.modelId) }; this.saveDraft(draft); }
    return res;
  }
}
module.exports = { Studio, ROOT };
