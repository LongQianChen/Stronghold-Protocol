// server/http/files.js — disk files and verified in-memory bodies → HTTP responses (static.js and media.js).
// Runtime pins, dynamic manifest views and ordinary assets share encoding, cache and range semantics.
//     MIME types incl. .mjs/.js text/javascript, .skel application/octet-stream, .atlas text/plain;
//     Brotli/gzip for text-like types, .skel and uncompressed fonts when the client accepts it (small files are
//     compressed once and cached in memory); content ETag when supplied, else size + mtime; Last-Modified and 304s;
//     (html & code/data: no-cache + revalidate; public/assets|fonts|vendor: 1 day; asset/font `?v=`: immutable).
//     Verified runtime `?rv=sha256` and asset content-hash paths get immutable policies from their callers.
//     single byte-range requests (206/416, used by <audio>).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { pipeline } from 'node:stream/promises';

/** Extension → Content-Type. */
export const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.atlas': 'text/plain; charset=utf-8',
  '.skel': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
});

/** Extensions worth gzipping (text-like, .skel, uncompressed fonts). */
export const COMPRESSIBLE = new Set([
  '.html', '.htm', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.md', '.csv', '.xml',
  '.atlas', '.skel', '.bin', '.wasm', '.svg', '.ico', '.otf', '.ttf', '.wav',
]);

const TEXT_LIKE = new Set(['.html', '.htm', '.js', '.mjs', '.css', '.json', '.map', '.webmanifest', '.txt', '.md', '.csv', '.xml', '.atlas', '.svg']);
const GZIP_MIN_BYTES = 512;
const GZIP_CACHE_MAX_FILE = 8 << 20;      // larger files are compressed as streams
const GZIP_CACHE_MAX_TOTAL = 96 << 20;
// Plain files can change in place, so "long" is one day. Verified content-hash URLs receive
// IMMUTABLE_CACHE through opts after assetIndex checks the current bytes.
export const LONG_CACHE = 'public, max-age=86400';          // 1 day
export const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable';
const LONG_CACHE_DIRS = ['assets', 'fonts', 'vendor']; // first path segment under public/

