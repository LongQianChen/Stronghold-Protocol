// server/sim/content/kits/ops/op-monstr.js — Mon3tr (char_4179_monstr) 自选 operator kit: 6★ 链愈师 (医疗), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module (XAH-X 记忆存档) at every form, and the
// kit of her summon 重构体 (token_10050_monstr_prosts). Kit contract and the 自选 rules: ../README.md ("How to add an operator
// (自选)").
//
// Forms (data/backups.json units.char_4179_monstr): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// XAH-X at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json); PRTS Mon3tr
// (T1 备注 "治疗效果无视禁疗，但对象选取受禁疗制约，可以强行选择自身的重构体作为自身普通攻击的治疗目标", "攻击力加成效果同名效果取最高";
// T2 备注 "该效果重复触发刷新持续时间，不会因自身退场而消失"; S1 备注 "技能范围与技能期间治疗范围无关"; S2 备注 "可选择满生命值的重构体
// 进行治疗；重构体受到Mon3tr普通攻击治疗的0.6s后，Mon3tr再次以重构体为目标进行一次跳跃治疗", "仅技能期间治疗触发的第二天赋效果提升；
// …叠加时取最高"; S3 备注: the start (撤退重构体, 【移动】, the 路标形态 marker), 不死 ("期间受到致命伤害结算后立即结束技能；技能结束后
// 返回…以不高于1点的生命值在场；因返回而部署时获得1s不死"), "期间对自身进行治疗时，治疗跳跃不会衰减且不占用跳跃数", the return); PRTS
// 重构体 (备注 "持有禁疗（可以被Mon3tr无视）、不可阻挡", "嘲讽等级-1", "Mon3tr因移动之外的原因退场时强制撤退场上的重构体", 通常形态
// "阻挡数强制归0，每0.1s流失8生命值…退场时返还1个可部署的重构体"); PRTS 卫戍协议/帮助 (§战斗部署 placed summons, §作战阶段
// "若召唤物在战斗期间退场，将在满足条件后立即原地再部署1个"); the client's battle data: charpack char_4179_monstr (attacks
// `_ignoreHealFree`; talent "1" monstr_t_1[born_charge] / [die_to_kil_token]; talent "2" monstr_t_2[atk_spd], scaled in the S2
// mode by `_applyTalentScale` on attack_speed; modes S3_Reborn (Combat / Attack: PURE, targetMotion 1, `_maxNum` 3
// `_limitedMaxTargetNumToBlockedCnt`; ExtraHeal projectile_chr_monstr_s3 on every attack; talents monstr[free_jump],
// monstr_s_3[bleeding] (damage_per_second × 0.1 every 0.1 s), [reborned_passive], [sync_hp]); `_config` mapping S3's atk /
// damage_per_second / max_hp / block_cnt / base_attack_time and T1's attack@chain.extra_cnt); the skill prefabs (skchr_monstr_1
// next heal; skchr_monstr_2 its attack's activeBuff monstr_s_2[proj] lifeTime 0.6 → projectile_chr_monstr_s2_extra from the
// reconstruct; skchr_monstr_3 `_onlyAvailableWhenTokenValid`, the Respawn / RespawnEnd abilities, monstr_s_3[end_undeadable_
// restore] 1 s); the projectile prefabs (every heal projectile: `_atkScale` 0.75 = chain.atk_scale, the jump Selector
// `_rangeId` x-4 `_maxTarget` 3 lowest HP ratio `_useAdditionalTargetCount`, `_freeJumpValidator` monstr[free_jump]); the
// reconstruct's prefab (monstr[block_free] abnormal [3, 7] + taunt_level −1; prosts[atk_up] aura from the host's `atk`;
// prosts_t_1[born_charge] BLOCK_CNT ×0, interval 0.1, firstTriggerInterval 1, FixedValueDamage PURE `damage` on itself);
// buff_template_data (monstr_t_2[atk_spd] ON_OUTPUT_MODIFIER IsHeal; monstr_s_3[undead] ON_BEFORE_TRY_SET_HP_ZERO).
// - Trait (链愈师) "恢复友方单位生命，且会在3个友方单位间跳跃，每次跳跃治疗量降低25%" — the chain is this kit's (the profession's
//   chain is replaced: heal mode single + `chainFrom`, its links the profession's — ai.js chainHealNext): after the heal on
//   the main target the heal jumps to the lowest-HP-ratio ally (a full-HP one too — PRTS 分支特性信息 链愈师; ties: the latest
//   deployed) of the 3×3 around the last one healed (x-4), each jump ×
//   attack@chain.atk_scale (0.75; XAH-X 0.85), up to attack@chain.max_target units healed (3). A 重构体 (and she herself while S3
//   runs: monstr[free_jump]) is a free link: healing it uses no target of the count and the next jump does not decay (XAH-X
//   stage 3: the next attack@chain.extra_cnt jumps after that neither). Her heals pass 禁疗 ("治疗效果无视禁疗"); her selection
//   takes her own 重构体 through its 禁疗 (`healThrough`), no other 禁疗 unit [ASSUMED: the jumps too].
// - Module XAH-X 记忆存档: the trait's 0.85 per jump (traitOverride); stage 3 changes T1 (below); ATK / DEF from the attributes.
// - T1 自我修复 (cnt 1): her 重构体 is a hand piece the player places (the talent's summon) on a ground tile of her attack
//   range — "可以在攻击范围内的地面使用": the data's `ownerRange` from that talent text (tools/build-data.mjs summonRecord,
//   0.2.0 WE2) and its MELEE position, enforced by the match. Its kit: 禁疗 (only her heals reach it), blocks nothing, taunt
//   −1, loses 8 HP every 0.1 s from 1 s after it lands (流失, Battle.loseHp — PRTS "每0.1s流失8生命值"; trait damage_per_second
//   80); every ally of its
//   3×3 but itself (no 孤立 one) ATK +atk (0.2; XAH-X stage 3 0.3; 同名效果取最高). Gone (destroyed or withdrawn) ⇒ back on its
//   tile its redeploy time (15 s) after, paying its cost (3 DP), only while she stands — her deployment (not a 【移动】)
//   readies a waiting one at once (monstr_t_1[born_charge]) [ASSUMED: the 卫戍 auto redeploy of a placed summon, as 凯尔希's
//   Mon3tr]; withdrawn when she leaves the field (not on her S3 moves).
// - T2 战术协同: every heal of hers (chain jumps included) gives its target and herself ASPD +attack_speed for buff_duration s —
//   ×talent_scale (S2) for a heal made while S2 runs; one effect per unit, the strongest (同名效果取最高 — a weaker one that
//   outlasts it resumes afterwards: Battle.applyStrongest); a new one refreshes it.
// - S1 策略：超压链接 (AUTO, attack SP, data DEFAULT — a "next heal" waits for her heal, as 闪灵's S2): that heal is heal_scale ×
//   ATK and heals up to chain.max_target (4) units.
// - S2 策略：超负荷 (MANUAL, data SKILL_RANGE on its y-2 — an enemy there; 30 s): her own 重构体 inside her range is her heal
//   target, even at full HP (with nobody injured she heals it all the same: Battle.forceAttack); 0.6 s after each heal of her
//   attack on it a second chain heal starts on it (her ATK × 1); T2 ×talent_scale.
// - S3 策略：熔毁 (MANUAL, data DEFAULT, 25 s; only while her 重构体 stands — the cast is refused otherwise): the 重构体 is withdrawn
//   (its piece waits: back once its tile is free again) and she 【移动】s onto its tile; meanwhile range x-4, ATK +atk, base attack
//   time base_attack_time (a flat −1.5 s on 2.85 s), block +block_cnt, max HP +max_hp (the HP ratio kept), 流失 of
//   damage_per_second HP/s (8 every 0.1 s); "同时攻击阻挡的所有敌人" (her selector's _limitedMaxTargetNumToBlockedCnt): each attack
//   takes up to her block count of ground enemies of her range, the blocked ones first (ai.js `hitAllBlocked`, the 强攻手 rule
//   of PRTS 分支特性信息) for ATK true damage, and each attack starts a chain heal on herself at attack@heal_scale × ATK
//   (she is a free link). 不死: a hit or 流失 that would knock her out leaves her at 1 HP, untargetable and blocking nothing, and
//   the skill ends on the next tick. At the end she 【返回】s to the tile she left (her SP emptied; the max HP drop keeps the ratio,
//   so after a fatal blow she stands at ≤ 1 HP) with 1 s of 不死. The 路标形态 marker on her tile is not modelled: should another
//   unit stand there, she stays where she is [ASSUMED; officially she is knocked out].

