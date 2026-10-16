// Data patches, DESIGN §32.5 / PLUGINS §10. Atomic, pure, shared by Node and browsers.
import { clone, object, own, forbidden, problem, jsonProblems, mergeData, recordId, RECORD_MAPS } from './dataUtils.js';
import { canonicalJson } from './identity.js';

/** Data-patch operations (DESIGN §32.5). Closed: a new op belongs in the frozen API table. */
export const PATCH_OPS = Object.freeze(['set', 'merge', 'add', 'append', 'remove']);

const kind = v => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
// null is its own type: it may be written back onto a field that is already null, and nowhere else.
const compatible = (a, b) => kind(a) === kind(b);
const addPrefix = (file, path) => RECORD_MAPS[file]?.[0] ?? (file === 'config' && path.join('.') === 'modes' ? 'mode_x' : null);

/** Resolve typed manifest settings; unknown values never enter the hash. Invalid values use their defaults. */
export function normalizeSettings(defs = {}, input = {}) {
  const out = {};
  for (const [k, d] of Object.entries(defs)) {
    const v = input?.[k];
    const ok = d.type === 'boolean' ? typeof v === 'boolean' : d.type === 'enum' ? d.options.includes(v)
      : typeof v === 'number' && Number.isFinite(v) && v >= d.min && v <= d.max
        && (d.type !== 'integer' || Number.isInteger(v))
        && (!d.step || Math.abs((v - d.min) / d.step - Math.round((v - d.min) / d.step)) < 1e-9);
    out[k] = ok ? v : d.default;
  }
  return out;
}

function resolveSettings(v, settings) {
  if (object(v) && own(v, '$setting')) {
    if (Object.keys(v).length !== 1 || typeof v.$setting !== 'string' || !own(settings, v.$setting)) throw problem('PLUGIN_PATCH_SETTING', '', 'unknown setting');
    return settings[v.$setting];
  }
  if (Array.isArray(v)) return v.map(x => resolveSettings(x, settings));
  return object(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, resolveSettings(x, settings)])) : v;
}

/** C1: applyPatches(data, ops) → { data, problems }; optional context binds additions to their plugin. */
export function applyPatches(data, ops, { pluginId = null, settings = {} } = {}) {
  const problems = jsonProblems(ops, 'ops');
  if (!Array.isArray(ops)) problems.push(problem('PLUGIN_PATCH_TYPE', 'ops', 'ops must be an array'));
  if (problems.length) return { data, problems };
  const out = clone(data);
  for (const [i, op] of ops.entries()) {
    const at = `ops[${i}]`;
    try {
      if (!object(op) || !PATCH_OPS.includes(op.op)) throw problem('PLUGIN_PATCH_OP', at, 'unknown patch operation');
      if (!own(out, op.file) || !object(out[op.file])) throw problem('PLUGIN_PATCH_PATH', at, 'unknown data file');
      if (!Array.isArray(op.path ?? []) || (op.path ?? []).some(k => !(typeof k === 'string' || Number.isInteger(k)) || forbidden(k))) throw problem('PLUGIN_PATCH_PATH', at, 'path must contain safe keys or array indexes');
      if (op.id !== undefined && (typeof op.id !== 'string' || forbidden(op.id))) throw problem('PLUGIN_PATCH_PATH', at, 'invalid record id');
      const path = op.op === 'add' ? [...(op.path ?? []), op.id] : [...(op.id === undefined ? [] : [op.id]), ...(op.path ?? [])];
      if (!path.length || path.some(k => k === undefined || forbidden(k))) throw problem('PLUGIN_PATCH_PATH', at, 'a record or field path is required');
      let target = out[op.file];
      for (const k of path.slice(0, -1)) {
        if (!own(target, k) || !target[k] || typeof target[k] !== 'object') throw problem('PLUGIN_PATCH_PATH', at, 'path does not exist');
        target = target[k];
      }
      const key = path.at(-1), exists = own(target, key), old = target[key];
      if (Array.isArray(target) && !(Number.isInteger(Number(key)) && Number(key) >= 0 && Number(key) < target.length)) throw problem('PLUGIN_PATCH_PATH', at, 'array index does not exist');
      const value = own(op, 'value') ? resolveSettings(op.value, settings) : undefined;
      if (op.op === 'add') {
        const prefix = addPrefix(op.file, op.path ?? []);
        if (!prefix || !recordId(op.id, pluginId, prefix) || (op.file !== 'config' && (op.path ?? []).length)) throw problem('PLUGIN_RECORD_ID', at, 'add requires a new namespaced record id');
        if (exists) throw problem('PLUGIN_RECORD_EXISTS', at, 'record already exists; use a patch');
        if (!object(value)) throw problem('PLUGIN_PATCH_TYPE', at, 'record must be an object');
        target[key] = clone(value);
        continue;
      }
      if (!exists) throw problem('PLUGIN_PATCH_PATH', at, 'path does not exist');
      if (op.op === 'set') {
        if (value === undefined || !compatible(old, value)) throw problem('PLUGIN_PATCH_TYPE', at, 'set must preserve the field type');
        target[key] = clone(value);
      } else if (op.op === 'merge') {
        if (!object(old) || !object(value)) throw problem('PLUGIN_PATCH_TYPE', at, 'merge requires objects');
        const check = (a, b) => { for (const [k, v] of Object.entries(b)) if (own(a, k)) {
          if (!compatible(a[k], v)) throw problem('PLUGIN_PATCH_TYPE', at, 'merge must preserve field types');
          if (object(a[k]) && object(v)) check(a[k], v);
        } };
        check(old, value);
        target[key] = mergeData(old, value);
      } else {
        if (!Array.isArray(old)) throw problem('PLUGIN_PATCH_TYPE', at, `${op.op} requires an array`);
        if (op.op === 'append') {
          if (!Array.isArray(value) || (old.length && value.some(v => !compatible(old[0], v)))) throw problem('PLUGIN_PATCH_TYPE', at, 'append requires an array of the same element type');
          target[key] = [...old, ...clone(value)];
        } else {
          if (!own(op, 'match')) throw problem('PLUGIN_PATCH_TYPE', at, 'remove requires match (array values only)');
          const match = canonicalJson(resolveSettings(op.match, settings));
          const kept = old.filter(v => canonicalJson(v) !== match);
          if (kept.length === old.length) throw problem('PLUGIN_PATCH_PATH', at, 'remove match does not exist');
          target[key] = kept;
        }
      }
    } catch (e) { problems.push(e?.code ? { ...e, path: at } : problem('PLUGIN_PATCH_TYPE', at, String(e.message))); }
  }
  // Whole-map writes must not delete records or bypass the namespace rule.
  const maps = v => ({ ...Object.fromEntries(Object.keys(RECORD_MAPS).map(k => [k, v[k]])), modes: v.config?.modes });
  const before = maps(data), after = maps(out);
  for (const [file, map] of Object.entries(before)) {
    for (const id of Object.keys(map ?? {})) if (!own(after[file], id) || !object(after[file][id])) problems.push(problem('PLUGIN_RECORD_DELETE', `${file}.${id}`, 'records cannot be deleted'));
    for (const id of Object.keys(after[file] ?? {})) if (!own(map, id) && !recordId(id, pluginId, file === 'modes' ? 'mode_x' : RECORD_MAPS[file][0])) problems.push(problem('PLUGIN_RECORD_ID', `${file}.${id}`, 'new records must be namespaced'));
  }
  return { data: problems.length ? data : out, problems };
}