const gzipAsync = promisify(zlib.gzip);
const brotliAsync = promisify(zlib.brotliCompress);
export const BROTLI_QUALITY = 5;
export const BROTLI_OPTIONS = Object.freeze({ params: Object.freeze({
  [zlib.constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY,
}) });

function brotliParams(ext, size) {
  return { params: { ...BROTLI_OPTIONS.params,
    [zlib.constants.BROTLI_PARAM_MODE]: TEXT_LIKE.has(ext) ? zlib.constants.BROTLI_MODE_TEXT : zlib.constants.BROTLI_MODE_GENERIC,
    ...(size > 0 ? { [zlib.constants.BROTLI_PARAM_SIZE_HINT]: size } : {}),
  } };
}

function compressStream(encoding, ext, size) {
  return encoding === 'br' ? zlib.createBrotliCompress(brotliParams(ext, size)) : zlib.createGzip({ level: 6 });
}

// Bound HTTP compression independently of ws. Identical concurrent requests also share a cache promise.
let compressionActive = 0;
const compressionWaiters = [];
export async function compressBytes(body, encoding, ext = '') {
  if (compressionActive >= 2) await new Promise((resolve) => compressionWaiters.push(resolve));
  else compressionActive++;
  try {
    return encoding === 'br' ? await brotliAsync(body, brotliParams(ext, body.length)) : await gzipAsync(body, { level: 6 });
  } finally {
    const next = compressionWaiters.shift();
    if (next) next();
    else compressionActive--;
  }
}

// ---------------------------------------------------------------------------------------------------
// Compression cache (LRU by bytes). The historical class name remains compatible with media.js.
// ---------------------------------------------------------------------------------------------------

export class CompressCache {
  constructor(maxTotal = GZIP_CACHE_MAX_TOTAL) {
    this.maxTotal = maxTotal;
    this.total = 0;
    /** @type {Map<string, Buffer>} */ this.map = new Map();
    /** @type {Map<string, Promise<Buffer>>} */ this.inflight = new Map();
  }

  /**
   * @returns {Promise<Buffer>} the file identified by (path, size, mtime, inode, ctime) compressed with `encoding` ('gzip'
   *   by default) — the inode and ctime too: a file rewritten with its old size and mtime put back (rsync -t, touch -r)
   *   is another file (a cosmetic plugin's served at its new hash must not come out of the cache with the old bytes)
   */
  get(absPath, stat, encoding = 'gzip') {
    return this.compressed(`${absPath}\0${stat.size}\0${stat.mtimeMs}\0${stat.ino}\0${stat.ctimeMs}`, () => fsp.readFile(absPath), encoding, path.extname(absPath).toLowerCase());
  }

  /** id must identify the exact uncompressed bytes (content SHA-256 for runtime files and rendered HTML). */
  getBuffer(id, body, encoding, ext = '') {
    return this.compressed(`buffer\0${id}`, async () => body, encoding, ext);
  }

  /** Disk and in-memory variants share the same inflight and bounded LRU cache. */
  compressed(key, read, encoding = 'gzip', ext = '') {
    return this.obtain(`${encoding}\0${key}`, async () => compressBytes(await read(), encoding, ext));
  }

  obtain(key, make) {
    const hit = this.map.get(key);
    if (hit) { this.map.delete(key); this.map.set(key, hit); return Promise.resolve(hit); }
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const p = (async () => {
      const encoded = await make();
      this.store(key, encoded);
      return encoded;
    })().finally(() => this.inflight.delete(key));
    this.inflight.set(key, p);
    return p;
  }

  store(key, buf) {
    if (buf.length > this.maxTotal) return;
    const old = this.map.get(key);
    if (old) { this.map.delete(key); this.total -= old.length; }
    this.map.set(key, buf);
    this.total += buf.length;
    for (const [k, v] of this.map) {
      if (this.total <= this.maxTotal) break;
      this.map.delete(k);
      this.total -= v.length;
    }
  }
}

// ---------------------------------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------------------------------

/** Preserve the historical public class name for announcements and existing callers. */
export const GzipCache = CompressCache;

/** Parse explicit preferences, including exclusions. Missing header never opts into compression. */
function encodingPreferences(header) {
  const preferences = new Map();
  if (!header || typeof header !== 'string') return preferences;
  for (const part of header.split(',')) {
    const [token, ...params] = part.trim().toLowerCase().split(';');
    let q = 1;
    for (const p of params) {
      const m = /^\s*q\s*=\s*(.*?)\s*$/.exec(p);
      if (m) q = m[1] === '' ? 0 : Number(m[1]);
    }
    if (!Number.isFinite(q) || q < 0 || q > 1) q = 0;
    if (token) preferences.set(token === 'x-gzip' ? 'gzip' : token, q);
  }
  return preferences;
}

/** Does the Accept-Encoding header allow gzip (q > 0)? @param {string | undefined} header */
export function acceptsGzip(header) {
  const prefs = encodingPreferences(header);
  return (prefs.get('gzip') ?? prefs.get('*') ?? 0) > 0;
}

/** Highest permitted supported coding; Brotli wins ties, identity remains the backwards-compatible fallback. */
function selectEncoding(header, brotli, wildcardBrotli) {
  const prefs = encodingPreferences(header);
  const br = brotli ? prefs.get('br') ?? (wildcardBrotli ? prefs.get('*') : 0) ?? 0 : 0;
  const gz = prefs.get('gzip') ?? prefs.get('*') ?? 0;
  const q = Math.max(br, gz);
  if (q <= 0 || (prefs.has('identity') && prefs.get('identity') > q)) return null;
  return br >= gz ? 'br' : 'gzip';
}

/** Existing response policy and the SP_HTTP_BROTLI rollback retain wildcard support. */
export function preferredEncoding(header, brotli = process.env.SP_HTTP_BROTLI !== '0') {
  return selectEncoding(header, brotli, true);
}

/** Upstream's public helper names Brotli explicitly; `*` alone chooses gzip. */
export function pickEncoding(header) {
  return selectEncoding(header, process.env.SP_HTTP_BROTLI !== '0', false);
}

/**
 * Parse a single `bytes=` range against a file size.
 * @returns {{ start: number, end: number } | 'unsatisfiable' | null} null = ignore header (serve 200)
 */
export function parseRange(header, size) {
  if (typeof header !== 'string') return null;
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(header);
  if (!m) return null; // multi-range or malformed → ignore (RFC 9110 permits serving the full body)
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  if (a === '') {
    const suffix = Number(b);
    if (suffix === 0 || size === 0) return 'unsatisfiable';
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(a);
  const end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  if (b !== '' && Number(b) < start) return null;
  if (start >= size) return 'unsatisfiable';
  return { start, end };
}

const stripWeak = (tag) => tag.trim().replace(/^W\//, '');

/** Conditional GET check (If-None-Match wins over If-Modified-Since). */
export function isNotModified(req, etag, mtime) {
  const inm = req.headers['if-none-match'];
  if (typeof inm === 'string') {
    if (inm.trim() === '*') return true;
    return inm.split(',').some((t) => stripWeak(t) === etag);
  }
  const ims = req.headers['if-modified-since'];
  if (typeof ims === 'string' && mtime) {
    const t = Date.parse(ims);
    if (Number.isFinite(t)) return Math.floor(mtime.getTime() / 1000) * 1000 <= t;
  }
  return false;
}

/** If-Range: serve the range only when the validator still matches. */
function ifRangeMatches(req, etag, lastModified) {
  const v = req.headers['if-range'];
  if (typeof v !== 'string') return true;
  const s = v.trim();
  if (s.startsWith('"') || s.startsWith('W/')) return s === etag; // strong comparison
  return s === lastModified;
}

function cacheControlFor(ext, mountName, segments, query) {
  if (ext === '.html' || ext === '.htm') return 'no-cache';
  if (mountName === 'public' && ['assets', 'fonts'].includes(segments[0]) && /(^|&)v=/.test(query)) return IMMUTABLE_CACHE;
  if (mountName === 'public' && segments.length > 1 && LONG_CACHE_DIRS.includes(segments[0])) return LONG_CACHE;
  return 'no-cache';
}

/**
 * One file → the response.
 * @param {{ contentHash?: string | null, cacheControl?: string | null, headers?: Record<string, string> | null }} [opts]
 *   contentHash: the file's content hash (assetIndex.js) — the ETag then; cacheControl: overrides the policy of its
 *   path (a content-hashed URL); headers: extra response headers (a ui plugin's Content-Security-Policy), on 200,
 *   206 and 304 (they share this header object). 416 is an empty body and does not carry them.
 */
export async function serveFile(req, res, absPath, stat, mountName, segments, query, gzipCache, log, opts = {}) {
  const ext = path.extname(absPath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const compressible = COMPRESSIBLE.has(ext);
  // RFC 9110 §14.2: Range is defined only for GET; other methods ignore it, including for encoding selection.
  const rangeHeader = req.method === 'GET' ? req.headers.range : undefined;
  const encoding = compressible && stat.size >= GZIP_MIN_BYTES && !rangeHeader ? preferredEncoding(req.headers['accept-encoding']) : null;
  const baseTag = opts.contentHash || `${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}`;
  const etag = `"${baseTag}${encoding === 'br' ? '-br' : encoding ? '-gz' : ''}"`;
  const lastModified = stat.mtime.toUTCString();
  const isHead = req.method === 'HEAD';

  const headers = {
    'Content-Type': type,
    'Cache-Control': opts.cacheControl || cacheControlFor(ext, mountName, segments, query),
    ETag: etag,
    'Last-Modified': lastModified,
  };
  if (compressible) headers.Vary = 'Accept-Encoding';
  if (encoding) headers['Content-Encoding'] = encoding;
  if (opts.headers) for (const [k, v] of Object.entries(opts.headers)) if (v != null && v !== '') headers[k] = v;

  if (isNotModified(req, etag, stat.mtime)) {
    res.writeHead(304, headers);
    res.end();
    return;
  }

  if (encoding) {
    if (stat.size <= GZIP_CACHE_MAX_FILE) {
      const compressed = await gzipCache.get(absPath, stat, encoding);
      headers['Content-Length'] = compressed.length;
      res.writeHead(200, headers);
      res.end(isHead ? undefined : compressed);
      return;
    }
    res.writeHead(200, headers);
    if (isHead) { res.end(); return; }
    await streamTo(fs.createReadStream(absPath), res, log, compressStream(encoding, ext, stat.size));
    return;
  }

  headers['Accept-Ranges'] = 'bytes';
  let start = 0;
  let end = stat.size - 1;
  let status = 200;
  if (rangeHeader && ifRangeMatches(req, etag, lastModified)) {
    const r = parseRange(rangeHeader, stat.size);
    if (r === 'unsatisfiable') {
      res.writeHead(416, { 'Content-Range': `bytes */${stat.size}`, 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': 0 });
      res.end();
      return;
    }
    if (r) {
      ({ start, end } = r);
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${stat.size}`;
    }
  }
  headers['Content-Length'] = stat.size === 0 ? 0 : end - start + 1;
  res.writeHead(status, headers);
  if (isHead || stat.size === 0) { res.end(); return; }
  await streamTo(fs.createReadStream(absPath, { start, end }), res, log);
}

/** Serve exact, verified runtime bytes / generated HTML with variant validators and the same range semantics. */
/**
 * Serve exact bytes from memory.
 * Accepts both call shapes used across the fork and upstream 0.3.0:
 *   fork:     serveBuffer(req, res, body, { type, tag, cacheControl, mtime, cache, minBytes })
 *   upstream: serveBuffer(req, res, { body, hash, type, cacheControl, key, cache })
 * `hash` is the upstream alias of `tag`; `key` only namespaces the compression cache entry.
 */
export async function serveBuffer(req, res, bodyOrOpts, maybeOpts = {}) {
  let body, type, tag, cacheControl = 'no-cache', mtime = null, cache, minBytes = GZIP_MIN_BYTES;
  if (bodyOrOpts && typeof bodyOrOpts === 'object' && !Buffer.isBuffer(bodyOrOpts)
      && !(bodyOrOpts instanceof Uint8Array) && 'body' in bodyOrOpts) {
    ({ body, hash: tag, type, cacheControl = 'no-cache', cache } = bodyOrOpts);
  } else {
    body = bodyOrOpts;
    ({ type, tag, cacheControl = 'no-cache', mtime = null, cache, minBytes = GZIP_MIN_BYTES } = maybeOpts);
  }
  const encoding = body.length >= minBytes && !req.headers.range ? preferredEncoding(req.headers['accept-encoding']) : null;
  const etag = `"${tag}${encoding === 'br' ? '-br' : encoding ? '-gz' : ''}"`;
  const headers = { 'Content-Type': type, 'Cache-Control': cacheControl, ETag: etag, Vary: 'Accept-Encoding' };
  if (mtime) headers['Last-Modified'] = mtime.toUTCString();
  if (encoding) headers['Content-Encoding'] = encoding;
  if (isNotModified(req, etag, mtime)) { res.writeHead(304, headers); res.end(); return; }
  let status = 200;
  let output = body;
  if (encoding) output = await cache.getBuffer(tag, body, encoding, type.startsWith('text/') || type.includes('json') ? '.txt' : '');
  else {
    headers['Accept-Ranges'] = 'bytes';
    if (req.headers.range && ifRangeMatches(req, etag, headers['Last-Modified'])) {
      const range = parseRange(req.headers.range, body.length);
      if (range === 'unsatisfiable') {
        res.writeHead(416, { 'Content-Range': `bytes */${body.length}`, 'Content-Length': 0 }); res.end(); return;
      }
      if (range) {
        status = 206; output = body.subarray(range.start, range.end + 1);
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${body.length}`;
      }
    }
  }
  if (res.destroyed) return;
  headers['Content-Length'] = output.length;
  res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : output);
}

async function streamTo(src, res, log, transform) {
  try {
    if (transform) await pipeline(src, transform, res);
    else await pipeline(src, res);
  } catch (e) {
    if (e && e.code !== 'ERR_STREAM_PREMATURE_CLOSE') log.debug?.('[http] stream aborted', e.code || e.message);
    res.destroy();
  }
}
