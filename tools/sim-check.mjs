// The cross-engine check of the battle sim (docs/SIM.md「Cross-engine check」). A browser simulates its battles and
// the server re-simulates them (SP_VERIFY, takeovers), so every engine must give the same bits as Node. The golden
// battle corpus traced in Node is the reference; public/dev/sim-check.html runs the corpus in any browser — a desktop
// or a phone on the LAN — and compares it tick by tick (public/dev/simcheck: core.js, ui.js, stronghold.js).
//
//   node tools/sim-check.mjs                    write public/dev/simcheck/data/specs.json (the corpus's BattleSpecs)
//                                               and reference.json (their Node traces); git-ignored
//   node tools/sim-check.mjs --engines chromium,firefox,webkit [--subset fast|all|<family>] [--only id,id]
//                                               then start the server on a free port and run the page headless in each
//                                               engine; exit 1 when one differs. Firefox and WebKit need the
//                                               playwright package (npm i -D playwright && npx playwright install
//                                               firefox webkit); without it `chrome` runs a local Chrome
//                                               ($CHROME_PATH) through puppeteer-core
//   node tools/sim-check.mjs --diff <dump.json> the block a browser downloaded (下载这一段的状态) against Node's run of
//                                               the same ticks, entry by entry
import { mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import * as spec from '../server/sim/spec.js';
import { DataSource } from '../server/sim/simdata.js';
import { APP_VERSION } from '../shared/constants.js';
import { getData } from '../server/data.js';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { scenariosOf as goldenScenarios, isFast } from './golden.mjs';
import { strongholdAdapter, scenariosOf, SIM_DATA_FILES } from '../public/dev/simcheck/stronghold.js';
import { buildReference, runEngines, formatEngines, diffDumpFile } from '../public/dev/simcheck/node.mjs';
import { VERSION, textFingerprint, selectScenarios } from '../public/dev/simcheck/core.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT_DIR = join(ROOT, 'public', 'dev', 'simcheck', 'data');
export const FAMILIES = Object.freeze(['roster', 'bonds', 'fields', 'standins', 'diy']);

/** The golden battle corpus as BattleSpecs, in the corpus's order; a field battle keeps its cap (golden's forceEnd). */
export function corpusSpecs(families = FAMILIES) {
  const specs = [];
  for (const fam of families) {
    for (const sc of goldenScenarios(fam)) {
      specs.push({ id: sc.id, fam, fast: isFast(sc), cap: sc.cap ?? null, spec: spec.buildBattleSpec({
        battleId: sc.id, fieldId: sc.fieldId ?? 'g', kind: sc.kind, seed: sc.seed, modeId: sc.modeId, round: sc.round, stageId: sc.stageId, rect: sc.rect,
        timeLimit: sc.timeLimit, players: sc.players, spawns: sc.spawns, routes: sc.routes, flags: sc.flags, enemyOverrides: sc.enemyOverrides ?? {},
        waveId: sc.waveId ?? null, bossId: sc.bossId ?? null, boss: sc.boss ?? null, content: 'full' }) });
    }
  }
  return specs;
}
/** The adapter over Node's sim and data (the same files the browser loads: loadBrowserSim reads data/*.json). */
export function nodeAdapter(doc) {
  return strongholdAdapter({ spec, ds: new DataSource(getData({ log: { info() {}, warn() {}, error() {} } }), null), doc });
}
const commit = () => { try { return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim(); } catch { return ''; } };

export function parseOptions(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (!['--diff', '--engines', '--subset', '--only'].includes(k) || !v || v.startsWith('--') || out[k]) throw new Error(`invalid or missing argument: ${k}`);
    out[k] = v;
  }
  if (out['--diff'] && Object.keys(out).length !== 1) throw new Error('--diff cannot be combined with run options');
  if ((out['--subset'] || out['--only']) && !out['--engines']) throw new Error('--subset/--only require --engines');
  if (out['--subset'] && !['all', 'fast', ...FAMILIES].includes(out['--subset'])) throw new Error('unknown subset');
  if (out['--engines'] && out['--engines'].split(',').some(n => !['chrome', 'chromium', 'firefox', 'webkit'].includes(n))) throw new Error('unknown engine');
  return out;
}