import { num, talentBb, traitBb, skillRec, batMod, installAura, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { chainHealNext } from '../../../ai.js';

const S1 = 'skchr_monstr_1';
const S2 = 'skchr_monstr_2';
const S3 = 'skchr_monstr_3';
/** Her summon 重构体 (T1). */
export const PROSTS = 'token_10050_monstr_prosts';
/** S2: the second chain starts this long after a heal of hers on her 重构体 (monstr_s_2[proj] lifeTime). */
const S2_EXTRA_DELAY = 0.6;
/** The 重构体's 流失: every 0.1 s, from 1 s after it lands (prosts_t_1[born_charge] interval / firstTriggerInterval). */
const PROSTS_BLEED_IV = 0.1;
const PROSTS_BLEED_FIRST = 1;
/** The 重构体's ATK aura refresh [ASSUMED: the aura's interval is not in the data]. */
const PROSTS_AURA_IV = 0.1;
/** S3's 流失 period (monstr_s_3[bleeding] interval). */
const S3_BLEED_IV = 0.1;
/** S3: 不死 after the return (monstr_s_3[end_undeadable_restore] lifeTime). */
const RETURN_UNDEAD = 1;
/** How often a waiting 重构体 tries to come back once ready. */
const RETRY = 0.1;

const T2_KEY = 'talent:monstr:aspd';
const PROSTS_ATK_KEY = 'talent:monstr:prostsAtk';
const PROSTS_ABN_KEY = 'monstr:prosts:abnormal';
const S3_UNDEAD_KEY = 'skill:monstr:undead';
const TAG_PROSTS_BLEED = 'monstr:prostsBleed';
const TAG_S3_BLEED = 'monstr:meltdownBleed';
/** Her heals "无视禁疗" (every heal ability of hers: `_ignoreHealFree`). */
const HEAL_OPTS = Object.freeze({ ignoreHealFree: true });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
const isProstsOf = (t, unit) => !!t && t.kind === 'token' && t.defId === PROSTS && t.ownerUnit === unit;
const prostsOf = (battle, unit) => battle.allyUnits.filter((t) => isProstsOf(t, unit));
/** Her 重构体 standing inside her current attack range. */
const prostsInRange = (battle, unit) => prostsOf(battle, unit).find((t) => up(t) && !!unit.rangeKeySet && unit.rangeKeySet.has(t.tileR * COLS + t.tileC)) ?? null;
/** `a` stands on the 3×3 around `b` (x-4: a heal jump's reach, the 重构体's aura). */
const nearX4 = (a, b) => Math.abs(a.tileR - b.tileR) <= 1 && Math.abs(a.tileC - b.tileC) <= 1;

/**
 * A chain heal of hers from `main` (already healed by her attack when `mainDone`): up to `count` units healed, × `step` per
 * jump; a free link (her 重构体; herself with `selfFree`) uses no target of the count and the next 1 + `extra` jumps keep the
 * amount. Each link is the 链愈师 one (ai.js chainHealNext — the 3×3 around the last one healed, the lowest HP ratio a
 * full-HP ally included, then the latest deployed; no 禁疗 unit but her 重构体, her `healThrough`).
 */
function chainFrom(battle, unit, main, base, { count, step, extra, mainDone = false, selfFree = false }) {
  const free = (t) => isProstsOf(t, unit) || (selfFree && t === unit);
  let amount = base;
  if (!mainDone) battle.heal(unit, main, amount, HEAL_OPTS);
  let counted = free(main) ? 0 : 1;
  let calm = free(main) ? 1 + extra : 0;
  const seen = new Set([main.id]);
  let cur = main;
  while (counted < count) { // loop-cap: chain stops when the next ally is missing
    const next = chainHealNext(battle, unit, cur, seen);
    if (!next) break;
    seen.add(next.id);
    if (calm > 0) calm--; else amount *= step;
    battle._ev(['atk', cur.id, next.id, 'chainHeal']);
    battle.heal(unit, next, amount, HEAL_OPTS);
    if (free(next)) calm = 1 + extra; else counted++;
    cur = next;
  }
}

/** The 重构体's kit (owner = Mon3tr): 禁疗, no block, taunt −1, its 流失, the ATK aura, its return. */
function prostsKit(owner, { atk }) {
  return {
    skill: null,
    talents: [],
    trait: { noAttack: true },
    install(battle, t) {
      const dps = num(t.def?.traitBb?.damage_per_second, 80);
      battle.addBuff(t, { key: PROSTS_ABN_KEY, flags: { noHeal: true, noBlock: true }, mods: { taunt: -1 }, persist: true, allowDead: true });
      if (atk > 0) installAura(battle, t, { key: PROSTS_ATK_KEY, select: (a) => a !== t && nearX4(a, t), mods: { atkPct: atk }, value: atk, interval: PROSTS_AURA_IV });
      battle.on('deploy', (c) => {
        if (c.unit !== t) return;
        const seq = t.deploySeq;
        battle.after(PROSTS_BLEED_FIRST, () => {
          if (t.deploySeq !== seq || !up(t)) return;
          battle.every(PROSTS_BLEED_IV, (b, sched) => {
            if (t.deploySeq !== seq || !up(t)) { sched.cancel(); return; }
            b.loseHp(t, dps * PROSTS_BLEED_IV, { source: t, tags: [TAG_PROSTS_BLEED] });
          }, { owner: t, immediate: true });
        }, { owner: t });
      }, { owner: t });
      // gone (destroyed or withdrawn): the piece stays and comes back on its tile once ready, while she stands
      battle.on('death', (c) => {
        if (c.unit !== t || battle.finished) return;
        t.removed = false;
        t.mem.readyAt = battle.time + Math.max(0, num(t.base.respawnTime));
        if (t.mem.retry) return;
        t.mem.retry = battle.every(RETRY, (b, sched) => {
          const stop = () => { sched.cancel(); t.mem.retry = null; };
          if (t.alive || t.removed || b.finished) { stop(); return; }
          if (!up(owner) || b.time + 1e-9 < t.mem.readyAt) return;
          if (b.redeploy(t, { free: false })) stop();
        }, { owner: t });
      }, { owner: t, priority: -10 });
    },
  };
}

/** S2: with nobody injured in her range she heals her 重构体 there all the same ("可选择满生命值的重构体进行治疗"). */
function s2CanAttack(battle, unit) {
  const r = prostsInRange(battle, unit);
  if (!r || battle.injuredAlliesInKeys(unit.rangeKeys, unit).length) return true;
  if (battle.forceAttack(unit, [r])) unit.atkCd = Math.max(unit.atkCd, unit.s.interval);
  return false;
}

export default {
  char_4179_monstr: (bb, chess) => {
    const tb = traitBb(chess);       // attack@chain.max_target (3), attack@chain.atk_scale (0.75; XAH-X 0.85)
    const t0 = talentBb(chess, 0);   // 自我修复: cnt, atk (XAH-X stage 3: 0.3 + attack@chain.extra_cnt 1)
    const t1 = talentBb(chess, 1);   // 战术协同: buff_duration, attack_speed
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1), s3 = skillRec(chess, S3);
    const chain = {
      count: Math.max(1, Math.floor(num(tb['attack@chain.max_target'], 3))),
      step: num(tb['attack@chain.atk_scale'], 0.75),
      extra: Math.max(0, Math.floor(num(t0['attack@chain.extra_cnt']))),
    };
    const s1Count = Math.max(1, Math.floor(num(b1['chain.max_target'], chain.count)));
    const picked = chess?.skill?.skillId ?? null;
    return {
      // the chain is chainFrom's (heal mode single: no profession chain); her 重构体 is selectable through its 禁疗
      trait: { heal: { mode: 'single' }, healThrough: (healer, a) => isProstsOf(a, healer) },
      skills: {
        [S1]: { kind: num(s1?.maxChargeTime, 1) > 1 ? 'charges' : 'instant', attack: { healScale: num(b1.heal_scale, 1) } },
        [S2]: { kind: 'duration', attack: { canAttack: (battle, unit) => s2CanAttack(battle, unit) } },
        [S3]: {
          kind: 'duration',
          mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess), blockCnt: num(b3.block_cnt), hpFlat: num(b3.max_hp) },
          targeting: s3?.rangeGrid ? { rangeGrid: s3.rangeGrid } : undefined,
          attack: { dmgType: 'true', attack: 'melee', projectile: 'none', canHitFly: false, groundOnly: true, hitAllBlocked: true },
          onStart({ battle, unit, skill }) {
            const r = prostsOf(battle, unit).find(up);
            if (!r) { skill.end('noToken'); skill.addCharge(1); return; }   // (refused before: the activate guard)
            const home = { r: unit.tileR, c: unit.tileC, dir: unit.dir };
            const to = [r.tileR, r.tileC];
            battle.retreat(r, { reason: 'retreat', permanent: true });   // 撤退场上的重构体（返回待部署区）
            const fromX = unit.x, fromY = unit.y;
            if (!battle.moveRedeploy(unit, to[0], to[1])) { skill.end('blocked'); skill.addCharge(1); return; }   // 强制结束技能并返还技力
            unit.mem.mHome = home;
            battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
          },
          onTick({ unit, skill }) { if (unit.mem.mFatal) skill.end('fatal'); },   // 受到致命伤害结算后立即结束技能
          onEnd({ battle, unit }) {
            const h = unit.mem.mHome;
            unit.mem.mHome = null;
            unit.mem.mFatal = false;
            battle.removeBuff(unit, S3_UNDEAD_KEY);
            if (!h || !unit.alive || !unit.deployed) return;
            // 【返回】 to the tile she left: SP emptied (S3_Restore ModifySp −100 %), 1 s 不死
            const fromX = unit.x, fromY = unit.y, dir0 = unit.dir;
            unit.dir = h.dir;
            if (battle.moveRedeploy(unit, h.r, h.c, { clearSp: true })) battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
            else unit.dir = dir0;
            unit.mem.mUndeadUntil = battle.time + RETURN_UNDEAD;
          },
        },
      },
      talents: [
        { install(battle, unit) { // 自我修复: her pieces run the 重构体's kit; withdrawn when she leaves; readied by her deployment
          for (const t of battle.allyUnits) {
            if (!isProstsOf(t, unit) || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, prostsKit(unit, { atk: num(t0.atk) }));
          }
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            for (const t of prostsOf(battle, unit)) if (t.alive) battle.retreat(t, { reason: 'retreat', permanent: true });
          }, { owner: unit });
          battle.on('deploy', (c) => {
            if (c.unit !== unit || c.move) return;
            for (const t of prostsOf(battle, unit)) if (!t.alive && !t.removed) t.mem.readyAt = battle.time;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 战术协同: every heal of hers ⇒ target and herself ASPD + (×talent_scale under S2)
          const d = num(t1.buff_duration), v0 = num(t1.attack_speed);
          if (!(d > 0) || !(v0 > 0)) return;
          battle.on('heal', (c) => {
            if (c.source !== unit || c.opts?.regen || !c.target || c.target.side !== 'ally' || !(c.amount > 0)) return;
            const v = v0 * (skillOn(unit, S2) ? num(b2.talent_scale, 1) : 1);
            const give = (x) => battle.applyStrongest(x, T2_KEY, { duration: d, value: v, mods: (a) => ({ aspd: a }), source: unit });
            give(c.target);
            if (c.target !== unit && unit.alive) give(unit);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // the chain heals: after each heal attack of hers a chain from its target(s); under S3 every attack starts one on her
        battle.on('attack', (c) => {
          if (c.attacker !== unit || !unit.alive) return;
          const prof = battle.effectiveProfile(unit);
          if (prof.heal && prof.dmgType === 'heal') {
            const sk = unit.skill;
            const s1on = !!(sk && sk.id === S1 && sk.active && sk.pending);
            const s2on = skillOn(unit, S2);
            const base = unit.s.atk * (prof.atkScale ?? 1) * (prof.healScale ?? 1) * unit.s.atkScaleMul;
            for (const t of c.targets || []) {
              if (!t || t.side !== 'ally') continue;
              chainFrom(battle, unit, t, base, { ...chain, count: s1on ? s1Count : chain.count, mainDone: true });
              // S2: 0.6 s after her attack healed her 重构体, a second chain on it (her ATK × 1)
              if (s2on && isProstsOf(t, unit)) {
                battle.after(S2_EXTRA_DELAY, () => {
                  if (!unit.alive || !up(t)) return;
                  chainFrom(battle, unit, t, unit.s.atk * unit.s.atkScaleMul, chain);
                }, { owner: unit });
              }
            }
          } else if (skillOn(unit, S3) && unit.mem.mHome && !unit.mem.mFatal) {
            chainFrom(battle, unit, unit, unit.s.atk * num(b3['attack@heal_scale'], 0.5) * unit.s.atkScaleMul, { ...chain, selfFree: true });
          }
        }, { owner: unit });
        // S2: her 重构体 inside her range is the heal target
        if (picked === S2) {
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !skillOn(unit, S2) || !c.profile || c.profile.dmgType !== 'heal') return;
            const r = prostsInRange(battle, unit);
            if (r) c.targets = [r];
          }, { owner: unit, priority: 10 });
        }
        if (picked !== S3) return;
        // S3 `_onlyAvailableWhenTokenValid`: every activation path is refused while her 重构体 is not on the field
        const sk = unit.skill;
        if (sk && sk.id === S3 && !Object.prototype.hasOwnProperty.call(sk, 'activate')) {
          const activate = sk.activate;
          Object.defineProperty(sk, 'activate', {
            configurable: true, writable: true, enumerable: false,
            value(reason, opts) { return prostsOf(battle, unit).some(up) ? activate.call(this, reason, opts) : false; },
          });
        }
        // S3's 流失
        battle.every(S3_BLEED_IV, () => {
          if (!skillOn(unit, S3) || !unit.mem.mHome || unit.mem.mFatal || !up(unit)) return;
          battle.loseHp(unit, num(b3.damage_per_second) * S3_BLEED_IV, { source: unit, tags: [TAG_S3_BLEED] });
        }, { owner: unit });
        // S3 不死; the 1 s 不死 after the return
        battle.on('fatal', (c) => {
          if (c.unit !== unit) return;
          if (skillOn(unit, S3) && unit.mem.mHome) {
            c.prevented = true;
            if (!unit.mem.mFatal) {
              unit.mem.mFatal = true;
              battle.addBuff(unit, { key: S3_UNDEAD_KEY, flags: { untargetable: true, noBlock: true }, tags: ['skill'] });
              battle.releaseBlocked(unit);
              battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
            }
            return;
          }
          if (battle.time < num(unit.mem.mUndeadUntil, -Infinity) - 1e-9) c.prevented = true;
        }, { owner: unit, priority: 10 });
      },
    };
  },
};
