#!/usr/bin/env node
// tools/perfbench.mjs — frame-time benchmark of real battles in headless Chrome (public/dev/battle-perf.html: the battle
// runner + sim + field view, as in a match) for every spec × quality × CPU slowdown. Chrome DevTools CPU throttling
// stands in for slower phones (4× ≈ mid-range, 6× ≈ low-end — an approximation: no phone GPU, thermals or Safari).
// With --profile, a CPU profile of each sample is summarised by source area, by function (self time) and by pipeline
// stage (inclusive time: Spine pose, impostor redraw, Pixi render, three.js board, battle runner, sim, …).
//
// Usage: CHROME_PATH=<chrome> node tools/perfbench.mjs [--specs a,b] [--quality high,low] [--cpu 1,4,6] [--warm 20]
//        [--sample 6] [--width 844] [--height 390] [--dpr 2] [--fx off,lite,full] [--profile] [--out test/e2e/out/perf] [--json]
//   --fx       设置「官方特效」 tiers to measure (the official battle effects, render/vfx; default off; needs extracted effects)
//   --specs    names of public/dev/perf/index.json (default: all)      --warm    seconds before sampling (default 20)
//   --sample   seconds per sample (default 6)                          --profile also record and summarise a CPU profile
// Needs the downloaded assets (public/assets: real Spine models; without them every unit is a diamond and the numbers
// mean little). Writes <out>/results.json (+ <spec>-<quality>-<cpu>x.cpuprofile / .summary.json with --profile).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_CHROME = {
  win32: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
};

/** GPU flags for headless Chrome per platform (ANGLE backend; Metal exists on macOS only, D3D11 on Windows only). */
export function gpuArgs(platform = process.platform) {
  const angle = platform === 'win32' ? ['--use-angle=d3d11'] : platform === 'darwin' ? ['--use-angle=metal'] : [];
  return ['--no-first-run', '--enable-gpu', '--ignore-gpu-blocklist', ...angle];
}

