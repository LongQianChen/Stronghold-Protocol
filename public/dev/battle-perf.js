// Battle perf page (dev): one real battle in the browser, run the way the match screen runs it — the client-side battle
// runner (js/battle/runner.js: the shared sim at the battle speed) feeding the field view (js/render/app.js) — from a
// BattleSpec captured off a bot match (tools/capture-specs.mjs → /dev/perf/<name>.json). Players can open it on a
// phone and report the numbers (「开始测量」→ a verdict and a copyable report); tools/perfbench.mjs drives it headlessly.
//
// Query: ?spec=<name> (default: the first of /dev/perf/index.json) &quality=high|medium|low &panel=0 (hide the panel)
//        &fx=off|lite|full|auto (设置「官方特效」, render/vfx: the official battle effects when extracted; default off here
//        so the figures stay comparable with earlier runs)
//        &board=2d|3d (render/app.js reads it)
// Puppeteer hook: window.__perf = { ready, error, view, runner, sample(ms) → figures over `ms` of animation frames }
//
// The panel must not disturb what it measures: frame times go into a ring buffer (one store per frame), the strip is
// redrawn 4× a second from it, binned to pixel columns, and both the strip and the live figures stand still during a
// measurement (only a CSS progress animation runs).

import { createFieldView } from '../js/render/app.js';
import { data } from '../js/data.js';
import { assets } from '../js/assets.js';
import { createBattleRunner } from '../js/battle/runner.js';
import { round, frameFigures } from './frame-stats.js';

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);
const perf = { ready: false, error: null };
window.__perf = perf;

const longTasks = [];
try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
} catch { /* not supported */ }

// Frame-time budgets (ms) shared by the verdict, the strip colours and the stutter share: 16.7 / 33.3 ms are 60 / 30 FPS.
// The 60 FPS budget allows 5% for vsync jitter (a 60 Hz display measures frames of 16.6–17.4 ms); a frame over the 30 FPS
// budget counts as a stutter frame.
export const FRAME_60_MS = 17.5;
export const FRAME_30_MS = 33.4;
const QUALITY_NAME = { high: '高', medium: '中', low: '低' };

/**
 * Frame figures over `ms` of animation frames: average fps, frame-time percentiles, the share of frames over 33.4 ms
 * (below 30 fps), long tasks, the sim's ticks and their cost (runner.stats), and the view's own CPU / render times.
 * The first frame time is partial (from the call to the first frame) and dropped, so the sample runs for at least two
 * frames whatever `ms` is: a sample that saw a single frame (a short `ms`, a frame longer than `ms`) had no frame time
 * left and divided by zero.
 */
perf.sample = (ms = 10000) => new Promise((resolve) => {
  const deltas = [];
  let last = performance.now();
  const t0 = last;
  const r0 = { ...perf.runner.stats() };
  const lt0 = longTasks.length;
  const step = (t) => {
    deltas.push(t - last);
    last = t;
    if (t - t0 < ms || deltas.length < 2) { requestAnimationFrame(step); return; }
    deltas.shift();
    const r1 = perf.runner.stats();
    const v = perf.view.stats();
    const lt = longTasks.slice(lt0);
    const ticks = r1.ticks - r0.ticks;
    resolve({
      ...frameFigures(deltas, FRAME_30_MS),
      longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, b) => a + b, 0)),
      ticks, simMs: round(r1.stepMs - r0.stepMs), simMsPerTick: ticks > 0 ? round((r1.stepMs - r0.stepMs) / ticks, 3) : null,
      viewCpuMs: v.cpuMs, renderMs: v.renderMs, units: v.units, lod: v.lod, particles: v.particles,
      officialFx: v.officialFx ? { tier: v.officialFx.tier, effects: v.officialFx.effects, particles: v.officialFx.particles, draws: v.officialFx.draws, textures: v.officialFx.textures, texMB: v.officialFx.texMB } : null,
      board: v.board3d?.on ? '3d' : '2d', done: !!perf.runner.state()?.done,
    });
  };
  requestAnimationFrame(step);
});

