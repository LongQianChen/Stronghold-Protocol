// server/studio/key.js — the studio's key (DESIGN §32.9, docs/PLUGINS.md §15): every change through the studio's API
// carries it (the header X-SP-Studio), beside the address and Host rules of gate.js. An address cannot tell this machine
// from a raw TCP tunnel on it (frp tcp, ssh -R …: a visitor's bytes handed over from this machine, with any Host the
// visitor writes); the key can — only someone who sees the server's window or its files has it. The server prints the
// studio's address with the key (server/http/boot.js); the page keeps it in its browser (localStorage) and sends it. A
// read (the page, the list, a file of a plugin) needs no key [ASSUMED].
//
// The key is 128 random bits (base64url), kept in plugins/.studio-key (a dot file: never listed, served, checked or
// packed; created on the first start, the owner's only) so that it stays the same across restarts — or, when plugins/
// cannot be written, one per start.

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes, timingSafeEqual } from 'node:crypto';

/** The file of the key in the plugins folder. */
export const KEY_FILE = '.studio-key';
/** What a key looks like (what the file must hold to be read back). */
export const KEY_PATTERN = /^[A-Za-z0-9_-]{22,64}$/;

/**
 * The studio's key: the one plugins/.studio-key holds, else a new one saved there (else one for this start).
 * @param {string} pluginsDir @param {{ log?: { warn?: Function } }} [opts]
 * @returns {{ key: string, file: string, saved: boolean }}
 */
export function loadStudioKey(pluginsDir, { log } = {}) {
  const file = path.join(path.resolve(pluginsDir), KEY_FILE);
  try {
    const st = fs.lstatSync(file);
    if (st.isFile() && st.size < 256) {
      const key = fs.readFileSync(file, 'utf8').trim();
      if (KEY_PATTERN.test(key)) return { key, file, saved: true };
    }
  } catch { /* none yet */ }
  const key = randomBytes(16).toString('base64url');
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}-${randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, `${key}\n`, { flag: 'wx', mode: 0o600 });
    try { fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* gone */ } throw e; }
    return { key, file, saved: true };
  } catch (e) {
    log?.warn?.(`[studio] cannot keep the studio's key in ${file} (${e?.code || e?.message || e}): a new one each start`);
    return { key, file, saved: false };
  }
}

/** Is `given` (a header's value) the key? Compared in constant time. @param {unknown} given @param {string} key */
export function sameKey(given, key) {
  if (typeof given !== 'string' || typeof key !== 'string' || !key) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(key);
  return a.length === b.length && timingSafeEqual(a, b);
}
