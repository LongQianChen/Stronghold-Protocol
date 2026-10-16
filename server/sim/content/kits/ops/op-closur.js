// server/sim/content/kits/ops/op-closur.js — 可露希尔 (char_4228_closur) 自选 operator kit: 6★ 战术家 (先锋), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, the module TAC-X 给自己的小奖杯 at every form, and the
// kit of her 援军 指挥中心 (token_10066_closur_ourbase). Kit contract and the 自选 rules: ../README.md ("How to add an operator
// (自选)").
//
// Forms (data/backups.json units.char_4228_closur): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07). Sources:
// character_table / skill_table / battle_equip_table / the token's character_table row (zh_CN, as built into backups.json),
// PRTS 可露希尔 (精准投放 备注 "战术点对位于战术点攻击范围内的所有我方干员/召唤物付与可露希尔的援军标记…在攻击这些单位阻挡的敌人时同样
// 可以触发特性效果"; S1 备注 "回费间隔 = 持续时间 / 回费量，首次回费间隔为计算所得的回费间隔的一半"; S2 备注 "2秒固定间隔回复费用",
// the 【返费】 "回复干员当前部署费用属性的40%（向上取整）", "上一次撤退/离场的原因为移动…不会生效"; S3 备注 "1.66秒的固定间隔", "攻击
// 范围变为自身攻击范围+战术点的攻击范围+所有“援军”视野范围的复合范围", "能攻击到自身援军阻挡的敌人", "仅能对敌人类敌方单位施加迟钝"),
// PRTS 指挥中心 (备注: 持有禁疗; 对攻击范围内的所有我方干员/召唤物施加援军标记; x-5 / x-4 / x-6 by her skill; 撤退或被击倒 ⇒ 战术点
// 形态; 持有者离场后强制撤退), PRTS 分支特性信息 战术家, PRTS 术语释义 护盾 / 迟钝 / 部署费用下限, and the client's battle data read
// from the local install — charpack char_4228_closur (trait closur_tr; T2 deck buff closur_t_2[atk] ATK MULTIPLIER on the
// filterTag rhodes cards with `_minCostExtremeSetting`; S2 / S3 selectors: her range + the enemies blocked by a closur_friend
// holder; S3's attack buff closur[slow_down]: overrideType, refreshRemainingTimeWhenStackMax, clearAllStackCntWhenTimeUp),
// the token prefab token_10066_closur_ourbase (modes S1 / S2 / S3: closur_ourbase_aura on ground allies, operators and
// summons (professionMask 767), itself too; closur_passive with 禁疗 (abnormal flag 7); the 战术点形态 "Recharge" mode:
// 不死 / 无敌, block ×0, back at full HP — closur_ourbase_t_1[listener] / [trigger_switch] / [switch]), the skill prefabs
// skchr_closur_1 (ApplyShield: closur_friend holders, damage_block_once, one layer, `overrideType`) / _2 (ActiveAura:
// closur_s_2[friend] DEF MULTIPLIER + BLOCK_CNT, the born-state refund) / _3, buff_template_data closur_tr (AtkScaleUp vs a
// target blocked by her summon or by a closur_friend holder), closur_e_002_tr (TAC-X DamageScale vs the damage of a unit the
// holder blocks), closur_ourbase_aura (closur_friend from the host), closur_s_1[cost] / [trigger_modify_cost],
// closur_s_2[friend], closur_s_3[data], slow_down.
// - Trait (战术家) "可以在攻击范围内选择一次战术点来召唤援军，自身攻击援军阻挡的敌人时攻击力提升至150%" (trait bb atk_scale): her
//   援军 is the 指挥中心 (T1); her damage on an enemy blocked by one of her 援军 — the 指挥中心, or any ally holding her mark — ×
//   atk_scale (closur_tr; every attack of hers, skill attacks included). Ranged physical, 3-3, hits air (PRTS 分支特性信息 战术家
//   "普通攻击可对空"), blocks 1, ground enemies target her. TAC-X adds "援军受到来自自身阻挡单位的伤害降低15%" (hidden module talent
//   damage_scale 0.85): damage on one of her 援军 from an enemy that 援军 blocks ×damage_scale.
// - 援军 (her mark, closur_friend): while her 指挥中心 stands, it and every ally of its range — operators and summons (the aura's
//   ground-motion targets: every unit of our side), any player's, never a 孤立 one — hold her mark (re-read every tick). Her
//   own tile counts too when the player puts the 指挥中心 next to her [ASSUMED: nothing in the text leaves her out].
// - T1 精准投放 "可以在战术点召唤指挥中心协助作战，其被击败后会在15秒后自动刷新；战术点效果范围随携带技能变化": the 指挥中心 is a hand
//   piece the player places in her range (data ownerRange); her deployment brings it on its tile (deployed early when she comes
//   first in the battle-start deployment, as 伺夜's pack); without a placed piece it is summoned on the tactical point
//   (Battle.findTacticalPoint — tier3 tacticalPoint, the 伺夜 rule). It never attacks (ATK 0), blocks 2, holds 禁疗, and its
//   range is the one of her skill (the variant's bySkill: x-5 / x-4 / x-6 — its passive skill's range here, so the card shows
//   it). Knocked out (or withdrawn) it enters its 战术点形态 — off the fight, its tile kept (伺夜's 狼群 model) — for the token's
//   hidden talent `interval` (15 s), then it is back on its tile at full HP; her leaving the field withdraws it for good (no
//   战术点形态: "持有者离场后强制撤退") and her next deployment brings a new one.
// - T2 极限调度 "携带可露希尔时，部署费用下限降低3，【罗德岛】干员攻击力+4%" (full potential: 降低4; bb cost / atk; TAC-X stage 3:
//   −6 / +8 %): from the battle start every operator of her player whose nation is 罗德岛 (character_table nationId rhodes —
//   the client's filterTag) ATK +atk for the whole battle (a deck buff: on the field or not, herself included). The
//   部署费用下限 has no counterpart here: the sim's deploy costs never go below 0 (the kits' cost cuts stop there) and only the
//   auto-redeploy spends DP [ASSUMED: no effect].
// - S1 递归策略 (AUTO, 8 s): the 援军 of the moment get one 护盾 layer (shieldHits 1, 不叠加: back to one; until used) and she
//   gains n = min(cost + uses × cost_per_add, cost_add_max) DP over the duration — uses = her earlier casts of this deployment —
//   one at a time, every 8 / n s from half that interval. An AUTO skill acting on her side only: it fires as soon as its SP is
//   full (`trigger: 'SP_FULL'`, the owner's AUTO rule, kits/README.md checklist 5).
// - S2 模型扩展 (MANUAL, data SP_FULL — the 战术家 row's ALWAYS; 30 s): +cost DP at once, 15 more one per 2 s; ATK +atk, 2 targets,
//   and the enemies her 援军 block are her targets too (Battle.setExtraRange: their tiles); every 援军 DEF +def (MULTIPLIER =
//   Σpct) and block +block_cnt while it runs; an operator of her player deployed on a tile of the 指挥中心's range meanwhile
//   gives back ceil(cost_return × its deploy cost) DP — not after a 【移动】.
// - S3 Q.E.D. (MANUAL, SP_FULL, 30 s): 18 DP one per 1.66 s; attack interval base_attack_time (a flat −0.5 s on 1.0 s); her range
//   is her own + the 指挥中心's + every 援军's own range (their running grid, not their extra keys — PRTS "仅累加其复合范围中的基础
//   范围") + the tiles of the enemies her 援军 block; every hit attack@atk_scale × ATK physical and one 迟钝 stack of
//   attack@slow_down on an enemy (≤ attack@max_stack_cnt, cap attack@slow_down_max), the stacks sharing one
//   attack@slow_down_time timer; every attack_trigger_cnt attacks one more target (max_trigger_cnt times).
// - 迟钝 (ba.slowdown "移动速度、攻击速度…降低相应比例（同名效果取最高）"; PRTS "移动速度、攻击速度、迟钝乘数均降低相应数值（直接乘算）",
//   "同名同源效果叠加并刷新时间（不超过上限）；不同名/不同源迟钝效果间取当前数值最高"): one 'slowdown' effect per enemy
//   (Battle.applyStrongest) of value v: move speed ×(1 − v) and attack interval ×1 / (1 − v) (ASPD ×(1 − v); the engine has
//   no ASPD Σpct bucket — exact while no other attack-interval change is on). Its effect on enemy ability cooldowns and on the
//   time of resistible statuses is not modelled [ASSUMED].

