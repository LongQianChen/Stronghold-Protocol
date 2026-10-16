// server/sim/content/kits/ops/chess_char_6_17-nearl2.js — 耀骑士临光 (char_1014_nearl2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import {
  num, tbb, live, hasBond, onDefaultSkill, selectedSkill, N4, bstate, freeTiles, bestTile,
} from '../shared/tier6.js';

/** Deploy-order tracker: last op deployed per owner (read before the update by priority-0 deploy handlers). */
function ensureDeployTracker(battle) {
  const S = bstate(battle);
  if (S.lastOp) return S.lastOp;
  S.lastOp = new Map();
  battle.on('deploy', ({ unit }) => { if (unit.kind === 'op') S.lastOp.set(unit.ownerId, unit); }, { priority: -100 });
  return S.lastOp;
}

// ------------------------------------------------------------------------------------------------------------------
// 耀骑士临光 chess_char_6_17 (无畏者) — S3 耀阳颔首; 不畏苦暗; 破晓; module 耀阳锋刃

function nearl2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const t0Grid = def?.talents?.[0]?.rangeGrid?.length ? def.talents[0].rangeGrid : N4;
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const tokId = (chess?.tokens || []).find((t) => /nearl2_sword/.test(String(t))) || 'token_10019_nearl2_sword';
  const sunBurst = (battle, unit, r, c, scale, stun) => {
    const keys = new Set(absoluteRangeKeys(N4, r, c, 1, 0));
    battle.fx('sunBurst', { x: c, y: r, id: unit.id });
    for (const e of battle.enemies) {
      if (!e.alive || e.hidden || !bodyInRange(e, keys)) continue;
      battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'true', isSkill: true, tags: ['skill'] });
      if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
    }
  };
  const isDef = onDefaultSkill(chess), sid = selectedSkill(chess, def);
  const lastOps = { map: null };
  const skills = {
    // S1 灿焰长刃 (toggle, 持续时间无限): skill range, ATK / ASPD +
    skchr_nearl2_1: {
      kind: 'toggle',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed) },
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
    },
    // S2 逐夜烁光 (passive, ON_DEPLOY): for the skill duration after each deployment ATK +atk and `times` 护盾 layers
    // (whole hits negated); then she withdraws and this redeploy time is ×respawn_time (×1 when the operator deployed
    // right before her is 【卡西米尔】)
    skchr_nearl2_2: {
      kind: 'duration', activateOnDeploy: true, duration: num(def?.skill?.duration, 22), spCost: 0, spType: 'none', trigger: 'NEVER',
      mods: { atkPct: num(bb.atk) },
      onStart({ battle, unit, skill }) {
        const dur = num(skill.duration, num(def?.skill?.duration, 22));
        if (!(dur > 0)) return;
        const prev = lastOps.map?.get(unit.ownerId);
        unit.mem.nearl2Combo = !!prev && prev !== unit && hasBond(prev, 'kazimierzShip');
        const hits = Math.floor(num(bb.times));
        if (hits > 0) battle.addBuff(unit, { key: 'nearl2:shield', shieldHits: hits, duration: dur, visible: true });
      },
      onEnd({ battle, unit, reason }) {
        battle.removeBuff(unit, 'nearl2:shield');
        if (reason !== 'duration' || !live(unit)) return;
        const combo = unit.mem.nearl2Combo;
        battle.retreat(unit, { reason: 'retreat' });
        const mul = combo ? num(bb['nearl2_s_2[withdraw][combo].respawn_time'], 1) : num(bb.respawn_time, 1);
        if (Number.isFinite(unit.respawnAt) && mul !== 1) unit.respawnAt = battle.time + (unit.respawnAt - battle.time) * mul;
        battle.fx('disappear', { x: unit.x, y: unit.y, id: unit.id, combo });
      },
    },
  };
  // module “骑士家族”: "被击倒时不撤退且回复所有生命但生命上限-60%，攻击速度+30（单次部署只触发1次）" and 不畏苦暗
  // "部署时及首次被击倒时…" (the burst again)
  const standVal = num(tb.value), standAs = num(tb.attack_speed), standHp = num(tb.hp_ratio, 1);
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_nearl2_2') lastOps.map = ensureDeployTracker(battle);
      if (standVal > 0) {
        battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.nearlStood = false; }, { owner: unit });
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || ctx.prevented || unit.mem.nearlStood) return;
          ctx.prevented = true;
          unit.mem.nearlStood = true;
          battle.addBuff(unit, { key: 'nearl2:stand', mods: { hpMul: Math.max(0.05, 1 - standVal), aspd: standAs }, visible: true });
          unit.hp = Math.max(1, unit.s.maxHp * standHp);
          battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
          battle.emit('nearl2:knockdown', { unit });
        }, { owner: unit, priority: -60 });
      }
    },
    trait: num(tb.atk_scale, 1) > 1 ? { dmgMul: (b, u, t) => (t.blockedBy ? num(tb.atk_scale, 1) : 1) } : null,
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      onStart({ battle, unit, skill }) {
        const tile = bestTile(battle, freeTiles(battle, unit, N4));
        const sword = tile ? battle.spawnToken(unit, tokId, tile[0], tile[1], { duration: skill.timeLeft }) : null;
        unit.mem.sun = sword;
        if (sword) battle.fx('summon', { x: sword.x, y: sword.y, id: sword.id, src: unit.id });
        // the token kit (content/tokens.js) performs the appear burst; without it (or without a free tile) do it here
        if (!sword || !sword.kit?.fromTokens) {
          sunBurst(battle, unit, sword ? sword.tileR : unit.tileR, sword ? sword.tileC : unit.tileC, num(bb.value), num(bb.value2));
        }
      },
      onEnd({ battle, unit }) {
        const s = unit.mem.sun;
        unit.mem.sun = null;
        if (s && s.alive) battle.retreat(s, { reason: 'expired', permanent: true });
      },
    },
    talents: [
      { install(battle, unit) { // S3: attacks on units blocked by her or 耀阳 deal true damage
        if (!isDef) return;
        battle.on('hit', (ctx) => {
          if (ctx.source !== unit || !unit.skill?.active || !ctx.dmg.isAttack) return;
          const b = ctx.target.blockedBy;
          if (b && (b === unit || b === unit.mem.sun)) ctx.dmg.type = 'true';
        }, { owner: unit });
      } },
      { install(battle, unit) { // 不畏苦暗 — the 4 tiles around her, air units too [ASSUMED: no 对空 note on PRTS, like “耀阳”]
        const last = ensureDeployTracker(battle);
        const sc = num(t0.atk_scale), stun = num(t0.stun);
        const dawn = (times) => {
          const foes = battle.unitsInGrid(unit, t0Grid, { side: 'enemy' });
          if (foes.length) battle.fx('sunBurst', { x: unit.x, y: unit.y, id: unit.id });
          for (const e of foes) {
            for (let i = 0; i < times && e.alive; i++) battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'true', tags: ['talent'] });
            if (stun > 0 && e.alive) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
          }
        };
        const kazTimes = () => { const prev = last.get(unit.ownerId); return prev && prev !== unit && hasBond(prev, 'kazimierzShip') ? 2 : 1; };
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit || !(sc > 0)) return;
          unit.mem.nearlDawnTimes = kazTimes();
          dawn(unit.mem.nearlDawnTimes);
        }, { owner: unit });
        // module “骑士家族”: "…及首次被击倒时" — the burst again when the trait keeps her standing
        battle.on('nearl2:knockdown', ({ unit: u }) => { if (u === unit && sc > 0) dawn(unit.mem.nearlDawnTimes ?? 1); }, { owner: unit });
      } },
      { install(battle, unit) { // 破晓
        const p = num(t1.def_penetrate);
        if (p) battle.addBuff(unit, { key: 'nearl2:dawn', mods: { defIgnorePct: p }, persist: true, allowDead: true });
      } },
    ],
  };
}

export default {
  chess_char_6_17_a: nearl2,
};
