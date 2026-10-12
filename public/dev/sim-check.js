// The cross-engine check page (docs/SIM.md「Cross-engine check」): this browser runs the golden battle corpus with the
// client's own sim loader (public/js/battle/runner.js loadBrowserSim) and compares every tick with the Node reference
// that `node tools/sim-check.mjs` wrote to /dev/simcheck/data/ — any device on the LAN can open it from the server.
import { mountCheck } from './simcheck/ui.js';
import { strongholdAdapter, scenariosOf } from './simcheck/stronghold.js';
import { VERSION, textFingerprint } from './simcheck/core.js';

const app = document.getElementById('app');
globalThis.__simcheck = { status: 'loading', results: [], summary: null, error: null };
const get = async (url) => {
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw Object.assign(new Error(`${r.status} ${url}`), { missing: r.status === 404 });
  return r.json();
};

try {
  const [doc, reference, { loadBrowserSim }, { APP_VERSION }] = await Promise.all([
    get('/dev/simcheck/data/specs.json'), get('/dev/simcheck/data/reference.json'), import('/js/battle/runner.js'), import('/shared/constants.js'),
  ]);
  if (doc.simcheck !== VERSION || reference.simcheck !== VERSION || !Array.isArray(doc.files) || !doc.files.length
    || doc.identity !== reference.identity || doc.identity !== textFingerprint(JSON.stringify({ specs: doc.specs, files: doc.files }))) {
    throw new Error('参考与场景文件不匹配，请重新生成参考数据。');
  }
  const verifiedData = new Map();
  const validate = async () => {
    for (let i = 0; i < doc.files.length; i += 8) await Promise.all(doc.files.slice(i, i + 8).map(async ({ url, hash }) => {
      if (typeof url !== 'string' || !/^\/(?:sim\/|shared\/|data\/|data\.js$|js\/battle\/runner\.js$|dev\/simcheck\/)/.test(url) || url.includes('..')) throw new Error('invalid reference input path');
      const response = await fetch(url, { cache: 'no-cache' });
      if (!response.ok) throw new Error(`参考输入不可用：${url}`);
      const text = await response.text();
      if (textFingerprint(text) !== hash) throw new Error(`参考数据已过期：${url}。请重新生成参考并刷新页面。`);
      if (url.startsWith('/data/')) verifiedData.set(url, text);
    }));
  };
  await validate();
  const { spec, ds } = await loadBrowserSim({ fetchFn: url => {
    const text = verifiedData.get(url);
    if (text == null) throw new Error(`unverified data input: ${url}`);
    return Promise.resolve(new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } }));
  } });
  const scenarios = scenariosOf(doc);
  const FAMILIES = [['roster', '干员'], ['bonds', '盟约'], ['fields', '首领战场与联防'], ['standins', '补位'], ['diy', '自选']];
  if (reference.made?.version !== APP_VERSION) throw new Error('参考游戏版本已过期，请重新生成。');
  mountCheck(app, {
    project: 'Stronghold Protocol',
    title: '模拟一致性检查',
    subtitle: '逐帧比较已记录的单位状态与 Node 参考，并抽样比较快照和部分内部状态。输入文件按内容指纹核对；通过不代表全部画面、事件流或内部内存均已覆盖。状态下载仅定位状态向量字段。',
    validate,
    adapter: strongholdAdapter({ spec, ds, doc }),
    scenarios,
    subsets: [
      { id: 'fast', label: '快速（黄金结果的快速子集）', pick: (sc) => sc.fast },
      { id: 'all', label: '全部', pick: () => true },
      ...FAMILIES.map(([id, label]) => ({ id, label, pick: (sc) => sc.family === id })),
    ],
    reference,
    info: [['游戏版本', APP_VERSION]],
  });
} catch (e) {
  globalThis.__simcheck = { status: 'error', results: [], summary: null, error: String(e.message || e) };
  app.innerHTML = '';
  const p = document.createElement('p');
  p.style.cssText = 'color:var(--text-md);padding:16px;max-width:760px;margin:0 auto;font:14px/1.6 var(--font-cjk)';
  p.textContent = e.missing
    ? '还没有参考数据：请在服务器的目录里运行 node tools/sim-check.mjs（生成 public/dev/simcheck/data/），然后刷新这个页面。'
    : `载入失败：${e && e.message || e}`;
  app.appendChild(p);
}
