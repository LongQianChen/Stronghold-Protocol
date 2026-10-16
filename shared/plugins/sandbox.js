// SES isolation shared by a browser module Worker and the permission-limited match child (DESIGN §32.11).
// Never import this from the vanilla boot path. The real SDK owns registration and callback budgets; live engine
// arguments belong to kit callbacks, not SDK data. Files are checked snapshots, never URLs to import/fetch.
import { sha256Hex } from '../sha256.js';
const { URL, TextEncoder, TextDecoder } = /** @type {any} */ (globalThis);
const moduleUrl = /** @type {any} */ (import.meta).url;

export const SANDBOX_LIMITS = Object.freeze({ files: 64, bytes: 1024 * 1024 }); // [ASSUMED] per plugin
const denied = (code, detail) => Object.assign(new Error(`${code}: ${detail}`), { code });
let initialized = false;
let safeMath;

/** @param {{ loadSES?: () => Promise<unknown>, loadMath?: () => Promise<any> }} [options] */
export async function initializeSandbox({ loadSES, loadMath = () => import('../../server/sim/detmath.js') } = {}) {
  if (initialized) return;
  if (typeof loadSES !== 'function') throw denied('PLUGIN_SANDBOX_UNAVAILABLE', 'SES loader missing');
  await loadSES();
  if (typeof globalThis.lockdown !== 'function') throw denied('PLUGIN_SANDBOX_UNAVAILABLE', 'SES unavailable');
  // SES safe error taming clears host stacks too. Math/Date restrictions are explicit endowments below.
  globalThis.lockdown({ errorTaming: 'safe', stackFiltering: 'concise' });
  const dm = await loadMath(); // engine imported only AFTER lockdown
  safeMath = Object.create(null);
  for (const k of ['E', 'LN10', 'LN2', 'LOG10E', 'LOG2E', 'PI', 'SQRT1_2', 'SQRT2', 'abs', 'ceil', 'floor', 'round',
    'trunc', 'sqrt', 'min', 'max', 'sign', 'clz32', 'imul', 'fround']) safeMath[k] = Math[k];
  const finite = (xs) => { if (xs.some(x => typeof x !== 'number' || !Number.isFinite(x))) throw denied('PLUGIN_SANDBOX_MATH', 'finite numbers required'); };
  safeMath.sin = x => { finite([x]); return dm.sin(x); };
  safeMath.cos = x => { finite([x]); return dm.cos(x); };
  safeMath.atan2 = (y, x) => { finite([y, x]); return dm.atan2(y, x); };
  safeMath.hypot = (x, y) => { finite([x, y]); return dm.hypot(x, y); };
  safeMath.pow = (x, n) => {
    finite([x, n]);
    // detmath.powi falls back to native pow outside this domain. Never permit that fallback in a script.
    if (!Number.isSafeInteger(n) || Math.abs(x) > 3.273390607896142e150) throw denied('PLUGIN_SANDBOX_MATH', 'pow requires an integer exponent and |base| <= 2^500');
    return dm.powi(x, n);
  };
  globalThis.harden(safeMath);
  initialized = true;
}

export function createPluginCompartment(sp) {
  if (!initialized) throw denied('PLUGIN_SANDBOX_UNAVAILABLE', 'initializeSandbox first');
  const c = new globalThis.Compartment({ sp: globalThis.harden(sp), Math: safeMath });
  // [ASSUMED] No eval/Function/Promise: runtime source must not bypass the parsed synchronous module surface.
  // SES already omits host powers; explicitly shadow even its tamed Date and the child-Compartment constructor.
  for (const name of ['Date', 'performance', 'Intl', 'WeakRef', 'FinalizationRegistry', 'SharedArrayBuffer', 'Atomics',
    'fetch', 'setTimeout', 'setInterval', 'queueMicrotask', 'process', 'require', 'Compartment', 'eval', 'Function', 'Promise', 'harden', 'lockdown']) {
    Object.defineProperty(c.globalThis, name, { value: undefined, writable: false, configurable: false });
  }
  return c;
}

function localPath(path) {
  return typeof path === 'string' && path.length <= 200 && /^[A-Za-z0-9_./-]+\.m?js$/.test(path)
    && !path.startsWith('/') && !path.split('/').some(s => !s || s === '.' || s === '..' || s.startsWith('.'));
}
export function resolveSandboxImport(specifier, referrer) {
  if (specifier === 'sp:sdk@1') return specifier;
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) throw denied('PLUGIN_SANDBOX_IMPORT', specifier);
  const parts = referrer.split('/'); parts.pop();
  for (const part of specifier.split('/')) {
    if (part === '.') continue;
    if (part === '..') { if (!parts.length) throw denied('PLUGIN_SANDBOX_IMPORT', specifier); parts.pop(); }
    else parts.push(part);
  }
  const path = parts.join('/');
  if (!localPath(path)) throw denied('PLUGIN_SANDBOX_IMPORT', specifier);
  return path;
}

