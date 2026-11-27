'use strict';
// Everything the studio knows about the game server's files. Reading is free; the only code that writes into the
// server folder is lib/port.js, and only when a port is asked for.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ITEM_ID_START = 50000, MODEL_ID_START = 1100000, NPC_ID_START = 60000, NPC_ID_END = 65534, PACKET_LIMIT = 0xffff;
const EQUIPMENT_TYPES = ['NONE', 'WEAPON', 'SHIELD', 'HAT', 'MASK', 'COIF', 'MED_HELMET', 'FULL_HELMET', 'BODY', 'PLATEBODY', 'LEGS', 'GLOVES', 'BOOTS', 'CAPE', 'HOODED_CAPE', 'AMULET', 'RING', 'ARROWS'];
const BONUS_NAMES = ['Stab attack', 'Slash attack', 'Crush attack', 'Magic attack', 'Ranged attack', 'Stab defence', 'Slash defence', 'Crush defence', 'Magic defence', 'Ranged defence', 'Melee strength', 'Ranged strength', 'Magic damage %', 'Prayer'];
const SKILL_NAMES = ['Attack', 'Defence', 'Strength', 'Hitpoints', 'Ranged', 'Prayer', 'Magic', 'Cooking', 'Woodcutting', 'Fletching', 'Fishing', 'Firemaking', 'Crafting', 'Smithing', 'Mining', 'Herblore', 'Agility', 'Thieving', 'Slayer', 'Farming', 'Runecrafting', 'Hunter', 'Construction'];

