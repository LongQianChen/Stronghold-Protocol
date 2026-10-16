// API v1 lexical check. This is a portability check, NOT a security boundary (DESIGN §32.10).
const banned = new Set(['eval', 'Function', 'require', 'process', 'globalThis', 'fetch', 'XMLHttpRequest',
  'WebSocket', 'Date', 'window', 'document', 'localStorage', 'sessionStorage', 'setTimeout', 'setInterval',
  'Worker', 'navigator']);

/** Tokens keep source offsets so only actual SDK import strings are rewritten. Comments and strings are inert. */
export function scriptTokens(source) {
  const tokens = [];
  // Template text is conservatively scanned too: ${...} must not hide executable identifiers.
  const re = /\/\*[\s\S]*?\*\/|\/\/[^\n\r]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_$][\w$]*|\?\.|\*\*=?|[^\s]/g;
  for (const m of source.matchAll(re)) {
    const s = m[0];
    if (s.startsWith('//') || s.startsWith('/*')) continue;
    tokens.push({ value: s, start: m.index, end: m.index + s.length, string: /^['"]/.test(s) });
  }
  return tokens;
}

/** Entry modules may import only sp:sdk@1; no dynamic loading, ambient IO or nondeterministic operations. */
export function checkScript(source) {
  const problems = [], imports = [], ts = scriptTokens(String(source));
  const bad = (t, message) => problems.push({ code: 'PLUGIN_SCRIPT_CHECK', path: String(t.start), message });
  for (let i = 0; i < ts.length; i++) {
    const t = ts[i], v = t.value;
    if (t.string) continue;
    if (banned.has(v) || v === 'localeCompare') bad(t, `${v} is not available in sp:sdk@1`);
    const member = ts[i+1]?.value === '[' && ts[i+2]?.string ? ts[i+2].value.slice(1,-1) : ts[i+2]?.value;
    if (v === 'Math' && ['.','?.','['].includes(ts[i+1]?.value) &&
      ['random','acos','acosh','asin','asinh','atan','atanh','atan2','cbrt','cos','cosh','exp','expm1','hypot','log','log1p','log2','log10','pow','sin','sinh','tan','tanh'].includes(member)) bad(t, 'use sp.math or battle.rng');
    if (v === '**' || v === '**=') bad(t, 'use sp.math.powi');
    if (v === 'import') {
      if (ts[i+1]?.value === '(' || ts[i+1]?.value === '.') { bad(t, 'dynamic import and import.meta are not available'); continue; }
      let j = i + 1;
      if (!ts[j]?.string) { while (j < ts.length && !['from', ';', 'import', 'export'].includes(ts[j].value)) j++; j++; }
      const spec = ts[j];
      if (!spec?.string || spec.value.slice(1,-1) !== 'sp:sdk@1') bad(t, 'imports may name only sp:sdk@1');
      else imports.push(spec);
    }
    if (v === 'export') {
      // Re-exports are module loading too. Ordinary export declarations need no parsing.
      let j = i+1;
      if (['*', '{'].includes(ts[j]?.value)) {
        while (j < ts.length && !['from',';'].includes(ts[j].value)) j++;
        if (ts[j]?.value === 'from') bad(t, 're-exports are not supported');
      }
    }
  }
  return { sandboxable: problems.length === 0, problems, imports };
}

/** Link SDK imports after checking; no author-controlled import path reaches the native loader. */
export function linkScript(source, sdkUrl) {
  const checked = checkScript(source);
  if (checked.problems.length) throw Object.assign(new Error(checked.problems[0].message), { code: 'PLUGIN_SCRIPT_CHECK' });
  for (const t of [...checked.imports].reverse()) source = source.slice(0,t.start) + JSON.stringify(sdkUrl) + source.slice(t.end);
  return source;
}
