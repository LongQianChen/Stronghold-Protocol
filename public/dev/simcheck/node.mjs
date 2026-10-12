// simcheck's Node side: the reference (every scenario traced in Node, core.js), headless runs of the check page in
// several engines, and the field-by-field comparison of a dump a browser downloaded with Node's run of the same ticks.
// Engines: Playwright's chromium / firefox / webkit when the `playwright` package is installed (its browsers fetched
// with `npx playwright install firefox webkit`), else a local Chrome through puppeteer-core ($CHROME_PATH or the usual
// install paths).
//
// Written for Stronghold Protocol (GPL-3.0-or-later) and Duel Channel (AGPL-3.0-or-later) by the same author, and kept
// the same in both.
import { existsSync, readFileSync } from 'node:fs';
import { tracer, diffDumps, VERSION } from './core.js';

/**
 * Trace every scenario in Node: the reference a page compares with.
 * @param {object} adapter @param {{ id: string }[]} scenarios
 * @param {{ every?: number, project: string, made?: object, onProgress?: (i: number, n: number, id: string) => void }} o
 */
export function buildReference(adapter, scenarios, { every = 30, deepEvery = every * 5, project, made = {}, onProgress } = {}) {
  const out = {};
  scenarios.forEach((sc, i) => {
    if (onProgress) onProgress(i, scenarios.length, sc.id);
    const { ticks, blocks, views, deeps, result } = tracer(adapter, sc, { every, deepEvery }).finish();
    out[sc.id] = { ticks, blocks, views, deeps, result };
  });
  return { simcheck: VERSION, project, every, deepEvery, made: { engine: `Node ${process.version}`, date: new Date().toISOString().slice(0, 10), ...made }, scenarios: out };
}

const CHROMES = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
async function tryImport(name) { try { return await import(name); } catch { return null; } }

/**
 * Open the check page (url, with ?auto=1 and the subset) in each engine and wait for its results.
 * @param {string} url @param {string[]} engines 'chromium' | 'firefox' | 'webkit' | 'chrome' (a local Chrome)
 * @returns {Promise<Record<string, { version?: string, status: string, summary?: object, results?: object[], report?: string, error?: string }>>}
 */
export async function runEngines(url, engines, { timeoutMs = 30 * 60000, log = () => {} } = {}) {
  const pw = await tryImport('playwright'), pp = pw ? null : await tryImport('puppeteer-core');
  const out = {};
  for (const name of engines) {
    let browser = null;
    try {
      if (pw && pw[name === 'chrome' ? 'chromium' : name]) {
        const type = pw[name === 'chrome' ? 'chromium' : name], exe = CHROMES.find((p) => p && existsSync(p));
        // chromium / chrome: Playwright's own build when it is installed, else the local Chrome
        try { browser = await type.launch(name === 'chrome' && exe ? { executablePath: exe } : {}); } catch (e) {
          if (type !== pw.chromium || !exe) throw e;
          browser = await type.launch({ executablePath: exe });
        }
      } else if (pp && (name === 'chrome' || name === 'chromium')) {
        const exe = CHROMES.find((p) => p && existsSync(p));
        if (!exe) throw new Error('no Chrome found: set CHROME_PATH');
        browser = await (pp.default || pp).launch({ executablePath: exe, headless: true });
      } else throw new Error(pw ? `playwright has no ${name}` : `${name} needs the playwright package (npm i -D playwright && npx playwright install ${name})`);
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e.message || e)));
      await page.goto(url, { timeout: 120000 });
      const t0 = Date.now();
      let last = -1;
      for (;;) {
        const st = await page.evaluate(() => { const s = globalThis.__simcheck; return s ? { status: s.status, n: s.results.length } : null; });
        if (st && ['done', 'stopped', 'error'].includes(st.status)) break;
        if (errors.length) throw new Error(errors.join('; '));
        if (st && st.n !== last && st.n % 25 === 0) { log(`  ${name}: ${st.n}`); last = st.n; }
        if (Date.now() - t0 > timeoutMs) throw new Error('timed out');
        await new Promise((r) => setTimeout(r, 1000));
      }
      const res = await page.evaluate(() => { const s = globalThis.__simcheck; return { status: s.status, expected: s.expected, completed: s.completed, error: s.error, summary: s.summary, results: s.results, report: s.report }; });
      out[name] = { version: browser.version ? await browser.version() : '', ...res, errors };
    } catch (e) {
      out[name] = { status: 'error', error: String(e && e.message || e) };
    } finally { if (browser) await browser.close().catch(() => {}); }
  }
  return out;
}

/**
 * A dump a browser downloaded (the page's 下载这一段的状态) against Node's run of the same ticks: the differing entries,
 * first ones first, as printable lines.
 * @param {string} file @param {object} adapter @param {{ id: string }[]} scenarios
 */
export function diffDumpFile(file, adapter, scenarios, { every = 30, deepEvery = every * 5, limit = 20, identity = null } = {}) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  if (d.simcheck !== VERSION || !d.dumps || typeof d.dumps !== 'object' || !Array.isArray(d.window)) throw new Error('invalid dump format');
  if (identity && d.identity !== identity) throw new Error('dump and reference inputs differ');
  const sc = scenarios.find((s) => s.id === d.id);
  if (!sc) throw new Error(`no scenario ${d.id} here`);
  const ref = tracer(adapter, sc, { every, deepEvery, dump: d.window }).finish();
  const diffs = diffDumps(ref.dumps, d.dumps, limit);
  const lines = [`${d.id}, ticks ${d.window[0]}–${d.window[1]}: Node ${process.version} vs ${d.engine}`];
  if (!diffs.length) lines.push('  the same in every entry of these ticks (the difference is in what the state vector does not hold: view / deep)');
  for (const x of diffs) lines.push(x.index < 0 ? `  tick ${x.tick}: ${x.label}` : `  tick ${x.tick} ${x.label}: ${x.ref} (${x.refBits}) vs ${x.got} (${x.gotBits})`);
  return lines;
}

/** One line per engine for a console. */
export function formatEngines(res) {
  return Object.entries(res).map(([name, r]) => {
    if (r.status === 'error') return `${name}: error — ${r.error}`;
    const s = r.summary || {};
    const bad = (r.results || []).filter((x) => !x.c.ok).map((x) => x.id);
    return `${name} ${r.version || ''}: ${s.ok}/${s.n} the same${bad.length ? ` — different: ${bad.slice(0, 12).join(', ')}${bad.length > 12 ? ' …' : ''}` : ''}${r.errors && r.errors.length ? ` (page errors: ${r.errors.length})` : ''}`;
  });
}