class ServerData {
  /** dir: the game server folder. opt.osrsCache: use this OSRS cache instead of the server's own. opt.standalone: dir is the Studio's export folder, not a running server. */
  constructor(dir, opt) {
    opt = opt || {};
    this.dir = dir; this.osrsCache = opt.osrsCache || null; this.standalone = !!opt.standalone;
    const d = (...p) => path.join(dir, ...p);
    this.files = { items: d('data', 'definitions', 'custom-items.json'), customModels: d('data', 'definitions', 'custom-models.json'),
      definitions: d('data', 'definitions', 'custom-definitions.json'), combat: d('data', 'definitions', 'npc-combat-defs.json'),
      particles: d('data', 'definitions', 'custom-particles.json'), spawns: d('data', 'definitions', 'npc-spawns.json'),
      seqs: d('data', 'definitions', 'custom-seqs.json'), spotanims: d('data', 'definitions', 'custom-spotanims.json'), objectSpawns: d('data', 'definitions', 'object-spawns.json'),
      restart: d('data', 'restart-trigger.json'), log: d('logs', 'server.log') };
    this.modelsDir = d('data', 'models'); this.backupsDir = d('backups'); this.toDeleteDir = this.standalone ? path.join(dir, '_to_delete') : path.join(dir, '..', '_to_delete');
  }
  exists() { return fs.existsSync(this.files.items); }
  /** A folder is treated as a game server of the supported kind when it has data/definitions. */
  static looksLikeServer(dir) { try { return fs.statSync(path.join(dir, 'data', 'definitions')).isDirectory() && !fs.existsSync(path.join(dir, ServerData.EXPORT_MARK)); } catch { return false; } }
  static isOsrsCache(dir) { return fs.existsSync(path.join(dir, 'main_file_cache.dat2')) && fs.existsSync(path.join(dir, 'main_file_cache.idx255')); }
  /** An OpenRS2 "flat file" RS3 cache: one folder per index, one file per group. */
  static isRs3Cache(dir) { return fs.existsSync(path.join(dir, '255')) && fs.existsSync(path.join(dir, '47')) && fs.existsSync(path.join(dir, '19')); }
  /**
   * Caches dropped into a folder: the folder itself if it is one, else any folder up to two levels inside it
   * (so "rs3-cache/950/cache/..." is found as well as "rs3-cache/47/...").
   */
  static findCaches(dir, test) {
    const out = [], look = (d, depth) => { if (test(d)) { out.push(d); return; } if (depth >= 2) return; let names = []; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of names) if (e.isDirectory() && !ServerData.isIndexName(e.name)) look(path.join(d, e.name), depth + 1); };
    look(dir, 0); return out.sort();
  }
  /** Folder names 0..255 are a cache's own index folders, never a place to look for another cache. (A build number such as 950 is fine.) */
  static isIndexName(name) { return /^\d+$/.test(name) && +name <= 255; }
  /**
   * A wider look under several folders, for the "find it for me" button: every RS3 cache, OSRS cache and game server
   * it can reach. Bounded by depth, folder count and time, never follows links, and skips system folders.
   * Returns { rs3: [], osrs: [], servers: [], complete } where complete is false if a limit stopped it early.
   */
  static scan(roots, opt) {
    opt = opt || {};
    const maxDepth = opt.depth || 4, until = Date.now() + (opt.ms || 5000), out = { rs3: [], osrs: [], servers: [], complete: true }, seen = new Set();
    const SKIP = /^(node_modules|appdata|application data|windows|program files.*|programdata|system volume information|library|temp|tmp)$/i;
    let left = opt.dirs || 8000;
    const look = (d, depth) => {
      if (seen.has(d)) return; seen.add(d);
      if (left-- <= 0 || Date.now() > until) { out.complete = false; return; }
      if (ServerData.isRs3Cache(d)) { out.rs3.push(d); return; }
      if (ServerData.isOsrsCache(d)) { out.osrs.push(d); return; }
      if (ServerData.looksLikeServer(d)) { out.servers.push(d); look(path.join(d, 'caches'), depth); return; }   // a server's own caches, nothing else in it
      if (depth >= maxDepth) return;
      let names = []; try { names = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
      for (const e of names) if (e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$') && !SKIP.test(e.name) && !ServerData.isIndexName(e.name)) look(path.join(d, e.name), depth + 1);
    };
    for (const r of roots) look(path.resolve(r), 0);
    for (const k of ['rs3', 'osrs', 'servers']) out[k].sort();
    return out;
  }
  /** What a folder is, as far as the Studio can tell: 'rs3' | 'osrs' | 'server' | null. */
  static kindOf(dir) { return ServerData.isRs3Cache(dir) ? 'rs3' : ServerData.isOsrsCache(dir) ? 'osrs' : ServerData.looksLikeServer(dir) ? 'server' : null; }
  /** The OSRS cache to read: the one set in config, else the server's target.txt, else the newest under caches/. */
  cacheDir() {
    if (this.osrsCache) return this.osrsCache;
    try { const p = path.join(this.dir, 'caches', fs.readFileSync(path.join(this.dir, 'target.txt'), 'utf8').trim()); if (ServerData.isOsrsCache(p)) return p; } catch { /* no target.txt */ }
    let best = null;
    try { for (const n of fs.readdirSync(path.join(this.dir, 'caches'))) { const p = path.join(this.dir, 'caches', n); if (ServerData.isOsrsCache(p)) { const t = fs.statSync(p).mtimeMs; if (!best || t > best.t) best = { p, t }; } } } catch { /* no caches folder */ }
    if (best) return best.p;
    throw new Error('No OSRS cache found. Run "node cli.js setup --osrs-cache <folder with main_file_cache.dat2>" or use the Game folder button in the app.');
  }
  hasCache() { try { return ServerData.isOsrsCache(this.cacheDir()); } catch { return false; } }
  /**
   * What this server can actually load, so a port never promises more than the game will show. Known file names are
   * checked first; anything not found that way is looked for in the plugins' own code (a bounded read, done once).
   */
  capabilities() {
    if (this._caps) return this._caps;
    if (this.standalone) return (this._caps = { standalone: true, items: false, npcs: false, animations: false, particles: false, autoRestart: false, log: false });
    const has = (...q) => fs.existsSync(path.join(this.dir, ...q)), read = (...q) => { try { return fs.readFileSync(path.join(this.dir, ...q), 'utf8'); } catch { return ''; } };
    const caps = { standalone: false, items: has('plugins', 'items', 'ItemDefinitionLoader.plugin.js'), npcs: has('plugins', 'tools', 'cache-editor'),
      animations: read('plugins', 'bosses', 'NexAod.plugin.js').includes('customSeqs'), particles: has('plugins', 'items', 'RS3CapeParticles.plugin.js'),
      autoRestart: has('nodemon.json'), log: fs.existsSync(this.files.log) };
    const want = { items: 'custom-items.json', npcs: 'custom-definitions.json', animations: 'customSeqs', particles: 'customParticles' };
    const missing = Object.keys(want).filter((k) => !caps[k]);
    if (missing.length) {
      const files = [], root = path.join(this.dir, 'plugins');
      const walk = (dir, depth) => { let names = []; try { names = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; } for (const e of names) { if (files.length >= 4000) return; const q = path.join(dir, e.name); if (e.isDirectory()) { if (depth < 3 && e.name !== 'node_modules' && e.name !== 'data') walk(q, depth + 1); } else if (/\.(js|ts)$/.test(e.name)) files.push(q); } };
      walk(root, 0);
      for (const f of files) { if (!missing.some((k) => !caps[k])) break; let text = ''; try { if (fs.statSync(f).size < 400000) text = fs.readFileSync(f, 'utf8'); } catch { continue; } for (const k of missing) if (!caps[k] && text.includes(want[k])) caps[k] = true; }
    }
    return (this._caps = caps);
  }
  readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { if (fallback !== undefined) return fallback; throw new Error(`Could not read ${path.basename(file)}: ${e.message}`); } }
  items() { const j = this.readJson(this.files.items, []); return Array.isArray(j) ? j : Object.values(j); }
  customModels() { return this.readJson(this.files.customModels, {}); }
  definitions() { const j = this.readJson(this.files.definitions, { version: 1, rows: [] }); if (!Array.isArray(j.rows)) j.rows = []; return j; }
  item(id) { return this.items().find((r) => r.id === id) || null; }
  /**
   * "Definition archive" bundles: whole NPC / object / item definitions added after the cache's own (the bosses:
   * Angel of Death, Vorago, ...). Every data/definitions/*.json shaped { id, definitions:[{ kind, id, symbol, dataBase64 }] }.
   */
  bundles() {
    const dir = path.join(this.dir, 'data', 'definitions'), out = [];
    let names = []; try { names = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return out; }
    for (const name of names) {
      let st; try { st = fs.statSync(path.join(dir, name)); } catch { continue; }
      if (st.size > 400000) continue;                                  // bundles are small; skip the big data files
      const j = this.readJson(path.join(dir, name), null);
      if (j && !Array.isArray(j) && Array.isArray(j.definitions) && j.definitions.every((d) => d && typeof d.dataBase64 === 'string')) out.push({ file: name, id: j.id, definitions: j.definitions });
    }
    return out;
  }
  modelFile(rel) { return path.join(this.modelsDir, rel); }
  /** Every custom model id in use, with the file it points at. */
  modelIndex() {
    const m = new Map();
    for (const r of this.items()) for (const [id, file] of Object.entries(r.models || {})) m.set(+id, { file, owner: 'item ' + r.id });
    for (const [id, file] of Object.entries(this.customModels())) m.set(+id, { file, owner: 'custom-models.json' });
    return m;
  }
  takenItemIds() { const s = new Set(this.items().map((r) => r.id)); for (const r of this.definitions().rows) if (r.kind === 'item') s.add(r.id); return s; }
  takenNpcIds() { const s = new Set(); for (const r of this.definitions().rows) if (r.kind === 'npc') s.add(r.id); return s; }
  nextItemId(reserved) { const t = this.takenItemIds(); let id = Math.max(ITEM_ID_START - 1, ...t) + 1; while (t.has(id) || (reserved && reserved.has(id))) id++; return id; }
  nextNpcId(reserved) { const t = this.takenNpcIds(); let id = NPC_ID_START; while (t.has(id) || (reserved && reserved.has(id))) id++; if (id > NPC_ID_END) throw new Error('No free NPC id left below 65535'); return id; }
  nextModelIds(n, reserved) {
    const t = new Set(this.modelIndex().keys()); if (reserved) for (const r of reserved) t.add(r);
    let id = Math.max(MODEL_ID_START, ...[...t].filter((v) => v >= MODEL_ID_START && v < 1200000)) + 1; const out = [];
    while (out.length < n) { if (!t.has(id)) { out.push(id); t.add(id); } id++; }
    return out;
  }
  /** Size of one content packet as the server sends it (3-byte packet header + 5-byte compression header + deflate). */
  static packetSize(key, rows) { return 8 + zlib.deflateSync(Buffer.from(JSON.stringify({ gamemodeId: 'server', datasets: [{ key, rows }] }))).length; }
  budgets() {
    return { customItems: { used: ServerData.packetSize('customItems', this.items()), limit: PACKET_LIMIT },
      customDefinitions: { used: ServerData.packetSize('customDefinitions', this.definitions().rows), limit: PACKET_LIMIT - 8 } };
  }
  /** Lines of server.log from the last `bytes` of the file. */
  logTail(bytes) {
    try { const st = fs.statSync(this.files.log), n = Math.min(st.size, bytes || 400000), fd = fs.openSync(this.files.log, 'r'), buf = Buffer.alloc(n); fs.readSync(fd, buf, 0, n, st.size - n); fs.closeSync(fd); return buf.toString('utf8').split(/\r?\n/); }
    catch { return []; }
  }
  /** What the log says since `since` (ms): did the server restart, did the custom loaders come up, any errors. */
  restartStatus(since) {
    if (this.standalone) return { standalone: true, note: 'Standalone mode: files are written to the export folder, there is no server to restart.' };
    if (!fs.existsSync(this.files.log)) return { restarted: null, note: `No server log at ${this.files.log}, so the Studio cannot tell whether the server restarted. Check it yourself.` };
    const lines = this.logTail(600000); let boot = -1;
    if (!lines.some((l) => l.includes('server_bootstrap'))) return { restarted: null, note: 'The server log has no "server_bootstrap" lines, so the Studio cannot tell whether this server restarted. Check it yourself.' };
    const stamp = (l) => { const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)/.exec(l); return m ? Date.parse(m[1]) : NaN; };
    lines.forEach((l, i) => { if (l.includes('server_bootstrap') && stamp(l) >= since) boot = i; });
    if (boot < 0) { const last = lines.filter((l) => l.includes('server_bootstrap')).pop(); return { restarted: false, lastBootstrap: last ? last.slice(0, 24) : null }; }
    const after = lines.slice(boot);
    const errors = after.filter((l) => /\[ERROR\]/.test(l) || /failed to initialize|login hook failed|exceeds short length|overlay document not applied/.test(l)).slice(0, 12);
    return { restarted: true, at: lines[boot].slice(0, 24), listening: after.some((l) => /websocket listening/i.test(l)), errors,
      loaded: after.filter((l) => /\] installed |custom seq\(s\)/.test(l)).map((l) => l.slice(25, 150).trim()).slice(0, 10),
      cacheEditor: (after.find((l) => l.includes('[cache-editor]')) || '').slice(25, 200) };
  }
}
/** A file with this name marks the Studio's own export folder, so it is never mistaken for a game server. */
ServerData.EXPORT_MARK = 'ABOUT THIS FOLDER.txt';
module.exports = { ServerData, ITEM_ID_START, MODEL_ID_START, NPC_ID_START, NPC_ID_END, PACKET_LIMIT, EQUIPMENT_TYPES, BONUS_NAMES, SKILL_NAMES };
