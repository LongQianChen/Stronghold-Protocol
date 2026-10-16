// test/helpers/jsonSchema.js — a small JSON Schema validator for the tests (draft 2020-12, the keywords schemas/*.json use):
// type, enum, const, pattern, minLength / maxLength, minimum / maximum, minItems / maxItems, uniqueItems,
// uniqueItemProperties (not a stock draft-2020-12 keyword: each named property is unique across the items), items,
// contains, properties, required, additionalProperties, patternProperties, propertyNames, minProperties /
// maxProperties, allOf / anyOf / oneOf / not, if / then / else, $ref (within a schema: #/$defs/…; to another file of the
// same folder: other.schema.json or other.schema.json#/$defs/…), boolean schemas. Annotations ($schema, $id, title,
// description, default, examples, markdownDescription, $comment) are ignored. No dependency: the repository pins none
// for this (test/plugins/schema.test.js).

import fs from 'node:fs';
import path from 'node:path';

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const typeOf = (v) => (v === null ? 'null' : Array.isArray(v) ? 'array' : Number.isInteger(v) ? 'integer' : typeof v);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * A validator over the schema files of a folder.
 * @param {string} dir the folder of the schemas
 */
export function schemaValidator(dir) {
  const files = new Map();
  const load = (name) => {
    if (!files.has(name)) files.set(name, JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8')));
    return files.get(name);
  };
  /** The schema a $ref names, and the file it is in. */
  const resolve = (ref, file) => {
    const [f, frag = ''] = ref.split('#');
    const target = f ? f : file;
    let node = load(target);
    for (const seg of frag.split('/').filter(Boolean)) node = node[decodeURIComponent(seg.replace(/~1/g, '/').replace(/~0/g, '~'))];
    if (node === undefined) throw new Error(`unresolved $ref ${ref} in ${file}`);
    return { schema: node, file: target };
  };

  /**
   * The errors of `value` against `schema` (empty: valid).
   * @param {any} schema @param {any} value @param {string} file @param {string} at
   * @returns {string[]}
   */
  function check(schema, value, file, at) {
    if (schema === true) return [];
    if (schema === false) return [`${at}: not allowed`];
    if (!isObj(schema)) throw new Error(`${at}: not a schema`);
    const errs = [];
    const sub = (s, v, a) => check(s, v, file, a);
    if (schema.$ref) {
      const r = resolve(schema.$ref, file);
      errs.push(...check(r.schema, value, r.file, at));
    }
    if (schema.type !== undefined) {
      const types = Array.isArray(schema.type) ? schema.type : [schema.type];
      const t = typeOf(value);
      if (!types.includes(t) && !(t === 'integer' && types.includes('number'))) return [...errs, `${at}: is ${t}, not ${types.join('|')}`];
    }
    if (schema.enum && !schema.enum.some((e) => equal(e, value))) errs.push(`${at}: not one of ${JSON.stringify(schema.enum).slice(0, 80)}`);
    if ('const' in schema && !equal(schema.const, value)) errs.push(`${at}: not ${JSON.stringify(schema.const)}`);
    if (typeof value === 'string') {
      const n = [...value].length;
      if (schema.minLength !== undefined && n < schema.minLength) errs.push(`${at}: shorter than ${schema.minLength}`);
      if (schema.maxLength !== undefined && n > schema.maxLength) errs.push(`${at}: longer than ${schema.maxLength}`);
      if (schema.pattern !== undefined && !new RegExp(schema.pattern, 'u').test(value)) errs.push(`${at}: does not match ${schema.pattern}`);
    }
    if (typeof value === 'number') {
      if (schema.minimum !== undefined && value < schema.minimum) errs.push(`${at}: below ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) errs.push(`${at}: above ${schema.maximum}`);
      if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errs.push(`${at}: not above ${schema.exclusiveMinimum}`);
    }
    if (Array.isArray(value)) {
      if (schema.minItems !== undefined && value.length < schema.minItems) errs.push(`${at}: fewer than ${schema.minItems} items`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) errs.push(`${at}: more than ${schema.maxItems} items`);
      if (schema.uniqueItems && new Set(value.map((v) => JSON.stringify(v))).size !== value.length) errs.push(`${at}: items not unique`);
      if (Array.isArray(schema.uniqueItemProperties)) {
        for (const prop of schema.uniqueItemProperties) {
          const seen = new Set();
          for (const item of value) {
            if (!isObj(item) || !Object.hasOwn(item, prop)) continue;
            const key = JSON.stringify(item[prop]);
            if (seen.has(key)) errs.push(`${at}: duplicate ${prop}`);
            seen.add(key);
          }
        }
      }
      if (schema.items !== undefined) value.forEach((v, i) => errs.push(...sub(schema.items, v, `${at}[${i}]`)));
      if (schema.contains !== undefined && !value.some((v, i) => !sub(schema.contains, v, `${at}[${i}]`).length)) errs.push(`${at}: contains no matching item`);
    }
    if (isObj(value)) {
      const keys = Object.keys(value);
      if (schema.minProperties !== undefined && keys.length < schema.minProperties) errs.push(`${at}: fewer than ${schema.minProperties} properties`);
      if (schema.maxProperties !== undefined && keys.length > schema.maxProperties) errs.push(`${at}: more than ${schema.maxProperties} properties`);
      for (const r of schema.required || []) if (!Object.hasOwn(value, r)) errs.push(`${at}: lacks ${r}`);
      if (schema.propertyNames !== undefined) for (const k of keys) errs.push(...sub(schema.propertyNames, k, `${at}{${k}}`));
      for (const k of keys) {
        let matched = false;
        if (isObj(schema.properties) && Object.hasOwn(schema.properties, k)) { matched = true; errs.push(...sub(schema.properties[k], value[k], `${at}.${k}`)); }
        for (const [p, s] of Object.entries(schema.patternProperties || {})) if (new RegExp(p, 'u').test(k)) { matched = true; errs.push(...sub(s, value[k], `${at}.${k}`)); }
        if (!matched && schema.additionalProperties !== undefined) errs.push(...sub(schema.additionalProperties, value[k], `${at}.${k}`));
      }
    }
    for (const s of schema.allOf || []) errs.push(...sub(s, value, at));
    if (schema.anyOf && !schema.anyOf.some((s) => !sub(s, value, at).length)) errs.push(`${at}: matches none of anyOf`);
    if (schema.oneOf) {
      const n = schema.oneOf.filter((s) => !sub(s, value, at).length).length;
      if (n !== 1) errs.push(`${at}: matches ${n} of oneOf`);
    }
    if (schema.not !== undefined && !sub(schema.not, value, at).length) errs.push(`${at}: matches what "not" forbids`);
    if (schema.if !== undefined) {
      const ok = !sub(schema.if, value, at).length;
      if (ok && schema.then !== undefined) errs.push(...sub(schema.then, value, at));
      if (!ok && schema.else !== undefined) errs.push(...sub(schema.else, value, at));
    }
    return errs;
  }

  return {
    /**
     * Validate a value against a schema file (or a #fragment of one).
     * @param {string} ref 'plugin.schema.json' or 'overlay.schema.json#/$defs/…'
     * @param {any} value
     * @returns {string[]} errors
     */
    validate(ref, value) {
      const r = resolve(ref, ref.split('#')[0]);
      return check(r.schema, value, r.file, '$');
    },
  };
}
