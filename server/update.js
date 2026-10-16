// server/update.js — the update package (docs/DEPLOY.md §1.5 and §7): the boot step that finishes an update extracted
// over an install, and the install check `npm run doctor` shows. Node builtins only, so it loads whatever else the
// install holds.
//
// Every release zip (full, lite, update) carries MANIFEST.json at its root: {format, app, files: {<path>: {size,
// sha256}}} — every shipped file except the art setup manages (public/assets/, public/fonts/, data/assets.json,
// data/local-assets.json, data/local-fx.json; the lite zip has none of it): the code, the data, node_modules, public/vendor, the docs. The
// update zip (Stronghold-Protocol-v<version>-update.zip, `node tools/package.mjs --update --from <earlier full zips>`)
// holds only the files that differ from at least one of those zips, MANIFEST.json and UPDATE.json:
//   {format, app, from: [<base versions>], count, bytes, files: {<path>: {size, sha256}} (what it ships),
//    removed: [{path, sha256: [<the bytes the bases shipped>]}] (files a base shipped that this version does not)}.
//
// The player stops the server, extracts the zip over the install and starts it again. applyPendingUpdate runs before
// the server starts (server/http/boot.js runMain — every route: npm start, scripts/launch.mjs, the Windows service's
// run-server.cmd, NSSM, systemd; scripts/launch.mjs runs it once more before setup):
//   1. UPDATE.json unreadable or malformed (an unknown format, a path outside the install …) → logged, left in place,
//      nothing deleted: the server starts with the files as they are.
//   2. The install is verified against MANIFEST.json (and the art files the update brought). A file the server or the
//      browser runs that is missing or holds other bytes → the bilingual "this update only applies over v… — download
//      the full package" message, nothing deleted, UPDATE.json kept (the next start checks again) and the server does
//      not start: a mix of two versions fails in ways that look like game bugs (a stale module, old data under new
//      code). Differences only in docs, licences, scripts/ or tools/ are named, and the update counts as applied.
//   3. Each `removed` file is deleted when it still holds bytes a base shipped — a file changed on this machine, a pack
//      the player installed, a symlink, a folder, a path outside the install or a per-machine name (.env, .venv*, logs,
//      the caches, the service settings) is never touched — then the folders it leaves empty.
//   4. UPDATE.json is renamed to .update-applied.json; the next start finds nothing to do.
// No network, no automatic update: the update zip is a manual download from GitHub Releases, the same trust as the
// full zip (whose code runs anyway).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const MANIFEST_FILE = 'MANIFEST.json';
export const UPDATE_FILE = 'UPDATE.json';
export const APPLIED_FILE = '.update-applied.json';
/** The format of MANIFEST.json and UPDATE.json this code writes and reads. */
export const UPDATE_FORMAT = 1;
const META = new Set([MANIFEST_FILE, UPDATE_FILE, APPLIED_FILE]);

/** The art setup downloads or extracts (and the lite zip leaves out): never in MANIFEST.json, never fatal. */
export const isSetupArt = (rel) => rel.startsWith('public/assets/') || rel.startsWith('public/fonts/')
  || rel === 'data/assets.json' || rel === 'data/local-assets.json' || rel === 'data/local-fx.json';
/** Whether MANIFEST.json lists a shipped file. */
export const inManifest = (rel) => !META.has(rel) && !isSetupArt(rel);

const DOC = /(?:^|\/)(?:LICEN[CS]E|COPYING|NOTICE|AUTHORS|CHANGELOG|CHANGES|HISTORY|README)(?:[.-][^/]*)?$|\.(?:md|markdown|txt|map|d\.[cm]?ts)$/i;
const CODE = /\.(?:[cm]?js|json|wasm|node|css|html?)$/i;
/**
 * Whether the server or the browser runs (or serves) a file: a missing or different one stops an update. Docs and
 * licences anywhere (README, LICENSE, *.md, *.txt, *.d.ts, source maps), scripts/, tools/ (setup, doctor — not the
 * server), package-lock.json and npm's own node_modules/.package-lock.json only get a warning.
 */
