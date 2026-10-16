// server/sim/content/kits/ops/op-chen.js — 陈 (char_010_chen) 自选 operator kit: 6★ 剑豪 (近卫), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_010_chen, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), PRTS 陈 (S2 备注
// "可对空；先造成法术伤害，后造成物理伤害"; S3 备注 "不可对空 / 技能生效期间，持有效果：无敌，无法阻挡，眩晕免疫，冻结免疫 / 若斩击次数
// 未到10次之前技能范围内没有目标，立刻中止技能"; SWO-X 特性 修正 "技能期间造成的伤害提升10%", 原因 6 "描述与游戏实际表现不符合"),
// PRTS 分支特性信息 §剑豪, her battle skeleton char_010_chen.skel (front; the client's own spine parser: Skill 1 OnAttack,
// Skill_2 1 OnAttack, Skill_3 2.933 s with OnAttack at 0.6 + 0.2k (k = 0…8), 2.833 and 2.933).
// - Trait (剑豪) "普通攻击连续造成两次伤害": the profession default (hits 2; professions.js `sword`), ground-only melee
//   (canHitFly false) on her 1-1 — PRTS 分支 "可以且优先攻击自身阻挡的单位（即使…为飞行单位）" is the engine's blocked-first rule.
//   Module SWO-X “罗德岛制式剑” adds "技能造成的伤害提升10%" (trait bb damage_scale) — PRTS corrects it to 技能期间: every damage
//   she deals while her skill runs (the S1 strike, the S2 cut, the S3 slashes: all of them her skill's) ×1.1; SWO-Y
//   “往昔时光” adds "攻击时无视敌人70点的防御力" (def_penetrate_fixed): defIgnoreFlat on all her damage (as 锏's SWO-Y).
// - T1 呵斥 "在场时每4秒回复全场友方角色1点攻击/受击技力": every `interval` s from each deployment, +sp SP to every ally of the
//   field (her included, a teammate's in a shared field too; Battle.alliesFor: no 孤立 unit) whose skill recovers by
//   attacking or by being hit — not a time-SP skill, nobody whose timed skill runs (giveSp), nobody under 阻回. SWO-X
//   stage 2+ "每3秒" (the module talent's interval); stage 3 "自身额外回复1点技力": the hidden module talent part
//   (chen_equip_1_3_p2, its own interval / sp) — +1 more for her, read from the module's talentChanges (its bb merges
//   into the visible talent's with the same keys). [ASSUMED] two 陈 of a shared field (two players) both give theirs.
// - T2 持刀格斗术 "攻击力+5%，防御力+5%，物理闪避+10%" (full potential: +6 % / +6 % / 13 %): a permanent ATK / DEF / 物理闪避
//   buff; SWO-Y stage 3: +16 % / +16 % / 21 % (the module talent change replaces the numbers).
// - S1 鞘击 (AUTO, attack SP): the next attack is one sheath strike (her skeleton's Skill clip: one OnAttack — not the
//   trait's two) for atk_scale × ATK physical that stuns the target `stun` s; the data's DEFAULT trigger.
// - S2 赤霄·拔刀 (MANUAL, attack SP, 技能范围 3-12, data SKILL_RANGE): at once, up to max_target enemies of the skill range —
//   flyers too (PRTS 备注 可对空) — each take atk_scale × ATK arts, then atk_scale × ATK physical (PRTS: 先法术后物理);
//   the official target order (blocked first, then nearest the goal). Its range never becomes her attack range.
// - S3 赤霄·绝影 (MANUAL, attack SP, 技能范围 x-1, data SKILL_RANGE): she seeks the nearest ground enemy of the skill range
//   and slashes it `times` (10) times for atk_scale × ATK physical each, the last stunning it `stun` s; a target that falls
//   or leaves is replaced by the next nearest; with no target left in the skill range the skill ends at once (PRTS 备注).
//   The slashes fall at her skeleton's Skill_3 OnAttack times (0.6 … 2.2 s every 0.2 s, then 2.833 s) and the skill lasts
//   the clip (2.933 s) [ASSUMED: the first ten of its eleven OnAttack events are the ten slashes, the eleventh marks the
//   clip's end]. Meanwhile (PRTS 备注): 无敌 (flag invulnerable), 无法阻挡 (noBlock: her blocked enemies walk on), stun and
//   freeze immunity, no normal attack. Ground only (不可对空): no flyer, no levitated enemy is slashed. The skill cannot be
//   opened while its range holds no ground enemy at all [ASSUMED: PRTS 艾丽妮 S3's 备注 "技能范围内仅存在飞行单位时，该技能
//   也可开启" marks the opposite as the rule for a skill that strikes ground enemies only; the strategy's SKILL_RANGE still
//   counts unselectable ones, "无视其不可选中", so a stealthed ground enemy alone opens it and it ends with nobody to cut].