import { num, talentBb, moduleBb, traitBb, skillRec, batMod, up } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { tacticalPoint } from '../shared/tier3.js';
import { COLS, FORCED_EXIT } from '../../../constants.js';

const S1 = 'skchr_closur_1';
const S2 = 'skchr_closur_2';
const S3 = 'skchr_closur_3';
export const BASE = 'token_10066_closur_ourbase';
/** 精准投放 "其被击败后会在15秒后自动刷新" when the token def carries no interval. */
const REFRESH_FALLBACK = 15;
/** Seconds between two tries of a 指挥中心 whose 战术点形态 is over but whose tile is taken. */
const RETRY = 0.25;
/** Removal reasons that put the 指挥中心 in its 战术点形态 ("撤退或被击倒"); 'expired' = her leaving / the deploy limit. */
const TAC_EXITS = new Set(['killed', 'retreat', FORCED_EXIT]);
export const SHIELD_KEY = 'closur:s1';
export const S2_KEY = 'closur:s2';
export const S3_KEY = 'closur:s3';
export const RHODES_KEY = 'talent:closur:rhodes';
export const SLOWDOWN = 'slowdown';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileKey = (r, c) => r * COLS + c;
/** First talent of a normalised token def holding `key` (token talents keep no index). */
const tokTalent = (def, key) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null) ?? null;