/**
 * A deliberately small, parsed ESM surface [ASSUMED]: static imports; const/function/class/default exports;
 * no cyclic graphs, mutable named exports, export-star, dynamic import, import.meta, async/generator code or **.
 * No regex stripping of JavaScript. Unsupported syntax fails closed before ANY module is evaluated.
 * Module bodies are evaluated only by SES; this compiler never uses the host eval or Function.
 */
function compileModule(source, parse) {
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'module' });
  const stack = [ast];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'ImportExpression' || n.type === 'MetaProperty' || n.type === 'AwaitExpression' || n.type === 'YieldExpression'
      || n.async || n.generator || n.operator === '**' || n.operator === '**=') throw denied('PLUGIN_SANDBOX_SYNTAX', n.type);
    // No collisions with the wrapper's private bindings, including in shorthand properties and escaped identifiers.
    if (n.type === 'Identifier' && n.name.startsWith('__spSandbox')) throw denied('PLUGIN_SANDBOX_SYNTAX', 'reserved binding');
    for (const v of Object.values(n)) if (v && typeof v === 'object') {
      if (Array.isArray(v)) stack.push(...v); else stack.push(v);
    }
  }
  const deps = [];
  const edits = [];
  const exports = [];
  const importExpr = spec => { const i = deps.push(spec) - 1; return `__spSandboxImports[${i}]`; };
  for (const n of ast.body) {
    if (n.type === 'ImportDeclaration') {
      const expr = importExpr(n.source.value);
      const declarations = n.specifiers.map(s => `const ${s.local.name} = ${s.type === 'ImportNamespaceSpecifier' ? expr
        : `${expr}[${JSON.stringify(s.type === 'ImportDefaultSpecifier' ? 'default' : s.imported.name || s.imported.value)}]`};`).join('\n');
      edits.push([n.start, n.end, declarations]);
    } else if (n.type === 'ExportDefaultDeclaration') {
      edits.push([n.start, n.declaration.start, 'const __spSandboxDefault = ']);
      edits.push([n.end, n.end, ';']);
      exports.push(['default', '__spSandboxDefault']);
    } else if (n.type === 'ExportNamedDeclaration') {
      if (n.declaration) {
        const d = n.declaration;
        if (d.type === 'VariableDeclaration') {
          if (d.kind !== 'const' || d.declarations.some(v => v.id.type !== 'Identifier')) throw denied('PLUGIN_SANDBOX_SYNTAX', 'use simple const exports');
          for (const v of d.declarations) exports.push([v.id.name, v.id.name]);
        } else exports.push([d.id.name, d.id.name]);
        edits.push([n.start, d.start, '']);
      } else {
        const expr = n.source ? importExpr(n.source.value) : null;
        for (const s of n.specifiers) exports.push([s.exported.name || s.exported.value, expr ? `${expr}[${JSON.stringify(s.local.name || s.local.value)}]` : s.local.name]);
        edits.push([n.start, n.end, '']);
      }
    } else if (n.type === 'ExportAllDeclaration') throw denied('PLUGIN_SANDBOX_SYNTAX', 'export-star is unsupported');
  }
  let body = source;
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) body = body.slice(0, start) + value + body.slice(end);
  // Getter namespaces preserve exported object identity and local updates after setup; cyclic graphs are rejected.
  const getters = exports.map(([name, local]) => `get [${JSON.stringify(name)}]() { return ${local}; }`).join(',');
  return { deps, code: `(function(__spSandboxImports) { 'use strict';\n${body}\nreturn Object.freeze({${getters}});\n})` };
}