import { num, talentBb, traitBb, moduleOn, skillRec, statBuff, giveSp, onHitBy } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_chen_1';
const S2 = 'skchr_chen_2';
const S3 = 'skchr_chen_3';
/** char_010_chen.skel (front) Skill_3: the slashes' OnAttack times from the cast (s) and the clip's length. */
const S3_SLASH_AT = Object.freeze([0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 1.8, 2.0, 2.2, 2.833]);
const S3_CLIP = 2.933;
/** The skill ranges when a record carries none (data: 3-12 and x-1). */
const R3_12 = Object.freeze([[1, 0], [1, 1], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-1, 1]]);
const X_1 = Object.freeze([[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]]);
const AIR = Object.freeze({ canHitFly: true });
const GROUND = Object.freeze({ canHitFly: false });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** The module the record fights with (its active one), or null. */
function activeModule(chess) {
  if (!moduleOn(chess)) return null;
  return (chess.modules ?? []).find((m) => m && m.uniEquipId === chess.module.id) ?? null;
}
/** Absolute tile keys of a skill range at the unit's tile and facing (a 技能范围 ignores 攻击距离: no extend). */
const keysOf = (unit, grid) => absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);

/**
 * A skill that strikes ground enemies only cannot be opened while its range holds no ground enemy: every activation path
 * (the strategy's SKILL_RANGE, content) is refused and the charge stays — the pattern of 莎草 S2 (ops/chess_char_2_06-papyrs.js,
 * non-enumerable: never serialised).
 */
function guardActivation(battle, unit, grid) {
  const sk = unit.skill;
  if (!sk || Object.prototype.hasOwnProperty.call(sk, 'activate')) return;
  const activate = sk.activate;
  const ok = () => battle.unitsInGrid(unit, grid, { side: 'enemy' }).some((e) => !e.isFlying);
  Object.defineProperty(sk, 'activate', {
    configurable: true, writable: true, enumerable: false,
    value(reason, opts) { return ok() ? activate.call(this, reason, opts) : false; },
  });
}