/** 迟钝 v: move speed ×(1 − v), attack interval ×1 / (1 − v). */
const slowMods = (v) => ({ moveMul: Math.max(0, 1 - v), batPct: v < 0.99 ? v / (1 - v) : 99 });

/**
 * One 迟钝 stack of `unit` on enemy `e` (S3): the stacks of one source add up (≤ maxStacks, ≤ cap) and share one timer
 * refreshed by each stack (cleared together when it runs out); the strongest source wins (applyStrongest).
 */
export function slowdownStack(battle, unit, e, { step, maxStacks, cap, duration }) {
  if (!e || !e.alive || e.side !== 'enemy' || e.kind !== 'enemy' || !(step > 0) || !(duration > 0)) return;
  const key = `closurSlow:${unit.id}`;
  const cur = e.mem[key];
  const n = Math.min(Math.max(1, Math.floor(maxStacks) || 1), (cur && cur.until > battle.time + 1e-9 ? cur.n : 0) + 1);
  e.mem[key] = { n, until: battle.time + duration };
  battle.applyStrongest(e, SLOWDOWN, { duration, value: Math.min(cap > 0 ? cap : Infinity, step * n), source: unit, mods: slowMods });
}

/**
 * A skill's DP over time (the client's periodic_cost / closur_s_1[trigger_modify_cost]): `step` DP every `iv` s from
 * `first` s on, `total` in all; a skill that runs its full duration pays the rest at its end.
 */
function dpTicker(unit, { total, step = 1, iv, first = iv }) {
  unit.mem.closurDp = { t: 0, next: first, given: 0, total, step, iv };
}
function dpTick(battle, unit, dt) {
  const d = unit.mem.closurDp;
  if (!d) return;
  const iv = stepOf('interval', d.iv, d.iv);
  const step = stepOf('cost', d.step, d.step);
  if (!(iv > 0) || !(step > 0)) return;
  d.t += dt;
  let guard = 0;
  while (d.t + 1e-9 >= d.next && d.given + step <= d.total + 1e-9 && guard++ < STEP_PER_TICK) { // loop-cap: stepOf interval/cost
    d.given += step;
    d.next += iv;
    battle.addDp(unit.ownerId, step);
  }
}
function dpEnd(battle, unit, reason) {
  const d = unit.mem.closurDp;
  unit.mem.closurDp = null;
  if (!d) return;
  const rest = d.total - d.given;
  if (reason === 'duration' && rest > 1e-9) { battle.addDp(unit.ownerId, rest); d.given += rest; }
  if (d.given > 0) battle.fx('dp', { x: unit.x, y: unit.y, n: d.given, id: unit.id });
}

