// simcheck's page: runs a corpus of scenarios in this browser, compares every run with the reference made in Node
// (core.js compare) and says which ones parted, when, and how badly — the outcome, what viewers see, or only the
// hidden state. For a run that parted, the state vectors of the block where it parted can be downloaded and compared
// field by field with Node's (the project's tool, `--diff`). The summary can be copied as a report.
// Plain DOM, no framework; colours from CSS variables (--sc-*), so a page can wear its project's theme. Headless
// drivers read window.__simcheck ({ status, results, summary, report }) and may pass ?subset=<id>&auto=1 (&only=a,b).
//
// Written for Stronghold Protocol (GPL-3.0-or-later) and Duel Channel (AGPL-3.0-or-later) by the same author, and kept
// the same in both.
import { tracer, compare, severity, selectScenarios, VERSION } from './core.js';

const TEXT = {
  run: '开始检查', stop: '停止', subset: '范围', scenarios: (n) => `${n} 场`,
  idle: '准备好了。检查只在本机进行，不会上传任何数据。',
  running: (i, n, id) => `正在检查 ${i} / ${n}：${id}`, stopped: '已停止', done: (n, t) => `完成：${n} 场，用时 ${t}`,
  ok: '一致', bad: '不一致', result: '结果不同', view: '画面不同', state: '状态不同', deep: '仅内部状态不同', ticks: '长度不同', missing: '参考里没有',
  where: (c, hz) => `首次检测到差异的区间：${(c.at.from / hz).toFixed(1)}–${(c.at.to / hz).toFixed(1)} 秒（第 ${c.at.from}–${c.at.to} 帧），${({ state: '状态', view: '快照', deep: '内部状态' })[c.at.level]}不同`,
  outcome: '结果不同', length: (a, b) => `长度 ${a} → ${b} 帧`,
  dump: '下载这一段的状态', dumping: '正在记录…',
  copy: '复制报告', copied: '已复制报告', copyFail: '无法写入剪贴板，请手动复制下面的内容',
  allOk: '全部选中场景的已记录状态、抽样快照与结果一致。',
  engine: '这个浏览器', reference: '参考', none: '没有不一致的场次。', error: '运行出错',
};