/** The device line of a report: renderer, screen, cores (what a phone report needs to be comparable). */
function deviceInfo() {
  let gpu = '?';
  try {
    const gl = document.createElement('canvas').getContext('webgl2') || document.createElement('canvas').getContext('webgl');
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
    gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : (gl ? gl.getParameter(gl.RENDERER) : 'no WebGL');
  } catch { /* ignore */ }
  return {
    ua: navigator.userAgent, gpu, cores: navigator.hardwareConcurrency || null, memoryGB: navigator.deviceMemory || null,
    viewport: `${innerWidth}×${innerHeight}`, dpr: devicePixelRatio,
  };
}

/** The copyable report: one item per line, the panel's terms and units (pasted into feedback as is). */
function report(spec, title, quality, s) {
  const d = deviceInfo();
  const lines = [
    '战斗性能测试报告（/dev/battle-perf.html）',
    `场景：${title}（${spec}）`,
    `画质：${QUALITY_NAME[quality] || quality}；棋盘：${s.board === '3d' ? '3D' : '2D'}`,
    `帧率：${s.fps} FPS`,
    `帧耗时：P50 ${s.p50} ms，P95 ${s.p95} ms，P99 ${s.p99} ms`,
    `卡顿帧占比（单帧 > 33.3 ms）：${s.over33}%`,
    `模拟单步：${s.simMsPerTick} ms（共 ${s.ticks} 步）`,
    `渲染 CPU：${s.viewCpuMs} ms；渲染提交：${s.renderMs} ms`,
    `场上单位：${s.units}；自适应负载档位：${s.lod}`,
    `长任务：${s.longTasks} 次，共 ${s.longTaskMs} ms`,
    `GPU：${d.gpu}`,
    `设备：${d.cores ?? '未知'} 个 CPU 线程${d.memoryGB ? `，内存约 ${d.memoryGB} GB` : ''}；视口 ${d.viewport}，像素比 ${d.dpr}`,
    `浏览器：${d.ua}`,
  ];
  if (s.done) lines.splice(10, 0, '注意：战斗在测量期间结束，结果仅供参考');
  return lines.join('\n');
}

/** The verdict a player reads first, on the frame-time budgets of the strip (60 / 30 FPS). */
export function verdictOf(s) {
  if (s.p95 <= FRAME_60_MS && s.over33 < 1) return { label: '流畅', note: `P95 帧耗时 ${s.p95} ms，达到 60 FPS`, color: '--mint-500' };
  if (s.p95 <= FRAME_30_MS && s.over33 < 1) return { label: '基本流畅', note: `P95 帧耗时 ${s.p95} ms，介于 30–60 FPS`, color: '--amber' };
  return { label: '卡顿', note: `卡顿帧占比 ${s.over33}%，P95 帧耗时 ${s.p95} ms`, color: '--red' };
}

// ---- frame ring buffer + strip ------------------------------------------------------------------------------------

const RING = 4096;
const ringT = new Float64Array(RING);   // frame end (performance.now)
const ringD = new Float32Array(RING);   // frame time (ms)
let ringN = 0;
let lastT = 0;
function recordFrames(t) {
  if (lastT) { const i = ringN % RING; ringT[i] = t; ringD[i] = t - lastT; ringN++; }
  lastT = t;
  requestAnimationFrame(recordFrames);
}

const SPAN_MS = 10000;   // the strip shows the last 10 s
const TOP_MS = 50;       // frame times above clip to the top (a red spike)
let palette = null;
function colors() {
  if (!palette) {
    const cs = getComputedStyle(document.documentElement);
    const v = (n) => cs.getPropertyValue(n).trim();
    palette = { good: v('--mint-500'), warn: v('--amber'), bad: v('--red'), line: v('--line-2'), text: v('--text-lo') };
  }
  return palette;
}
const band = (ms) => (ms <= FRAME_60_MS ? 'good' : ms <= FRAME_30_MS ? 'warn' : 'bad');

