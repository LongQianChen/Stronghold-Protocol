// public/studio/js/preview/field.js — the studio's live model preview (DESIGN §32.9): the game's own battlefield view
// (render/app.js createFieldView — PixiJS, pixi-spine, the official board when installed) with the original on the left
// and the plugin's version on the right, on the board of the preparation phase or in a battle, playing the role the
// author picks: 待机, 移动, 攻击, 技能 (S1–S3), 眩晕, 倒下, 部署 — fed exactly as a real battle feeds it (b.snap tuples
// `[id, x, y, hp, maxHp, sp, spMax, flags, anim]` and b.ev events: shared/protocol.js), so what plays here is what plays
// in a match. Its art comes from the preview layers (./layers.js): a new preview re-draws the models in place.

import { useEffect, useRef, useState } from '../../../vendor/hooks.module.js';
import { html } from '../../../js/ui/components.js';
import { createFieldView } from '../../../js/render/app.js';
import { data } from '../../../js/data.js';
import { GEO, UF, ANIM } from '../../../../shared/constants.js';
import { t, N_ } from '../../../../shared/i18n.js';
import { PLUGIN_SUFFIX, pluginRecord } from './layers.js';

/** The roles the preview plays: the snapshot's anim, its flags, the events it repeats. */
export const ROLES = Object.freeze([
  { id: 'idle', label: N_('待机') }, { id: 'move', label: N_('移动') }, { id: 'attack', label: N_('攻击') }, { id: 'skill', label: N_('技能') },
  { id: 'stun', label: N_('眩晕') }, { id: 'die', label: N_('倒下') }, { id: 'deploy', label: N_('部署') },
]);
/** The stage the preview stands on (the first normal field of the mode). */
const STAGE = 'act2autochess_m01';
/** The dummy every attack aims at (源石虫). */
const DUMMY = 'enemy_1007_slime';
/** The part of the field the camera frames: the two units and their dummies, close (the official battle framing of a smaller rect). */
const CLOSE_RECT = Object.freeze({ r0: 9, r1: 12, c0: 1, c1: 9 });
/** Seconds of one 倒下 cycle: down (the clip and the fade of a battle) then standing for 0.9 s. */
const DIE_CYCLE = 3.6;
/** Ids of the units: the original, the plugin's, their dummies. */
const ID = Object.freeze({ orig: 1, plugin: 2, dOrig: 11, dPlugin: 12 });

/**
 * The record the field view reads for a target (data.js lookups), the plugin's under its own chess id.
 * @param {any} target @returns {{ chessId: string | null, rec: any }}
 */
function recordOf(target) {
  if (target.kind === 'operator') {
    const rec = data.list('chess').find((c) => c && c.charId === target.key && !c.isGolden) || null;
    return { chessId: rec?.chessId ?? null, rec };
  }
  if (target.kind === 'token') return { chessId: null, rec: data.lookup('tokens', target.key) };
  if (target.kind === 'enemy') return { chessId: null, rec: data.lookup('enemies', target.key) };
  return { chessId: null, rec: null };
}

/** The data the field view reads: the game's, with the plugin's records beside the original ones. */
function previewData(target, chessId) {
  const pluginChess = chessId ? `${chessId}${PLUGIN_SUFFIX}` : null;
  return {
    get: (f) => data.get(f),
    lookup(file, id) {
      if (file === 'chess' && id === pluginChess) return pluginRecord(data.lookup('chess', chessId), target.key);
      if (file === 'tokens' && id === `${target.key}${PLUGIN_SUFFIX}`) return pluginRecord(data.lookup('tokens', target.key), target.key);
      if (file === 'enemies' && id === `${target.key}${PLUGIN_SUFFIX}`) return data.lookup('enemies', target.key);
      return data.lookup(file, id);
    },
  };
}

/**
 * The model preview (see the header).
 * @param {{ target: any, assets: any, version: number }} props
 *   assets: the preview's asset store (createAssets over the preview layers); version: changes with every new preview
 */
