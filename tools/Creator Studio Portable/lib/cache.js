'use strict';
// Read-only cache readers. Nothing in this file ever writes to a cache.
//   Dat2Cache : the OSRS cache the server uses (main_file_cache.dat2 + .idx files)
//   FlatCache : the RS3 build-950 cache in OpenRS2 flat layout (cache/<index>/<group>.dat)
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const { Buf } = require('./buf');
const lzma = require('./lzma');
const bzip2 = require('../vendor/bzip2.js');

const BZ_HEADER = Buffer.from('BZh1');
function bunzip(body) {
  const data = Buffer.concat([BZ_HEADER, body]);
  const out = bzip2.simple(bzip2.array(data));
  return typeof out === 'string' ? Buffer.from(out, 'latin1') : Buffer.from(out);
}
/** A js5 container: u8 type, u32 packed length, [u32 unpacked length], payload. */
function decompress(data) {
  const type = data[0];
  const clen = data.readUInt32BE(1);
  if (type === 0) return data.subarray(5, 5 + clen);
  const ulen = data.readUInt32BE(5);
  const body = data.subarray(9, 9 + clen);
  if (type === 1) return bunzip(body);
  if (type === 2) return zlib.gunzipSync(body);
  if (type === 3) return lzma.decode(body.subarray(0, 5), body.subarray(5), ulen);
  throw new Error('unknown cache compression ' + type);
}
function rawDecompress(data) {
  if (data[0] === 0x5a && data[1] === 0x4c && data[2] === 0x42) return zlib.inflateSync(data.subarray(8));   // "ZLB"
  return decompress(data);
}
class BaseCache {
  constructor(root) { this.root = root; this.tables = new Map(); this.fileCache = new Map(); }
  group(index, group) { const d = this.raw(index, group); return d ? rawDecompress(d) : null; }
  /** Reference table of an index: Map groupId -> [fileIds]. */
  table(index) {
    let t = this.tables.get(index);
    if (t) return t;
    const raw = this.raw(255, index);
    if (!raw) throw new Error(`cache at ${this.root} has no index ${index}`);
    const b = new Buf(rawDecompress(raw));
    const fmt = b.u8();
    if (fmt >= 6) b.i32();
    const flags = b.u8();
    const cnt = fmt >= 7 ? () => b.smart32() : () => b.u16();
    const n = cnt();
    const ids = new Array(n);
    for (let i = 0, last = 0; i < n; i++) { last += cnt(); ids[i] = last; }
    if (flags & 1) b.skip(4 * n);
    b.skip(4 * n);
    if (flags & 8) b.skip(4 * n);
    if (flags & 2) b.skip(64 * n);
    if (flags & 4) b.skip(8 * n);
    b.skip(4 * n);
    const counts = ids.map(() => cnt());
    t = new Map();
    for (let i = 0; i < n; i++) {
      const fl = new Array(counts[i]);
      for (let k = 0, last = 0; k < counts[i]; k++) { last += cnt(); fl[k] = last; }
      t.set(ids[i], fl);
    }
    this.tables.set(index, t);
    return t;
  }
  groupIds(index) { return [...this.table(index).keys()]; }
  /** The files of a group as Map fileId -> Buffer. Small LRU so repeated lookups stay fast. */
  files(index, group) {
    const key = index + ':' + group;
    const hit = this.fileCache.get(key);
    if (hit) return hit;
    const out = new Map();
    const data = this.group(index, group);
    if (data) {
      const fids = this.table(index).get(group) || [0];
      if (fids.length === 1) out.set(fids[0], data);
      else {
        const chunks = data[data.length - 1], n = fids.length;
        let p = data.length - 1 - chunks * n * 4;
        const sizes = [], tot = new Int32Array(n);
        for (let c = 0; c < chunks; c++) {
          const row = new Int32Array(n);
          for (let f = 0, s = 0; f < n; f++, p += 4) { s += data.readInt32BE(p); row[f] = s; tot[f] += s; }
          sizes.push(row);
        }
        const bufs = Array.from(tot, (t) => Buffer.alloc(t)), at = new Int32Array(n);
        let off = 0;
        for (let c = 0; c < chunks; c++) for (let f = 0; f < n; f++) {
          data.copy(bufs[f], at[f], off, off + sizes[c][f]); at[f] += sizes[c][f]; off += sizes[c][f];
        }
        for (let i = 0; i < n; i++) out.set(fids[i], bufs[i]);
      }
    }
    if (this.fileCache.size > 24) this.fileCache.delete(this.fileCache.keys().next().value);
    this.fileCache.set(key, out);
    return out;
  }
  file(index, group, file) { return this.files(index, group).get(file) || null; }
}
class FlatCache extends BaseCache {
  constructor(root) {
    super(root);
    if (!fs.existsSync(path.join(root, '255'))) throw new Error('Not an OpenRS2 flat cache (no 255 folder): ' + root);
  }
  raw(index, group) {
    try { return fs.readFileSync(path.join(this.root, String(index), group + '.dat')); } catch { return null; }
  }
}
class Dat2Cache extends BaseCache {
  constructor(root) {
    super(root);
    this.dat = fs.openSync(path.join(root, 'main_file_cache.dat2'), 'r');
    this.idx = new Map();
  }
  close() { try { fs.closeSync(this.dat); } catch { /* already closed */ } for (const fd of this.idx.values()) try { fs.closeSync(fd); } catch { /* ignore */ } }
  raw(index, group) {
    let fd = this.idx.get(index);
    if (fd === undefined) {
      try { fd = fs.openSync(path.join(this.root, 'main_file_cache.idx' + index), 'r'); } catch { fd = null; }
      this.idx.set(index, fd);
    }
    if (fd === null) return null;
    const e = Buffer.alloc(6);
    if (fs.readSync(fd, e, 0, 6, group * 6) < 6) return null;
    const size = e.readUIntBE(0, 3);
    let sector = e.readUIntBE(3, 3);
    if (!size || !sector) return null;
    const hdr = group > 0xffff ? 10 : 8;
    const out = Buffer.alloc(size), blk = Buffer.alloc(520);
    let done = 0;
    while (done < size) {
      if (!sector) return null;
      fs.readSync(this.dat, blk, 0, 520, sector * 520);
      const n = Math.min(size - done, 520 - hdr);
      blk.copy(out, done, hdr, hdr + n);
      done += n;
      sector = blk.readUIntBE(hdr - 4, 3);
    }
    return out;
  }
}
module.exports = { Dat2Cache, FlatCache, decompress, rawDecompress };