export function loadSandboxPlugin({ plugin, sp, parse }) {
  if (plugin?.class !== 'script') throw denied('PLUGIN_SANDBOX_CLASS', 'only script plugins enter SES');
  const entryPoints = plugin.entries || [plugin.entry];
  if (!entryPoints.length || entryPoints.some(p => !localPath(p))) throw denied('PLUGIN_SANDBOX_IMPORT', 'invalid entry');
  const entries = Object.entries(plugin.files || {});
  if (!entries.length || entries.length > SANDBOX_LIMITS.files) throw denied('PLUGIN_SANDBOX_LIMIT', 'file count');
  const compiled = new Map();
  let total = 0;
  for (const [path, f] of entries) {
    if (!localPath(path)) throw denied('PLUGIN_SANDBOX_IMPORT', path);
    const source = f?.bytes;
    if (!(source instanceof Uint8Array || Array.isArray(source)) || (total += source.length) > SANDBOX_LIMITS.bytes)
      throw denied('PLUGIN_SANDBOX_LIMIT', 'source bytes');
    const bytes = source instanceof Uint8Array ? source : Uint8Array.from(source);
    if (sha256Hex(bytes) !== f.sha256) throw denied('PLUGIN_SANDBOX_HASH', path);
    compiled.set(path, compileModule(new TextDecoder('utf-8', { fatal: true }).decode(bytes), parse));
  }
  // Check the entire graph before any setup code can register effects.
  const visiting = new Set(), order = [], seen = new Set();
  const visit = path => {
    if (path === 'sp:sdk@1' || seen.has(path)) return;
    if (visiting.has(path)) throw denied('PLUGIN_SANDBOX_IMPORT', 'cyclic imports');
    const m = compiled.get(path);
    if (!m) throw denied('PLUGIN_SANDBOX_IMPORT', path);
    visiting.add(path);
    m.paths = m.deps.map(s => resolveSandboxImport(s, path));
    m.paths.forEach(visit);
    visiting.delete(path); seen.add(path); order.push(path);
  };
  entryPoints.forEach(visit);
  const compartment = createPluginCompartment(sp);
  const modules = new Map([['sp:sdk@1', globalThis.harden({ ...sp, default: sp, sp })]]);
  for (const path of order) modules.set(path, compartment.evaluate(compiled.get(path).code)(
    globalThis.harden(compiled.get(path).paths.map(p => modules.get(p)))));
  for (const entry of entryPoints) {
    const setup = modules.get(entry)?.default;
    if (typeof setup !== 'function') throw denied('PLUGIN_SANDBOX_SYNTAX', 'export default function setup(sp) required');
    if (setup(sp)?.then) throw denied('PLUGIN_SANDBOX_SYNTAX', 'setup must be synchronous');
  }
  return compartment;
}

/** Low-level loader; the production descriptor adapter below supplies the SDK. */
export async function installSandboxPlugins({ plugins, parse, createSDK }) {
  if (typeof createSDK !== 'function') throw denied('PLUGIN_SANDBOX_UNAVAILABLE', 'createSDK adapter missing');
  for (const plugin of plugins) loadSandboxPlugin({ plugin, parse, sp: await createSDK(plugin) });
}

/** Install verified P3 descriptors, transactionally, using the same SDK/registry as native execution. */
export async function installSandboxScripts(scripts, { hashInput = null, parse = null, sdkUrl = new URL('./sdk.js', moduleUrl).href,
  extensionsUrl = null, log = (..._args) => {} } = {}) {
  const { verifyScripts, scriptExecution } = await import('./scriptLoad.js');
  verifyScripts(scripts, hashInput);
  if (scriptExecution(scripts) !== 'sandbox') throw denied('PLUGIN_SANDBOX_CLASS', 'sandbox descriptors required');
  const sdk = await import(sdkUrl);
  const root = new URL('../../', sdkUrl);
  const ext = await import(extensionsUrl || new URL(root.protocol === 'file:' ? 'server/sim/content/extensions.js' : 'sim/content/extensions.js', root).href);
  ext.resetExtensions();
  try {
    const plugins = scripts.map(p => {
      const m = JSON.parse(p.manifestSource);
      const entries = [...new Set([m.entry?.sim, m.entry?.meta].filter(Boolean))];
      // Check lengths before allocating UTF-8 copies (TextEncoder may allocate up to three bytes per code unit).
      let total = 0;
      for (const rel of entries) {
        for (const ch of p.sources[rel]) {
          const n = ch.codePointAt(0);
          total += n < 128 ? 1 : n < 2048 ? 2 : n < 65536 ? 3 : 4;
          if (total > SANDBOX_LIMITS.bytes) throw denied('PLUGIN_SANDBOX_LIMIT', 'source bytes');
        }
      }
      const part = hashInput.plugins.find(x => x.id === p.id);
      return { id: p.id, class: m.class, entries, overrides: m.overrides || [], permissions: m.permissions || [],
        files: Object.fromEntries(entries.map(rel => [rel, { sha256: part.files[rel], bytes: new TextEncoder().encode(p.sources[rel]) }])) };
    });
    await installSandboxPlugins({ plugins, parse, createSDK: p => sdk.createSDK(p, { settings: hashInput.settings[p.id] || {}, log }) });
    ext.sealExtensions();
    return ext.extensionRegistrations();
  } catch (e) { ext.resetExtensions(); throw e; }
}
