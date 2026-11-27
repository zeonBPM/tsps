// 3D viewer: draws game models with the game's own lighting, plays animations, shows the stretch heat map,
// and lets you pick or paint single faces. Drag = rotate, right-drag or Shift-drag = move, wheel = zoom,
// double-click = reset the camera.
(function () {
  'use strict';
  const M = window.Model, A = window.Anim;

  function mat4() { return new Float32Array(16); }
  function mul(a, b) { const o = mat4(); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) { let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; }
  function persp(fov, aspect, near, far) { const f = 1 / Math.tan(fov / 2), o = mat4(); o[0] = f / aspect; o[5] = f; o[10] = (far + near) / (near - far); o[11] = -1; o[14] = 2 * far * near / (near - far); return o; }
  function ident() { const o = mat4(); o[0] = o[5] = o[10] = o[15] = 1; return o; }
  function trans(x, y, z) { const o = ident(); o[12] = x; o[13] = y; o[14] = z; return o; }
  function rotX(a) { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[5] = c; o[6] = s; o[9] = -s; o[10] = c; return o; }
  function rotY(a) { const o = ident(), c = Math.cos(a), s = Math.sin(a); o[0] = c; o[2] = -s; o[8] = s; o[10] = c; return o; }
  function scale(x, y, z) { const o = ident(); o[0] = x; o[5] = y; o[10] = z; return o; }

  const VS = 'attribute vec3 p; attribute vec4 c; uniform mat4 m; varying vec4 v; void main(){ v = c; gl_Position = m * vec4(p, 1.0); }';
  const FS = 'precision mediump float; varying vec4 v; void main(){ gl_FragColor = v; }';
  const HEAT = [[60, 130, 220], [240, 210, 60], [235, 70, 50]];
  function heatColour(t) { t = Math.max(0, Math.min(1, t)); const i = t < 0.5 ? 0 : 1, f = t < 0.5 ? t * 2 : (t - 0.5) * 2; return [0, 1, 2].map((k) => HEAT[i][k] + (HEAT[i + 1][k] - HEAT[i][k]) * f); }

  class Viewer {
    constructor(canvas) {
      this.canvas = canvas;
      const gl = this.gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true }) || canvas.getContext('experimental-webgl');
      if (!gl) throw new Error('This browser cannot show 3D (WebGL is off).');
      const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return s; };
      const prog = this.prog = gl.createProgram();
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(prog); gl.useProgram(prog);
      this.aPos = gl.getAttribLocation(prog, 'p'); this.aCol = gl.getAttribLocation(prog, 'c'); this.uMvp = gl.getUniformLocation(prog, 'm');
      this.bufPos = gl.createBuffer(); this.bufCol = gl.createBuffer(); this.bufGrid = gl.createBuffer(); this.bufGridCol = gl.createBuffer();
      this.cam = { yaw: Math.PI - 0.6, pitch: 0.2, dist: 600, target: [0, -60, 0] };
      this.mesh = null; this.parts = []; this.anim = null; this.playing = true; this.speed = 1; this.time = 0; this.frameIndex = 0;
      this.heat = null; this.textureColours = new Map(); this.onHover = null; this.onPaint = null; this.tool = null; this.dirty = true;
      this.lighting = [64, 850, -30, -50, -30]; this.showGrid = true; this.bg = [0.118, 0.137, 0.153];
      this._bind(); this._grid();
      const loop = (t) => { this._tick(t); requestAnimationFrame(loop); };
      requestAnimationFrame(loop);
    }
    /** parts: [{ mesh, tag }] in the order the game merges them. */
    setParts(parts, opt) {
      opt = opt || {};
      this.parts = parts;
      this.mesh = parts.length ? M.merge(parts.map((p) => p.mesh)) : null;
      this.rest = this.mesh ? A.positions(this.mesh) : null;
      this.groups = this.mesh ? A.groups(this.mesh.vskin, this.mesh.nv) : null;
      // local face index of every merged face inside its own part
      if (this.mesh) { const n = new Int32Array(parts.length); this.local = new Int32Array(this.mesh.nf); for (let f = 0; f < this.mesh.nf; f++) this.local[f] = n[this.mesh.src[f]]++; }
      if (opt.lighting) this.lighting = opt.lighting;
      this.hideUnderFloor = !!opt.hideUnderFloor;
      this.heat = null; this.dirty = true;
      if (opt.fit !== false) this.fit();
    }
    fit() {
      if (!this.mesh || !this.mesh.nv) return;
      const b = M.bounds(this.mesh), c = [0, 1, 2].map((k) => (b.min[k] + b.max[k]) / 2), r = Math.max(40, Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) / 2);
      this.cam.target = c; this.cam.dist = r / Math.sin(0.26) * 1.05; this.dirty = true;
    }
    resetCamera() { this.cam.yaw = Math.PI - 0.6; this.cam.pitch = 0.2; this.fit(); }
    setAnim(anim) { this.anim = anim && anim.frames && anim.frames.length ? anim : null; this.time = 0; this.frameIndex = 0; this.dirty = true; }
    /** perFace: stretch ratio of each face of the part with this tag. */
    setHeat(tag, perFace, threshold) { this.heat = perFace ? { tag, perFace, threshold: threshold || 1.4 } : null; this.dirty = true; }
    setTextureColour(id, hsl) { this.textureColours.set(id, hsl); this.dirty = true; }
    /** Change one face's colour in place (painting). partIndex/localFace as returned by pick(). */
    paintFace(partIndex, localFace, hsl) {
      const part = this.parts[partIndex]; if (!part) return;
      part.mesh.col[localFace] = hsl; if (part.mesh.ftex) part.mesh.ftex[localFace] = -1;
      for (let f = 0; f < this.mesh.nf; f++) if (this.mesh.src[f] === partIndex && this.local[f] === localFace) { this.mesh.col[f] = hsl; if (this.mesh.ftex) this.mesh.ftex[f] = -1; break; }
      this.dirty = true;
    }
    _grid() {
      const gl = this.gl, lines = [], cols = [], n = 3, t = 128;
      for (let i = -n; i <= n; i++) { lines.push(i * t, 0, -n * t, i * t, 0, n * t, -n * t, 0, i * t, n * t, 0, i * t); for (let k = 0; k < 4; k++) cols.push(255, 255, 255, i === 0 ? 46 : 20); }
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGrid); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STATIC_DRAW);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufGridCol); gl.bufferData(gl.ARRAY_BUFFER, new Uint8Array(cols), gl.STATIC_DRAW);
      this.gridCount = lines.length / 3;
    }
    _mvp() {
      const c = this.canvas, cam = this.cam, aspect = c.width / Math.max(1, c.height);
      const view = mul(trans(0, 0, -cam.dist), mul(rotX(cam.pitch), mul(rotY(cam.yaw), mul(scale(1, -1, 1), trans(-cam.target[0], -cam.target[1], -cam.target[2])))));
      return mul(persp(0.52, aspect, Math.max(4, cam.dist / 50), cam.dist * 8 + 4000), view);
    }
    _bind() {
      const c = this.canvas; let drag = null;
      c.addEventListener('contextmenu', (e) => e.preventDefault());
      c.addEventListener('pointerdown', (e) => {
        c.setPointerCapture(e.pointerId);
        const pan = e.button === 2 || e.button === 1 || e.shiftKey;
        if (this.tool && e.button === 0 && !e.shiftKey && !e.altKey) { drag = { mode: 'paint' }; this._paintAt(e); }
        else drag = { mode: pan ? 'pan' : 'orbit', x: e.clientX, y: e.clientY };
      });
      c.addEventListener('pointermove', (e) => {
        if (!drag) { if (this.onHover) this.onHover(this.pick(e.clientX, e.clientY)); return; }
        if (drag.mode === 'paint') { this._paintAt(e); return; }
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
        if (drag.mode === 'orbit') { this.cam.yaw += dx * 0.008; this.cam.pitch = Math.max(-1.5, Math.min(1.5, this.cam.pitch + dy * 0.008)); }
        else { const k = this.cam.dist * 0.0011, cy = Math.cos(this.cam.yaw), sy = Math.sin(this.cam.yaw); this.cam.target[0] -= dx * k * cy; this.cam.target[2] -= dx * k * sy; this.cam.target[1] -= dy * k; }
        this.dirty = true;
      });
      const end = () => { if (drag && drag.mode === 'paint' && this.onPaint) this.onPaint(null, true); drag = null; };
      c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
      c.addEventListener('wheel', (e) => { e.preventDefault(); this.cam.dist = Math.max(30, Math.min(20000, this.cam.dist * Math.exp(e.deltaY * 0.0012))); this.dirty = true; }, { passive: false });
      c.addEventListener('dblclick', () => this.resetCamera());
    }
    _paintAt(e) { const hit = this.pick(e.clientX, e.clientY); if (hit && this.onPaint) this.onPaint(hit, false); }
    /** Which face is under the pointer: { face, part, tag, local, colour, label } or null. */
    pick(clientX, clientY) {
      if (!this.mesh || !this.screen) return null;
      const r = this.canvas.getBoundingClientRect(), x = (clientX - r.left) * (this.canvas.width / r.width), y = (clientY - r.top) * (this.canvas.height / r.height);
      const S = this.screen, m = this.mesh; let best = -1, bz = Infinity;
      for (let f = 0; f < m.nf; f++) {
        if (m.alpha && m.alpha[f] >= 250) continue;
        const a = m.fa[f] * 3, b = m.fb[f] * 3, c = m.fc[f] * 3;
        const d = (S[b] - S[a]) * (S[c + 1] - S[a + 1]) - (S[c] - S[a]) * (S[b + 1] - S[a + 1]);
        if (Math.abs(d) < 1e-9) continue;
        const w1 = ((x - S[a]) * (S[c + 1] - S[a + 1]) - (S[c] - S[a]) * (y - S[a + 1])) / d, w2 = ((S[b] - S[a]) * (y - S[a + 1]) - (x - S[a]) * (S[b + 1] - S[a + 1])) / d, w0 = 1 - w1 - w2;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const z = w0 * S[a + 2] + w1 * S[b + 2] + w2 * S[c + 2];
        if (z < bz && z > -1) { bz = z; best = f; }
      }
      if (best < 0) return null;
      const part = m.src[best];
      return { face: best, part, tag: this.parts[part].tag, local: this.local[best], colour: m.col[best], label: m.vskin ? m.vskin[m.fa[best]] : -1, textured: !!(m.ftex && m.ftex[best] !== -1) };
    }
    /** Faces of one part that touch `localFace` through shared corners and have the same colour (for the Fill tool). */
    connectedSameColour(partIndex, localFace) {
      const m = this.parts[partIndex].mesh, target = m.col[localFace], byVert = new Map();
      const key = (v) => m.vx[v] + ',' + m.vy[v] + ',' + m.vz[v];
      for (let f = 0; f < m.nf; f++) if (m.col[f] === target) for (const v of [m.fa[f], m.fb[f], m.fc[f]]) { const k = key(v); if (!byVert.has(k)) byVert.set(k, []); byVert.get(k).push(f); }
      const seen = new Set([localFace]), stack = [localFace];
      while (stack.length) { const f = stack.pop(); for (const v of [m.fa[f], m.fb[f], m.fc[f]]) for (const g of byVert.get(key(v)) || []) if (!seen.has(g)) { seen.add(g); stack.push(g); } }
      return [...seen];
    }
    /** Faces of one part whose corners all carry the same label as `localFace` (a body part / bone group). */
    sameLabel(partIndex, localFace) {
      const m = this.parts[partIndex].mesh; if (!m.vskin) return [localFace];
      const l = m.vskin[m.fa[localFace]], out = [];
      for (let f = 0; f < m.nf; f++) if (m.vskin[m.fa[f]] === l || m.vskin[m.fb[f]] === l || m.vskin[m.fc[f]] === l) out.push(f);
      return out;
    }
    _tick(t) {
      const c = this.canvas, w = Math.floor(c.clientWidth * (window.devicePixelRatio || 1)), h = Math.floor(c.clientHeight * (window.devicePixelRatio || 1));
      if (w && h && (c.width !== w || c.height !== h)) { c.width = w; c.height = h; this.dirty = true; }
      const dt = this._last ? Math.min(100, t - this._last) : 0; this._last = t;
      if (this.anim && this.playing) {
        this.time += dt * this.speed;
        let i = this.frameIndex, len = (this.anim.delays[i] || 1) * 20;
        while (this.time >= len) { this.time -= len; i = (i + 1) % this.anim.frames.length; len = (this.anim.delays[i] || 1) * 20; }
        if (i !== this.frameIndex) { this.frameIndex = i; this.dirty = true; }
      }
      if (this.dirty) { this.dirty = false; this._draw(); }
    }
    _draw() {
      const gl = this.gl, c = this.canvas, mvp = this._mvp();
      gl.viewport(0, 0, c.width, c.height); gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.uniformMatrix4fv(this.uMvp, false, mvp);
      const attr = (buf, loc, size, type, norm) => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, size, type, norm, 0, 0); };
      if (this.showGrid) { attr(this.bufGrid, this.aPos, 3, gl.FLOAT, false); attr(this.bufGridCol, this.aCol, 4, gl.UNSIGNED_BYTE, true); gl.drawArrays(gl.LINES, 0, this.gridCount); }
      const m = this.mesh; this.screen = null;
      if (!m || !m.nf) return;
      let P = this.rest;
      if (this.anim) { P = this.rest.slice(); A.apply(P, this.groups, this.anim.frames[this.frameIndex] || []); }
      // screen positions for picking
      const S = this.screen = new Float32Array(m.nv * 3);
      for (let i = 0; i < m.nv; i++) {
        const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2];
        const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12], cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13], cz = mvp[2] * x + mvp[6] * y + mvp[10] * z + mvp[14], cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
        S[i * 3] = (cx / cw * 0.5 + 0.5) * c.width; S[i * 3 + 1] = (1 - (cy / cw * 0.5 + 0.5)) * c.height; S[i * 3 + 2] = cw > 0 ? cz / cw : 2;
      }
      const tmp = Object.assign({}, m, { vx: new Int32Array(m.nv), vy: new Int32Array(m.nv), vz: new Int32Array(m.nv) });
      for (let i = 0; i < m.nv; i++) { tmp.vx[i] = Math.round(P[i * 3]); tmp.vy[i] = Math.round(P[i * 3 + 1]); tmp.vz[i] = Math.round(P[i * 3 + 2]); }
      const L = this.lighting, lit = M.light(tmp, L[0], L[1], L[2], L[3], L[4]);
      const pos = new Float32Array(m.nf * 9), col = new Uint8Array(m.nf * 12);
      const heatPart = this.heat ? this.parts.findIndex((p) => p.tag === this.heat.tag) : -1;
      let n = 0; const solid = [], clear = [];
      for (let f = 0; f < m.nf; f++) {
        if (lit[f * 3] === -2 || (m.alpha && m.alpha[f] === 255)) continue;
        // the game's own pivot markers sit just under the floor; they are never seen in game
        if (this.hideUnderFloor && m.vy[m.fa[f]] > 2 && m.vy[m.fb[f]] > 2 && m.vy[m.fc[f]] > 2) continue;
        (m.alpha && m.alpha[f] > 0 ? clear : solid).push(f);
      }
      const put = (f) => {
        const v = [m.fa[f], m.fb[f], m.fc[f]], alpha = m.alpha ? 255 - m.alpha[f] : 255;
        let over = null;
        if (heatPart >= 0 && m.src[f] === heatPart) { const r = this.heat.perFace[this.local[f]] || 1; if (r > 1.08) over = heatColour((r - 1) / (this.heat.threshold - 1) / 2); }
        for (let k = 0; k < 3; k++) {
          pos[n * 3] = P[v[k] * 3]; pos[n * 3 + 1] = P[v[k] * 3 + 1]; pos[n * 3 + 2] = P[v[k] * 3 + 2];
          let rgb;
          if (m.ftex && m.ftex[f] !== -1) rgb = M.hslToRgb(M.adjust(this.textureColours.has(m.ftex[f]) ? this.textureColours.get(m.ftex[f]) : 4660, Math.max(20, Math.min(120, lit[f * 3 + k] & 127))));
          else rgb = M.hslToRgb(lit[f * 3 + k]);
          let r = rgb >> 16 & 255, g = rgb >> 8 & 255, b = rgb & 255;
          if (over) { r = r * 0.25 + over[0] * 0.75; g = g * 0.25 + over[1] * 0.75; b = b * 0.25 + over[2] * 0.75; }
          col[n * 4] = r; col[n * 4 + 1] = g; col[n * 4 + 2] = b; col[n * 4 + 3] = alpha; n++;
        }
      };
      solid.forEach(put); const solidCount = n; clear.forEach(put);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufPos); gl.bufferData(gl.ARRAY_BUFFER, pos.subarray(0, n * 3), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(this.aPos); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bufCol); gl.bufferData(gl.ARRAY_BUFFER, col.subarray(0, n * 4), gl.DYNAMIC_DRAW); gl.enableVertexAttribArray(this.aCol); gl.vertexAttribPointer(this.aCol, 4, gl.UNSIGNED_BYTE, true, 0, 0);
      gl.drawArrays(gl.TRIANGLES, 0, solidCount);
      if (n > solidCount) { gl.depthMask(false); gl.drawArrays(gl.TRIANGLES, solidCount, n - solidCount); gl.depthMask(true); }
    }
  }
  window.Viewer = Viewer;
})();