/** Draw the last SPAN_MS of frame times into `cv`: one column per pixel (its slowest frame), budget lines at 60 / 30 fps. */
function drawStrip(cv, { labels = true } = {}) {
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return;
  const dpr = Math.min(2, devicePixelRatio || 1);
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const c = colors();
  const pad = labels ? 4 : 1;
  const y = (ms) => h - pad - (Math.min(ms, TOP_MS) / TOP_MS) * (h - pad * 2);
  g.fillStyle = c.line;
  for (const ms of [16.7, 33.3]) g.fillRect(0, Math.round(y(ms)), w, 1);
  if (labels) {
    g.fillStyle = c.text;
    g.font = '10px "Noto Sans SC", sans-serif';
    g.textAlign = 'right';
    g.fillText('60 FPS', w - 3, y(16.7) - 3);
    g.fillText('30 FPS', w - 3, y(33.3) - 3);
  }
  const now = performance.now();
  const cols = new Float32Array(Math.ceil(w));
  for (let k = 1; k <= Math.min(ringN, RING); k++) {
    const i = (ringN - k) % RING;
    const age = now - ringT[i];
    if (age > SPAN_MS) break;
    const x = Math.floor(w - 1 - (age / SPAN_MS) * w);
    if (x >= 0 && ringD[i] > cols[x]) cols[x] = ringD[i];
  }
  const barW = labels ? 1 : 1.5;
  for (let x = 0; x < cols.length; x++) {
    const ms = cols[x];
    if (!ms) continue;
    g.fillStyle = c[band(ms)];
    const top = y(ms);
    g.fillRect(x, top, barW, h - pad - top);
  }
}

// ---- panel ----------------------------------------------------------------------------------------------------------

const PANEL_KEY = 'sp.dev.battlePerfPanel';
function loadPanelPref() {
  try { return localStorage.getItem(PANEL_KEY); } catch { return null; }
}
function savePanelPref(v) {
  try { localStorage.setItem(PANEL_KEY, v); } catch { /* private mode */ }
}

function setupPanel() {
  const panel = $('panel');
  const set = (collapsed, save = true) => {
    panel.classList.toggle('is-collapsed', collapsed);
    $('expand').setAttribute('aria-expanded', String(!collapsed));
    $('collapse').setAttribute('aria-expanded', String(!collapsed));
    if (save) savePanelPref(collapsed ? 'collapsed' : 'open');
  };
  const pref = loadPanelPref();
  // phones (a landscape phone is short): start folded, the battle is what is being measured
  set(pref ? pref === 'collapsed' : (innerWidth < 900 || innerHeight < 500), false);
  $('collapse').onclick = () => { set(true); $('expand').focus(); };
  $('expand').onclick = () => { set(false); $('collapse').focus(); };
}

