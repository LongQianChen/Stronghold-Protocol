// Binary format sniffing/validation for downloaded assets (PNG, MP3, fonts,
// Spine skel/atlas, JSON). Used to reject truncated or error-page downloads and
// to decide whether an existing file on disk can be kept (idempotent re-runs).

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * Read width/height from a PNG IHDR chunk.
 * @param {Buffer|Uint8Array} buf
 * @returns {{width:number,height:number}|null} null when not a PNG
 */
export function pngSize(buf) {
  if (!buf || buf.length < 24) return null;
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!b.subarray(0, 8).equals(PNG_SIG)) return null;
  if (b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16);
  const height = b.readUInt32BE(20);
  if (!width || !height) return null;
  return { width, height };
}

/**
 * True when the buffer is a complete PNG (signature + IHDR + trailing IEND chunk).
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isCompletePng(buf) {
  if (!pngSize(buf)) return false;
  // IEND chunk: length(4)=0, 'IEND', CRC(4) → the last 12 bytes.
  return buf.length >= 12 && buf.toString('latin1', buf.length - 8, buf.length - 4) === 'IEND';
}

/**
 * True when the buffer looks like an MP3 (ID3v2 tag or MPEG audio frame sync).
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isMp3(buf) {
  if (!buf || buf.length < 128) return false;
  if (buf.toString('latin1', 0, 3) === 'ID3') return true;
  return buf[0] === 0xff && (buf[1] & 0xe0) === 0xe0;
}

/**
 * True when the buffer is an OpenType/TrueType font (sfnt).
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isSfnt(buf) {
  if (!buf || buf.length < 12) return false;
  const tag = buf.readUInt32BE(0);
  return tag === 0x00010000 || tag === 0x4f54544f /* OTTO */ || tag === 0x74727565 /* true */;
}

/**
 * True when the buffer is a WOFF2 file.
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isWoff2(buf) {
  return !!buf && buf.length >= 48 && buf.readUInt32BE(0) === 0x774f4632;
}

/**
 * True when the text looks like a Spine atlas (has at least one page image line).
 * @param {Buffer|string} data
 * @returns {boolean}
 */
export function isAtlasText(data) {
  const s = typeof data === 'string' ? data : Buffer.from(data).toString('utf8');
  if (s.includes('\u0000')) return false;
  return /^[^\s:][^\r\n:]*\.(png|webp|jpg)\s*$/im.test(s);
}

/**
 * True when the buffer looks like a Spine binary skeleton (not an HTML/text error page).
 * Spine 3.8 binaries start with a varint-prefixed hash string.
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function isSkelBinary(buf) {
  if (!buf || buf.length < 32) return false;
  const head = buf.toString('latin1', 0, 16).toLowerCase();
  return !head.startsWith('<!doctype') && !head.startsWith('<html') && !head.startsWith('404');
}

/**
 * Validate a buffer for the given asset kind.
 * @param {'png'|'mp3'|'font'|'atlas'|'skel'|'json'|'bin'} kind
 * @param {Buffer} buf
 * @returns {boolean}
 */
export function validate(kind, buf) {
  switch (kind) {
    case 'png': return isCompletePng(buf);
    case 'mp3': return isMp3(buf);
    case 'font': return isSfnt(buf) || isWoff2(buf);
    case 'atlas': return isAtlasText(buf);
    case 'skel': return isSkelBinary(buf);
    case 'json':
      try { JSON.parse(buf.toString('utf8')); return true; } catch { return false; }
    default: return !!buf && buf.length > 0;
  }
}

/**
 * Infer the asset kind from a file name.
 * @param {string} name
 * @returns {'png'|'mp3'|'font'|'atlas'|'skel'|'json'|'bin'}
 */
export function kindOf(name) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'png') return 'png';
  if (ext === 'mp3') return 'mp3';
  if (ext === 'otf' || ext === 'ttf' || ext === 'woff2') return 'font';
  if (ext === 'atlas') return 'atlas';
  if (ext === 'skel') return 'skel';
  if (ext === 'json') return 'json';
  return 'bin';
}
