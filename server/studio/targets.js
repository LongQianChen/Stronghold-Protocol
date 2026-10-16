// server/studio/targets.js — what a cosmetic plugin can change, found by its official name (DESIGN §32.9, docs/PLUGINS.md
// §15): the studio's target picker (GET /studio/api/targets) and `node tools/plugin.mjs new … --target <名字>` search one
// index built from this installation's game data and art manifest, so an author types 德克萨斯 and never an internal id.
//
//   kind       container of data/assets.json      names from
//   operator   chars[charId]                      data/chess.json (the visible chess, once per operator), data/backups.json
//                                                 units (补位 / 自选 operators)
//   token      tokens[tokenId]                    data/tokens.json, data/backups.json tokens
//   enemy      enemies[key]                       data/enemies.json
//   item       items[iconId | trapId]             data/items.json (the shop's equipment)
//   bond       bonds[bondId]                      data/bonds.json
//   band       bands[bandId]                      data/bands.json (strategies)
//   ui         ui['group/key']                    the manifest's own keys (no official names: the key and its picture)
//   music      audio.bgm[key], audio.bossBgm[id]  the manifest's tracks (named in Chinese / English here)
//   sound      audio.sfx.ui / battle[key]         the manifest's sounds (by key)
// Each target: `{ kind, key, container, name, alt, icon, group? }` — container the path of its entry's container, name its
// official name (a track's, a sound's or an interface picture's: its key), alt other words to match (an operator's
// appellation, an id, the words of a track in Chinese and English), icon the URL of its picture in the committed manifest
// (null when it has none). The page shows the labels itself (public/studio/js/labels.js, translated by the language
// packs): nothing here is display text. Read once per change of the files (size + mtime), never written.

import fs from 'node:fs';
import path from 'node:path';
import { N_ } from '../../shared/i18n.js';

/** The target kinds, in the picker's order: the container of their entries. */
export const TARGET_KINDS = Object.freeze({
  operator: { container: ['chars'] },
  token: { container: ['tokens'] },
  enemy: { container: ['enemies'] },
  item: { container: ['items'] },
  bond: { container: ['bonds'] },
  band: { container: ['bands'] },
  ui: { container: ['ui'] },
  music: { container: ['audio', 'bgm'] },
  sound: { container: ['audio', 'sfx'] },
});

/** The words a named BGM track (audio.bgm keys a plugin may write — shared/plugins/visual.js; not combatAlts) is found by. */
const BGM_WORDS = Object.freeze({
  lobby: [N_('大厅音乐'), 'lobby music'], prep: [N_('准备阶段音乐'), 'preparation music'], combat: [N_('战斗音乐'), 'battle music'],
  unite: [N_('联防音乐'), 'joint defence music'], boss: [N_('最终攻势音乐'), 'final assault music'],
});
/** … a boss track's and a sound's (by group). */
const BOSS_WORDS = [N_('首领音乐'), 'boss music'];
const SOUND_WORDS = Object.freeze({ ui: [N_('界面音效'), 'interface sound'], battle: [N_('战斗音效'), 'battle sound'] });

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const get = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);

/**
 * @typedef {{ kind: string, key: string, container: string[], name: string, alt: string, icon: string | null,
 *   group?: string }} Target
 *   group: a sound's sub-container (ui / battle) or a track's (bgm / bossBgm)
 */

/**
 * The index of a data folder's targets (see the header).
 * @param {{ chess?: any, tokens?: any, enemies?: any, items?: any, bonds?: any, bands?: any, backups?: any }} data
 * @param {any} manifest data/assets.json
 * @returns {Target[]}
 */
