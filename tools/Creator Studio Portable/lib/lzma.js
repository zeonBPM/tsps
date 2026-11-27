'use strict';
// LZMA1 decoder (the RS3 cache stores models with it). Written from the public LZMA specification.
// decode(props5, body, outSize) -> Buffer
function decode(props, src, outSize) {
  let d = props[0];
  if (d >= 225) throw new Error('lzma: bad properties');
  const lc = d % 9; d = (d / 9) | 0; const lp = d % 5, pb = (d / 5) | 0;
  const out = Buffer.alloc(outSize);
  let pos = 0, range = 0xffffffff, code = 0, outPos = 0;
  if (src[0] !== 0) throw new Error('lzma: bad stream start');
  for (let i = 1; i < 5; i++) code = ((code << 8) | src[i]) >>> 0;
  pos = 5;
  const P = (n) => new Uint16Array(n).fill(1024);
  const isMatch = P(12 << 4), isRep = P(12), isRepG0 = P(12), isRepG1 = P(12), isRepG2 = P(12), isRep0Long = P(12 << 4);
  const posSlot = [P(64), P(64), P(64), P(64)], align = P(16), posDec = P(1 + 128 - 14);
  const lit = P(0x300 << (lc + lp));
  const mkLen = () => ({ choice: P(2), low: Array.from({ length: 16 }, () => P(8)), mid: Array.from({ length: 16 }, () => P(8)), high: P(256) });
  const lenDec = mkLen(), repLenDec = mkLen();
  const bit = (probs, i) => {
    const v = probs[i], bound = (range >>> 11) * v;
    let s;
    if (code < bound) { probs[i] = v + ((2048 - v) >> 5); range = bound; s = 0; }
    else { probs[i] = v - (v >> 5); code = (code - bound) >>> 0; range = (range - bound) >>> 0; s = 1; }
    if (range < 0x1000000) { range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; }
    return s;
  };
  const tree = (probs, bits) => { let m = 1; for (let i = 0; i < bits; i++) m = (m << 1) + bit(probs, m); return m - (1 << bits); };
  const rtree = (probs, off, bits) => { let m = 1, sym = 0; for (let i = 0; i < bits; i++) { const b = bit(probs, off + m); m = (m << 1) + b; sym |= b << i; } return sym; };
  const direct = (bits) => {
    let res = 0;
    for (; bits > 0; bits--) {
      range >>>= 1;
      let b = 0;
      if (code >= range) { code = (code - range) >>> 0; b = 1; }
      if (range < 0x1000000) { range = (range << 8) >>> 0; code = ((code << 8) | src[pos++]) >>> 0; }
      res = ((res << 1) | b) >>> 0;
    }
    return res;
  };
  const len = (ld, ps) => {
    if (!bit(ld.choice, 0)) return tree(ld.low[ps], 3);
    if (!bit(ld.choice, 1)) return 8 + tree(ld.mid[ps], 3);
    return 16 + tree(ld.high, 8);
  };
  let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0;
  const pbMask = (1 << pb) - 1, lpMask = (1 << lp) - 1;
  while (outPos < outSize) {
    const ps = outPos & pbMask;
    if (!bit(isMatch, (state << 4) + ps)) {
      const prev = outPos > 0 ? out[outPos - 1] : 0;
      const base = 0x300 * (((outPos & lpMask) << lc) + (prev >> (8 - lc)));
      let sym = 1;
      if (state >= 7) {
        let mb = out[outPos - rep0 - 1];
        do {
          const mbit = (mb >> 7) & 1; mb <<= 1;
          const b = bit(lit, base + ((1 + mbit) << 8) + sym);
          sym = (sym << 1) | b;
          if (mbit !== b) break;
        } while (sym < 0x100);
      }
      while (sym < 0x100) sym = (sym << 1) | bit(lit, base + sym);
      out[outPos++] = sym & 255;
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6;
      continue;
    }
    let n;
    if (bit(isRep, state)) {
      if (!bit(isRepG0, state)) {
        if (!bit(isRep0Long, (state << 4) + ps)) {
          state = state < 7 ? 9 : 11;
          out[outPos] = out[outPos - rep0 - 1]; outPos++;
          continue;
        }
      } else {
        let dist;
        if (!bit(isRepG1, state)) dist = rep1;
        else { if (!bit(isRepG2, state)) dist = rep2; else { dist = rep3; rep3 = rep2; } rep2 = rep1; }
        rep1 = rep0; rep0 = dist;
      }
      n = len(repLenDec, ps); state = state < 7 ? 8 : 11;
    } else {
      rep3 = rep2; rep2 = rep1; rep1 = rep0;
      n = len(lenDec, ps); state = state < 7 ? 7 : 10;
      const slot = tree(posSlot[n > 3 ? 3 : n], 6);
      if (slot < 4) rep0 = slot;
      else {
        const nb = (slot >> 1) - 1;
        let dist = ((2 | (slot & 1)) << nb) >>> 0;
        if (slot < 14) dist = (dist + rtree(posDec, dist - slot, nb)) >>> 0;
        else { dist = (dist + ((direct(nb - 4) << 4) >>> 0)) >>> 0; dist = (dist + rtree(align, 0, 4)) >>> 0; }
        rep0 = dist;
      }
      if (rep0 === 0xffffffff) break;     // end marker
    }
    n += 2;
    if (rep0 >= outPos) throw new Error('lzma: corrupt stream');
    for (let i = 0; i < n && outPos < outSize; i++, outPos++) out[outPos] = out[outPos - rep0 - 1];
  }
  return out;
}
module.exports = { decode };