const CSS = `
.sc { --_bg: var(--sc-bg, #101413); --_panel: var(--sc-panel, #171d1b); --_fg: var(--sc-fg, #e6ece9); --_muted: var(--sc-muted, #93a19b);
  --_line: var(--sc-line, #2a3532); --_accent: var(--sc-accent, #4ed8af); --_ok: var(--sc-ok, #4ed8af); --_warn: var(--sc-warn, #f2c14e);
  --_bad: var(--sc-bad, #ff6b5e); --_font: var(--sc-font, system-ui, sans-serif); --_mono: var(--sc-mono, ui-monospace, monospace);
  box-sizing: border-box; max-width: 760px; margin: 0 auto; padding: 16px; color: var(--_fg); font: 14px/1.55 var(--_font); }
.sc *, .sc *::before, .sc *::after { box-sizing: inherit; }
.sc h1 { margin: 0 0 4px; font-size: 18px; }
.sc-sub { margin: 0 0 12px; color: var(--_muted); }
.sc-info { display: grid; grid-template-columns: max-content 1fr; gap: 2px 12px; margin: 0 0 14px; padding: 10px 12px; background: var(--_panel);
  border: 1px solid var(--_line); font-size: 13px; }
.sc-info dt { color: var(--_muted); } .sc-info dd { margin: 0; overflow-wrap: anywhere; }
.sc-controls { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 12px; }
.sc button, .sc select { font: inherit; color: var(--_fg); background: var(--_panel); border: 1px solid var(--_line); min-height: 40px; padding: 6px 12px; cursor: pointer; }
.sc button.sc-primary { border-color: var(--_accent); color: var(--_accent); }
.sc button:disabled { opacity: .5; cursor: default; }
.sc-bar { height: 6px; background: var(--_panel); border: 1px solid var(--_line); margin: 0 0 6px; }
.sc-bar i { display: block; height: 100%; width: 0; background: var(--_accent); transition: width .2s; }
.sc-status { margin: 0 0 12px; color: var(--_muted); min-height: 1.55em; overflow-wrap: anywhere; }
.sc-sum { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 0 0 12px; }
.sc-sum b { font: 600 18px/1 var(--_mono); margin-left: 4px; }
.sc-sum .is-ok b { color: var(--_ok); } .sc-sum .is-warn b { color: var(--_warn); } .sc-sum .is-bad b { color: var(--_bad); }
.sc-list { list-style: none; margin: 0 0 12px; padding: 0; display: grid; gap: 6px; }
.sc-list li { padding: 8px 10px; background: var(--_panel); border-left: 3px solid var(--_warn); overflow-wrap: anywhere; }
.sc-list li.is-bad { border-left-color: var(--_bad); }
.sc-list code { font: 13px var(--_mono); }
.sc-list button { min-height: 32px; padding: 3px 10px; margin-top: 6px; font-size: 13px; }
.sc-note { color: var(--_muted); font-size: 13px; }
.sc-allok { color: var(--_ok); }
.sc textarea { width: 100%; min-height: 160px; margin-top: 8px; background: var(--_panel); color: var(--_fg); border: 1px solid var(--_line);
  font: 12px/1.5 var(--_mono); padding: 8px; }
`;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
// a task boundary that background tabs do not throttle like timers
const yieldTask = () => new Promise((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

/** This browser, briefly: the engine family and version. */
function engineName() {
  const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
  const m = (re) => (ua.match(re) || [])[1];
  if (m(/Edg\/(\d+)/)) return `Edge ${m(/Edg\/(\d+)/)} (Blink)`;
  if (m(/Firefox\/(\d+)/)) return `Firefox ${m(/Firefox\/(\d+)/)} (Gecko)`;
  if (/AppleWebKit/.test(ua) && !/Chrome|Chromium|CriOS/.test(ua)) return `Safari ${m(/Version\/([\d.]+)/) || ''} (WebKit)`.replace('  ', ' ');
  if (m(/CriOS\/(\d+)/)) return `Chrome iOS ${m(/CriOS\/(\d+)/)} (WebKit)`;
  if (m(/Chrom(?:e|ium)\/(\d+)/)) return `Chrome ${m(/Chrom(?:e|ium)\/(\d+)/)} (Blink)`;
  return ua || 'unknown';
}

async function copyText(text) {
  try { if (navigator.clipboard && globalThis.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch { /* the textarea */ }
  const ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;left:-9999px;top:0;font-size:16px';
  document.body.appendChild(ta);
  try { ta.focus(); ta.select(); ta.setSelectionRange(0, text.length); return document.activeElement === ta && !!document.execCommand('copy'); } catch { return false; } finally { ta.remove(); }
}
function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

/**
 * Mount the check into root.
 * @param {HTMLElement} root
 * @param {{ project: string, title: string, subtitle?: string, adapter: object, scenarios: { id: string, family?: string }[],
 *   subsets: { id: string, label: string, pick: (sc: object) => boolean }[], reference: { every: number, made?: object,
 *   scenarios: Record<string, object> }, hz?: number, info?: [string, string][], text?: object }} o
 */
function mountCheck(root, o) {
  const T = { ...TEXT, ...(o.text || {}) }, every = o.reference.every || 30, deepEvery = o.reference.deepEvery || every * 5, hz = o.hz || 30;
  const q = new URLSearchParams(location.search);
  if (!document.getElementById('sc-style')) { const st = document.createElement('style'); st.id = 'sc-style'; st.textContent = CSS; document.head.appendChild(st); }
  const engine = engineName(), made = o.reference.made || {};
  const info = [[T.engine, engine], [T.reference, [made.engine, made.commit, made.date].filter(Boolean).join(' · ') || '—'], ...(o.info || [])];
  root.classList.add('sc');
  root.innerHTML = `<h1>${esc(o.title)}</h1>${o.subtitle ? `<p class="sc-sub">${esc(o.subtitle)}</p>` : ''}
    <dl class="sc-info">${info.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
    <div class="sc-controls"><label>${esc(T.subset)} <select class="sc-subset">${o.subsets.map((s) =>
      `<option value="${esc(s.id)}">${esc(s.label)} · ${esc(T.scenarios(o.scenarios.filter(s.pick).length))}</option>`).join('')}</select></label>
      <button class="sc-primary sc-run">${esc(T.run)}</button><button class="sc-stop" hidden>${esc(T.stop)}</button></div>
    <div class="sc-bar"><i></i></div><p class="sc-status" role="status">${esc(T.idle)}</p>
    <div class="sc-sum"></div><ol class="sc-list"></ol>
    <div class="sc-report" hidden><button class="sc-copy">${esc(T.copy)}</button> <span class="sc-note"></span><textarea readonly hidden></textarea></div>`;
  const $ = (s) => root.querySelector(s);
  const sel = $('.sc-subset'), runBtn = $('.sc-run'), stopBtn = $('.sc-stop'), bar = $('.sc-bar i'), status = $('.sc-status');
  if (q.get('subset') && o.subsets.some((s) => s.id === q.get('subset'))) sel.value = q.get('subset');
  sel.onchange = () => q.set('subset', sel.value);
  const state = { status: 'idle', results: [], summary: null, report: '', expected: 0, completed: 0 };
  globalThis.__simcheck = state;
  let stop = false;

  const summarize = (list) => {
    const s = { n: list.length, ok: 0, result: 0, view: 0, state: 0, deep: 0 };
    for (const r of list) {
      if (r.c.ok) { s.ok++; continue; }
      if (r.c.missing || r.c.result || r.c.ticks) s.result++;
      else s[r.c.at.level]++;
    }
    return s;
  };
  const describe = (r) => {
    const c = r.c, parts = [];
    if (c.missing) return T.missing;
    if (c.error) return `${T.error}：${c.error}`;
    if (c.at) parts.push(T.where(c, hz));
    if (c.result) parts.push(T.outcome);
    if (c.ticks) parts.push(T.length(c.ticks[0], c.ticks[1]));
    return parts.join('；');
  };
  const render = (list, total, elapsed, current) => {
    const s = summarize(list);
    bar.style.width = `${total ? (100 * list.length) / total : 0}%`;
    $('.sc-sum').innerHTML = [[T.ok, s.ok, 'is-ok'], [T.result, s.result, 'is-bad'], [T.view, s.view, 'is-warn'], [T.state, s.state, 'is-warn'], [T.deep, s.deep, 'is-warn']]
      .map(([k, v, cls]) => `<span class="${v && cls !== 'is-ok' ? cls : cls === 'is-ok' ? cls : ''}">${esc(k)}<b>${v}</b></span>`).join('');
    const bad = list.filter((r) => !r.c.ok).sort((a, b) => severity(b.c) - severity(a.c));
    $('.sc-list').innerHTML = bad.map((r, i) => `<li class="${severity(r.c) === 3 ? 'is-bad' : ''}"><code>${esc(r.id)}</code>${r.family ? ` <span class="sc-note">${esc(r.family)}</span>` : ''}<br>${esc(describe(r))}
      ${r.c.at ? `<br><button data-i="${i}">${esc(T.dump)}</button>` : ''}</li>`).join('');
    $('.sc-list').querySelectorAll('button[data-i]').forEach((b) => { b.onclick = () => dumpOne(bad[Number(b.dataset.i)], b); });
    if (current) status.textContent = T.running(list.length + 1, total, current);
    state.summary = s;
    return s;
  };
  const reportText = (list, subset, elapsed) => {
    const s = summarize(list), lines = [
      `simcheck ${VERSION} · ${o.project}`, `${T.engine}：${engine}`, `UA：${(navigator && navigator.userAgent) || ''}`,
      `${T.reference}：${info[1][1]}`, `${T.subset}：${subset.label} · ${T.scenarios(list.length)} · ${clock(elapsed)}`,
      `${T.ok} ${s.ok} · ${T.result} ${s.result} · ${T.view} ${s.view} · ${T.state} ${s.state} · ${T.deep} ${s.deep}`];
    for (const r of list.filter((x) => !x.c.ok).sort((a, b) => severity(b.c) - severity(a.c))) lines.push(`- ${r.id}：${describe(r)}`);
    return lines.join('\n');
  };
  const dumpOne = async (r, btn) => {
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = T.dumping;
    try {
      await o.validate?.();
      await yieldTask();
      const tr = tracer(o.adapter, o.scenarios.find((x) => x.id === r.id), { every, deepEvery, dump: [r.c.at.from, r.c.at.to] });
      while (!tr.advance(25)) await yieldTask();
      const got = tr.finish();
      download(`simcheck-${String(o.project).replace(/[^\w\u4e00-\u9fff]+/g, '-').toLowerCase()}-${r.id}-${r.c.at.from}.json`, JSON.stringify({ simcheck: VERSION, project: o.project, identity: o.reference.identity, id: r.id, window: [r.c.at.from, r.c.at.to],
        engine, ua: navigator.userAgent, dumps: got.dumps }));
    } catch (e) { status.textContent = `${T.error}：${String(e.message || e)}`; }
    finally { btn.disabled = false; btn.textContent = old; }
  };

  const run = async () => {
    stop = false; runBtn.disabled = true; sel.disabled = true; stopBtn.hidden = false; $('.sc-report').hidden = true;
    state.status = 'running'; state.results = [];
    state.expected = 0; state.completed = 0; state.error = null;
    const t0 = performance.now();
    try {
      await o.validate?.();
      if (q.has('subset') && !o.subsets.some(s => s.id === q.get('subset'))) throw new Error(`unknown subset: ${q.get('subset')}`);
      const { subset, list } = selectScenarios(o.scenarios, o.subsets, sel.value, q.get('only'));
      state.expected = list.length;
      for (const sc of list) {
        if (stop) break;
        render(state.results, list.length, performance.now() - t0, sc.id);
        await yieldTask();
        const t1 = performance.now(), tr = tracer(o.adapter, sc, { every, deepEvery });
        while (!tr.advance(25)) { await yieldTask(); if (stop) break; }
        if (stop) break;
        const got = tr.finish();
        state.results.push({ id: sc.id, family: sc.family, c: compare(o.reference.scenarios[sc.id], got, every, deepEvery), ms: performance.now() - t1 });
        state.completed = state.results.length;
      }
      const elapsed = performance.now() - t0, s = render(state.results, list.length, elapsed, null);
      const complete = s.n > 0 && state.completed === state.expected;
      status.innerHTML = stop ? esc(T.stopped) : complete && s.ok === s.n ? `<span class="sc-allok">${esc(T.allOk)}</span> ${esc(T.done(s.n, clock(elapsed)))}` : esc(T.done(s.n, clock(elapsed)));
      if (complete && !state.results.some(r => !r.c.ok)) $('.sc-list').innerHTML = `<li class="sc-note">${esc(T.none)}</li>`;
      state.report = reportText(state.results, subset, elapsed);
      state.status = stop ? 'stopped' : 'done';
    } catch (e) {
      state.status = 'error'; state.error = String(e.message || e); state.report = `${T.error}：${state.error}`;
      status.textContent = state.report;
    } finally { $('.sc-report').hidden = false; runBtn.disabled = false; sel.disabled = false; stopBtn.hidden = true; }
  };
  runBtn.onclick = run;
  stopBtn.onclick = () => { stop = true; };
  $('.sc-copy').onclick = async () => {
    const ok = await copyText(state.report), ta = $('.sc-report textarea');
    $('.sc-report .sc-note').textContent = ok ? T.copied : T.copyFail;
    ta.hidden = ok; if (!ok) { ta.value = state.report; ta.focus(); ta.select(); }
  };
  if (q.get('auto') === '1') run();
  return state;
}

export { mountCheck, engineName };