export function affectsRuntime(rel) {
  if (rel.startsWith('scripts/') || rel.startsWith('tools/')) return false;
  if (rel === 'package-lock.json' || rel === 'node_modules/.package-lock.json') return false;
  return CODE.test(rel) || !DOC.test(rel);
}

/** Size and SHA-256 (hex) of a regular file, or null. */
export function digestFile(abs) {
  let buf;
  try { buf = fs.readFileSync(abs); } catch { return null; }
  return { size: buf.length, sha256: crypto.createHash('sha256').update(buf).digest('hex') };
}

/**
 * The '/assets/…' and '/fonts/…' URLs of an art manifest (data/assets.json, data/local-assets.json) as public/… paths
 * (the walk of tools/setup.mjs checkAssets; tools/package.mjs plans the full zip's art with it).
 */
export function listedArtFiles(manifest) {
  const out = new Set();
  const walk = (v) => {
    if (typeof v === 'string') {
      if (/^\/(?:assets|fonts)\//.test(v)) out.add(`public/${v.split('/').filter(Boolean).map(decodeURIComponent).join('/')}`);
    } else if (v && typeof v === 'object') for (const x of Object.values(v)) walk(x);
  };
  walk(manifest);
  return out;
}

/** Per-machine places an update never deletes from (the user part of tools/package.mjs's refusal list). */
const KEEP = ['.git', '.cache', '.claude', 'logs', 'handoff', 'node_modules/.cache', 'scripts/service.env.cmd'];

/**
 * Why a path of MANIFEST.json / UPDATE.json cannot be used (null when it can): it must be relative, in `/` form and
 * inside the install — no `..` or `.` part, no empty part, no part ending in a dot or a space, no backslash, drive or
 * stream colon, control or wildcard character.
 */
export function pathProblem(rel) {
  if (typeof rel !== 'string' || !rel) return 'not a path';
  if (rel.length > 1024) return 'too long';
  if (/[\x00-\x1f\\:*?"<>|]/.test(rel)) return 'not a plain relative path';
  if (rel.startsWith('/')) return 'an absolute path';
  if (rel.split('/').some((s) => s === '' || s === '.' || s === '..' || /[. ]$/.test(s))) return 'outside the install (an empty, . or .. part)';
  return null;
}

/**
 * Why an update may not delete a path (null when it may): pathProblem's rules, and never a per-machine file (`.env`,
 * `.venv*`, the caches, logs, the Windows service settings) or one of the update's own files.
 */
export function removalProblem(rel) {
  const bad = pathProblem(rel);
  if (bad) return bad;
  if (META.has(rel)) return 'an update file';
  const parts = rel.split('/');
  const base = parts[parts.length - 1];
  if (base === '.env' || base.startsWith('.env.') || parts.some((s) => s.startsWith('.venv'))) return 'a per-machine file';
  if (KEEP.some((k) => rel === k || rel.startsWith(`${k}/`))) return 'in a per-machine folder';
  return null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isCount = (v) => Number.isSafeInteger(v) && v >= 0;

/** {path: {size, sha256}} → Map, or throws. */
function parseFiles(v, what) {
  if (!isObj(v)) throw new Error(`${what} is not an object`);
  const out = new Map();
  for (const [rel, d] of Object.entries(v)) {
    const bad = pathProblem(rel);
    if (bad) throw new Error(`${what}: ${rel} is ${bad}`);
    if (!isObj(d) || !isCount(d.size) || typeof d.sha256 !== 'string' || !HEX64.test(d.sha256)) throw new Error(`${what}: ${rel} has no size / sha256`);
    out.set(rel, { size: d.size, sha256: d.sha256 });
  }
  return out;
}

function parseHead(text, what) {
  const j = JSON.parse(text);
  if (!isObj(j)) throw new Error(`${what} is not an object`);
  if (j.format !== UPDATE_FORMAT) throw new Error(`${what} has format ${JSON.stringify(j.format)}, this server reads ${UPDATE_FORMAT}`);
  if (typeof j.app !== 'string' || !VERSION.test(j.app)) throw new Error(`${what} names no version`);
  return j;
}

/** MANIFEST.json's text → {app, files: Map}, or throws with the reason. */
export function parseManifest(text) {
  const j = parseHead(text, MANIFEST_FILE);
  return { app: j.app, files: parseFiles(j.files, 'files') };
}

/** UPDATE.json's text → {app, from, count, bytes, files: Map, removed: [{path, sha256}]}, or throws with the reason. */
export function parseUpdate(text) {
  const j = parseHead(text, UPDATE_FILE);
  if (!Array.isArray(j.from) || !j.from.length || !j.from.every((v) => typeof v === 'string' && VERSION.test(v))) throw new Error('from names no base version');
  if (!isCount(j.count) || !isCount(j.bytes)) throw new Error('count / bytes missing');
  const files = parseFiles(j.files, 'files');
  if (!Array.isArray(j.removed)) throw new Error('removed is not a list');
  const removed = [];
  const seen = new Set();
  for (const r of j.removed) {
    const rel = isObj(r) ? r.path : undefined;
    const bad = removalProblem(rel);
    if (bad) throw new Error(`removed: ${typeof rel === 'string' ? rel : JSON.stringify(rel)} is ${bad}`);
    if (seen.has(rel) || files.has(rel)) throw new Error(`removed: ${rel} is listed twice or also shipped`);
    if (!Array.isArray(r.sha256) || !r.sha256.length || !r.sha256.every((h) => typeof h === 'string' && HEX64.test(h))) throw new Error(`removed: ${rel} has no sha256`);
    seen.add(rel);
    removed.push({ path: rel, sha256: [...r.sha256] });
  }
  return { app: j.app, from: [...j.from], count: j.count, bytes: j.bytes, files, removed };
}

const abs = (root, rel) => path.join(root, ...rel.split('/'));

/** Compare the files on disk with a Map of {size, sha256}: the paths missing (or not a file) and those with other bytes. */
export function verifyFiles(root, files) {
  const missing = [];
  const mismatched = [];
  for (const [rel, want] of files) {
    const p = abs(root, rel);
    let st;
    try { st = fs.statSync(p); } catch { missing.push(rel); continue; }
    if (!st.isFile()) { missing.push(rel); continue; }
    if (st.size !== want.size) { mismatched.push(rel); continue; }
    const got = digestFile(p);
    if (!got || got.sha256 !== want.sha256) mismatched.push(rel);
  }
  return { checked: files.size, missing, mismatched };
}

const inside = (root, p) => { const r = path.relative(root, p); return r !== '' && !r.startsWith('..') && !path.isAbsolute(r); };

/**
 * Delete the `removed` files that still hold bytes a base shipped, then the folders that leaves empty. `keep`: the
 * lower-cased paths of the new version — a removed path that differs from one only in case is the same file on
 * Windows / macOS.
 * @param {string} root
 * @param {{ path: string, sha256: string[] }[]} removed
 * @param {Set<string>} [keep]
 * @returns {{ deleted: string[], kept: string[], skipped: string[], absent: number }}
 */
export function deleteRemoved(root, removed, keep = new Set()) {
  const base = path.resolve(root);
  let real;
  try { real = fs.realpathSync(base); } catch { real = base; }
  const out = { deleted: [], kept: [], skipped: [], absent: 0 };
  for (const { path: rel, sha256 } of removed) {
    const bad = removalProblem(rel);
    if (bad) { out.skipped.push(`${rel} (${bad})`); continue; }
    if (keep.has(rel.toLowerCase())) { out.skipped.push(`${rel} (a file of the new version)`); continue; }
    const p = abs(base, rel);
    let st;
    try { st = fs.lstatSync(p); } catch { out.absent++; continue; }
    if (!st.isFile()) { out.skipped.push(`${rel} (not a regular file)`); continue; }
    let dir;
    try { dir = fs.realpathSync(path.dirname(p)); } catch { dir = null; }
    if (!dir || (dir !== real && !inside(real, dir))) { out.skipped.push(`${rel} (outside the install)`); continue; }
    const got = digestFile(p);
    if (!got || !sha256.includes(got.sha256)) { out.kept.push(rel); continue; }
    try { fs.unlinkSync(p); } catch (e) { out.skipped.push(`${rel} (${e?.code || e?.message || e})`); continue; }
    out.deleted.push(rel);
    for (let d = path.dirname(p); inside(base, d); d = path.dirname(d)) {
      try { fs.rmdirSync(d); } catch { break; }
    }
  }
  return out;
}

/** The files data/local-assets.json lists that are not on disk (none when it is absent or unreadable). */
export function localArtGaps(root) {
  let listed;
  try { listed = listedArtFiles(JSON.parse(fs.readFileSync(path.join(root, 'data', 'local-assets.json'), 'utf8'))); } catch { return []; }
  return [...listed].filter((rel) => { try { return !fs.statSync(abs(root, rel)).isFile(); } catch { return true; } }).sort();
}

const NAMED = 5;
const named = (list, sep) => list.slice(0, NAMED).join(sep) + (list.length > NAMED ? ' …' : '');

/**
 * Verify an install against its MANIFEST.json (npm run doctor; read-only).
 * @returns {{ state: 'none'|'broken'|'ok'|'mismatch', pending: boolean, app?: string, error?: string, checked?: number,
 *             missing?: string[], mismatched?: string[], runtime?: string[], other?: string[] }}
 *   none: no MANIFEST.json (a source checkout); runtime / other: the bad paths that do / do not stop an update
 */
export function checkInstall(root) {
  const base = path.resolve(root);
  const pending = fs.existsSync(path.join(base, UPDATE_FILE));
  let m;
  try { m = parseManifest(fs.readFileSync(path.join(base, MANIFEST_FILE), 'utf8')); } catch (e) {
    return e?.code === 'ENOENT' ? { state: 'none', pending } : { state: 'broken', pending, error: e?.message || String(e) };
  }
  const v = verifyFiles(base, m.files);
  const bad = [...v.missing, ...v.mismatched].sort();
  return {
    state: bad.length ? 'mismatch' : 'ok', pending, app: m.app, checked: v.checked, missing: v.missing, mismatched: v.mismatched,
    runtime: bad.filter(affectsRuntime), other: bad.filter((f) => !affectsRuntime(f)),
  };
}

/**
 * Finish an update package extracted over the install at `root` (the header's steps 1–4). Never throws.
 * @param {string} root
 * @param {{ log?: { log: Function, warn: Function, error: Function } }} [opts]
 * @returns {{ state: 'none'|'malformed'|'failed'|'applied', [k: string]: any }} failed: the server must not start
 */
export function applyPendingUpdate(root, { log = console } = {}) {
  try {
    return applyUpdate(path.resolve(root), log);
  } catch (e) {
    // a bug here must not keep a server down: report it and start as before
    log.error(`[update] 更新检查出错，已跳过 · the update check failed and was skipped: ${e?.stack || e}`);
    return { state: 'malformed', error: e?.message || String(e) };
  }
}

function applyUpdate(base, log) {
  const file = path.join(base, UPDATE_FILE);
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch (e) {
    if (e?.code === 'ENOENT') return { state: 'none' };
    log.warn(`[update] ${UPDATE_FILE} 无法读取，已跳过，服务器按现有文件启动（${e?.code || e?.message}）· could not read ${UPDATE_FILE}: skipped, the server starts with the files as they are`);
    return { state: 'malformed', error: String(e?.code || e?.message) };
  }
  let u;
  try { u = parseUpdate(text); } catch (e) {
    log.warn(`[update] ${UPDATE_FILE} 格式不对，已跳过，服务器按现有文件启动（${e.message}）· ${UPDATE_FILE} is malformed: skipped, the server starts with the files as they are`);
    return { state: 'malformed', error: e.message };
  }
  const app = `v${u.app}`;
  const fromZh = u.from.map((v) => `v${v}`).join('、');
  const fromEn = u.from.map((v) => `v${v}`).join(' / ');
  log.log(`[update] 正在应用更新包 ${app}（适用于 ${fromZh}），校验文件… · applying the ${app} update package (for ${fromEn}): verifying the install…`);

  let manifest = null;
  let reason = null;
  try { manifest = parseManifest(fs.readFileSync(path.join(base, MANIFEST_FILE), 'utf8')); } catch (e) {
    reason = e?.code === 'ENOENT' ? `${MANIFEST_FILE} is missing` : e?.message || String(e);
  }
  if (manifest && manifest.app !== u.app) reason = `${MANIFEST_FILE} belongs to v${manifest.app}`;
  if (reason) {
    log.error(`[update] 更新包 ${app} 没有完整解压（${reason}）。服务器没有启动：请把更新包重新完整解压到安装文件夹，或下载 ${app} 的完整包。`);
    log.error(`[update] The ${app} update package is incomplete (${reason}). The server did not start: extract the whole update package over the install again, or download the full ${app} package.`);
    return { state: 'failed', reason };
  }

  // the manifest (every non-art file of the new version) and the art files the update brought
  const want = new Map(manifest.files);
  for (const [rel, d] of u.files) if (!want.has(rel) && isSetupArt(rel)) want.set(rel, d);
  const v = verifyFiles(base, want);
  const bad = [...v.missing, ...v.mismatched].sort();
  const fatal = bad.filter((f) => !isSetupArt(f) && affectsRuntime(f));
  const notes = bad.filter((f) => !isSetupArt(f) && !affectsRuntime(f));
  const art = bad.filter(isSetupArt);
  if (fatal.length) {
    log.error(`[update] 这个更新包只能覆盖在 ${fromZh} 的整合包安装上（检测到 ${fatal.length} 个文件与 ${app} 不一致或缺失，例：${named(fatal, '、')}）。服务器没有启动：请下载 ${app} 的完整包重新安装，或确认更新包已完整解压。`);
    log.error(`[update] This update package only applies over a ${fromEn} install (${fatal.length} files differ from ${app} or are missing, e.g. ${named(fatal, ', ')}). The server did not start: download the full ${app} package, or extract the update package again.`);
    return { state: 'failed', checked: v.checked, missing: v.missing, mismatched: v.mismatched, fatal, notes, art };
  }

  const keep = new Set([...want.keys()].map((f) => f.toLowerCase()));
  const removal = deleteRemoved(base, u.removed, keep);
  let renamed = true;
  try { fs.renameSync(file, path.join(base, APPLIED_FILE)); } catch (e) {
    renamed = false;
    log.warn(`[update] ${UPDATE_FILE} 无法改名为 ${APPLIED_FILE}（${e?.code || e?.message}），下次启动会再检查一遍 · could not rename ${UPDATE_FILE}: the next start checks again`);
  }
  log.log(`[update] 已更新到 ${app}：${v.checked} 个文件校验通过，删除 ${removal.deleted.length} 个旧文件 · updated to ${app}: ${v.checked} files verified, ${removal.deleted.length} old files deleted`);
  if (notes.length) log.warn(`[update] ${notes.length} 个说明 / 脚本文件与 ${app} 不一致（不影响运行，例：${named(notes, '、')}）· ${notes.length} doc / script files differ from ${app} (the server is not affected)`);
  if (art.length) log.warn(`[update] ${art.length} 个素材文件没有完整解压（例：${named(art, '、')}），画面会缺图：重新解压更新包即可 · ${art.length} art files of the update are missing or damaged: extract the update package again`);
  if (removal.kept.length) log.warn(`[update] 保留了 ${removal.kept.length} 个在这台电脑上改过的旧文件（新版本已不再使用，可以手动删除）：${named(removal.kept, '、')} · kept ${removal.kept.length} old files changed on this machine (no longer used)`);
  if (removal.skipped.length) log.warn(`[update] ${removal.skipped.length} 个旧文件没有删除：${named(removal.skipped, '、')} · ${removal.skipped.length} old files were not deleted`);
  const gaps = u.files.has('data/local-assets.json') ? localArtGaps(base) : [];
  if (gaps.length) {
    log.warn(`[update] 本地客户端素材不完整：data/local-assets.json 列出的 ${gaps.length} 个文件不在这台电脑上（这个安装原来没有本地素材？例：${named(gaps, '、')}）。从 ${app} 的完整包复制 public/assets/local 和 data/local-assets.json，或运行 node tools/setup.mjs --local 重新提取；不需要时删除 data/local-assets.json 即可 · the local-client art is incomplete (${gaps.length} files data/local-assets.json lists are missing): copy public/assets/local and data/local-assets.json from the full ${app} package, re-extract with node tools/setup.mjs --local, or delete data/local-assets.json`);
  }
  return { state: 'applied', renamed, checked: v.checked, notes, art, localGaps: gaps, ...removal };
}