export function FieldPreview({ target, assets, version }) {
  const host = useRef(null);
  const view = useRef(null);
  const [mode, setMode] = useState(target.kind === 'enemy' ? 'battle' : 'prep');
  const [role, setRole] = useState('idle');
  const [back, setBack] = useState(false);
  const [skill, setSkill] = useState(0);
  const [state, setState] = useState('loading');
  const scene = useRef(null);
  const canPrep = target.kind === 'operator' || target.kind === 'token';

  // the view: made once per target (destroyed with the panel)
  useEffect(() => {
    let alive = true;
    let v = null;
    setState('loading');
    (async () => {
      await data.loadAll('chess', 'tokens', 'items', 'enemies', 'stages', 'bonds', 'config', 'backups');
      if (!alive || !host.current) return;
      const { chessId } = recordOf(target);
      v = await createFieldView(host.current, { data: previewData(target, chessId), assets, settings: { quality: 'high', damageNumbers: true } });
      if (!alive) { v.destroy(); return; }
      view.current = v;
      globalThis.__studioView = v;
      setState('ready');
    })().catch((e) => { console.warn('[studio] the field preview did not start', e); if (alive) setState('failed'); });
    return () => { alive = false; scene.current?.stop(); scene.current = null; view.current = null; try { v?.destroy(); } catch { /* gone */ } };
  }, [target.kind, target.key]);

  // the scene: rebuilt when the mode, the facing, the skill or the role changes — and when a new preview arrived
  useEffect(() => {
    const v = view.current;
    if (!v || state !== 'ready') return undefined;
    scene.current?.stop();
    scene.current = mode === 'prep' && canPrep ? prepScene(v, target, { back }) : battleScene(v, target, { role, back, skill });
    return () => { scene.current?.stop(); scene.current = null; };
  }, [state, mode, role, back, skill, target.kind, target.key]);

  // a new preview: the views re-resolve their art (assets.onChange); a role that plays once plays again
  useEffect(() => { if (version && scene.current?.replay) scene.current.replay(); }, [version]);

  const cx = (...p) => p.filter(Boolean).join(' ');
  return html`<div class="st-field" data-testid="field-preview">
    <div class="st-field__bar">
      ${canPrep ? html`<div class="st-seg" role="group" aria-label=${t('场景')}>
        <button type="button" class=${cx('st-seg__btn', mode === 'prep' && 'is-on')} onClick=${() => setMode('prep')}>${t('准备区')}</button>
        <button type="button" class=${cx('st-seg__btn', mode === 'battle' && 'is-on')} onClick=${() => setMode('battle')}>${t('战斗')}</button>
      </div>` : null}
      ${mode === 'battle' || !canPrep ? html`<div class="st-seg" role="group" aria-label=${t('动作')}>
        ${ROLES.map((r) => html`<button type="button" key=${r.id} data-role=${r.id} class=${cx('st-seg__btn', role === r.id && 'is-on')} onClick=${() => { setRole(r.id); scene.current?.replay?.(); }}>${t(r.label)}</button>`)}
      </div>` : null}
      ${target.kind === 'operator' ? html`<div class="st-seg" role="group" aria-label=${t('朝向')}>
        <button type="button" class=${cx('st-seg__btn', !back && 'is-on')} onClick=${() => setBack(false)}>${t('正面')}</button>
        <button type="button" class=${cx('st-seg__btn', back && 'is-on')} onClick=${() => setBack(true)}>${t('背面')}</button>
      </div>` : null}
      ${target.kind === 'operator' && mode === 'battle' && role === 'skill' ? html`<div class="st-seg" role="group" aria-label=${t('技能')}>
        ${[0, 1, 2].map((i) => html`<button type="button" key=${i} class=${cx('st-seg__btn', skill === i && 'is-on')} onClick=${() => setSkill(i)}>S${i + 1}</button>`)}
      </div>` : null}
    </div>
    <div class="st-field__stage" ref=${host}>
      ${state === 'loading' ? html`<div class="st-field__note">${t('正在载入游戏画面…')}</div>` : null}
      ${state === 'failed' ? html`<div class="st-field__note">${t('游戏画面没有载入（需要 WebGL）。图片和声音的预览不受影响。')}</div>` : null}
    </div>
    <div class="st-field__legend"><span>${t('左：原版')}</span><span>${t('右：插件')}</span></div>
  </div>`;
}

/** A piece of the prep board (render/app.js setPrep). */
const piece = (uid, kind, id, row, col, dir) => ({ uid, kind, id, golden: false, tier: 1, items: [], count: 1, row, col, dir });

/** The preparation board: the original and the plugin's version standing on the board, side by side. */
function prepScene(v, target, { back }) {
  const { chessId } = recordOf(target);
  const dir = back ? 'UP' : 'RIGHT';
  const kind = target.kind === 'token' ? 'token' : 'chess';
  const id0 = kind === 'chess' ? chessId : target.key;
  const id1 = kind === 'chess' ? (chessId ? `${chessId}${PLUGIN_SUFFIX}` : null) : `${target.key}${PLUGIN_SUFFIX}`;
  const priv = { hand: Array(GEO.HAND_SIZE).fill(null), temp: Array(GEO.TEMP_SIZE).fill(null), board: [] };
  if (id0) priv.board.push(piece(1, kind, id0, 10, 4, dir));
  if (id1) priv.board.push(piece(2, kind, id1, 10, 7, dir));
  v.setPrep(priv, { editable: false });
  v.setCamera('normal', { rect: CLOSE_RECT, instant: true });
  return { stop() {}, replay() { v.setPrep(JSON.parse(JSON.stringify(priv)), { editable: false }); } };
}

