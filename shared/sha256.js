// shared/sha256.js — SHA-256 (FIPS 180-4) in plain JavaScript: the same digest in Node and in every browser, without
// crypto.subtle (it exists only in a secure context, and a LAN page at http://192.168.x.x is not one) and without a Node
// API. The content identity of the plugin system hashes with it (shared/plugins/identity.js, DESIGN §32); the server
// may hash file bytes with node:crypto for speed — test/plugins/identity.test.js checks that both agree.
//
//   sha256Hex(input)   → 64 lowercase hex digits
//   sha256(input)      → Uint8Array(32)
//   createSha256()     → { update(input) → itself, digest() → Uint8Array(32), hex() → string } for input in pieces
//   utf8(text)         → Uint8Array: the UTF-8 bytes of a string (a lone surrogate becomes U+FFFD, as TextEncoder does)
//
// `input` is a string (hashed as its UTF-8 bytes) or bytes (a Uint8Array, a Node Buffer, any ArrayBuffer view, an
// ArrayBuffer). Integer arithmetic only (32-bit words through `| 0` and `>>> 0`), so every engine gives the same bits.

const K = new Int32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
const H0 = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
const HEX = '0123456789abcdef';

/**
 * The UTF-8 bytes of a string. A lone surrogate becomes U+FFFD (EF BF BD), as TextEncoder (WHATWG Encoding) does.
 * @param {string} text
 * @returns {Uint8Array}
 */
export function utf8(text) {
  const s = String(text);
  const out = new Uint8Array(s.length * 3);
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) out[n++] = c;
    else if (c < 0x800) {
      out[n++] = 0xc0 | (c >> 6);
      out[n++] = 0x80 | (c & 63);
    } else if (c >= 0xd800 && c <= 0xdfff) {
      const d = i + 1 < s.length ? s.charCodeAt(i + 1) : 0;
      if (c <= 0xdbff && d >= 0xdc00 && d <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
        out[n++] = 0xf0 | (cp >> 18);
        out[n++] = 0x80 | ((cp >> 12) & 63);
        out[n++] = 0x80 | ((cp >> 6) & 63);
        out[n++] = 0x80 | (cp & 63);
      } else {
        out[n++] = 0xef;
        out[n++] = 0xbf;
        out[n++] = 0xbd;
      }
    } else {
      out[n++] = 0xe0 | (c >> 12);
      out[n++] = 0x80 | ((c >> 6) & 63);
      out[n++] = 0x80 | (c & 63);
    }
  }
  return out.subarray(0, n);
}

/**
 * `input` as bytes: a string as UTF-8, a view over the same memory for bytes.
 * @param {string | Uint8Array | ArrayBuffer | ArrayBufferView} input
 * @returns {Uint8Array}
 */
function bytesOf(input) {
  if (typeof input === 'string') return utf8(input);
  if (input instanceof Uint8Array) return input;
  if (input instanceof ArrayBuffer) return new Uint8Array(input);
  if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  throw new TypeError('sha256: input must be a string or bytes');
}

/**
 * One 64-byte block into the state (FIPS 180-4 §6.2.2).
 * @param {Int32Array} h the eight state words
 * @param {Int32Array} w the 64-word message schedule (scratch)
 * @param {Uint8Array} p the bytes
 * @param {number} o the block's offset in `p`
 */
function block(h, w, p, o) {
  for (let i = 0; i < 16; i++) {
    const j = o + i * 4;
    w[i] = (p[j] << 24) | (p[j + 1] << 16) | (p[j + 2] << 8) | p[j + 3];
  }
  for (let i = 16; i < 64; i++) {
    const x = w[i - 15];
    const y = w[i - 2];
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3);
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
  }
  let a = h[0], b = h[1], c = h[2], d = h[3], e = h[4], f = h[5], g = h[6], k = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const t1 = (k + S1 + ((e & f) ^ (~e & g)) + K[i] + w[i]) | 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const t2 = (S0 + ((a & b) ^ (a & c) ^ (b & c))) | 0;
    k = g;
    g = f;
    f = e;
    e = (d + t1) | 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) | 0;
  }
  h[0] = (h[0] + a) | 0;
  h[1] = (h[1] + b) | 0;
  h[2] = (h[2] + c) | 0;
  h[3] = (h[3] + d) | 0;
  h[4] = (h[4] + e) | 0;
  h[5] = (h[5] + f) | 0;
  h[6] = (h[6] + g) | 0;
  h[7] = (h[7] + k) | 0;
}

/**
 * @typedef {{ update: (input: string | Uint8Array | ArrayBuffer | ArrayBufferView) => Sha256, digest: () => Uint8Array,
 *   hex: () => string }} Sha256
 */

/**
 * An incremental hash: `update` any number of pieces, then `digest()` or `hex()` once (a second call answers the same
 * digest; `update` after it throws).
 * @returns {Sha256}
 */
export function createSha256() {
  const h = new Int32Array(H0);
  const w = new Int32Array(64);
  const buf = new Uint8Array(64);
  let fill = 0;
  let total = 0;
  /** @type {Uint8Array | null} */
  let done = null;
  /** @type {Sha256} */
  const api = {
    update(input) {
      if (done) throw new Error('sha256: update after digest');
      const p = bytesOf(input);
      total += p.length;
      let i = 0;
      if (fill > 0) {
        const take = Math.min(64 - fill, p.length);
        buf.set(p.subarray(0, take), fill);
        fill += take;
        i = take;
        if (fill < 64) return api;
        block(h, w, buf, 0);
        fill = 0;
      }
      for (; i + 64 <= p.length; i += 64) block(h, w, p, i);
      if (i < p.length) {
        buf.set(p.subarray(i), 0);
        fill = p.length - i;
      }
      return api;
    },
    digest() {
      if (done) return done.slice();
      buf[fill++] = 0x80;
      if (fill > 56) {
        buf.fill(0, fill);
        block(h, w, buf, 0);
        fill = 0;
      }
      buf.fill(0, fill, 56);
      // the message length in bits, a 64-bit big-endian number (exact below 2^53 bytes)
      const hi = Math.floor(total / 0x20000000);
      const lo = (total << 3) >>> 0;
      buf[56] = hi >>> 24; buf[57] = (hi >>> 16) & 255; buf[58] = (hi >>> 8) & 255; buf[59] = hi & 255;
      buf[60] = lo >>> 24; buf[61] = (lo >>> 16) & 255; buf[62] = (lo >>> 8) & 255; buf[63] = lo & 255;
      block(h, w, buf, 0);
      const out = new Uint8Array(32);
      for (let i = 0; i < 8; i++) {
        out[i * 4] = h[i] >>> 24;
        out[i * 4 + 1] = (h[i] >>> 16) & 255;
        out[i * 4 + 2] = (h[i] >>> 8) & 255;
        out[i * 4 + 3] = h[i] & 255;
      }
      done = out;
      return out.slice();
    },
    hex() {
      const d = api.digest();
      let s = '';
      for (let i = 0; i < d.length; i++) s += HEX[d[i] >> 4] + HEX[d[i] & 15];
      return s;
    },
  };
  return api;
}

/**
 * The SHA-256 digest of `input` (see the header).
 * @param {string | Uint8Array | ArrayBuffer | ArrayBufferView} input
 * @returns {Uint8Array}
 */
export const sha256 = (input) => createSha256().update(input).digest();

/**
 * The SHA-256 digest of `input` as 64 lowercase hex digits.
 * @param {string | Uint8Array | ArrayBuffer | ArrayBufferView} input
 * @returns {string}
 */
export const sha256Hex = (input) => createSha256().update(input).hex();
