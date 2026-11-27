'use strict';
// Byte reader/writer used by every decoder. Big-endian unless the name says le.
const CP1252 = (() => { try { return new TextDecoder('windows-1252'); } catch { return new TextDecoder('latin1'); } })();
class Buf {
  constructor(b, p = 0) { this.b = b; this.p = p; }
  get left() { return this.b.length - this.p; }
  u8() { return this.b[this.p++]; }
  s8() { const v = this.b[this.p++]; return v > 127 ? v - 256 : v; }
  u16() { const v = (this.b[this.p] << 8) | this.b[this.p + 1]; this.p += 2; return v; }
  s16() { const v = this.u16(); return v > 32767 ? v - 65536 : v; }
  u16le() { const v = this.b[this.p] | (this.b[this.p + 1] << 8); this.p += 2; return v; }
  u24() { const v = (this.b[this.p] << 16) | (this.b[this.p + 1] << 8) | this.b[this.p + 2]; this.p += 3; return v; }
  i32() { const b = this.b, p = this.p; this.p += 4; return (b[p] << 24) | (b[p + 1] << 16) | (b[p + 2] << 8) | b[p + 3]; }
  u32() { return this.i32() >>> 0; }
  u32le() { const b = this.b, p = this.p; this.p += 4; return ((b[p + 3] << 24) | (b[p + 2] << 16) | (b[p + 1] << 8) | b[p]) >>> 0; }
  f32le() { const v = new DataView(this.b.buffer, this.b.byteOffset + this.p, 4).getFloat32(0, true); this.p += 4; return v; }
  smart32() { return (this.b[this.p] & 0x80) ? (this.i32() & 0x7fffffff) : this.u16(); }          // "big smart"
  smart() { return this.b[this.p] < 128 ? this.u8() : this.u16() - 32768; }                      // unsigned smart
  smart2() { return this.b[this.p] < 128 ? this.u8() - 64 : this.u16() - 49152; }                // signed smart
  bigsmartNull() { if (this.b[this.p] & 0x80) return this.i32() & 0x7fffffff; const v = this.u16(); return v === 32767 ? -1 : v; }
  str() { let e = this.p; while (e < this.b.length && this.b[e] !== 0) e++; const s = CP1252.decode(this.b.subarray(this.p, e)); this.p = e + 1; return s; }
  skip(n) { this.p += n; return this; }
  bytes(n) { const s = this.b.subarray(this.p, this.p + n); this.p += n; return s; }
}
/** Growable byte writer. */
class Out {
  constructor() { this.a = []; }
  get length() { return this.a.length; }
  u8(v) { this.a.push(v & 255); return this; }
  u16(v) { this.a.push((v >> 8) & 255, v & 255); return this; }
  i32(v) { this.a.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255); return this; }
  smart2(v) {
    if (v >= -64 && v < 64) this.a.push(v + 64);
    else if (v >= -16384 && v < 16384) { const w = v + 49152; this.a.push((w >> 8) & 255, w & 255); }
    else throw new Error('model delta out of range: ' + v + ' (model too large for the OSRS format)');
    return this;
  }
  put(o) { const src = o instanceof Out ? o.a : o; for (let i = 0; i < src.length; i++) this.a.push(src[i]); return this; }
  done() { return Buffer.from(this.a); }
}
module.exports = { Buf, Out };