/**
 * A battle: the original and the plugin's version facing a dummy each, the role repeated (see the header).
 * @returns {{ stop: () => void, replay: () => void }}
 */
function battleScene(v, target, { role, back, skill }) {
  const enemy = target.kind === 'enemy';
  const { chessId, rec } = recordOf(target);
  const kind = enemy ? 'enemy' : target.kind === 'token' ? 'token' : 'op';
  const side = enemy ? 'enemy' : 'ally';
  const name = rec?.name || target.name || target.key;
  const row = 10.5;
  const unit = (id, x, spine, defId) => ({
    id, kind, side, defId, name, tier: 1, golden: false, spine, avatar: spine, x, y: row, facing: enemy ? -1 : 1,
    ...(enemy ? {} : { dir: back ? 'UP' : 'RIGHT' }), maxHp: 3000, ...(kind === 'op' ? { skillIndex: skill } : {}),
  });
  const dummy = (id, x) => ({ id, kind: 'enemy', side: 'enemy', defId: DUMMY, name: '', tier: 1, golden: false, spine: DUMMY, avatar: DUMMY, x, y: row, facing: -1, maxHp: 99999 });
  const def0 = kind === 'op' ? chessId || target.key : target.key;
  const def1 = kind === 'op' ? (chessId ? `${chessId}${PLUGIN_SUFFIX}` : target.key) : `${target.key}${PLUGIN_SUFFIX}`;
  const units = [unit(ID.orig, 2.5, target.key, def0), unit(ID.plugin, 6.5, `${target.key}${PLUGIN_SUFFIX}`, def1), dummy(ID.dOrig, 4.4), dummy(ID.dPlugin, 8.4)];
  const fieldId = `studio-${Date.now()}`;
  v.enterBattle({ fieldId, kind: 'normal', rect: { ...GEO.NORMAL_RECT }, stageId: STAGE, units });
  v.setCamera('normal', { rect: CLOSE_RECT, instant: true });
  let gt = 0;
  let acc = 0;
  let nextAttack = 0.4;
  let started = performance.now();
  let raf = 0;
  let stopped = false;
  let deployOnce = role === 'deploy';
  // 倒下 repeats: the fall (the Die clip, the view fading as in a battle), a moment standing again, the fall again
  let dieFrom = role === 'die' ? 0.3 : -1;
  const anim = role === 'move' ? ANIM.MOVE : role === 'stun' ? ANIM.STUN : ANIM.IDLE;
  const tuple = (u, a, flags) => [u.id, u.x, u.y, u.maxHp, u.maxHp, 0, 0, flags, a];
  const frame = (now) => {
    if (stopped) return;
    const dt = Math.min(0.25, (now - started) / 1000);
    started = now;
    acc += dt;
    while (acc >= 0.1) {
      acc -= 0.1;
      gt += 0.1;
      const ev = [];
      if (deployOnce) { deployOnce = false; ev.push(['deploy', ID.orig], ['deploy', ID.plugin]); }
      if ((role === 'attack' || role === 'skill') && gt >= nextAttack) {
        nextAttack = gt + 1.2;
        ev.push(['atk', ID.orig, ID.dOrig, 'none'], ['atk', ID.plugin, ID.dPlugin, 'none']);
        ev.push(['dmg', ID.dOrig, 120, 'phys'], ['dmg', ID.dPlugin, 120, 'phys']);
      }
      const dead = dieFrom >= 0 && gt >= dieFrom && (gt - dieFrom) % DIE_CYCLE < DIE_CYCLE - 0.9;
      const a = dead ? ANIM.DIE : anim;
      const flags = role === 'skill' ? UF.SKILL : 0;
      const tuples = [tuple(units[0], a, flags), tuple(units[1], a, flags), tuple(units[2], ANIM.IDLE, 0), tuple(units[3], ANIM.IDLE, 0)];
      if (ev.length) v.pushEvents({ t: 'b.ev', fieldId, gt, ev });
      v.pushSnapshot({ t: 'b.snap', fieldId, gt, units: tuples, dp: 10, killed: 0, total: 2 });
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return {
    stop() { stopped = true; cancelAnimationFrame(raf); },
    /** Play a one-shot role again (deploy; die from the start of its cycle). */
    replay() {
      if (role === 'deploy') deployOnce = true;
      if (role === 'die') dieFrom = gt + 0.9; // standing a moment first, then down again
    },
  };
}