export function buildTargets(data, manifest) {
  /** @type {Target[]} */
  const out = [];
  const seen = new Set();
  const add = (t) => { const k = `${t.kind}|${t.container.join('.')}|${t.key}`; if (!seen.has(k)) { seen.add(k); out.push(t); } };
  const chars = get(manifest, 'chars');
  const avatarOf = (charId) => str(get(get(chars, charId), 'avatar'));
  // operators: the visible chess once per charId, then the 补位 / 自选 operators of backups.json
  for (const c of Object.values(isObj(data.chess) ? data.chess : {})) {
    if (!isObj(c) || c.isGolden || c.isHidden || c.visible === false || !str(c.charId) || !str(c.name)) continue;
    add({ kind: 'operator', key: c.charId, container: ['chars'], name: c.name, alt: [c.appellation, c.charId].filter(Boolean).join(' '), icon: avatarOf(c.charId) });
  }
  for (const [charId, u] of Object.entries(isObj(data.backups?.units) ? data.backups.units : {})) {
    if (!isObj(u) || !str(u.name)) continue;
    const id = str(u.charId) || charId;
    add({ kind: 'operator', key: id, container: ['chars'], name: u.name, alt: [u.appellation, id].filter(Boolean).join(' '), icon: avatarOf(id) });
  }
  const tokens = get(manifest, 'tokens');
  const tokenIcon = (id) => str(get(get(tokens, id), 'avatar')) || avatarOf(str(get(get(tokens, id), 'owner')) || '');
  for (const src of [data.tokens, data.backups?.tokens]) {
    for (const [id, t] of Object.entries(isObj(src) ? src : {})) {
      if (!isObj(t) || !str(t.name)) continue;
      const key = str(t.tokenId) || id;
      add({ kind: 'token', key, container: ['tokens'], name: t.name, alt: [t.appellation, key].filter(Boolean).join(' '), icon: tokenIcon(key) });
    }
  }
  const enemies = get(manifest, 'enemies');
  for (const [id, e] of Object.entries(isObj(data.enemies) ? data.enemies : {})) {
    if (!isObj(e) || !str(e.name)) continue;
    const key = str(e.key) || id;
    add({ kind: 'enemy', key, container: ['enemies'], name: e.name, alt: key, icon: str(get(get(enemies, key), 'icon')) });
  }
  const items = get(manifest, 'items');
  for (const it of Object.values(isObj(data.items) ? data.items : {})) {
    if (!isObj(it) || it.isGolden || !str(it.name)) continue;
    const key = [str(it.iconId), str(it.trapId)].find((k) => k && get(items, k) !== undefined) || str(it.iconId) || str(it.trapId);
    if (!key) continue;
    add({ kind: 'item', key, container: ['items'], name: it.name, alt: [it.id, key].filter(Boolean).join(' '), icon: str(get(items, key)) });
  }
  const bonds = get(manifest, 'bonds');
  for (const [id, b] of Object.entries(isObj(data.bonds) ? data.bonds : {})) {
    if (!isObj(b) || !str(b.name)) continue;
    const key = str(b.bondId) || id;
    add({ kind: 'bond', key, container: ['bonds'], name: b.name, alt: key, icon: str(get(bonds, key)) });
  }
  const bands = get(manifest, 'bands');
  for (const [id, b] of Object.entries(isObj(data.bands) ? data.bands : {})) {
    if (!isObj(b) || !str(b.name)) continue;
    const key = str(b.bandId) || id;
    add({ kind: 'band', key, container: ['bands'], name: b.name, alt: key, icon: str(get(bands, key)) });
  }
  for (const [key, url] of Object.entries(isObj(get(manifest, 'ui')) ? manifest.ui : {})) {
    if (typeof url === 'string') add({ kind: 'ui', key, container: ['ui'], name: key, alt: key, icon: url });
  }
  const audio = get(manifest, 'audio');
  for (const key of Object.keys(BGM_WORDS)) {
    if (!isObj(get(get(audio, 'bgm'), key))) continue;
    add({ kind: 'music', key, container: ['audio', 'bgm'], group: 'bgm', name: key, alt: BGM_WORDS[key].join(' '), icon: null });
  }
  for (const key of Object.keys(isObj(get(audio, 'bossBgm')) ? audio.bossBgm : {})) {
    add({ kind: 'music', key, container: ['audio', 'bossBgm'], group: 'bossBgm', name: key, alt: BOSS_WORDS.join(' '), icon: null });
  }
  for (const group of ['ui', 'battle']) {
    for (const key of Object.keys(isObj(get(get(audio, 'sfx'), group)) ? audio.sfx[group] : {})) {
      add({ kind: 'sound', key, container: ['audio', 'sfx', group], group, name: key, alt: SOUND_WORDS[group].join(' '), icon: null });
    }
  }
  return out;
}