async function main() {
  if (q.get('panel') === '0') $('panel').classList.add('is-hidden');
  setupPanel();
  const index = await fetch('/dev/perf/index.json').then((r) => (r.ok ? r.json() : []), () => []);
  const specName = q.get('spec') || index[0]?.name;
  if (!specName) throw new Error('未找到战斗数据。请先运行 node tools/capture-specs.mjs 生成。');
  const quality = ['high', 'medium', 'low'].includes(q.get('quality')) ? q.get('quality') : 'high';
  for (const s of index) $('spec').append(new Option(s.title || s.name, s.name));
  $('spec').value = specName;
  $('quality').value = quality;
  const reload = () => {
    const p = new URLSearchParams(location.search);
    p.set('spec', $('spec').value);
    p.set('quality', $('quality').value);
    if (q.get('fx')) p.set('fx', q.get('fx'));
    location.search = p.toString();
  };
  $('restart').onclick = reload;
  $('spec').onchange = reload;
  $('quality').onchange = reload;

  await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config');
  await assets.ready();
  const msg = await fetch(`/dev/perf/${encodeURIComponent(specName)}.json`).then((r) => {
    if (!r.ok) throw new Error(`战斗数据 ${specName} 加载失败（HTTP ${r.status}）。请确认该文件位于 public/dev/perf/。`);
    return r.json();
  });
  const officialFx = ['off', 'lite', 'full', 'auto'].includes(q.get('fx')) ? q.get('fx') : 'off';
  const view = await createFieldView($('field'), { data, assets, settings: { quality, damageNumbers: true, officialFx } });
  view.setStage(data.lookup('stages', msg.spec.stageId));
  // the runner needs no server here: reports go nowhere, the battle runs from its start
  const net = { on: () => () => {}, send() {}, request: async () => ({ ok: true }) };
  const runner = createBattleRunner({ net, store: null });
  const camKind = msg.kind === 'hidden' ? 'boss' : msg.kind;
  runner.on('field', (field) => { view.enterBattle(field); view.setCamera(camKind, { rect: field.rect, side: 'L', instant: true }); });
  runner.on('snap', (snap) => view.pushSnapshot(snap));
  runner.on('ev', (ev) => view.pushEvents(ev));
  perf.view = view;
  perf.runner = runner;
  await runner.onStart({ ...msg, elapsed: 0, authoritative: true, watch: false, done: false });
  perf.ready = true;
  // frame times from here on: the loading hitches before the battle are not the battle's
  requestAnimationFrame(recordFrames);

  let measuring = false;
  let prev = { ...runner.stats() };
  const live = () => {
    if (measuring) return;
    const v = view.stats();
    const r = runner.stats();
    const ticks = r.ticks - prev.ticks;
    const simMs = ticks > 0 ? (r.stepMs - prev.stepMs) / ticks : 0;
    prev = { ...r };
    const fps = Math.round(v.fps);
    $('fps').textContent = fps;
    $('f-frame').textContent = `${v.frameMs.toFixed(1)} ms`;
    $('f-view').textContent = `${v.cpuMs.toFixed(1)} ms`;
    $('f-sim').textContent = `${simMs.toFixed(2)} ms`;
    $('chip-fps').textContent = fps;
    $('chip-ms').textContent = `FPS / ${v.frameMs.toFixed(1)} ms`;
    const st = runner.state();
    $('meta').textContent = st?.done
      ? '战斗已结束。如需继续测量，请点击「重新开始」。'
      : `场上单位 ${v.units} 个，自适应负载 ${v.lod} 档，${v.board3d?.on ? '3D' : '2D'} 棋盘`;
  };
  setInterval(live, 500);
  setInterval(() => {
    if (measuring) return;
    if ($('panel').classList.contains('is-collapsed')) drawStrip($('chip-strip'), { labels: false });
    else drawStrip($('strip'));
  }, 250);

  const btn = $('measure');
  btn.disabled = false;
  btn.onclick = async () => {
    if (measuring) return;
    measuring = true;
    btn.classList.add('is-running');
    btn.setAttribute('aria-disabled', 'true');
    $('freeze').hidden = false;
    const t0 = Date.now();
    const tick = setInterval(() => { $('measure-label').textContent = `测量中（剩余 ${Math.max(1, 10 - Math.floor((Date.now() - t0) / 1000))} 秒）`; }, 1000);
    $('measure-label').textContent = '测量中（剩余 10 秒）';
    const s = await perf.sample(10000);
    clearInterval(tick);
    measuring = false;
    btn.classList.remove('is-running');
    btn.removeAttribute('aria-disabled');
    $('freeze').hidden = true;
    $('measure-label').textContent = '重新测量（10 秒）';

    const v = verdictOf(s);
    const verdict = $('verdict');
    verdict.style.setProperty('--v', `var(${v.color})`);
    verdict.replaceChildren(document.createTextNode(v.label));
    const note = document.createElement('small');
    note.textContent = v.note;
    verdict.append(note);
    $('r-fps').textContent = s.fps;
    $('r-p95').textContent = `${s.p95} ms`;
    $('r-over').textContent = `${s.over33}%`;
    const text = report(specName, index.find((x) => x.name === specName)?.title || specName, quality, s);
    $('out').textContent = text;
    $('result').hidden = false;
    const copy = $('copy');
    copy.textContent = '复制报告';
    copy.onclick = () => {
      const done = () => { copy.textContent = '已复制到剪贴板'; };
      const fallback = () => {
        const d = $('result').querySelector('details');
        d.open = true;
        const range = document.createRange();
        range.selectNodeContents($('out'));
        const sel = getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        copy.textContent = '无法写入剪贴板，已选中报告文本，请手动复制';
      };
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).then(done, fallback);
      else fallback();
    };
  };
}

main().catch((err) => {
  perf.error = String(err?.stack || err);
  console.error(err);
  const meta = document.getElementById('meta');
  if (meta) meta.textContent = `加载失败：${err?.message || err}`;
});