export default {
  char_4228_closur: (bb, chess) => {
    const t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);            // TAC-X: damage_scale (the 援军's guard)
    const scale = num(traitBb(chess).atk_scale, 1.5);
    const guard = num(hidden.damage_scale, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1);
    const tokenId = (chess?.talents ?? []).find((t) => t && t.tokenKey)?.tokenKey ?? BASE;

    /** Her 指挥中心 units (board pieces and summons). */
    const basesOf = (battle, unit) => battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === tokenId && t.ownerUnit === unit);
    /** Her 援军 now (cached per tick): her standing 指挥中心 and every operator / summon of its range (no 孤立 one). */
    const reinfOf = (battle, unit) => {
      const m = unit.mem;
      if (m.closurReinf && m.closurReinfT === battle.time) return m.closurReinf;
      const set = new Set();
      for (const base of basesOf(battle, unit)) {
        if (!up(base)) continue;
        set.add(base);
        const keys = base.rangeKeySet ?? new Set(base.rangeKeys ?? []);
        for (const a of battle.allyUnits) {
          if (!up(a) || a.hidden || (a.kind !== 'op' && a.kind !== 'token')) continue;
          if (!battle.allySelectable(a, unit) || !keys.has(tileKey(a.tileR, a.tileC))) continue;
          set.add(a);
        }
      }
      m.closurReinf = set;
      m.closurReinfT = battle.time;
      return set;
    };
    /** Tiles of the enemies her 援军 block (S2 / S3: "能攻击到自身援军阻挡的敌人"). */
    const blockedTiles = (battle, unit, reinf) => {
      const keys = [];
      for (const r of reinf) for (const e of r.blocking) if (e.alive && e.blockedBy === r) keys.push(tileKey(Math.round(e.y), Math.round(e.x)));
      return keys;
    };
    const setExtra = (battle, unit, keys) => {
      const cur = unit.extraRangeKeys ?? [];
      const uniq = [...new Set(keys)].sort((a, b) => a - b);
      if (uniq.length === cur.length && uniq.every((k, i) => k === cur[i])) return;
      battle.setExtraRange(unit, uniq.length ? uniq : null);
    };

    /** The 指挥中心's kit: no attack, 禁疗, the range of her skill, its 战术点形态. `def` = its def for her loadout. */
    const baseKit = (owner, def) => {
      const grid = def?.skill?.rangeGrid ?? def?.rangeGrid ?? [[0, 0]];
      const refresh = num(tokTalent(def, 'interval')?.bb?.interval, REFRESH_FALLBACK);
      return {
        skill: { kind: 'passive', targeting: { rangeGrid: grid.map((p) => [p[0], p[1]]) } },
        trait: { noAttack: true },
        talents: [],
        install(battle, t) {
          battle.addBuff(t, { key: 'closur:base', flags: { noHeal: true }, persist: true, allowDead: true });
          // 撤退 / 被击倒 ⇒ 战术点形态: off the fight for `refresh` s, its tile kept, then back at full HP (while she stands)
          battle.on('death', (ctx) => {
            if (ctx.unit !== t || battle.finished || !TAC_EXITS.has(ctx.reason) || !up(owner)) return;
            t.removed = false;
            const seq = (t.mem.closurTacSeq ?? 0) + 1;
            t.mem.closurTacSeq = seq;
            t.mem.closurTac = { seq, until: battle.time + refresh };
            battle.fx('disappear', { x: t.x, y: t.y, id: t.id });
            const back = () => {
              const tp = t.mem.closurTac;
              if (!tp || tp.seq !== seq || battle.finished || t.alive || t.removed) return;
              if (!up(owner)) { t.mem.closurTac = null; return; }
              if (battle.redeploy(t, { free: true })) { t.mem.closurTac = null; battle.fx('summon', { x: t.x, y: t.y, id: t.id, src: owner.id }); return; }
              battle.after(RETRY, back, { owner: t });
            };
            battle.after(refresh, back, { owner: t });
          }, { owner: t, priority: -10 });
        },
      };
    };

    return {
      // the 援军 is the 指挥中心 (T1): no engine generic 援军; ×atk_scale vs an enemy one of her 援军 blocks
      trait: {
        install() {},
        dmgMul(battle, unit, target) {
          const b = target && target.blockedBy;
          return b && reinfOf(battle, unit).has(b) ? scale : 1;
        },
      },
      skills: {
        [S1]: {
          kind: 'duration',
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            const uses = unit.mem.closurS1Uses ?? 0;
            unit.mem.closurS1Uses = uses + 1;
            const n = Math.max(0, Math.min(num(b1.cost_add_max, Infinity), num(b1.cost) + uses * num(b1.cost_per_add)));
            const dur = num(s1?.duration, 8);
            if (n > 0) dpTicker(unit, { total: n, step: 1, iv: dur / n, first: dur / n / 2 });
            const layers = Math.max(1, Math.floor(num(b1.shield_cnt, 1)));
            for (const a of reinfOf(battle, unit)) {
              battle.addBuff(a, { key: `${SHIELD_KEY}:${unit.id}`, shieldHits: layers, source: unit, tags: ['skill'] });
              battle.fx('shield', { x: a.x, y: a.y, id: a.id, src: unit.id });
            }
          },
          onTick({ battle, unit, dt }) { dpTick(battle, unit, dt); },
          onEnd({ battle, unit, reason }) { dpEnd(battle, unit, reason); },
        },
        [S2]: {
          kind: 'duration',
          mods: { atkPct: num(b2.atk) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 2))) },
          onStart({ battle, unit }) {
            const cost = num(b2.cost);
            if (cost > 0) { battle.addDp(unit.ownerId, cost); battle.fx('dp', { x: unit.x, y: unit.y, n: cost, id: unit.id }); }
            dpTicker(unit, { total: num(b2.cost_period), step: num(b2['closur_s_2[add_cost_period].cost'], 1), iv: num(b2['closur_s_2[add_cost_period].interval'], 2) });
            unit.mem.closurS2Set = new Set();
          },
          onTick({ battle, unit, dt }) {
            dpTick(battle, unit, dt);
            // every 援军 DEF +def, block +block_cnt; the enemies they block are her targets
            const reinf = reinfOf(battle, unit);
            const key = `${S2_KEY}:${unit.id}`;
            const had = unit.mem.closurS2Set ?? new Set();
            const mods = { defPct: num(b2.def), blockCnt: num(b2.block_cnt) };
            for (const a of reinf) if (!a.findBuff(key)) battle.addBuff(a, { key, mods, source: unit, tags: ['skill'] });
            for (const a of had) if (!reinf.has(a)) battle.removeBuff(a, key);
            unit.mem.closurS2Set = new Set(reinf);
            setExtra(battle, unit, blockedTiles(battle, unit, reinf));
          },
          onEnd({ battle, unit, reason }) {
            dpEnd(battle, unit, reason);
            for (const a of unit.mem.closurS2Set ?? []) battle.removeBuff(a, `${S2_KEY}:${unit.id}`);
            unit.mem.closurS2Set = null;
            battle.setExtraRange(unit, null);
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { batPct: batMod(b3.base_attack_time, chess) },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1),
            onEachHit({ battle, unit, target }) {
              slowdownStack(battle, unit, target, {
                step: num(b3['attack@slow_down']), maxStacks: num(b3['attack@max_stack_cnt'], 10),
                cap: num(b3['attack@slow_down_max']), duration: num(b3['attack@slow_down_time'], 3),
              });
            },
          },
          onStart({ battle, unit }) {
            dpTicker(unit, { total: num(b3.cost_period), step: num(b3['closur_s_3[add_cost_period].cost'], 1), iv: num(b3['closur_s_3[add_cost_period].interval'], 1.66) });
            unit.mem.closurS3 = { attacks: 0, extra: 0 };
            battle.removeBuff(unit, S3_KEY);
          },
          onAttack({ battle, unit }) {
            const q = unit.mem.closurS3;
            if (!q) return;
            q.attacks++;
            if (q.extra < num(b3.max_trigger_cnt, 6) && q.attacks >= num(b3.attack_trigger_cnt, 9)) {
              q.attacks = 0;
              q.extra++;
              battle.addBuff(unit, { key: S3_KEY, mods: { maxTargets: q.extra }, tags: ['skill'] });
            }
          },
          onTick({ battle, unit, dt }) {
            dpTick(battle, unit, dt);
            // her own range + the 指挥中心's + every 援军's own range + the tiles of the enemies they block
            const reinf = reinfOf(battle, unit);
            const keys = [];
            for (const r of reinf) {
              const extra = r.extraRangeKeys ? new Set(r.extraRangeKeys) : null;
              for (const k of r.rangeKeys ?? []) if (!extra || !extra.has(k)) keys.push(k);
            }
            keys.push(...blockedTiles(battle, unit, reinf));
            setExtra(battle, unit, keys);
          },
          onEnd({ battle, unit, reason }) {
            dpEnd(battle, unit, reason);
            unit.mem.closurS3 = null;
            battle.removeBuff(unit, S3_KEY);
            battle.setExtraRange(unit, null);
          },
        },
      },
      talents: [
        { install(battle, unit) { // 精准投放: the 指挥中心
          // her placed pieces run its kit (set up here, before the battle starts — as 鸿雪's 打字机)
          for (const t of basesOf(battle, unit)) {
            if (t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, baseKit(unit, t.def));
          }
          const summon = () => {
            if (!up(unit)) return;
            const ps = basesOf(battle, unit);
            const live = ps.find((t) => up(t));
            if (live) { unit.trait.reinforcement = live; return; }
            if (ps.some((t) => !t.alive && !t.removed && t.mem.closurTac)) return; // in its 战术点形态: back by itself
            const waiting = ps.find((t) => !t.alive && !t.removed);
            if (waiting && battle.redeploy(waiting, { free: true })) {
              unit.trait.reinforcement = waiting;
              battle.fx('summon', { x: waiting.x, y: waiting.y, id: waiting.id, src: unit.id, token: tokenId });
              return;
            }
            const board = ps.find((t) => t.uid != null);
            const tile = tacticalPoint(battle, unit, board ? [board.homeR, board.homeC] : null);
            if (!tile) return;
            const def = battle.tokenDef(tokenId, unit);
            const t = battle.spawnToken(unit, tokenId, tile[0], tile[1], { kit: baseKit(unit, def) });
            if (!t) return;
            unit.trait.reinforcement = t;
            battle.fx('summon', { x: t.x, y: t.y, id: t.id, src: unit.id, token: tokenId });
          };
          battle.on('deploy', (ctx) => {
            if (ctx.unit === unit) { unit.mem.closurS1Uses = 0; summon(); return; }
            if (ctx.unit.kind === 'token' && ctx.unit.defId === tokenId && ctx.unit.ownerUnit === unit) unit.trait.reinforcement = ctx.unit;
          }, { owner: unit });
          // "持有者离场后强制撤退场上所有的指挥中心" (no 战术点形态); one in its 战术点形态 ends it there and waits for her
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            for (const t of basesOf(battle, unit)) {
              if (t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
              else if (t.mem.closurTac) t.mem.closurTac = null;
            }
            unit.trait.reinforcement = null;
          }, { owner: unit });
          // TAC-X: damage on one of her 援军 from an enemy that 援军 blocks ×damage_scale
          if (guard !== 1) {
            battle.on('hit', (ctx) => {
              const tg = ctx.target, src = ctx.source;
              if (!tg || !src || src.side !== 'enemy' || src.blockedBy !== tg || !up(unit) || !reinfOf(battle, unit).has(tg)) return;
              ctx.dmg.mul *= guard;
            }, { owner: unit });
          }
          // S2: 在战术点效果范围内部署干员时，立即返还部署费用的40%（向上取整） — not after a 【移动】
          if (unit.skill?.id === S2) {
            const ret = num(b2.cost_return);
            battle.on('deploy', (ctx) => {
              const a = ctx.unit;
              if (!(ret > 0) || ctx.initial || ctx.move || !a || a.kind !== 'op' || a.ownerId !== unit.ownerId || a === unit) return;
              if (!unit.skill?.active || unit.skill.id !== S2 || !up(unit)) return;
              const inRange = basesOf(battle, unit).some((t) => up(t) && (t.rangeKeySet ?? new Set(t.rangeKeys)).has(tileKey(a.tileR, a.tileC)));
              if (!inRange) return;
              const back = Math.ceil(num(a.base.cost) * ret - 1e-9);
              if (back > 0) { battle.addDp(unit.ownerId, back); battle.fx('dp', { x: a.x, y: a.y, n: back, id: unit.id }); }
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 极限调度: the 【罗德岛】 operators of her player ATK +atk for the battle (携带可露希尔时)
          const atk = num(t1.atk);
          if (!(atk > 0)) return;
          const give = () => {
            for (const a of battle.allyUnits) {
              if (a.kind !== 'op' || a.ownerId !== unit.ownerId || (a.def?.raw?.nationId ?? a.def?.nationId) !== 'rhodes') continue;
              const cur = a.findBuff(RHODES_KEY);
              if (cur && num(cur.data?.v) >= atk) continue;
              battle.addBuff(a, { key: RHODES_KEY, mods: { atkPct: atk }, persist: true, allowDead: true, data: { v: atk }, source: unit, tags: ['talent'] });
            }
          };
          if (battle.started) give();
          else battle.on('battleStart', give, { owner: unit });
        } },
      ],
    };
  },
};