/** A search text: lower case, without spaces and the middle dot. @param {unknown} s */
const norm = (s) => String(s ?? '').toLowerCase().replace(/[\s·・]+/g, '');

/**
 * The targets matching `q` (official name, another name or the id; an empty query lists the first of each kind), of
 * `kinds` when given, best first: an exact name, a name that starts with it, a name that holds it, then the other names
 * and the key; operators before the other kinds at the same rank.
 * @param {Target[]} targets @param {string} q @param {{ kinds?: string[] | null, limit?: number }} [opts]
 * @returns {Target[]}
 */
export function searchTargets(targets, q, { kinds = null, limit = 40 } = {}) {
  const n = norm(q);
  const order = Object.keys(TARGET_KINDS);
  const scored = [];
  for (const t of targets) {
    if (kinds && !kinds.includes(t.kind)) continue;
    const name = norm(t.name);
    let rank;
    if (!n) rank = 5;
    else if (name === n || norm(t.key) === n) rank = 0;
    else if (name.startsWith(n)) rank = 1;
    else if (name.includes(n)) rank = 2;
    else if (norm(t.alt).includes(n) || norm(t.key).includes(n)) rank = 3;
    else continue;
    scored.push({ t, rank });
  }
  scored.sort((a, b) => a.rank - b.rank || order.indexOf(a.t.kind) - order.indexOf(b.t.kind) || a.t.name.length - b.t.name.length || (a.t.key < b.t.key ? -1 : a.t.key > b.t.key ? 1 : 0));
  return scored.slice(0, Math.max(1, limit)).map((x) => x.t);
}

/** The data files the index reads (data/<name>.json). */
const FILES = ['chess', 'tokens', 'enemies', 'items', 'bonds', 'bands', 'backups', 'assets'];

/**
 * The targets of a data folder, read again when one of its files changes (size + mtime).
 * @param {string} dataDir
 * @returns {() => { targets: Target[], manifest: any }}
 */
export function createTargetIndex(dataDir) {
  let sig = null;
  let state = { targets: [], manifest: null };
  return () => {
    const parts = FILES.map((f) => { try { const st = fs.statSync(path.join(dataDir, `${f}.json`)); return `${f}:${st.size}:${st.mtimeMs}`; } catch { return `${f}:-`; } });
    const s = parts.join('|');
    if (s === sig) return state;
    /** @type {Record<string, any>} */
    const data = {};
    for (const f of FILES) {
      try { data[f] = JSON.parse(fs.readFileSync(path.join(dataDir, `${f}.json`), 'utf8')); } catch { data[f] = null; }
    }
    state = { targets: buildTargets(data, data.assets), manifest: data.assets };
    sig = s;
    return state;
  };
}

/**
 * The target a `<kind>:<key>` names (or a bare key: the first target with it), else null.
 * @param {Target[]} targets @param {string} spec
 */
export function targetOf(targets, spec) {
  const s = String(spec || '');
  const i = s.indexOf(':');
  const kind = i > 0 && Object.hasOwn(TARGET_KINDS, s.slice(0, i)) ? s.slice(0, i) : null;
  const key = kind ? s.slice(i + 1) : s;
  return targets.find((t) => t.key === key && (!kind || t.kind === kind)) || null;
}

/** The `<kind>:<key>` of a target (targetOf reads it back). @param {Target} t */
export const targetSpec = (t) => `${t.kind}:${t.key}`;