export default {
  char_010_chen: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const mod = activeModule(chess);
    // SWO-X stage 3 "自身额外回复1点技力": the hidden part of the 呵斥 change (its own interval / sp)
    const self0 = mod?.talentChanges?.find((t) => t && t.talentIndex === 0 && t.hidden)?.bb ?? {};
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const grid2 = s2?.rangeGrid ?? R3_12, grid3 = s3?.rangeGrid ?? X_1;
    const times3 = Math.min(S3_SLASH_AT.length, Math.max(1, Math.floor(num(b3.times, 10))));

    /** S3: the slash target — the current one while it stays a ground target of the skill range, else the nearest. */
    const slashTarget = (battle, unit, m) => {
      const list = battle.enemiesInKeys(keysOf(unit, grid3), unit, GROUND);
      if (m.target && list.includes(m.target)) return m.target;
      if (!list.length) return null;
      sortEnemyTargets(battle, unit, list, 'nearest');
      m.target = list[0];
      return m.target;
    };

    return {
      skills: {
        [S1]: {
          kind: num(skillRec(chess, S1)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 1),
            hits: 1, // one sheath strike (Skill clip: one OnAttack), not the trait's two
            onHit({ battle, unit, target }) {
              if (target && target.alive && target.side === 'enemy' && num(b1.stun) > 0) battle.applyStatus(target, 'stun', { duration: num(b1.stun), source: unit });
            },
          },
        },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          // 白铁's 铁钳号·原型机 (a registered ally target) is drawn on like an enemy, after every enemy (嘲讽等级 −2) — the
          // owner's rule of 2026-10-08; its kit cancels the hits [ASSUMED] (skills.js allyTargetsOk)
          allyTargets: true,
          onStart({ battle, unit }) {
            const list = battle.enemiesInKeys(keysOf(unit, grid2), unit, AIR);
            sortEnemyTargets(battle, unit, list, null);
            list.push(...battle.allyTargetsInKeys(keysOf(unit, grid2), unit));
            const v = list.slice(0, Math.max(1, Math.floor(num(b2.max_target, 1))));
            battle.fx('slash', { x: unit.x, y: unit.y, id: unit.id, n: v.length, skill: 'chen:draw' });
            const amount = () => unit.s.atk * num(b2.atk_scale, 1);
            for (const e of v) {
              // "先造成法术伤害，后造成物理伤害" (PRTS 备注)
              battle.dealDamage(unit, e, { amount: amount(), type: 'arts', isSkill: true, tags: ['skill'] });
              if (e.alive) battle.dealDamage(unit, e, { amount: amount(), type: 'phys', isSkill: true, tags: ['skill'] });
            }
          },
        },
        [S3]: {
          kind: 'duration',
          duration: S3_CLIP,
          flags: { invulnerable: true, noBlock: true },
          attack: { noAttack: true },
          // [ASSUMED] its slashes and its guard (guardActivation) take ground enemies only: 白铁's 铁钳号 alone does not open
          // it (skills.js allyTargetsOk) — the skill ends at once without a target
          allyTargets: false,
          onStart({ battle, unit }) {
            battle.releaseBlocked(unit); // 无法阻挡
            unit.mem.chenS3 = { t: 0, n: 0, target: null };
            battle.fx('blink', { x: unit.x, y: unit.y, id: unit.id, skill: 'chen:shadowless' });
          },
          onTick({ battle, unit, skill, dt }) {
            const m = unit.mem.chenS3;
            if (!m) return;
            m.t += dt;
            // "若斩击次数未到10次之前技能范围内没有目标，立刻中止技能" (after the last slash the clip runs out)
            if (m.n < times3 && !slashTarget(battle, unit, m)) { skill.end('noTarget'); return; }
            while (m.n < times3 && m.t + 1e-9 >= S3_SLASH_AT[m.n]) { // loop-cap: fixed slash-time table
              const e = slashTarget(battle, unit, m);
              if (!e) { skill.end('noTarget'); return; }
              m.n++;
              battle.fx('slash', { x: e.x, y: e.y, id: unit.id, n: 1, skill: 'chen:shadowless' });
              battle.dealDamage(unit, e, { amount: unit.s.atk * num(b3.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'slash'] });
              if (m.n === times3 && e.alive && num(b3.stun) > 0) battle.applyStatus(e, 'stun', { duration: num(b3.stun), source: unit });
              if (!unit.alive || !skill.active) return;
            }
          },
          onEnd({ unit }) { unit.mem.chenS3 = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 呵斥: every `interval` s on the field, +sp attack / hurt SP to every ally; SWO-X stage 3: +1 more for her
          const iv = num(t0.interval), sp = num(t0.sp);
          const selfIv = num(self0.interval, iv), selfSp = num(self0.sp);
          if (!(iv > 0) || !(sp > 0)) return;
          const mates = (b) => b.alliesFor(unit).filter((a) => a.skill && !a.skill.noSkill && (a.skill.spType === 'attack' || a.skill.spType === 'hurt'));
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            const seq = unit.deploySeq;
            const here = () => unit.alive && unit.deployed && unit.deploySeq === seq;
            battle.every(iv, (b, sc) => {
              if (!here()) { sc.cancel(); return; }
              for (const a of mates(b)) giveSp(a, sp);
            }, { owner: unit });
            if (selfSp > 0 && selfIv > 0) {
              battle.every(selfIv, (b, sc) => {
                if (!here()) { sc.cancel(); return; }
                giveSp(unit, selfSp);
              }, { owner: unit });
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 持刀格斗术: ATK / DEF / 物理闪避 (SWO-Y stage 3: the module numbers)
          statBuff(battle, unit, 'talent:chen:knife', { atkPct: num(t1.atk), defPct: num(t1.def), dodgePhys: num(t1.prob) });
        } },
      ],
      install(battle, unit) {
        // SWO-Y “往昔时光”: 攻击时无视敌人70点的防御力
        statBuff(battle, unit, 'trait:chen:pierce', { defIgnoreFlat: num(tb.def_penetrate_fixed) });
        // SWO-X “罗德岛制式剑”: 技能期间造成的伤害提升10% (PRTS 修正)
        const skillMul = num(tb.damage_scale, 1);
        if (skillMul !== 1) onHitBy(battle, unit, ({ dmg }) => { if (dmg.isSkill || unit.skill?.active) dmg.mul *= skillMul; });
        // S3: 眩晕免疫, 冻结免疫 while the slashes run
        battle.on('beforeStatus', (c) => {
          if (c.target === unit && unit.mem.chenS3 && (c.status === 'stun' || c.status === 'freeze')) c.cancel = true;
        }, { owner: unit });
        if (unit.skill?.id === S3) guardActivation(battle, unit, grid3);
      },
    };
  },
};