/** Served runtime inputs, by content (dirty source/data changes included; never host paths in the document). */
export function runtimeFiles() {
  const files = [];
  const add = (url, file) => files.push({ url, hash: textFingerprint(readFileSync(join(ROOT, file), 'utf8')) });
  const walk = (dir, url) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, `${url}/${e.name}`);
      else if (e.name.endsWith('.js') && e.name !== 'nodeData.js') add(`${url}/${e.name}`, `${dir}/${e.name}`);
    }
  };
  walk('server/sim', '/sim'); walk('shared', '/shared');
  for (const p of ['js/battle/runner.js', 'dev/simcheck/core.js', 'dev/simcheck/stronghold.js']) add(`/${p}`, `public/${p}`);
  for (const p of SIM_DATA_FILES) add(`/data/${p}.json`, `data/${p}.json`);
  files.push({ url: '/data.js', hash: textFingerprint(DATA_SHIM_JS) });
  return files.sort((a, b) => a.url < b.url ? -1 : a.url > b.url ? 1 : 0);
}
export const bundleIdentity = (specs, files) => textFingerprint(JSON.stringify({ specs, files }));

async function main(argv) {
  const options = parseOptions(argv), opt = k => options[k] ?? null;
  if (opt('--diff')) {
    const doc = JSON.parse(readFileSync(join(OUT_DIR, 'specs.json'), 'utf8'));
    if (doc.identity !== bundleIdentity(doc.specs, runtimeFiles())) throw new Error('reference inputs are stale; regenerate before comparing a dump');
    for (const line of diffDumpFile(opt('--diff'), nodeAdapter(doc), scenariosOf(doc), { identity: doc.identity })) console.log(line);
    return 0;
  }
  const t0 = Date.now();
  const doc = { simcheck: VERSION, made: { version: APP_VERSION, commit: commit() }, specs: corpusSpecs(), files: runtimeFiles() };
  doc.identity = bundleIdentity(doc.specs, doc.files);
  const scenarios = scenariosOf(doc);
  if (opt('--engines')) selectScenarios(scenarios, [{ id: 'all', pick: () => true }, { id: 'fast', pick: s => s.fast }, ...FAMILIES.map(id => ({ id, pick: s => s.family === id }))], opt('--subset') || 'all', opt('--only'));
  let last = 0;
  const reference = buildReference(nodeAdapter(doc), scenarios, {
    project: 'stronghold', made: { version: APP_VERSION, commit: doc.made.commit },
    onProgress: (i, n) => { if (Date.now() - last > 2000) { last = Date.now(); process.stdout.write(`\r  ${i} / ${n}`); } },
  });
  reference.identity = doc.identity;
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(join(OUT_DIR, 'specs.json'), JSON.stringify(doc));
  writeFileSync(join(OUT_DIR, 'reference.json'), JSON.stringify(reference));
  console.log(`\r${scenarios.length} battles traced in ${((Date.now() - t0) / 1000).toFixed(1)} s → public/dev/simcheck/data/ (open /dev/sim-check.html)`);

  const engines = opt('--engines');
  if (!engines) return 0;
  const { startServer } = await import('../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  try {
    const q = new URLSearchParams({ auto: '1', subset: opt('--subset') || 'all' });
    if (opt('--only')) q.set('only', opt('--only'));
    const res = await runEngines(`http://127.0.0.1:${srv.port}/dev/sim-check.html?${q}`, engines.split(','), { log: (s) => console.log(s) });
    for (const line of formatEngines(res)) console.log(line);
    return Object.values(res).every((r) => r.status === 'done' && r.expected > 0 && r.completed === r.expected && r.summary?.ok === r.expected) ? 0 : 1;
  } finally { await srv.close(); }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1] && existsSync(ROOT)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e); process.exit(2); });
}