/** Source area of a profile call frame (vendor libraries, the game's own modules, the browser's own work). */
export function areaOf(cf) {
  const url = cf.url || '';
  if (!url) {
    if (cf.functionName === '(garbage collector)') return 'gc';
    if (cf.functionName === '(idle)') return 'idle';
    if (cf.functionName === '(program)') return 'program';
    return 'native';
  }
  if (/\/sim\//.test(url)) return 'sim';
  if (/\/js\/battle\//.test(url)) return 'runner';
  if (/\/js\/render\//.test(url)) return 'render';
  if (/\/js\/(ui|screens)\//.test(url)) return 'ui';
  if (/pixi-spine/.test(url)) return 'spine';
  if (/pixi(\.min)?\.js/.test(url)) return 'pixi';
  if (/three\./.test(url)) return 'three';
  return 'other';
}

/** Pipeline stages measured inclusively (a sample counts once per stage on its stack). */
export const STAGES = [
  ['spinePose', 'Spine pose (actor.update)', (cf) => cf.functionName === 'update' && /render\/spine\.js/.test(cf.url)],
  ['impostorFlush', 'impostor redraw (skeletons → atlas)', (cf) => cf.functionName === 'flush' && /render\/impostor\.js/.test(cf.url)],
  ['unitUpdate', 'unit views (units.js update)', (cf) => cf.functionName === 'update' && /render\/units\.js/.test(cf.url)],
  ['frameBody', 'view frame (all JS before the Pixi render)', (cf) => cf.functionName === 'frameBody' && /render\/app\.js/.test(cf.url)],
  ['officialFx', 'official effects: simulate (render/vfx update)', (cf) => cf.functionName === 'update' && /render\/vfx\/system\.js/.test(cf.url)],
  ['officialFxDraw', 'official effects: geometry + GL draw (render/vfx renderPass)', (cf) => cf.functionName === 'renderPass' && /render\/vfx\/system\.js/.test(cf.url)],
  ['pixiRender', 'Pixi render (main + render textures)', (cf) => cf.functionName === 'render' && /pixi(\.min)?\.js/.test(cf.url)],
  ['board3d', 'three.js board render', (cf) => cf.functionName === 'render' && /board3d\/scene\.js/.test(cf.url)],
  ['runner', 'battle runner frame', (cf) => cf.functionName === 'frame' && /js\/battle\/runner\.js/.test(cf.url)],
  ['sim', 'sim (any /sim/ module)', (cf) => /\/sim\//.test(cf.url || '')],
  ['gc', 'garbage collector', (cf) => cf.functionName === '(garbage collector)'],
  ['program', 'browser-native (program)', (cf) => cf.functionName === '(program)'],
];

/**
 * Summary of a CDP CPU profile ({ nodes, samples, timeDeltas }): busy time (idle excluded), the share of each source
 * area (self time), the top functions by self time, and each STAGES entry's inclusive share.
 */
export function aggregateProfile(profile, top = 30) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const area = new Map(), fn = new Map(), stage = new Map(STAGES.map(([k]) => [k, 0]));
  let busy = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const dt = profile.timeDeltas[i] || 0;
    const leaf = nodes.get(profile.samples[i]);
    if (!leaf) continue;
    const a = areaOf(leaf.callFrame);
    if (a === 'idle') continue;
    busy += dt;
    area.set(a, (area.get(a) || 0) + dt);
    const cf = leaf.callFrame;
    const key = `${cf.functionName || '(anonymous)'} ${cf.url ? `${cf.url.replace(/^[a-z]+:\/\/[^/]+/, '')}:${cf.lineNumber + 1}` : ''}`.trim();
    fn.set(key, (fn.get(key) || 0) + dt);
    const hit = new Set();
    for (let id = profile.samples[i]; id != null; id = parent.get(id)) {
      const f = nodes.get(id).callFrame;
      for (const [k, , test] of STAGES) if (!hit.has(k) && test(f)) hit.add(k);
    }
    for (const k of hit) stage.set(k, stage.get(k) + dt);
  }
  const pct = (us) => (busy > 0 ? Math.round((us / busy) * 1000) / 10 : 0);
  const ms = (us) => Math.round(us / 100) / 10;
  return {
    busyMs: ms(busy),
    areas: [...area].sort((x, y) => y[1] - x[1]).map(([name, us]) => ({ area: name, ms: ms(us), pct: pct(us) })),
    stages: STAGES.map(([k, label]) => ({ stage: k, label, ms: ms(stage.get(k)), pct: pct(stage.get(k)) })),
    top: [...fn].sort((x, y) => y[1] - x[1]).slice(0, top).map(([name, us]) => ({ fn: name, ms: ms(us), pct: pct(us) })),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
  const list = (k, d) => String(opt(k, d)).split(',').map((s) => s.trim()).filter(Boolean);
  const index = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/dev/perf/index.json'), 'utf8'));
  const specs = argv.includes('--specs') ? list('specs', '') : index.map((s) => s.name);
  const qualities = list('quality', 'high');
  const fxs = list('fx', 'off');
  const cpus = list('cpu', '1,4,6').map(Number);
  const warm = Number(opt('warm', 20)), sample = Number(opt('sample', 6));
  const width = Number(opt('width', 844)), height = Number(opt('height', 390)), dpr = Number(opt('dpr', 2));
  const profileOn = argv.includes('--profile');
  const out = path.resolve(ROOT, opt('out', 'test/e2e/out/perf'));
  const chrome = process.env.CHROME_PATH || DEFAULT_CHROME[process.platform];
  if (!chrome || !fs.existsSync(chrome)) { console.error(`Chrome not found (${chrome}); set CHROME_PATH`); return 2; }
  if (!fs.existsSync(path.join(ROOT, 'public/assets/spine'))) console.warn('warning: public/assets/spine is missing (npm run setup): units draw as diamonds');
  fs.mkdirSync(out, { recursive: true });

  const puppeteer = (await import('puppeteer-core')).default;
  const { startServer } = await import('../server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: gpuArgs() });
  const results = [];
  try {
    for (const spec of specs) for (const quality of qualities) for (const fx of fxs) for (const cpu of cpus) {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.setViewport({ width, height, deviceScaleFactor: dpr });
      await page.goto(`http://127.0.0.1:${srv.port}/dev/battle-perf.html?spec=${encodeURIComponent(spec)}&quality=${quality}&fx=${fx}&panel=0`);
      await page.waitForFunction('window.__perf && (window.__perf.ready || window.__perf.error)', { timeout: 60000 });
      const err = await page.evaluate(() => globalThis.__perf.error);
      if (err) { console.log(`${spec}: ${err.split('\n')[0]}`); await page.close(); continue; }
      const cdp = await page.createCDPSession();
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      await new Promise((r) => setTimeout(r, warm * 1000));
      if (profileOn) {
        await cdp.send('Profiler.enable');
        await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
        await cdp.send('Profiler.start');
      }
      const s = await page.evaluate((ms) => globalThis.__perf.sample(ms), sample * 1000);
      let summary = null;
      if (profileOn) {
        const { profile } = await cdp.send('Profiler.stop');
        summary = aggregateProfile(profile);
        const base = path.join(out, `${spec}-${quality}${fx !== 'off' ? `-fx${fx}` : ''}-${cpu}x`);
        fs.writeFileSync(`${base}.cpuprofile`, JSON.stringify(profile));
        fs.writeFileSync(`${base}.summary.json`, JSON.stringify(summary, null, 1));
      }
      const rec = { spec, quality, fx, cpu, ...s, profiled: profileOn, errors: errors.slice(0, 3) };
      results.push(rec);
      if (!argv.includes('--json')) {
        const o = s.officialFx;
        console.log(`${spec.padEnd(18)} ${quality.padEnd(6)} fx ${fx.padEnd(4)} ${String(cpu).padStart(2)}x  fps ${String(s.fps).padStart(6)}  p95 ${String(s.p95).padStart(6)} ms  >33ms ${String(s.over33).padStart(5)}%`
          + `  sim ${s.simMsPerTick} ms/tick  view CPU ${s.viewCpuMs} ms  render ${s.renderMs} ms  units ${s.units}  load ${s.lod}`
          + (o && o.tier !== 'off' ? `  fx ${o.effects} effects / ${o.particles} particles / ${o.draws} draws / ${o.texMB} MB` : '')
          + `${errors.length ? `  ERRORS ${errors.length}` : ''}`);
        if (summary) console.log(`  ${summary.stages.filter((x) => x.pct > 0).map((x) => `${x.stage} ${x.pct}%`).join(' · ')}`);
      }
      await page.close();
    }
  } finally {
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
    await browser.close();
    await srv.close();
  }
  if (argv.includes('--json')) console.log(JSON.stringify(results));
  return results.some((r) => r.errors.length) ? 1 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then((code) => { process.exitCode = code; }, (err) => { console.error(err); process.exitCode = 1; });
}
