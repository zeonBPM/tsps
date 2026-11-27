// Creator Studio front end. Talks only to this computer's studio server (/api/...).
(function () {
  'use strict';
  const M = window.Model;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const css = (hsl) => '#' + (M.hslToRgb(hsl) | 0x1000000).toString(16).slice(1);
  const api = {
    async get(u) { const r = await fetch(u); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
    async post(u, body) { const r = await fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Studio': '1' }, body: JSON.stringify(body || {}) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.statusText); return j; },
    async bytes(u) { const r = await fetch(u); if (!r.ok) throw new Error('Could not load ' + u); return new Uint8Array(await r.arrayBuffer()); },
  };
  const SLOT_REPLACES = { 4: 2, 7: 5, 9: 4, 10: 6 }, SLOT_TO_PART = { 4: 2, 6: 3, 7: 5, 8: 0, 9: 4, 10: 6, 11: 1 };
  const SLOTS = [['ground', 'Inventory / ground'], ['male', 'Worn, male'], ['female', 'Worn, female']];
  const LIGHT = { player: [64, 850, -30, -50, -30], item: [64, 850, -30, -50, -30] };
  const state = { status: null, tab: 'item', sel: null, info: null, draft: null, build: null, view: 'ground', animId: 808, heat: true, tool: null, brush: 960, swatch: null, undo: [], dirty: false, diag: null, npcSeq: null, animKey: null, animJoint: null, animPlaying: false, animFor: 'player' };
  const cache = { anims: new Map(), kits: new Map(), tex: new Set(), targets: new Map() };
  const DEG = 256 / 360;
  let viewer, saveTimer = null, searchTimer = null;

  // ---------- small helpers ----------
  function toast(text, ms) { const t = $('#toast'); t.textContent = text; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => { t.hidden = true; }, ms || 3200); }
  function modal(title, bodyHtml, actions, wide) {
    $('#modal-title').textContent = title; $('#modal-body').innerHTML = bodyHtml; $('.modal-card').classList.toggle('wide', !!wide);
    const box = $('#modal-actions'); box.innerHTML = '';
    for (const a of actions) { const b = document.createElement('button'); b.className = 'btn' + (a.primary ? ' primary' : ''); b.textContent = a.label; b.onclick = () => a.run ? a.run(b) : closeModal(); box.appendChild(b); }
    $('#modal').hidden = false; const first = box.querySelector('button'); if (first) first.focus();
  }
  function closeModal() { $('#modal').hidden = true; }
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a === undefined || a === null ? undefined : a[k]), o);
  function setPath(o, p, v) { const ks = p.split('.'); let a = o; for (let i = 0; i < ks.length - 1; i++) { if (a[ks[i]] === undefined || a[ks[i]] === null) a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {}; a = a[ks[i]]; } if (v === undefined) delete a[ks[ks.length - 1]]; else a[ks[ks.length - 1]] = v; }
  async function anim(id) { if (id === null || id === undefined || id < 0) return null; if (!cache.anims.has(id)) { try { cache.anims.set(id, await api.get('/api/anim/' + id)); } catch { cache.anims.set(id, null); } } return cache.anims.get(id); }
  async function kits(female, hidden) { const key = (female ? 'f' : 'm') + [...hidden].sort().join(','); if (!cache.kits.has(key)) { const r = await api.get(`/api/kits?female=${female ? 1 : 0}&hide=${[...hidden].join(',')}`); cache.kits.set(key, r.parts.map((p) => ({ tag: p.tag, bytes: bytes(p.model) }))); } return cache.kits.get(key).map((p) => ({ tag: p.tag, mesh: M.decode(p.bytes) })); }
  function hiddenParts(w) { const h = new Set(); if (!w) return h; if (SLOT_REPLACES[w.wearPos] !== undefined) h.add(SLOT_REPLACES[w.wearPos]); for (const s of [w.wearPos2, w.wearPos3]) if (SLOT_TO_PART[s] !== undefined) h.add(SLOT_TO_PART[s]); return h; }
  async function textures(mesh) { if (!mesh.ftex) return; for (const t of new Set(mesh.ftex)) if (t !== -1 && !cache.tex.has(t)) { cache.tex.add(t); api.get('/api/texture/' + t).then((r) => viewer.setTextureColour(t, r.colour)).catch(() => {}); } }
  async function modelMesh(ref) { if (!ref) return null; const b = ref.type === 'custom' ? await api.bytes('/api/model/custom?file=' + encodeURIComponent(ref.file)) : await api.bytes('/api/model/osrs/' + ref.id); const m = M.decode(b); textures(m); return m; }
  function recolour(mesh, from, to) { (from || []).forEach((f, i) => M.recolor(mesh, f, to[i])); return mesh; }
  function setViews(enabled) { $$('#views button').forEach((b) => { b.disabled = !enabled.includes(b.dataset.view); b.setAttribute('aria-pressed', b.dataset.view === state.view ? 'true' : 'false'); }); }
  function status(text) { $('#statusline').textContent = text || ' '; }
  function show(parts, opt) { $('#empty').hidden = true; viewer.setParts(parts, opt); const m = viewer.mesh; state.sceneInfo = m ? `${m.nf} triangles, ${m.nv} points` : ''; status(state.sceneInfo); }

  // ---------- scenes ----------
  async function wornScene(female, wear, meshes) {
    const parts = await kits(female, hiddenParts(wear));
    for (const m of meshes) if (m) parts.push({ tag: 'item', mesh: m });
    show(parts, { lighting: LIGHT.player, fit: state.keepCamera ? false : true, hideUnderFloor: true });
    viewer.setAnim(await anim(state.animId));
  }
  async function showItem() {
    const info = state.info; if (!info) return;
    const worn = !!(info.models.male || info.models.female);
    if (state.view !== 'ground' && !worn) state.view = 'ground';
    setViews(worn ? ['ground', 'male', 'female'] : ['ground']);
    if (state.view === 'ground') {
      const m = await modelMesh(info.models.ground); if (!m) { viewer.setParts([]); status('This item has no model'); return; }
      show([{ tag: 'item', mesh: recolour(m, info.recolorFrom, info.recolorTo) }], { lighting: LIGHT.item }); viewer.setAnim(null);
    } else {
      const female = state.view === 'female', keys = female ? ['female', 'female1', 'female2'] : ['male', 'male1', 'male2'], off = female ? info.womanwear : info.manwear, meshes = [];
      for (const k of keys) { const m = await modelMesh(info.models[k]); if (m) { recolour(m, info.recolorFrom, info.recolorTo); if (off && (off[0] || off[1] || off[2])) M.transform(m, { translate: off }); meshes.push(m); } }
      await wornScene(female, info, meshes);
      if (state.diag && state.heat) viewer.setHeat('item', state.diag[female ? 'female' : 'male'] && state.diag[female ? 'female' : 'male'].perFace, 1.4);
    }
  }
  async function showNpc(view) {
    const parts = [];
    for (const b of view.models) { const m = b instanceof Uint8Array ? M.decode(b) : await modelMesh({ type: 'osrs', id: b }); if (!m) continue; textures(m); recolour(m, view.recolorFrom, view.recolorTo); parts.push({ tag: 'npc', mesh: m }); }
    if (view.widthScale !== 128 || view.heightScale !== 128) for (const p of parts) M.transform(p.mesh, { scale: [view.widthScale / 128, view.heightScale / 128, view.widthScale / 128] });
    setViews([]); show(parts, { lighting: LIGHT.player, fit: !state.keepCamera });
    viewer.setAnim(await anim(state.npcSeq !== null && state.npcSeq !== undefined ? state.npcSeq : state.npcAnim === 'walk' ? view.walkSeq : view.idleSeq));
  }
  async function showRs3() {
    const it = state.info; const worn = it.male >= 0 || it.female >= 0;
    if (state.view !== 'ground' && !worn) state.view = 'ground';
    setViews(worn ? ['ground', 'male', 'female'] : ['ground']);
    const id = state.view === 'ground' ? it.model : state.view === 'female' ? (it.female >= 0 ? it.female : it.male) : (it.male >= 0 ? it.male : it.female);
    status('Converting the RS3 model...');
    const m = M.decode(await api.bytes(`/api/model/rs3/${id}?maxTris=3000`));
    show([{ tag: 'item', mesh: m }], { lighting: state.view === 'ground' ? LIGHT.item : LIGHT.player }); viewer.setAnim(null);
    status(`${state.sceneInfo} (preview straight from RS3, before any fitting)`);
  }
  /** What an animation is made for: the rest-pose model, the skeleton's groups and the joints that can be posed. */
  async function animTargetFor(spec) { if (!cache.targets.has(spec)) cache.targets.set(spec, await api.get('/api/animtarget?for=' + encodeURIComponent(spec))); return cache.targets.get(spec); }
  /** A pose { group: [x, y, z] } as frame operations (the same rule as lib/animedit.js poseOps). */
  function poseOps(base, pose) {
    const ops = []; let reset = -1, last = -1;
    for (let i = 0; i < base.types.length; i++) {
      const t = base.types[i]; if (t === 0) { reset = i; continue; }
      const v = pose[i]; if (!v || (t !== 1 && t !== 2 && t !== 3)) continue;
      const dv = t === 3 ? 128 : 0; if (v[0] === dv && v[1] === dv && v[2] === dv) continue;
      if (reset > last) { ops.push([0, base.labels[reset], 0, 0, 0]); last = reset; }
      ops.push(t === 2 ? [t, base.labels[i], v[0] * DEG, v[1] * DEG, v[2] * DEG] : [t, base.labels[i], v[0], v[1], v[2]]); last = i;
    }
    return ops;
  }
  function showTarget(tg, keep) { const mesh = M.decode(bytes(tg.model)); setViews([]); show([{ tag: 'anim', mesh }], { lighting: LIGHT.player, fit: !keep, hideUnderFloor: tg.skeleton === 0 }); }
  async function showAnimInfo() {
    const a = state.info, tg = await animTargetFor(state.animFor);
    showTarget(tg);
    if (tg.skeleton !== a.skeleton) { viewer.setAnim(null); status(`This animation is made for another skeleton (${a.skeleton}); ${tg.name} uses ${tg.skeleton}. Pick what to play it on.`); return; }
    viewer.setAnim(await anim(a.id)); status(`${state.sceneInfo}   |   playing animation ${a.id} on ${tg.name}`);
  }
  function animKeyNow() { const an = state.draft.anim; return an.keys.find((k) => k.t === state.animKey) || null; }
  async function showAnimDraft(keep) {
    const b = state.build, d = state.draft; if (!b || !b.target) return;
    showTarget(b.target, keep);
    const key = animKeyNow();
    if (state.animPlaying || !key) viewer.setAnim(b.anim.frames.length ? b.anim : null);
    else viewer.setAnim({ frames: [poseOps(b.target.base, key.pose)], delays: [1000] });
    const joint = b.target.controls.find((c) => c.id === state.animJoint);
    if (joint && !state.animPlaying) { const m = viewer.parts[0].mesh, set = new Set(joint.labels), per = new Float32Array(m.nf); for (let f = 0; f < m.nf; f++) per[f] = set.has(m.vskin[m.fa[f]]) || set.has(m.vskin[m.fb[f]]) || set.has(m.vskin[m.fc[f]]) ? 2 : 1; viewer.setHeat('anim', per, 1.4); } else viewer.setHeat('anim', null);
    status(`${state.sceneInfo}   |   ${state.animPlaying || !key ? `playing: ${b.seconds} seconds, ${b.anim.frames.length} frames` : `pose at ${(key.t * 0.02).toFixed(2)}s${joint ? ' - the part that ' + joint.name + ' moves is tinted' : ''}`}`);
  }
  async function showDraft() {
    const b = state.build, d = state.draft; if (!b) return;
    if (d.kind === 'anim') return showAnimDraft(state.keepCamera);
    if (d.kind === 'npc') { await showNpc(Object.assign({}, b.view, { models: b.view.models.map(bytes) })); return; }
    const has = (s) => !!b.slots[s];
    if (!has(state.view)) state.view = has('ground') ? 'ground' : has('male') ? 'male' : 'female';
    setViews(['ground', 'male', 'female'].filter(has));
    const slot = b.slots[state.view]; if (!slot) { viewer.setParts([]); return; }
    const mesh = M.decode(bytes(slot.model)); textures(mesh);
    recolour(mesh, b.row.objType.recolorFrom, b.row.objType.recolorTo);
    if (state.view === 'ground') { show([{ tag: 'item', mesh }], { lighting: LIGHT.item, fit: !state.keepCamera }); viewer.setAnim(null); }
    else {
      const female = state.view === 'female', extra = [];
      for (const k of female ? ['female1', 'female2'] : ['male1', 'male2']) if (b.slots[k]) extra.push(M.decode(bytes(b.slots[k].model)));
      const wear = Object.assign({}, b.base || {}, ['wearPos', 'wearPos2', 'wearPos3'].reduce((o, k) => { if (d.item[k] !== undefined && d.item[k] !== null) o[k] = d.item[k]; return o; }, {}));
      await wornScene(female, wear, [mesh].concat(extra));
      if (slot.report && state.heat) viewer.setHeat('item', slot.report.perFace, slot.report.after.threshold);
    }
    status(`${state.sceneInfo}${slot.info && slot.info.bytes ? `, ${slot.info.bytes} bytes` : ''}`);
  }
  async function refreshScene(keepCamera) { state.keepCamera = !!keepCamera; try { if (state.draft) await showDraft(); else if (state.sel && state.sel.kind === 'item') await showItem(); else if (state.sel && state.sel.kind === 'rs3') await showRs3(); else if (state.sel && state.sel.kind === 'anim') await showAnimInfo(); else if (state.sel && state.sel.kind === 'npc') await showNpc({ models: state.info.models, recolorFrom: state.info.recolorFrom, recolorTo: state.info.recolorTo, widthScale: state.info.widthScale, heightScale: state.info.heightScale, idleSeq: state.info.idleSeq, walkSeq: state.info.walkSeq }); } catch (e) { status(e.message); } state.keepCamera = false; }

  // ---------- browser (left) ----------
  async function loadTab(tab) {
    if (state.tab !== tab) $('#q').value = '';
    state.tab = tab; $$('#tabs button').forEach((b) => b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false'));
    $('#search-box').hidden = tab === 'drafts' || tab === 'ports';
    $('#q').placeholder = tab === 'rs3' ? 'Search RS3 items, e.g. noxious scythe' : tab === 'npc' ? 'Search NPCs by name or id' : tab === 'anim' ? 'Custom animations, or any animation id' : 'Search items by name or id';
    await runSearch();
  }
  async function runSearch() {
    const list = $('#results'), q = $('#q').value.trim(), tab = state.tab;
    try {
      let rows = [];
      if (tab === 'drafts') { rows = (await api.get('/api/drafts')).drafts.map((d) => ({ key: d.slug, id: d.ported || '', name: d.name, note: d.kind + (d.ported ? ', in game' : ', not ported') })); if (!rows.length) return void (list.innerHTML = '<li class="none">No drafts yet. Open a game item, NPC or RS3 item and start a custom version from there.</li>'); }
      else if (tab === 'ports') { rows = (await api.get('/api/ports')).ports.map((p) => ({ key: p.key, id: p.id, name: p.name, note: p.undone ? 'undone' : p.when.slice(0, 10) })); if (!rows.length) return void (list.innerHTML = '<li class="none">Nothing has been ported from the studio yet.</li>'); }
      else {
        if (tab === 'rs3' && !state.status.rs3Cache) return void (list.innerHTML = '<li class="none">No RS3 cache is loaded yet. Press <b>RS3 cache</b> at the top: it can find one on this computer, or you can choose where yours is.</li>');
        if (!q && tab === 'rs3') return void (list.innerHTML = '<li class="none">Type part of an RS3 item name. The first search reads the whole RS3 item list, which takes a few seconds once.</li>');
        rows = (await api.get(`/api/search?kind=${tab}&q=${encodeURIComponent(q || (tab === 'npc' ? 'a' : tab === 'anim' ? '' : 'sword'))}`)).results.map((r) => ({ key: r.id, id: r.id, name: r.name, note: r.note }));
        if (tab === 'anim') rows.unshift({ key: 'new', id: '+', name: 'New animation', note: 'start from a blank pose' });
        if (!rows.length) return void (list.innerHTML = `<li class="none">Nothing called "${esc(q)}". Try fewer letters, or an id.</li>`);
      }
      if (tab !== state.tab) return;
      list.innerHTML = rows.map((r) => `<li data-key="${esc(r.key)}" tabindex="0"><span class="id">${esc(r.id)}</span><span class="name">${esc(r.name)}</span><span class="note">${esc(r.note || '')}</span></li>`).join('');
    } catch (e) { list.innerHTML = `<li class="none">${esc(e.message)}</li>`; }
  }
  async function pick(key) {
    $$('#results li').forEach((li) => li.classList.toggle('sel', li.dataset.key === String(key)));
    state.draft = null; state.build = null; state.diag = null; setTool(null);
    try {
      if (state.tab === 'drafts') return await openDraft(key);
      if (state.tab === 'ports') return await showPort(key);
      if (state.tab === 'anim' && key === 'new') { state.sel = { kind: 'animnew' }; state.info = null; return renderAnimNew(); }
      state.sel = { kind: state.tab, id: +key }; state.npcSeq = null;
      if (state.tab === 'anim') { state.info = await api.get('/api/animinfo/' + key); if (state.info.fits.length && state.info.skeleton !== 0) state.animFor = 'npc:' + state.info.fits[0].id; else if (state.info.skeleton === 0) state.animFor = 'player'; renderAnimInfo(); await showAnimInfo(); }
      else if (state.tab === 'item') { state.info = await api.get('/api/item/' + key); renderItem(); await showItem(); }
      else if (state.tab === 'npc') { state.info = await api.get('/api/npc/' + key); renderNpc(); await refreshScene(); }
      else if (state.tab === 'rs3') { state.info = await api.get('/api/rs3item/' + key); renderRs3(); await showRs3(); }
    } catch (e) { $('#inspector').innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; viewer.setParts([]); viewer.setAnim(null); $('#empty').hidden = false; status(''); }
  }

  // ---------- inspector: things already in the game ----------
  const slotName = (p) => (state.status.slotNames[p] || (p >= 0 ? 'slot ' + p : 'not wearable'));
  function renderItem() {
    const i = state.info, m = i.models, ref = (r) => r ? (r.type === 'custom' ? `custom ${esc(r.id)}` : `cache ${esc(r.id)}`) : 'none';
    $('#inspector').innerHTML = `<h2>${esc(i.name)}${i.custom ? '<span class="pill custom">custom</span>' : ''}</h2>
      <div class="sub">Item ${i.id}${i.base ? `, plays as ${esc(i.base.name)} (${i.base.id})` : ''}</div>
      ${i.examine ? `<p>${esc(i.examine)}</p>` : ''}
      <dl class="kv"><dt>Worn in</dt><dd>${esc(slotName(i.wearPos))}</dd><dt>Models</dt><dd>item ${ref(m.ground)}, male ${ref(m.male)}, female ${ref(m.female)}</dd>
      <dt>Menu options</dt><dd>${esc((i.actions || []).filter(Boolean).join(', ') || 'none')}</dd><dt>Recolours</dt><dd>${(i.recolorFrom || []).length} colour swaps</dd></dl>
      <div class="actions">
        ${i.custom ? '<button class="btn primary" data-act="edit-replace">Edit this item</button><button class="btn" data-act="edit-copy">Make a copy as a new item</button>' : '<button class="btn primary" data-act="edit-copy">Make a custom version</button>'}
        ${m.male || m.female ? '<button class="btn" data-act="diagnose">Check for stretching</button>' : ''}
      </div>
      <p class="note">${i.custom ? '"Edit this item" changes the item in the game when you port it and keeps its id. A copy gets a new id.' : 'A custom version is a new item with its own id. The original stays as it is.'}</p>
      <div id="diag"></div>`;
  }
  function renderNpc() {
    const n = state.info;
    $('#inspector').innerHTML = `<h2>${esc(n.name)}</h2><div class="sub">NPC ${n.id}${n.combatLevel > 0 ? `, level ${n.combatLevel}` : ''}</div>
      <dl class="kv"><dt>Size</dt><dd>${n.size} tile${n.size > 1 ? 's' : ''}</dd><dt>Models</dt><dd>${esc(n.models.join(', '))}</dd><dt>Stand / walk</dt><dd>animation ${n.idleSeq} / ${n.walkSeq}</dd>
      <dt>Hitpoints</dt><dd>${n.hitpoints >= 0 ? n.hitpoints : 'not set in the cache'}</dd><dt>Menu options</dt><dd>${esc(n.actions.filter(Boolean).join(', ') || 'none')}</dd><dt>Scale</dt><dd>${n.widthScale} wide, ${n.heightScale} tall (128 = normal)</dd></dl>
      <label class="field">Play one of its animations<select id="npc-seq">${(n.anims || []).map((a) => `<option value="${a.id}" ${a.id === (state.npcSeq !== null ? state.npcSeq : n.idleSeq) ? 'selected' : ''}>${esc(a.name)} (${a.id})</option>`).join('')}</select></label>
      <div class="actions">${n.from ? '' : '<button class="btn primary" data-act="npc-copy">Make a custom NPC from this</button>'}
      <button class="btn" data-act="gamecheck">Check it as the game builds it</button>
      <button class="btn" data-act="anim-for-npc">Make an animation for it</button></div>
      <p class="note">${n.from ? 'This NPC was added to the game on top of the cache (a ported boss or a custom NPC).' : 'A custom NPC gets its own unused id. You can rename it, recolour or paint it, resize it and set its combat numbers, then port it.'} The check plays every one of its animations on the model exactly as the game client puts it together, and finds faces that stretch.</p>
      <div id="diag"></div>`;
  }
  function gameReportHtml(r, after) {
    const g = after || r.inGameNow, faults = r.models.reduce((n, m) => n + m.unusedVerticesTheGameDrops + m.verticesTheGameJoinsAcrossParts, 0);
    if (typeof g === 'string') return `<p class="note">${esc(g)}</p>`;
    return `${after ? '<h3>After the repair</h3>' : `<h3>In the game now</h3>${r.models.map((m) => m.verticesTheGameJoinsAcrossParts || m.unusedVerticesTheGameDrops ? `<div class="msg bad">Model ${m.id}: the game joins ${m.verticesTheGameJoinsAcrossParts} vertices that belong to different body parts, and drops ${m.unusedVerticesTheGameDrops} hidden pivot vertices.</div>` : '').join('')}${faults ? '' : '<div class="msg ok">The game builds this model exactly as its file describes.</div>'}`}
      <table class="report"><tr><td>Worst stretch</td><td class="${parseFloat(g.worstStretch) <= 2 ? 'good' : parseFloat(g.worstStretch) >= 8 ? 'poor' : 'mid'}">${esc(g.worstStretch)}</td></tr><tr><td>Typical (95% of faces under)</td><td>${esc(g.typical95)}</td></tr>
      <tr><td>Faces growing more than 6 units</td><td>${g.facesGrowingOver6Units}</td></tr><tr><td>Largest growth</td><td>${g.largestGrowthUnits} units</td></tr><tr><td>Joints with no pivot</td><td>${g.pivotsWithNoVertices.length}</td></tr></table>
      ${after ? '' : `<p class="note">Tested on ${r.animations.length} animations, ${r.frames} frames. Worst faces: ${g.worstFaces.slice(0, 3).map((w) => `face ${w.face} grows ${w.grows} units in animation ${w.at ? w.at.seq : '?'} <span class="chipc" style="background:${esc(w.web)}"></span>`).join(', ') || 'none'}.</p>`}`;
  }
  async function gamecheck() {
    const box = $('#diag'); box.innerHTML = '<p class="note">Building the model the way the game does and playing all its animations...</p>';
    try {
      const r = await api.get('/api/gamecheck/npc/' + state.info.id); let html = gameReportHtml(r);
      const faults = r.models.some((m) => m.file !== 'cache' && (m.unusedVerticesTheGameDrops || m.verticesTheGameJoinsAcrossParts));
      if (faults) html += '<div class="actions"><button class="btn primary" data-act="gamefix">Work out the repair</button></div>';
      box.innerHTML = html;
    } catch (e) { box.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; }
  }
  async function gamefix() {
    const id = state.info.id, dry = await api.post('/api/gamefix/npc/' + id, { write: false }), r = dry.report;
    if (!dry.write) return toast('Nothing to repair');
    modal(`Repair ${r.npc}?`, `${r.repairs.map((x) => `<p class="note">Model ${x.model}: ${esc(x.steps.join('; '))}.</p>`).join('')}${gameReportHtml(r)}${r.inGameAfterRepair ? gameReportHtml(r, r.inGameAfterRepair) : ''}
      <p class="note">The current model file is copied to Server/server/backups first. The game server restarts once by itself. You can undo this from the Ported tab.</p>`,
      [{ label: 'Not now' }, { label: 'Repair in the game', primary: true, run: async (btn) => { btn.disabled = true; btn.textContent = 'Writing...'; try { const res = await api.post('/api/gamefix/npc/' + id, { write: true }); closeModal(); toast(res.write && res.write.written ? 'Repaired. The server is restarting; log back in to see it.' : 'Nothing was written', 7000); await pick(id); } catch (e) { closeModal(); toast(e.message, 8000); } } }]);
  }
  function renderAnimInfo() {
    const a = state.info, opts = [['player', 'A player']].concat(a.fits.map((f) => ['npc:' + f.id, f.name]));
    $('#inspector').innerHTML = `<h2>${esc(a.name || 'Animation ' + a.id)}${a.custom ? '<span class="pill custom">custom</span>' : ''}</h2><div class="sub">Animation ${a.id}${a.custom ? `, copies its settings from game animation ${a.template}` : ''}</div>
      <dl class="kv"><dt>Length</dt><dd>${a.seconds} seconds, ${a.frames} frames</dd><dt>Skeleton</dt><dd>${a.skeleton}${a.skeleton === 0 ? ' (the human one: players and human NPCs)' : ''}</dd></dl>
      ${a.skeletal ? '<div class="msg warn">This one uses the newer skeletal system, which the studio cannot play or edit yet.</div>' : ''}
      <label class="field">Play it on<select id="anim-for">${opts.map(([v, l]) => `<option value="${esc(v)}" ${v === state.animFor ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
      <div class="actions"><button class="btn primary" data-act="anim-copy" ${a.skeletal ? 'disabled' : ''}>Make an editable copy</button></div>
      <p class="note">An editable copy turns every frame into a pose you can change. It becomes a new custom animation with its own id; this one stays as it is.</p>`;
  }
  function renderAnimNew() {
    viewer.setParts([]); $('#empty').hidden = false;
    $('#inspector').innerHTML = `<h2>New animation</h2><div class="sub">Pose the model at a few moments. The studio makes every frame in between.</div>
      <label class="field">Name<input type="text" id="an-name" value="My animation"></label>
      <label class="field">Made for<select id="an-for"><option value="player">A player (also fits human NPCs)</option><option value="npc">An NPC, by id</option></select></label>
      <label class="field">NPC id (only for an NPC)<input type="number" id="an-npc" min="0" placeholder="e.g. 17015 for Vorago"></label>
      <label class="check"><input type="checkbox" id="an-loop"> It repeats (a stand or walk), instead of playing once</label>
      <div class="actions"><button class="btn primary" data-act="anim-new">Start posing</button></div>
      <p class="note">Each skeleton has its own joints, so an animation only fits the creature it is made for. Find an NPC's id in the Game NPCs tab.</p>`;
  }
  function renderRs3() {
    const it = state.info, wearable = it.male >= 0 || it.female >= 0, guess = it.slot === 3 || it.slot === 5 ? 'weapon' : it.slot === 1 ? 'cape' : [0, 4, 7, 9, 10].includes(it.slot) ? 'armour' : 'other';
    $('#inspector').innerHTML = `<h2>${esc(it.name)}<span class="pill">RS3</span></h2><div class="sub">RS3 item ${it.id}</div>
      <dl class="kv"><dt>RS3 models</dt><dd>item ${it.model}${wearable ? `, male ${it.male}, female ${it.female}` : ''}</dd><dt>RS3 slot</dt><dd>${it.slot >= 0 ? it.slot : 'not wearable'}</dd><dt>Colour swaps</dt><dd>${it.recolor.length} recolours, ${it.retexture.length} retextures</dd></dl>
      <details open><summary>Port this into the game</summary><div class="body">
        <label class="field">Name in game<input type="text" id="new-name" value="${esc(it.name)}"></label>
        <label class="field">What is it<select id="new-type">${['weapon', 'armour', 'cape', 'other'].map((t) => `<option ${t === guess ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="field">OSRS item it plays as (stats, slot, animations)<input type="search" id="base-q" placeholder="Search an OSRS item, e.g. armadyl godsword" autocomplete="off"></label>
        <ul class="results" id="base-results" style="max-height:150px;padding:0"></ul>
        <p class="note" id="base-picked">No base chosen yet. Weapons and armour need one: it gives the stats, the slot and which body parts are hidden.</p>
        <div class="actions"><button class="btn primary" data-act="rs3-start">Start the port</button></div>
      </div></details>`;
    state.basePick = null;
  }
  async function diagnose() {
    const box = $('#diag'); box.innerHTML = '<p class="note">Playing 24 player animations on the in-game body...</p>';
    try { state.diag = await api.get('/api/diagnose/item/' + state.info.id); box.innerHTML = reportHtml(state.diag.male, 'Male', state.diag.reference) + reportHtml(state.diag.female, 'Female', state.diag.reference); if (state.view === 'ground') { state.view = 'male'; } await showItem(); }
    catch (e) { box.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; }
  }
  function reportHtml(r, title, refName) {
    if (!r) return '';
    const a = r.after, ref = r.reference, cls = (v, good, bad) => v <= good ? 'good' : v >= bad ? 'poor' : 'mid';
    const empty = (r.pivots || []).filter((p) => p.problem);
    return `<h3>${esc(title)}</h3>
      ${empty.map((p) => `<div class="msg bad">Joint ${esc(p.labels.join('+'))}: ${esc(p.problem.replace(/^EMPTY: /, ''))}</div>`).join('')}
      <table class="report"><tr><th></th><th>This item</th><th>${ref ? esc(refName || 'OSRS reference') : ''}</th></tr>
      <tr><td>Worst stretch</td><td class="${cls(a.worst, 2, 8)}">${a.worst}x</td><td>${ref ? ref.worst + 'x' : ''}</td></tr>
      <tr><td>Typical (95% of faces under)</td><td class="${cls(a.p95, 1.5, 4)}">${a.p95}x</td><td>${ref ? ref.p95 + 'x' : ''}</td></tr>
      <tr><td>Faces over ${a.threshold}x</td><td>${a.over} of ${a.faces}</td><td>${ref ? `${ref.over} of ${ref.faces}` : ''}</td></tr></table>
      ${r.limit ? `<p class="note">Cloth is allowed to stretch as far as the base item's own does. Faces past ${r.limit}x were made rigid; ${r.beyondLimit || 0} are still past it.</p>` : ''}
      ${(r.steps || []).length ? `<p class="note">What the fixer did: ${esc(r.steps.join('; '))}.</p>` : ''}`;
  }
  async function showPort(key) {
    const p = (await api.get('/api/ports')).ports.find((x) => x.key === key); if (!p) return;
    $('#inspector').innerHTML = `<h2>${esc(p.name)}</h2><div class="sub">${esc(p.kind)} ${p.id}, ported ${esc(p.when)}</div>
      <dl class="kv"><dt>What it did</dt><dd>${p.replaced ? 'replaced an existing ' + p.kind : 'added a new ' + p.kind}</dd><dt>Backup</dt><dd>${esc(p.backupDir)}</dd><dt>State</dt><dd>${p.undone ? 'undone ' + esc(p.undone) : 'in the game'}</dd></dl>
      <div class="actions">${p.undone ? '' : `<button class="btn danger" data-act="undo" data-key="${esc(key)}">Undo this port</button>`}</div>
      <p class="note">Undo puts the previous files back. New model files are moved to a _to_delete folder next to the server, never deleted. A server under nodemon restarts once.</p>`;
  }

  // ---------- drafts ----------
  async function openDraft(slug) { state.draft = await api.get('/api/draft/' + encodeURIComponent(slug)); state.sel = { kind: 'draft', id: slug }; state.build = null; state.undo = []; state.npcSeq = null; state.animPlaying = false; state.animJoint = null; state.animKey = state.draft.kind === 'anim' && state.draft.anim.keys.length ? state.draft.anim.keys[0].t : null; renderDraft(); await buildDraft(); }
  async function startDraft(body) { const d = await api.post('/api/draft/new', body); toast(`Draft "${d.name}" created`); state.tab = 'drafts'; await loadTab('drafts'); await pick(d.slug); }
  function scheduleSave() { state.dirty = true; clearTimeout(saveTimer); saveTimer = setTimeout(saveDraft, 500); }
  async function saveDraft() { clearTimeout(saveTimer); if (!state.draft || !state.dirty) return; state.dirty = false; try { const d = await api.post('/api/draft', state.draft); state.draft.updated = d.updated; } catch (e) { toast('Could not save the draft: ' + e.message, 6000); } }
  async function buildDraft(keepCamera) {
    if (!state.draft) return;
    $('#build-state') && ($('#build-state').textContent = 'Building...');
    try { clearTimeout(saveTimer); state.dirty = false; state.build = await api.post(`/api/draft/${encodeURIComponent(state.draft.slug)}/build`, state.draft); renderDraft(); await refreshScene(keepCamera); }
    catch (e) { $('#build-state') && ($('#build-state').textContent = ''); toast(e.message, 7000); }
  }
  const val = (p, fallback) => { const v = getPath(state.draft, p); return v === undefined || v === null ? (fallback === undefined ? '' : fallback) : v; };
  const text = (label, path, extra) => `<label class="field">${esc(label)}<input type="text" data-path="${path}" value="${esc(val(path))}" ${extra || ''}></label>`;
  const num = (label, path, extra, fallback) => `<label class="field">${esc(label)}<input type="number" data-path="${path}" data-type="num" value="${esc(val(path, fallback))}" ${extra || ''}></label>`;
  const chk = (label, path, on) => `<label class="check"><input type="checkbox" data-path="${path}" data-type="bool" ${(getPath(state.draft, path) === undefined ? on : getPath(state.draft, path)) ? 'checked' : ''}> ${esc(label)}</label>`;
  const sel = (label, path, options, fallback) => `<label class="field">${esc(label)}<select data-path="${path}">${options.map(([v, l]) => `<option value="${esc(v)}" ${String(val(path, fallback)) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>`;

  function modelSection(slot, label) {
    const d = state.draft, spec = d.item.models[slot], p = `item.models.${slot}`, built = state.build && state.build.slots[slot];
    if (!spec) return `<details><summary>${esc(label)}: none</summary><div class="body"><p class="note">This item has no model here.</p></div></details>`;
    const s = spec.source, from = s.type === 'rs3' ? `RS3 model ${s.model}` : s.type === 'osrs' ? `game model ${s.model}` : s.type === 'custom' ? `custom file ${s.file}` : s.type;
    const worn = slot !== 'ground', mode = spec.mode || (worn ? 'asis' : 'ground');
    let body = `<p class="note">From ${esc(from)}.${built && built.info ? ` Built: ${built.info.tris} triangles${built.info.bytes ? `, ${built.info.bytes} bytes` : ''}.` : ''}</p>`;
    if (worn) body += sel('How it attaches to the body', p + '.mode', [['weapon', 'Held in the hand (weapon, shield)'], ['armour', 'Armour (bends with the body, stretch-tested)'], ['cape', 'Cape (bones copied from the base cape)'], ['asis', 'Leave its bones as they are']], mode);
    if (s.type === 'rs3') body += `<div class="grid2">${num('Triangle budget', p + '.maxTris', 'min="100" max="6000" step="50"', worn ? 1400 : 1000)}<div class="field">&nbsp;${chk('Tint grey detail textures', p + '.tint', false)}</div></div>`;
    if (worn && mode === 'weapon' && s.type === 'rs3') body += sel('Which hand', p + '.label', [['', 'As RS3 has it'], ['50', 'Right hand (weapons)'], ['27', 'Left hand (bows)'], ['161', 'Off-hand / shield']], '');
    if (worn && mode === 'armour') {
      body += `<div class="grid2">${sel('Shoulder pads', p + '.pads', [['auto', 'Decide for me'], ['chest', 'Stay on the chest (OSRS style)'], ['arm', 'Swing with the arms (RS3 style)']], 'auto')}
        ${sel('Joint pivots', p + '.pivots', [['auto', 'Decide for me'], ['source', "RS3 model's own"], ['reference', 'Copy the base item']], 'auto')}</div>
        <div class="grid2">${num('Stretch limit (x)', p + '.threshold', 'min="1.1" max="5" step="0.05"', 1.4)}<div class="field">&nbsp;${chk('Turn stretching faces into plates', p + '.plates', true)}</div></div>`;
      if (s.type !== 'rs3') body += `<div class="field">${chk('Repair pivots and stretching on this model', p + '.fix', false)}</div>`;
    }
    if (worn) body += `<div class="grid3">${num('Fit: move X', p + '.fit.offset.0', 'step="1"', 0)}${num('Move Y (up is minus)', p + '.fit.offset.1', 'step="1"', 0)}${num('Move Z', p + '.fit.offset.2', 'step="1"', 0)}</div>${num('Fit: size (1 = as is)', p + '.fit.scale', 'step="0.01" min="0.2" max="4"', 1)}`;
    else body += `<div class="grid3">${num('Size (1 = as is)', p + '.edits.scale', 'step="0.05" min="0.1" max="6"', 1)}${num('Turn Y (degrees)', p + '.edits.rotate.1', 'step="5"', 0)}${num('Turn X (degrees)', p + '.edits.rotate.0', 'step="5"', 0)}</div>`;
    return `<details ${slot === state.view ? 'open' : ''}><summary>${esc(label)}</summary><div class="body">${body}</div></details>`;
  }
  function paintSection() {
    const b = state.build, slot = b && b.slots && b.slots[state.view];
    const cols = slot ? slot.colours : (b && b.colours) || [];
    const hsl = state.brush, hue = hsl >> 10 & 63, sat = hsl >> 7 & 7, lum = hsl & 127;
    return `<details open><summary>Colours and paint</summary><div class="body">
      <p class="note">Swap a colour everywhere: click one of the model's colours, set the new colour below, press Swap. Or pick a tool and paint on the model itself.</p>
      <div class="swatches" id="swatches">${cols.map((c) => `<button class="swatch ${state.swatch === c.colour ? 'sel' : ''}" style="background:${css(c.colour)}" data-swatch="${c.colour}" title="Colour ${c.colour}, ${c.faces} faces"></button>`).join('')}</div>
      <div class="brush"><div class="chip" id="brush-chip" style="background:${css(hsl)}"></div><div class="sliders">
        <span>Hue</span><input type="range" min="0" max="63" value="${hue}" data-brush="h"><span class="num">${hue}</span>
        <span>Rich</span><input type="range" min="0" max="7" value="${sat}" data-brush="s"><span class="num">${sat}</span>
        <span>Light</span><input type="range" min="0" max="127" value="${lum}" data-brush="l"><span class="num">${lum}</span></div></div>
      <div class="row"><label class="field">Or a web colour<input type="text" id="brush-hex" value="${css(hsl)}" spellcheck="false"></label><label class="field">Game colour number<input type="number" id="brush-num" min="0" max="65535" value="${hsl}"></label></div>
      <div class="actions"><button class="btn" data-act="swap" ${state.swatch === null ? 'disabled' : ''}>Swap ${state.swatch === null ? 'a colour' : 'colour ' + state.swatch} for this</button></div>
      <div class="tools" id="tools">${[['brush', 'Brush (one face)'], ['fill', 'Fill (touching, same colour)'], ['part', 'Whole body part'], ['pick', 'Pick up a colour']].map(([t, l]) => `<button class="btn" data-tool="${t}" aria-pressed="${state.tool === t}">${l}</button>`).join('')}
        <button class="btn quiet" data-act="undo-paint" ${state.undo.length ? '' : 'disabled'}>Undo</button><button class="btn quiet" data-act="clear-paint">Clear paint</button></div>
      <p class="note">While a paint tool is on, drag paints. Hold Shift to move the camera, or turn the tool off to rotate.</p>
    </div></details>`;
  }
  function renderDraft() {
    const d = state.draft, b = state.build, st = state.status; if (!d) return;
    const problems = b ? b.problems.map((p) => `<div class="msg bad">${esc(p)}</div>`).join('') + b.warnings.map((p) => `<div class="msg warn">${esc(p)}</div>`).join('') : '';
    const where = d.ported ? `In the game as ${d.kind === 'anim' ? 'animation' : d.kind} ${d.ported.id}. Porting again updates it.` : d.kind === 'anim' ? 'Not in the game yet. It will get the next free animation id (61000 and up).' : d.kind === 'item' && d.item.replaceId !== undefined && d.item.replaceId !== null ? `Will replace item ${d.item.replaceId} in the game.` : `Not in the game yet. It will get id ${d.kind === 'npc' ? st.nextNpcId : st.nextItemId}.`;
    let html = `<h2>${esc(d.name)}<span class="pill ${d.ported ? 'ok' : ''}">${d.ported ? 'ported' : 'draft'}</span></h2><div class="sub">${esc(where)} <span id="build-state"></span></div>${problems}`;
    if (d.kind === 'anim') html += animEditorHtml();
    else if (d.kind === 'item') {
      const it = d.item, reports = b ? Object.entries(b.slots).filter(([, s]) => s.report).map(([k, s]) => reportHtml(s.report, k === 'male' ? 'Male, on the in-game body' : 'Female, on the in-game body', b.base && b.base.name)).join('') : '';
      html += `<details open><summary>Basics</summary><div class="body">${text('Name', 'name')}${text('Examine text', 'item.examine')}
        <div class="grid2">${num('OSRS item it plays as (id, -1 = none)', 'item.baseItemId', 'step="1"', -1)}<div class="field">&nbsp;${chk('Behave as the base where nothing else is set', 'item.aliasBase', true)}</div></div>
        ${b && b.base ? `<p class="note">Base: ${esc(b.base.name)}. Stats, slot, animations and special attack come from it unless you change them below.</p>` : ''}
        <label class="field">Menu options, left to right (blank = none)<input type="text" data-path="item.inventoryActions" data-type="actions" value="${esc((it.inventoryActions || []).map((a) => a || '').join(', '))}"></label>
        ${chk('Tradeable', 'item.isTradable', true)}</div></details>`;
      html += SLOTS.map(([s, l]) => modelSection(s, l)).join('');
      html += paintSection();
      html += `<details><summary>Inventory icon</summary><div class="body"><div class="row">${b && b.iconPng ? `<img class="icon-preview" alt="Inventory icon preview" src="data:image/png;base64,${b.iconPng}">` : ''}<div style="flex:1">${chk('Work out size and position for me', 'item.icon.auto', true)}
        <div class="grid3">${num('Tilt', 'item.icon.xan2d', 'min="0" max="2047"', 0)}${num('Turn', 'item.icon.yan2d', 'min="0" max="2047"', 0)}${num('Roll', 'item.icon.zan2d', 'min="0" max="2047"', 0)}</div></div></div>
        <div class="grid3">${num('Zoom', 'item.icon.zoom2d', 'min="100" max="20000" step="20"', b ? b.icon.zoom2d : 2000)}${num('Move X', 'item.icon.offsetX2d', '', b ? b.icon.offsetX2d : 0)}${num('Move Y', 'item.icon.offsetY2d', '', b ? b.icon.offsetY2d : 0)}</div>
        <p class="note">Angles go 0 to 2047 for a full turn. Zoom and move only apply when the box above is unticked.</p></div></details>`;
      html += `<details><summary>Stats and behaviour</summary><div class="body"><p class="note">Leave blank to take the base item's value.</p>
        <div class="grid2">${sel('Equipment type', 'item.itemDef.equipmentType', [['', 'From the base']].concat(st.equipmentTypes.map((t) => [t, t])), '')}
        <label class="field">Weapon style<input type="text" data-path="item.itemDef.weaponInterface" list="wi" value="${esc(val('item.itemDef.weaponInterface'))}"><datalist id="wi">${st.weaponInterfaces.map((w) => `<option>${esc(w)}</option>`).join('')}</datalist></label></div>
        <label class="field">Bonuses (14 numbers: ${esc(st.bonusNames.join(', '))})<input type="text" data-path="item.itemDef.bonuses" data-type="numlist" value="${esc((it.itemDef.bonuses || []).join(', '))}" placeholder="blank = base item's"></label>
        <label class="field">Level requirements (23 numbers in skill order: ${esc(st.skillNames.slice(0, 7).join(', '))}, ...)<input type="text" data-path="item.itemDef.requirements" data-type="numlist" value="${esc((it.itemDef.requirements || []).join(', '))}" placeholder="blank = base item's"></label>
        <div class="grid3">${num('Value (coins)', 'item.itemDef.value')}${num('Stand animation', 'item.itemDef.standAnim')}${num('Walk animation', 'item.itemDef.walkAnim')}${num('Run animation', 'item.itemDef.runAnim')}${num('Attack animation', 'item.itemDef.attackAnim')}${num('Block animation', 'item.itemDef.blockAnim')}</div>
        <div class="grid2">${num('Special attack: copy from item id', 'item.specialAttack.from')}${num('Special attack energy (1-100)', 'item.specialAttack.energy', 'min="1" max="100"')}</div></div></details>`;
      if (reports) html += `<details open><summary>Stretch test</summary><div class="body">${reports}<p class="note">Each face is measured through 24 player animations on the real in-game body. 1x means it never changes size. The right column is the OSRS item it plays as, measured the same way.</p></div></details>`;
    } else {
      const n = d.npc, base = b && b.base;
      html += `<details open><summary>Basics</summary><div class="body">${text('Name', 'name')}${text('Examine text', 'npc.fields.desc')}
        <p class="note">${base ? `Based on ${esc(base.name)} (NPC ${base.id}). Anything left blank stays as the base has it.` : 'No base NPC.'}</p>
        <div class="grid3">${num('Combat level', 'npc.fields.combatLevel')}${num('Size (tiles)', 'npc.fields.size', 'min="1" max="12"')}${num('Hitpoints', 'npc.fields.hitpoints')}
        ${num('Width (128 = normal)', 'npc.fields.widthScale', 'min="8" max="1024"')}${num('Height (128 = normal)', 'npc.fields.heightScale', 'min="8" max="1024"')}${num('Turn speed', 'npc.fields.rotationSpeed')}</div>
        <label class="field">Menu options, up to five (blank = none). "Attack" makes it attackable.<input type="text" data-path="npc.fields.actions" data-type="actions" value="${esc((n.fields.actions || []).map((a) => a || '').join(', '))}" placeholder="blank = same as the base"></label></div></details>
        <details><summary>Combat</summary><div class="body"><div class="grid3">${num('Attack level', 'npc.fields.attackLevel')}${num('Strength level', 'npc.fields.strengthLevel')}${num('Defence level', 'npc.fields.defenceLevel')}${num('Ranged level', 'npc.fields.rangedLevel')}${num('Magic level', 'npc.fields.magicLevel')}${num('Max hit', 'npc.combat.maxHit', 'min="0" max="10000"')}
        ${num('Attack animation', 'npc.combat.anims.attack')}${num('Block animation', 'npc.combat.anims.block')}${num('Death animation', 'npc.combat.anims.death')}${num('Respawn (ticks, 0 = never)', 'npc.combat.respawn')}${num('Death length (ticks)', 'npc.combat.deathTicks')}</div>
        ${sel('Attack style', 'npc.combat.attackType', [['', 'Same as the base'], ['melee', 'Melee'], ['ranged', 'Ranged'], ['magic', 'Magic']], '')}</div></details>
        <details><summary>Animations and models</summary><div class="body"><div class="grid2">${num('Stand animation', 'npc.fields.idleSeqId')}${num('Walk animation', 'npc.fields.walkSeqId')}</div>
        <label class="field">Game model ids, in order (blank = the base's models)<input type="text" data-path="npc.modelIds" data-type="numlist" value="${esc(n.models ? n.models.map((m) => m.source.model).join(', ') : '')}"></label>
        <p class="note">Animations must be ones the game already has. An NPC moves correctly only with animations made for its model, so take both from the same creature.</p>
        <div class="actions"><button class="btn" data-act="npc-anim">${state.npcAnim === 'walk' ? 'Show standing' : 'Show walking'}</button></div></div></details>`;
      html += paintSection();
    }
    html += `<div class="sticky-actions"><button class="btn" data-act="build">${d.kind === 'anim' ? 'Rebuild frames' : 'Build and test'}</button><button class="btn primary" data-act="port" ${b && !b.problems.length ? '' : 'disabled'}>${state.status.mode === 'standalone' ? 'Export files' : 'Port to game'}</button><button class="btn quiet" data-act="remove-draft">Remove draft</button></div>`;
    const ins = $('#inspector'), top = ins.scrollTop, open = $$('details', ins).map((x) => x.open);
    ins.innerHTML = html;
    if (state.renderedFor === d.slug) { $$('details', ins).forEach((x, i) => { if (open[i] !== undefined) x.open = open[i]; }); ins.scrollTop = top; }
    state.renderedFor = d.slug;
  }
  function animEditorHtml() {
    const d = state.draft, an = d.anim, b = state.build, tg = b && b.target, keys = an.keys.slice().sort((x, y) => x.t - y.t), key = animKeyNow();
    const secs = (t) => (t * 0.02).toFixed(2), joints = tg ? tg.controls.filter((c) => state.animAll || !c.extra) : [], joint = joints.find((c) => c.id === state.animJoint) || null;
    const v = key && joint ? (key.pose[joint.id] || (joint.kind === 'scale' ? [128, 128, 128] : [0, 0, 0])) : null;
    const axis = joint ? (joint.kind === 'rotate' ? [['Swing forward / back', -180, 180, 1], ['Twist', -180, 180, 1], ['Tilt sideways', -180, 180, 1]] : joint.kind === 'move' ? [['Move left / right', -150, 150, 1], ['Move up (minus) / down', -150, 150, 1], ['Move forward / back', -150, 150, 1]] : [['Width (128 = same)', 16, 384, 1], ['Height', 16, 384, 1], ['Depth', 16, 384, 1]]) : [];
    return `<details open><summary>Basics</summary><div class="body">${text('Name', 'name')}
        <p class="note">Made for ${esc(tg ? tg.name : an.for)}${tg ? ` (skeleton ${tg.skeleton})` : ''}. ${b ? `${b.seconds} seconds, ${b.anim.frames.length} frames.` : ''}</p>
        <div class="grid2">${num('Copies settings of game animation', 'anim.template', 'min="0" step="1"')}${sel('Frames made between poses', 'anim.step', [[1, 'Every tick (50 a second)'], [2, 'Every 2 ticks (25 a second)'], [3, 'Every 3 ticks'], [5, 'Every 5 ticks (10 a second)']], 2)}</div>
        <div class="grid2">${sel('Movement between poses', 'anim.ease', [['smooth', 'Ease in and out'], ['linear', 'Constant speed']], 'smooth')}${num('Hold the last pose (ticks of 20 ms)', 'anim.endHold', 'min="1" max="500"', 2)}</div>
        <p class="note">"Copies settings" decides what the game does around your frames: which animations it can interrupt, and whether it repeats. Use 863 (wave) for a one-off emote, 808 (stand) for something that repeats, or one of the creature's own.</p></div></details>
      <details open><summary>Poses in time</summary><div class="body">
        <div class="keys">${keys.map((k) => `<button class="btn key ${k.t === state.animKey ? 'sel' : ''}" data-key="${k.t}" title="${Object.keys(k.pose).length} joints posed">${secs(k.t)}s</button>`).join('') || '<span class="note">No poses yet. Add the first one at 0 seconds.</span>'}</div>
        <div class="row"><label class="field">Time in seconds<input type="number" id="key-time" min="0" step="0.1" value="${keys.length ? secs(keys[keys.length - 1].t + 20) : '0'}"></label>
          <div class="actions" style="align-self:end"><button class="btn" data-act="key-add">Add a pose here</button></div></div>
        <div class="actions"><button class="btn" data-act="key-copy" ${key ? '' : 'disabled'}>Copy the selected pose to that time</button><button class="btn quiet" data-act="key-remove" ${key ? '' : 'disabled'}>Remove the selected pose</button>
          <button class="btn ${state.animPlaying ? 'primary' : ''}" data-act="anim-play">${state.animPlaying ? 'Stop and edit' : 'Play the animation'}</button></div>
        <p class="note">Select a pose to edit it. A new pose starts as a copy of the one before it, so you only change what moves.</p></div></details>
      ${key ? `<details open><summary>Pose at ${secs(key.t)} seconds</summary><div class="body">
        <label class="field">Joint<select id="joint-pick"><option value="">Choose a joint...</option>${joints.map((c) => `<option value="${c.id}" ${c.id === state.animJoint ? 'selected' : ''}>${key.pose[c.id] ? '\u25CF ' : ''}${esc(c.name)}${c.where ? ' - ' + esc(c.where) : ''}</option>`).join('')}</select></label>
        ${tg && tg.skeleton === 0 ? `<label class="check"><input type="checkbox" id="joint-all" ${state.animAll ? 'checked' : ''}> Show the skeleton's extra joints too</label>` : ''}
        ${joint ? axis.map(([label, lo, hi, step], i) => `<label class="field">${esc(label)}<div class="row"><input type="range" data-axis="${i}" min="${lo}" max="${hi}" step="${step}" value="${v[i]}"><input type="number" class="axis-num" data-axisnum="${i}" step="${step}" value="${v[i]}"></div></label>`).join('') + '<div class="actions"><button class="btn quiet" data-act="joint-reset">Put this joint back to rest</button></div>' : '<p class="note">The part a joint moves is tinted on the model when you choose it. A dot marks joints this pose already changes.</p>'}
      </div></details>` : ''}`;
  }
  function animPoseChanged(rebuildUi) { scheduleSave(); if (rebuildUi) renderDraft(); showAnimDraft(true); }
  function onField(el) {
    const d = state.draft, path = el.dataset.path, type = el.dataset.type; if (!d || !path) return;
    let v;
    if (type === 'bool') v = el.checked;
    else if (type === 'num') v = el.value === '' ? undefined : +el.value;
    else if (type === 'numlist') { const a = el.value.split(/[,\s]+/).filter(Boolean).map(Number); v = a.length && a.every(Number.isFinite) ? a : undefined; }
    else if (type === 'actions') { const a = el.value.split(',').map((s) => s.trim() || null); v = el.value.trim() === '' ? undefined : a.slice(0, 5); if (v && path === 'item.inventoryActions') while (v.length < 5) v.push(null); }
    else v = el.value === '' && path !== 'name' ? undefined : el.value;
    if (path === 'npc.modelIds') { d.npc.models = v ? v.map((id) => ({ source: { type: 'osrs', model: id } })) : null; }
    else if (/\.label$/.test(path)) setPath(d, path, v === undefined ? undefined : +v);
    else setPath(d, path, v);
    if (path.startsWith('item.specialAttack') && d.item.specialAttack && d.item.specialAttack.from === undefined && d.item.specialAttack.energy === undefined) delete d.item.specialAttack;
    if (path.startsWith('item.icon.') && !path.endsWith('.auto') && /zoom2d|offset/.test(path)) d.item.icon.auto = false;
    scheduleSave();
    if (!/^(name|item\.examine|npc\.fields\.desc)$/.test(path)) buildDraft(true);
  }

  // ---------- paint ----------
  function setTool(t) { state.tool = t; if (viewer) { viewer.tool = t; viewer.canvas.classList.toggle('painting', !!t); } $$('#tools button[data-tool]').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tool === t ? 'true' : 'false')); $('#hint').textContent = t ? 'Painting. Drag on the model. Shift-drag moves the camera.' : 'Drag to rotate. Right-drag or Shift-drag to move. Scroll to zoom.'; }
  function setBrush(hsl) { state.brush = hsl & 0xffff; const chip = $('#brush-chip'); if (!chip) return; chip.style.background = css(state.brush); const vals = { h: state.brush >> 10 & 63, s: state.brush >> 7 & 7, l: state.brush & 127 }; $$('[data-brush]').forEach((r) => { r.value = vals[r.dataset.brush]; r.nextElementSibling.textContent = vals[r.dataset.brush]; }); if (document.activeElement !== $('#brush-hex')) $('#brush-hex').value = css(state.brush); if (document.activeElement !== $('#brush-num')) $('#brush-num').value = state.brush; }
  /** Where paint for the model on screen is kept in the draft: a list of [face, colour] plus the face count it belongs to. */
  function paintStore(partIndex) {
    const d = state.draft; let holder;
    if (d.kind === 'item') { const spec = d.item.models[state.view]; if (!spec) return null; spec.edits = spec.edits || {}; holder = spec.edits; }
    else { if (!d.npc.models) d.npc.models = (state.build.base ? state.build.baseModels || [] : []).map((id) => ({ source: { type: 'osrs', model: id } })); const spec = d.npc.models[partIndex]; if (!spec) return null; spec.edits = spec.edits || {}; holder = spec.edits; }
    const nf = viewer.parts[partIndex].mesh.nf;
    if (!holder.paint || holder.paint.faces !== nf) holder.paint = { faces: nf, list: [] };
    return holder.paint;
  }
  let stroke = null;
  function onPaint(hit, done) {
    if (done) { if (stroke && stroke.length) { state.undo.push(stroke); const u = $('[data-act="undo-paint"]'); if (u) u.disabled = false; scheduleSave(); } stroke = null; return; }
    if (!state.draft || !hit) return;
    const wanted = state.draft.kind === 'npc' ? 'npc' : 'item'; if (hit.tag !== wanted) return;
    if (state.tool === 'pick') { setBrush(hit.colour); return; }
    const store = paintStore(hit.part); if (!store) return;
    const faces = state.tool === 'fill' ? viewer.connectedSameColour(hit.part, hit.local) : state.tool === 'part' ? viewer.sameLabel(hit.part, hit.local) : [hit.local];
    stroke = stroke || [];
    const mesh = viewer.parts[hit.part].mesh;
    for (const f of faces) {
      if (mesh.col[f] === state.brush && !(mesh.ftex && mesh.ftex[f] !== -1)) continue;
      stroke.push([hit.part, f, mesh.col[f]]);
      viewer.paintFace(hit.part, f, state.brush);
      const at = store.list.findIndex((p) => p[0] === f); if (at >= 0) store.list[at][1] = state.brush; else store.list.push([f, state.brush]);
    }
  }
  function undoPaint() {
    const s = state.undo.pop(); if (!s) return;
    for (const [part, f, old] of s.reverse()) { viewer.paintFace(part, f, old); const store = paintStore(part); if (store) { const at = store.list.findIndex((p) => p[0] === f); if (at >= 0) store.list.splice(at, 1); } }
    scheduleSave(); const u = $('[data-act="undo-paint"]'); if (u) u.disabled = !state.undo.length;
  }
  /** Colour swaps live on the definition (the game applies them), so they need no new model file. */
  function swapColour(from, to) {
    const d = state.draft; if (from === to) return;
    const compose = (pairs) => { let out = pairs.map((p) => (p[1] === from ? [p[0], to] : p.slice())); const at = out.findIndex((p) => p[0] === from); if (at >= 0) out[at][1] = to; else out.push([from, to]); return out.filter((p) => p[0] !== p[1]); };
    if (d.kind === 'item') d.item.recolor = compose(d.item.recolor || []);
    else { const base = state.build.view, cur = d.npc.fields.recolorFrom ? d.npc.fields.recolorFrom.map((f, i) => [f, d.npc.fields.recolorTo[i]]) : base.recolorFrom.map((f, i) => [f, base.recolorTo[i]]); const out = compose(cur); d.npc.fields.recolorFrom = out.map((p) => p[0]); d.npc.fields.recolorTo = out.map((p) => p[1]); }
    state.swatch = null; scheduleSave(); buildDraft(true);
  }

  // ---------- port ----------
  async function portFlow() {
    await saveDraft();
    const slug = encodeURIComponent(state.draft.slug);
    let plan; try { plan = await api.post(`/api/draft/${slug}/port`, { write: false }); } catch (e) { return toast(e.message, 7000); }
    const list = (a, cls) => a.map((x) => `<div class="msg ${cls}">${esc(x)}</div>`).join(''), alone = !!plan.standalone, caps = state.status.capabilities || {};
    const body = `${list(plan.problems, 'bad')}${list(plan.warnings, 'warn')}
      <dl class="kv"><dt>What happens</dt><dd>${esc(plan.notes.join('. '))}</dd><dt>Files written</dt><dd>${plan.kind === 'anim' ? 'custom-seqs.json (the game\'s custom animation list)' : plan.files.length ? plan.files.map((f) => `${esc(f.file)} (${f.bytes} bytes, model ${f.modelId}${f.replaces ? ', replaces the current one' : ''})`).join('<br>') : 'no model files (it uses models the game already has)'}</dd>
      <dt>Packet size</dt><dd>${Object.entries(plan.packet || {}).filter(([k]) => k !== 'limit').map(([k, v]) => `${k}: ${v} of ${plan.packet.limit} bytes`).join(', ')}</dd></dl>
      <p class="note">${alone ? `The files are written to the Studio's own export folder (${esc(plan.target)}), laid out the way a supported server keeps them. Nothing is installed into a game. You can undo this from the Ported tab.`
        : `The current files are copied to the server's backups folder first. ${caps.autoRestart ? 'The game server restarts once by itself (players reconnect).' : 'This server does not restart by itself: restart it to load the change.'} You can undo this from the Ported tab.`}</p>`;
    modal(plan.ok ? (alone ? `Export "${state.draft.name}"?` : `Port "${state.draft.name}" to the game?`) : 'This cannot be ported yet', body, plan.ok ? [{ label: 'Not now' }, { label: alone ? 'Export files' : 'Port to game', primary: true, run: (btn) => doPort(btn, slug) }] : [{ label: 'Close' }]);
  }
  async function doPort(btn, slug) {
    btn.disabled = true; btn.textContent = 'Porting...';
    let res; try { res = await api.post(`/api/draft/${slug}/port`, { write: true, restart: true }); } catch (e) { closeModal(); return toast(e.message, 8000); }
    if (!res.written) { closeModal(); return toast('Nothing was written: ' + res.problems.join('; '), 8000); }
    state.draft = await api.get('/api/draft/' + slug); state.status = await api.get('/api/status'); meters();
    const alone = !!res.standalone, caps = state.status.capabilities || {}, what = res.kind === 'anim' ? 'animation' : res.kind;
    const how = res.kind === 'anim' ? `Play it in game with <b>::anim ${res.id}</b>.` : res.kind === 'npc' ? `Spawn it in game with <b>::npc ${res.id}</b>.` : `Spawn it in game with your item command and id <b>${res.id}</b>.`;
    modal(alone ? `Exported as ${what} ${res.id}` : `Ported as ${what} ${res.id}`, alone
      ? `<div class="msg ok">Written to ${esc(res.target)}</div><p class="note">These are the same files a supported server reads (data/definitions and data/models). Copy them into your server, or give them to whoever runs it. docs/AGENT-GUIDE.md explains what each file is and what a server needs to load it.</p>`
      : `<div class="msg ok">Written. Backup of the old files: ${esc(res.backupDir)}</div><p id="restart-state" class="note">${caps.autoRestart ? 'Waiting for the game server to restart...' : 'This server does not restart by itself. Restart it, then check it in game.'}</p><p class="note">${how}</p>`, [{ label: 'Done', primary: true }]);
    renderDraft();
    if (alone || !caps.autoRestart) return;
    for (let i = 0; i < 40 && !$('#modal').hidden; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      const s = await api.get('/api/restart?since=' + res.startedAt).catch(() => null), el = $('#restart-state'); if (!s || !el) continue;
      if (s.restarted === null || s.standalone) { el.textContent = s.note || 'The Studio cannot tell whether this server restarted. Check it yourself.'; break; }
      if (s.restarted) { el.className = 'msg ' + (s.errors.length ? 'bad' : 'ok'); el.innerHTML = s.errors.length ? `The server restarted at ${esc(s.at)} but logged errors:<br>${s.errors.map(esc).join('<br>')}<br>If custom items are missing in game, undo this port from the Ported tab.` : `The server restarted at ${esc(s.at)} with no errors${s.listening ? ' and is accepting logins' : ''}. Log back in and check it in game.`; if (s.listening || s.errors.length) break; }
      else if (i === 12) el.textContent = 'The server has not restarted yet. If it is not running, the change loads the next time it starts.';
    }
  }

  // ---------- wiring ----------
  function meters() {
    const s = state.status; s.problems = s.problems || []; s.capabilities = s.capabilities || { autoRestart: true };   // an app server from before this update sends neither
    const b = s.budgets, one = (label, m) => { const pct = Math.min(100, m.used / m.limit * 100); return `<div class="meter ${pct > 90 ? 'full' : pct > 70 ? 'high' : ''}" title="The game sends all ${label} to each player in one packet with a fixed size limit.">${label}: ${m.used.toLocaleString()} of ${m.limit.toLocaleString()} bytes<div class="bar"><i style="width:${pct}%"></i></div></div>`; };
    $('#meters').innerHTML = s.needsSetup ? '' : one('custom items', b.customItems) + one('custom NPCs', b.customDefinitions);
    $('#free-ids').textContent = s.needsSetup ? '' : `${s.mode === 'standalone' ? 'No game server (export mode). ' : ''}Next free ids: item ${s.nextItemId}, NPC ${s.nextNpcId}`;
    $('#game-dot').className = 'dot ' + (s.needsSetup ? 'warn' : 'ok'); $('#rs3-dot').className = 'dot ' + (s.rs3Cache ? 'ok' : 'warn');
    $('#open-game').title = s.needsSetup ? 'Not set yet: choose your game server folder or an OSRS cache' : s.mode === 'standalone' ? `No game server: ports go to ${s.exportDir}. OSRS cache: ${s.cacheDir}` : `Game server: ${s.serverDir}`;
    $('#open-rs3').title = s.rs3Cache ? `RS3 cache in use: ${s.rs3Cache}` : 'No RS3 cache loaded yet: find or choose one';
    const strip = $('#strip'); strip.hidden = !s.problems.length; strip.innerHTML = s.problems.map(esc).join('<br>') + (s.problems.length ? ' <button class="btn quiet" id="strip-fix">Choose folders</button>' : '');
  }
  // ---------- folders: find a cache or server, or choose where it is ----------
  const PLACE = {
    rs3: { title: 'RS3 cache', want: ['rs3'], what: 'RS3 cache', found: 'rs3',
      about: (st) => `An RS3 cache here is a folder of numbered folders (19, 47, 53, 255 and more) full of .dat files. It can be anywhere on this computer, for example in Downloads. The Studio's own drop folder is <b>${esc(st.found.dropFolders.rs3)}</b>: a cache put there is picked up by itself.` },
    game: { title: 'Game folder', want: ['server', 'osrs'], what: 'game server or OSRS cache', found: 'servers',
      about: (st) => `Choose your game server's folder (the one that holds <b>data/definitions</b>) and "Port to game" writes into it. No server? Choose an OSRS cache instead (a folder with <b>main_file_cache.dat2</b>): everything works, and ports are written to the Studio's own export folder.` },
  };
  const TAGS = { rs3: 'RS3 cache', osrs: 'OSRS cache', server: 'game server' };
  async function placeDialog(kind, intro) {
    const P = PLACE[kind]; let st;
    try { st = await api.get('/api/setup'); } catch (e) { return toast(/No such address/.test(e.message) ? 'The Studio was updated while it was running. Close its black window and start it again, then press this button.' : e.message, 9000); }
    const s = st.status, c = s.capabilities || {}, cap = (ok, label) => `<span class="${ok ? 'yes' : 'no'}">${label}</span>`;
    const now = kind === 'rs3' ? (s.rs3Cache ? `<div class="msg ok">In use: ${esc(s.rs3Cache)}</div>` : '<div class="msg warn">No RS3 cache is loaded yet, so the RS3 items tab is empty.</div>')
      : s.needsSetup ? '<div class="msg warn">Not set yet. The Studio needs a game server folder or an OSRS cache before it can show anything.</div>'
      : s.mode === 'standalone' ? `<div class="msg ok">No game server. OSRS cache: ${esc(s.cacheDir)}<br>Ports are written to ${esc(s.exportDir)}</div>`
      : `<div class="msg ok">Game server: ${esc(s.serverDir)}<br>OSRS cache: ${esc(s.cacheDir)}</div><div class="caps" title="What this server has code to load. Anything marked red is still written, but will not show in game until the server can load it.">${cap(c.items, 'custom items')}${cap(c.npcs, 'custom NPCs')}${cap(c.animations, 'custom animations')}${cap(c.particles, 'cape particles')}${cap(c.autoRestart, 'restarts by itself')}</div>`;
    modal(P.title, `${intro ? `<p>${intro}</p>` : ''}<div id="pl-now">${now}</div><p class="note">${P.about(st)}</p>
      <h3>Find it for me</h3>
      <p class="note">Looks in Downloads, Desktop, Documents and the Studio's own folders.</p>
      <button class="btn" id="pl-find">Search this computer</button><ul class="found" id="pl-found"></ul>
      <h3>Choose the folder myself</h3>
      <div class="places" id="pl-places"></div>
      <div class="pathrow"><input id="pl-path" type="text" spellcheck="false" aria-label="Folder path" placeholder="Paste a folder path and press Enter"><button class="btn" id="pl-up">Up one folder</button></div>
      <ul class="folders" id="pl-list"></ul>
      <div id="pl-here"></div><div id="pl-result"></div>
      ${kind === 'game' && s.mode === 'server' ? '<p class="note" style="margin-top:12px">Want to try things without touching a server? <button class="btn quiet" id="pl-alone">Use the Studio without a game server</button></p>' : ''}`,
      [{ label: 'Close' }], true);
    const use = async (path, as) => {
      const out = $('#pl-result'); out.innerHTML = '<div class="msg">Checking that folder...</div>';
      const body = kind === 'rs3' ? { rs3Cache: path } : as === 'osrs' ? { osrsCache: path } : as === 'alone' ? { standalone: true } : { serverDir: path, osrsCache: '' };
      let r; try { r = await api.post('/api/setup', body); } catch (e) { out.innerHTML = `<div class="msg bad">${esc(e.message)}</div>`; return; }
      if (!r.ok) { out.innerHTML = r.problems.map((x) => `<div class="msg bad">${esc(x)}</div>`).join(''); return; }
      if (kind !== 'rs3') { out.innerHTML = '<div class="msg ok">Saved. Loading the Studio again...</div>'; return void setTimeout(() => location.reload(), 500); }
      state.status = Object.assign(state.status, r.status); meters(); cache.targets.clear();
      $('#pl-now').innerHTML = `<div class="msg ok">In use: ${esc(r.status.rs3Cache || path)}</div>`;
      const v = r.rs3 || {}; out.innerHTML = `<div class="msg ${v.verdict === 'works' ? 'ok' : v.verdict === 'partly' ? 'warn' : 'bad'}">Loaded ${esc(r.status.rs3Cache || path)}<br>${esc(v.summary || '')}</div>${(v.problems || []).map((x) => `<div class="msg warn">${esc(x)}</div>`).join('')}`;
      if (state.tab === 'rs3') runSearch();
    };
    const useBtn = (path, is, label) => `<button class="btn primary" data-use="${esc(path)}" data-as="${is}">${label}</button>`;
    const go = async (dir) => {
      let b; try { b = await api.post('/api/browse', { dir }); } catch (e) { return void ($('#pl-list').innerHTML = `<li class="none">${esc(e.message)}</li>`); }
      if (!$('#pl-list')) return;
      $('#pl-path').value = b.dir; $('#pl-up').disabled = !b.parent; $('#pl-up').dataset.dir = b.parent || '';
      $('#pl-places').innerHTML = b.places.map((q) => `<button class="btn quiet" data-dir="${esc(q.path)}">${esc(q.name)}</button>`).join('');
      $('#pl-list').innerHTML = b.error ? `<li class="none">${esc(b.error)}</li>` : b.folders.length ? b.folders.map((f) => `<li tabindex="0" data-dir="${esc(f.path)}">${esc(f.name)}${f.is ? `<span class="tag ${P.want.includes(f.is) ? '' : 'other'}">${TAGS[f.is]}</span>` : ''}</li>`).join('') + (b.more ? `<li class="none">and ${b.more} more folders: paste the path above to open one.</li>` : '') : '<li class="none">No folders in here.</li>';
      const inside = b.inside ? (kind === 'rs3' ? b.inside.rs3.map((q) => [q, 'rs3']) : b.inside.osrs.map((q) => [q, 'osrs'])) : [];
      $('#pl-here').innerHTML = P.want.includes(b.is) ? `<div class="msg ok">This folder is ${b.is === 'osrs' ? 'an' : 'a'} ${TAGS[b.is]}. ${useBtn(b.dir, b.is, 'Use this folder')}</div>`
        : inside.length ? inside.map(([q, is]) => `<div class="msg ok">Found inside this folder: ${esc(q)} ${useBtn(q, is, 'Use it')}</div>`).join('')
        : `<p class="note">This folder is not ${P.what === 'RS3 cache' ? 'an RS3 cache' : 'a game server or an OSRS cache'}. Open the folder that is, and a "Use this folder" button appears here.</p>`;
    };
    const card = $('#modal-body');
    card.onclick = (e) => {
      const u = e.target.closest('[data-use]'); if (u) return void use(u.dataset.use, u.dataset.as);
      const d = e.target.closest('[data-dir]'); if (d && d.dataset.dir) return void go(d.dataset.dir);
      if (e.target.id === 'pl-alone') return void use('', 'alone');
      if (e.target.id === 'pl-find') (async () => {
        const btn = e.target, box = $('#pl-found'); btn.disabled = true; btn.textContent = 'Searching...';
        try {
          const f = await api.post('/api/find', {}), hits = kind === 'rs3' ? f.rs3.map((q) => [q, 'rs3']) : f.servers.map((q) => [q, 'server']).concat(f.osrs.map((q) => [q, 'osrs']));
          box.innerHTML = hits.length ? hits.map(([q, is]) => `<li><span>${esc(q)} <em class="note">(${TAGS[is]})</em></span>${useBtn(q, is, 'Use this')}</li>`).join('')
            : `<li><span>Nothing found in ${f.lookedIn.map(esc).join(', ')}.${f.complete ? '' : ' The search stopped early because there were too many folders.'} Choose the folder yourself below.</span></li>`;
        } catch (err) { box.innerHTML = `<li><span>${esc(err.message)}</span></li>`; }
        btn.disabled = false; btn.textContent = 'Search again';
      })();
    };
    card.onkeydown = (e) => { if (e.key !== 'Enter') return; if (e.target.id === 'pl-path') go(e.target.value); else { const d = e.target.closest('li[data-dir]'); if (d) go(d.dataset.dir); } };
    const start = kind === 'rs3' ? (s.rs3Cache || st.found.rs3Caches[0] || st.found.dropFolders.rs3) : (s.serverDir || st.found.servers[0] || s.cacheDir || '');
    await go(start);
  }
  async function act(a, el) {
    const info = state.info;
    if (a === 'edit-copy') await startDraft({ from: 'game', id: info.id, name: info.custom ? info.name + ' (copy)' : 'Custom ' + info.name.toLowerCase() });
    else if (a === 'edit-replace') await startDraft({ from: 'game', id: info.id, replace: true });
    else if (a === 'npc-copy') await startDraft({ from: 'npc', id: info.id, name: 'Custom ' + info.name.toLowerCase() });
    else if (a === 'npc-anim') { state.npcAnim = state.npcAnim === 'walk' ? 'idle' : 'walk'; if (state.draft) renderDraft(); else renderNpc(); await refreshScene(true); }
    else if (a === 'diagnose') await diagnose();
    else if (a === 'gamecheck') await gamecheck();
    else if (a === 'gamefix') await gamefix();
    else if (a === 'anim-for-npc') await startDraft({ from: 'anim', name: `${info.name} animation`, for: 'npc:' + info.id });
    else if (a === 'anim-copy') await startDraft({ from: 'anim', name: `${info.name || 'Animation ' + info.id} (copy)`, for: state.animFor, fromAnim: info.id });
    else if (a === 'anim-new') { const who = $('#an-for').value === 'npc' ? 'npc:' + (+$('#an-npc').value || 0) : 'player'; await startDraft({ from: 'anim', name: $('#an-name').value.trim() || 'My animation', for: who, loop: $('#an-loop').checked }); }
    else if (a === 'key-add' || a === 'key-copy') {
      const an = state.draft.anim, t = Math.max(0, Math.round((+$('#key-time').value || 0) * 50)), keys = an.keys.slice().sort((x, y) => x.t - y.t);
      const src = a === 'key-copy' ? animKeyNow() : keys.filter((k) => k.t <= t).pop() || null, at = an.keys.find((k) => k.t === t);
      const pose = src ? JSON.parse(JSON.stringify(src.pose)) : {};
      if (at) at.pose = a === 'key-copy' ? pose : at.pose; else an.keys.push({ t, pose });
      an.keys.sort((x, y) => x.t - y.t); state.animKey = t; state.animPlaying = false; scheduleSave(); await buildDraft(true);
    }
    else if (a === 'key-remove') { const an = state.draft.anim; an.keys = an.keys.filter((k) => k.t !== state.animKey); state.animKey = an.keys.length ? an.keys[0].t : null; scheduleSave(); await buildDraft(true); }
    else if (a === 'anim-play') { state.animPlaying = !state.animPlaying; if (state.animPlaying) await buildDraft(true); else { renderDraft(); await showAnimDraft(true); } }
    else if (a === 'joint-reset') { const k = animKeyNow(); if (k && state.animJoint !== null) { delete k.pose[state.animJoint]; animPoseChanged(true); } }
    else if (a === 'rs3-start') { const type = $('#new-type').value; if ((type === 'weapon' || type === 'armour' || type === 'cape') && !state.basePick) return toast('Choose the OSRS item it plays as first'); await startDraft({ from: 'rs3', id: info.id, name: $('#new-name').value.trim() || info.name, type, base: state.basePick ? state.basePick.id : -1 }); }
    else if (a === 'build') await buildDraft(true);
    else if (a === 'port') await portFlow();
    else if (a === 'remove-draft') modal('Remove this draft?', '<p>The draft moves to the studio\'s own trash folder. Anything already ported stays in the game.</p>', [{ label: 'Keep it' }, { label: 'Remove draft', primary: true, run: async () => { await api.post(`/api/draft/${encodeURIComponent(state.draft.slug)}/remove`); closeModal(); state.draft = null; $('#inspector').innerHTML = ''; viewer.setParts([]); $('#empty').hidden = false; await loadTab('drafts'); } }]);
    else if (a === 'swap') { if (state.swatch !== null) swapColour(state.swatch, state.brush); }
    else if (a === 'undo-paint') undoPaint();
    else if (a === 'clear-paint') { const d = state.draft; if (d.kind === 'item') { const s = d.item.models[state.view]; if (s && s.edits) delete s.edits.paint; } else for (const m of d.npc.models || []) if (m.edits) delete m.edits.paint; state.undo = []; scheduleSave(); await buildDraft(true); }
    else if (a === 'undo') modal('Undo this port?', '<p>The previous files go back and the game server restarts once.</p>', [{ label: 'Leave it' }, { label: 'Undo port', primary: true, run: async () => { try { const r = await api.post(`/api/ports/${encodeURIComponent(el.dataset.key)}/undo`); closeModal(); toast('Undone: ' + r.done.join('; '), 7000); state.status = await api.get('/api/status'); meters(); await loadTab('ports'); await showPort(el.dataset.key); } catch (e) { closeModal(); toast(e.message, 8000); } } }]);
  }
  async function init() {
    viewer = new window.Viewer($('#view'));
    viewer.onHover = (hit) => { if (!viewer.mesh) return; status(hit ? `${state.sceneInfo}   |   face ${hit.local} of ${esc(hit.tag)}, colour ${hit.colour}${hit.label >= 0 ? `, bone label ${hit.label}` : ''}${hit.textured ? ', textured' : ''}` : state.sceneInfo); };
    viewer.onPaint = onPaint;
    state.status = await api.get('/api/status'); meters();
    $('#open-game').addEventListener('click', () => placeDialog('game'));
    $('#open-rs3').addEventListener('click', () => placeDialog('rs3'));
    $('#strip').addEventListener('click', (e) => { if (e.target.id === 'strip-fix') placeDialog(state.status.needsSetup || !/RS3/.test(state.status.problems.join(' ')) ? 'game' : 'rs3'); });
    $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal') closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else setTool(null); } });
    if (state.status.needsSetup) { $('#empty').querySelector('h2').textContent = 'Choose your game folder first'; $('#empty').querySelector('p').textContent = 'Press "Game folder" at the top and pick your game server, or an OSRS cache to use the Studio without one.'; return void placeDialog('game', 'Welcome. Before anything can be shown, tell the Studio where your game is.'); }
    $('#anim').innerHTML = state.status.anims.map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
    $('#tabs').addEventListener('click', (e) => { const b = e.target.closest('button[data-tab]'); if (b) loadTab(b.dataset.tab); });
    $('#q').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(runSearch, 220); });
    const res = $('#results'); res.addEventListener('click', (e) => { const li = e.target.closest('li[data-key]'); if (li) pick(li.dataset.key); });
    res.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const li = e.target.closest('li[data-key]'); if (li) pick(li.dataset.key); } });
    $('#views').addEventListener('click', (e) => { const b = e.target.closest('button[data-view]'); if (!b || b.disabled) return; state.view = b.dataset.view; state.swatch = null; setTool(null); if (state.draft) renderDraft(); refreshScene(); });
    $('#anim').addEventListener('change', async (e) => { state.animId = +e.target.value; if (state.view !== 'ground') viewer.setAnim(await anim(state.animId)); });
    $('#play').addEventListener('click', (e) => { viewer.playing = !viewer.playing; e.target.textContent = viewer.playing ? 'Pause' : 'Play'; });
    $('#heat').addEventListener('change', (e) => { state.heat = e.target.checked; refreshScene(true); });
    $('#reset-cam').addEventListener('click', () => viewer.resetCamera());
    const ins = $('#inspector');
    ins.addEventListener('change', (e) => { const el = e.target;
      if (el.id === 'npc-seq') { state.npcSeq = +el.value; return void anim(state.npcSeq).then((a) => viewer.setAnim(a)); }
      if (el.id === 'anim-for') { state.animFor = el.value; return void showAnimInfo(); }
      if (el.id === 'joint-pick') { state.animJoint = el.value === '' ? null : +el.value; state.animPlaying = false; renderDraft(); return void showAnimDraft(true); }
      if (el.id === 'joint-all') { state.animAll = el.checked; return void renderDraft(); }
      if (el.dataset.axisnum !== undefined || el.dataset.axis !== undefined) return;
      if (el.dataset.path) onField(el); else if (el.id === 'brush-hex') { const m = /^#?([0-9a-f]{6})$/i.exec(el.value.trim()); if (m) { const n = parseInt(m[1], 16); setBrush(M.rgbToHsl(n >> 16 & 255, n >> 8 & 255, n & 255)); } } else if (el.id === 'brush-num') setBrush(+el.value || 0); });
    ins.addEventListener('input', async (e) => {
      const el = e.target;
      if (el.dataset.axis !== undefined || el.dataset.axisnum !== undefined) {
        const k = animKeyNow(), b = state.build, j = b && b.target.controls.find((c) => c.id === state.animJoint); if (!k || !j) return;
        const i = +(el.dataset.axis !== undefined ? el.dataset.axis : el.dataset.axisnum), cur = k.pose[j.id] || (j.kind === 'scale' ? [128, 128, 128] : [0, 0, 0]);
        cur[i] = +el.value || 0; k.pose[j.id] = cur;
        const other = el.dataset.axis !== undefined ? $(`[data-axisnum="${i}"]`) : $(`[data-axis="${i}"]`); if (other) other.value = cur[i];
        state.animPlaying = false; return void animPoseChanged(false);
      }
      if (el.dataset.brush) { const v = { h: state.brush >> 10 & 63, s: state.brush >> 7 & 7, l: state.brush & 127 }; v[el.dataset.brush] = +el.value; setBrush((v.h << 10) | (v.s << 7) | v.l); }
      else if (el.id === 'base-q') { const q = el.value.trim(), box = $('#base-results'); if (q.length < 2) { box.innerHTML = ''; return; } const r = await api.get('/api/search?kind=item&q=' + encodeURIComponent(q)); box.innerHTML = r.results.filter((x) => x.note !== 'custom').slice(0, 30).map((x) => `<li data-base="${x.id}" data-name="${esc(x.name)}"><span class="id">${x.id}</span><span class="name">${esc(x.name)}</span><span class="note">${esc(x.note)}</span></li>`).join(''); }
    });
    ins.addEventListener('click', (e) => {
      const b = e.target.closest('[data-act]'); if (b && !b.disabled) return void act(b.dataset.act, b).catch((err) => toast(err.message, 7000));
      const kb = e.target.closest('[data-key]'); if (kb) { state.animKey = +kb.dataset.key; state.animPlaying = false; renderDraft(); return void showAnimDraft(true); }
      const t = e.target.closest('[data-tool]'); if (t) return setTool(state.tool === t.dataset.tool ? null : t.dataset.tool);
      const s = e.target.closest('[data-swatch]'); if (s) { state.swatch = +s.dataset.swatch; $$('.swatch').forEach((x) => x.classList.toggle('sel', x === s)); const sw = $('[data-act="swap"]'); sw.disabled = false; sw.textContent = `Swap colour ${state.swatch} for this`; return; }
      const base = e.target.closest('[data-base]'); if (base) { state.basePick = { id: +base.dataset.base, name: base.dataset.name }; $('#base-picked').textContent = `Plays as ${state.basePick.name} (${state.basePick.id}).`; $('#base-results').innerHTML = ''; $('#base-q').value = state.basePick.name; }
    });
    window.addEventListener('beforeunload', () => { if (state.dirty) saveDraft(); });
    window.studio = { state, viewer, pick, loadTab, buildDraft };
    await loadTab('item');
  }
  init().catch((e) => { document.body.innerHTML = `<div style="padding:40px;font:16px sans-serif;color:#ebe0c8">The studio could not start: ${esc(e.message)}</div>`; });
})();
