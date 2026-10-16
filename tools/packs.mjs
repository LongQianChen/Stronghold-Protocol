#!/usr/bin/env node
// tools/packs.mjs — the content packs of a checkout (docs/PACKS.md; server/packs.js is the registry the server runs,
// shared/packs.js the format). It reads the language folders and packs/ as in 0.2.0, not plugins/: the plugins have
// their own tool, tools/plugin.mjs (docs/PLUGINS.md), and a static host could not serve a lang plugin's files at
// /packs/<id>/ (only the live server lists lang plugins in its /packs/index.json):
//
//   node tools/packs.mjs list [--json]          the packs by type (folder packs in packs/, the language packs of
//                                                public/i18n/), what was skipped and why, the warnings
//   node tools/packs.mjs index [--out <file>]   write the pack index — what GET /packs/index.json answers — to
//                                                packs/index.json (git-ignored), for a static host that cannot run the
//                                                server's live list; tools/package.mjs writes it into the release zips
//   node tools/packs.mjs check [--strict]       list, and exit 1 with --strict when a pack is skipped or warned about
//   --root <dir>   another checkout or an unpacked release (default: this checkout)
//
// The strings of a language pack are checked by node tools/i18n.mjs check <code> (docs/I18N.md).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { scanPacks, packIndexOf } from '../server/packs.js';
import { PACK_TYPES, PACK_INDEX_FILE } from '../shared/packs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = 'usage: node tools/packs.mjs list [--json] | index [--out <file>] | check [--strict]   [--root <dir>]';

/** The pack folders of a checkout. @param {string} root */
export const packDirs = (root) => ({ publicDir: path.join(root, 'public'), dataDir: path.join(root, 'data'), packsDir: path.join(root, 'packs') });

/**
 * Write the pack index of a checkout (default <root>/packs/index.json); returns its body.
 * @param {string} root
 * @param {string} [out]
 */
export function writePackIndex(root, out = path.join(root, 'packs', PACK_INDEX_FILE)) {
  const { packs } = scanPacks(packDirs(root));
  const body = packIndexOf(packs);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, `${JSON.stringify(body, null, 2)}\n`);
  return body;
}

/**
 * The CLI (exported for tools/i18n.mjs index).
 * @param {string[]} argv
 * @returns {Promise<number>} the exit code
 */
export async function main(argv) {
  const [cmd, ...rest] = argv;
  let root = REPO;
  let out = null;
  const flags = new Set();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--root' || a === '--out') {
      const v = rest[++i];
      if (!v || v.startsWith('--')) { console.error(`packs: ${a} needs a path\n${USAGE}`); return 2; }
      if (a === '--root') root = path.resolve(v); else out = path.resolve(v);
    } else if (a.startsWith('--')) flags.add(a.slice(2));
    else { console.error(`packs: unexpected ${a}\n${USAGE}`); return 2; }
  }
  if (cmd === 'index') {
    const file = out || path.join(root, 'packs', PACK_INDEX_FILE);
    const body = writePackIndex(root, file);
    console.log(`wrote ${path.relative(process.cwd(), file) || file}: ${body.packs.length} pack(s) — ${body.packs.map((p) => `${p.type} ${p.id}`).join(', ') || 'none'}`);
    return 0;
  }
  if (cmd !== 'list' && cmd !== 'check') { console.log(USAGE); return cmd ? 2 : 0; }
  const scan = scanPacks(packDirs(root));
  if (flags.has('json')) { console.log(JSON.stringify({ index: packIndexOf(scan.packs), skipped: scan.skipped, warnings: scan.warnings }, null, 2)); return 0; }
  for (const type of Object.keys(PACK_TYPES)) {
    const list = scan.packs.filter((p) => p.type === type);
    console.log(`${type} (${PACK_TYPES[type].status}: ${PACK_TYPES[type].summary}): ${list.length ? '' : 'none'}`);
    for (const p of list) {
      const m = p.manifest;
      const lang = type === 'lang' ? ` ${m.lang}${m.fallback?.length ? ` → ${m.fallback.join(' → ')}` : ''}` : '';
      const extra = [m.version && `v${m.version}`, m.app && `app ${m.app}${m.compatible ? '' : ' (not this version)'}`, p.strings !== undefined && `${p.strings} strings`, p.files.data && 'game texts'].filter(Boolean).join(', ');
      console.log(`  ${p.id.padEnd(16)} ${m.name}${m.englishName !== m.name ? ` (${m.englishName})` : ''}${lang}  — ${p.where}${extra ? `; ${extra}` : ''}`);
    }
  }
  for (const k of scan.skipped) console.log(`skipped  ${k.where}: ${k.problems.join('; ')}`);
  for (const w of scan.warnings) console.log(`warning  ${w.where}: ${w.warning}`);
  return cmd === 'check' && flags.has('strict') && (scan.skipped.length || scan.warnings.length) ? 1 : 0;
}

const invoked = (() => { try { return pathToFileURL(fs.realpathSync(process.argv[1] || '')).href; } catch { return null; } })();
if (invoked === import.meta.url) main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (e) => { console.error(`packs: ${e.message}`); process.exitCode = 2; });
