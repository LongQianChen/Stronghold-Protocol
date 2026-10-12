// server/sim/content/kits/ops/op-leizi2.js — 司霆惊蛰 (char_1043_leizi2) 自选 operator kit: 6★ 解放者 (近卫), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module (LIB-X) at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1043_leizi2, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, LIB-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); the client's battle
// logic — buff_template_data (leizi2_tr, leizi2_e_002_tr, leizi2_s_cast, leizi2_t_1[atk_up] / [on_calcul] / [fly] /
// [trigger] / [buff_start], leizi2_s_2[try_add_atk], leizi2_s_3), her charpack (Trait buff: triggerInterval 1; the
// "thunder" ability: `_maxCount` 15, `_resetCountList` 3…7, `_rangeCastDelay` 0.25; S1 abilities s1_m / s1_l / s1_r:
// `_preDelay` 0.3, ground selectors; S3 attack: projectile_char_leizi2_s3 every `_triggerDelta` 0.28 s), the skill prefabs
// (skchr_leizi2_1: leizi2_s_1 lifeTime 0.5; skchr_leizi2_2: the flood-fill selector `_depth` 3, `checkHeightType`) and
// the projectile prefabs (projectile_char_leizi2_t_1 / [start]: lands `_delayTime` 0.15 s after its cast, ground + air;
// projectile_char_leizi2_s3: speed 1, `_lifeTime` 3.1, `_keepAlreadyHitTime` 0.6, ground only, magical, modifier key
// "leizi2", rebounds off its source), her skeleton's clips (Skill_1_Begin 0.5 s with OnAttack at 0.3; Skill_2_Begin /
// Skill_3_Begin 0.5 s; Skill_1_End / Skill_2_End 0.933 s, Skill_3_End 0.833 s) — and PRTS 司霆惊蛰 (talent / skill 备注).
// The official map of a battle is its field (`rect`): stage tiles beyond it (another player's half) are no tiles here —
// no strike falls there, S2's range and S3's currents stop at its edge [ASSUMED].
// - Trait (解放者) "通常不攻击且阻挡数为0，技能未开启时40秒内攻击力逐渐提升至最高+200%且技能结束时重置攻击力": the librator
//   profile (professions.js: no attack and block 0 while the skill is off, ATK +atk / max_stack_cnt every second up to
//   +atk while it is off, reset when it ends). Module LIB-X “一念” "部署后获得+100%加成": its hidden talent init_atk
//   (leizi2_e_002_tr: init_atk / (atk / max_stack_cnt) stacks at each deployment) — the profile's rampInit (her DISPLAY
//   trait part carries no blackboard, unlike 玛恩纳's, so the kit hands it over).
// - T1 明断 "攻击范围内每个地块每秒有10%的概率落雷对所有敌人造成相当于攻击力100%的法术伤害。未开启技能时起飞；技能期间攻击时攻击
//   力提升至107%" (full potential: 111 %):
//   · the strikes (PRTS 备注's algorithm, the thunder ability's numbers): every 1.0333 s from each deployment, each tile of
//     her current attack range — first seen: a counter at a random 0…14; else +1, and at 15 the tile is struck and its
//     counter restarts at a random 3…7; counters outlive a tile leaving the range and die with the deployment. A strike
//     lands 0.15 s after its cast: atk_scale_t × ATK arts on every enemy she can select on that tile, air units too
//     (PRTS 可对空). Counting pauses while she cannot act [ASSUMED: the ability does not cast under 晕眩 / 冻结].
//   · 起飞 while no skill runs (leizi2_t_1[fly] in her default mode only; gamedata_const ba.liftoff): flag `liftoff` —
//     no ground enemy selects her or is blocked by her (her block count is 0 then anyway). PRTS "开启技能时的降落动作与技能
//     结束时的起飞动作…期间自身不处于起飞状态，其中降落动作计入技能总时长": she lands at the cast and makes no attack for the
//     landing clip (S2 / S3 0.5 s, inside the skill's time; S1's attacks are its own), and after the skill she is up
//     again only when the take-off clip is over (S1 / S2 0.933 s, S3 0.833 s) — ground enemies may select her meanwhile;
//     her block count is the trait's 0 from the skill's end on.
//   · leizi2_t_1[on_calcul] (AtkScaleUp on ON_CALCULATE_DAMAGE while a skill runs; PRTS "对自身技能期间造成的所有伤害生效"):
//     an atkScaleMul ×atk_scale[skill_up] buff for the skill's time — her attacks (ai.js resolveHit) and every damage this
//     kit computes (strikes, S1, currents) multiply it. LIB-X stage 2+: the module talent's value (stage 3: 1.17).
// - T2 追责 "开启技能时，使攻击范围内所有地面地块落雷，对所有敌人造成相当于攻击力100%的法术伤害和2秒战栗" (full potential: 3 s): at every cast (each S1
//   charge too) every low tile of her attack range — the skill's, S2's flood fill included — is struck, ring by ring by
//   Manhattan distance from her tile (PRTS "自内向外"), 0.25 s per ring (the thunder `_rangeCastDelay`; 0.07 s under S1 —
//   leizi2_t_1[trigger] `_specialRangeCastDelay`), each landing 0.15 s after its cast: atk_scale_t2 × ATK arts and 战栗
//   (`tremble`) not_combat s on every enemy she can select there, air units too. The strikes start at the cast
//   [ASSUMED: leizi2_t_1[trigger] rides her landing clip's start event (≤ 0.17 s in), not modelled].
// - S1 浩气长存 (MANUAL, 可充能 3 次, data SEARCH): a 0.5 s skill (PRTS "技能持续0.5s"; skill prefab lifeTime 0.5) whose
//   range is the 3-19; no normal attack in it; 0.3 s after the cast (the abilities' `_preDelay`) three attacks — a 3-2 to
//   her left, her front and her right (PRTS: the 3-19 only explains the coverage) — each hit every ground enemy she can
//   select on it for attack@atk_scale_s1 × ATK physical (one on her own tile takes all three). "充能耗尽前特性不重置"
//   (leizi2_s_cast: the trait resets only when no charge is left): while a charge remains the ramp is kept.
// - S2 正霆摄威 (MANUAL, data SEARCH): at the cast her range becomes the low tiles reachable from hers in up to three 4-way
//   steps over the field (PRTS 备注: "任意高度类型为低地的地块以及干员自己所在的地块", "不存在地块数据的地块始终视为不合法";
//   a real attack range — rangeExtend applies), fixed for the skill; attacks hit attack@max_target_s2 targets for
//   attack@atk_scale_s2 × ATK physical, air units too (PRTS 攻击可对空); every lightning cast of hers while it runs
//   (leizi2_s_2[try_add_atk], the thunder ability's buffsToOwnerOnCast — 追责's strikes too) gives ATK +thunder_atk, up
//   to thunder_max_stack_cnt stacks, gone when it ends.
// - S3 天地通明 (MANUAL, data CUSTOM_RANGE on its 2-1): range 2-1, attack interval +base_attack_time s (flat), each attack
//   hits its target and every enemy within attack@range_radius of it for attack@atk_scale_s3 × ATK physical (air units
//   too: PRTS 普通攻击可对空); after each attack four currents leave the target's spot — up, right, down, left (screen
//   directions), 0.28 s apart (the first at the hit [ASSUMED]) — at 1 tile/s for 3.1 s, turning back before they would
//   enter a high tile, her own tile or the field's edge (PRTS "只在即将进入地块时进行反弹判定"), gone when she leaves (they
//   outlive the skill [ASSUMED]); each hits every ground enemy she can select on its
//   tile for attack@atk_scale_current × ATK arts, each enemy at most every 0.6 s per current, and — while S3 runs
//   (leizi2_s_3 ON_OUTPUT_MODIFIER, modifier key "leizi2") — with `prob` to 战栗 it not_combat s.

import { num, talentBb, moduleBb, skillRec, batMod, up } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { toLocal } from '../../../dir.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_leizi2_1';
const S2 = 'skchr_leizi2_2';
const S3 = 'skchr_leizi2_3';
/** The skill ranges when a record carries none (data: 3-19, 2-1). */
const R3_19 = Object.freeze([[3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2], [0, 3], [-1, 0], [-2, 0], [-3, 0]]);
const R2_1 = Object.freeze([[2, 0], [1, 0], [1, 1], [0, 0], [0, 1], [0, 2], [-1, 0], [-1, 1], [-2, 0]]);
/** S1's three attacks (PRTS 备注): a 3-2 to her front, her left and her right (facing-RIGHT offsets). */
const S1_ARMS = Object.freeze([
  Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3]]),
  Object.freeze([[0, 0], [1, 0], [2, 0], [3, 0]]),
  Object.freeze([[0, 0], [-1, 0], [-2, 0], [-3, 0]]),
]);
/** skchr_leizi2_1 leizi2_s_1 lifeTime (PRTS "技能持续0.5s") and the s1_* abilities' `_preDelay`. */
const S1_TIME = 0.5;
const S1_STRIKE_AT = 0.3;
/** PRTS 明断 备注: "部署后每1.0333秒对自身当前攻击范围内所有地块执行计数判定" (31 ticks). */
const COUNT_IV = 31 / 30;
/** The thunder ability: a strike at `_maxCount` 15, then a restart at one of `_resetCountList` 3…7; a new tile 0…14. */
const COUNT_MAX = 15;
const RESET_MIN = 3;
const RESET_SPAN = 5;
/** projectile_char_leizi2_t_1 / [start] `_delayTime`: a strike lands this long after its cast. */
const STRIKE_DELAY = 0.15;
/** 追责: the thunder `_rangeCastDelay` per Manhattan ring; leizi2_t_1[trigger] `_specialRangeCastDelay` under S1. */
const RING_DELAY = 0.25;
const RING_DELAY_S1 = 0.07;
/** projectile_char_leizi2_s3: speed, lifetime, one hit per enemy per this long; the S3 attack's `_triggerDelta`. */
const CURRENT_SPEED = 1;
const CURRENT_LIFE = 3.1;
const CURRENT_REHIT = 0.6;
const CURRENT_GAP = 0.28;
/** PRTS: "依次生成向上/向右/向下/向左移动的电流" — screen directions as [dRow, dCol] (row 0 is the bottom). */
const CURRENT_DIRS = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const FOUR = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const AIR = Object.freeze({ canHitFly: true });
const GROUND = Object.freeze({ canHitFly: false });
/** Her skeleton's landing clips (Skill_2_Begin / Skill_3_Begin; S1's is its own 0.5 s) and take-off clips (Skill_N_End). */
const LANDING = Object.freeze({ [S2]: 0.5, [S3]: 0.5 });
const TAKEOFF = Object.freeze({ [S1]: 0.933, [S2]: 0.933, [S3]: 0.833 });
const LIFTOFF_KEY = 'talent:leizi2:liftoff';
const SKILL_UP_KEY = 'talent:leizi2:skillUp';
const S2_ATK_KEY = 'skill:leizi2:thunderAtk';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** Absolute tile keys of a grid at the unit's tile and facing. */
const keysOf = (unit, grid) => absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
/** A tile of the battle's field — the official map of a battle: no lightning falls on a stage tile beyond it. */
const onField = (battle, k) => battle.grid.inRect(Math.floor(k / COLS), k % COLS);

/**
 * S2's range: the tiles reachable from hers in up to three 4-way steps over low tiles (her own tile always; a tile
 * without data never — off the battle's field: the official map of a battle is its field, `rect`), as facing-RIGHT
 * offsets (PRTS 备注, the selector's `_depth` 3).
 */
function floodGrid(battle, unit) {
  const r0 = unit.tileR, c0 = unit.tileC;
  const seen = new Set([r0 * COLS + c0]);
  const cells = [[r0, c0]];
  let frontier = [[r0, c0]];
  for (let step = 0; step < 3 && frontier.length; step++) {
    const next = [];
    for (const [r, c] of frontier) {
      for (const [dr, dc] of FOUR) {
        const rr = r + dr, cc = c + dc, k = rr * COLS + cc;
        if (seen.has(k) || !battle.grid.inRect(rr, cc) || battle.grid.tile(rr, cc).height !== 'LOW') continue;
        seen.add(k);
        next.push([rr, cc]);
        cells.push([rr, cc]);
      }
    }
    frontier = next;
  }
  return cells.map(([r, c]) => toLocal(r - r0, c - c0, unit.dir));
}

export default {
  char_1043_leizi2: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const hidden = moduleBb(chess);   // LIB-X: init_atk
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s1 = skillRec(chess, S1), s3 = skillRec(chess, S3);
    const skillUp = num(t0['atk_scale[skill_up]'], 1);
    const s2Grid = [[0, 0]];          // this unit's S2 range, rebuilt at every cast

    /** A lightning cast on tile `key` (T1's strikes, `accuse` = T2's): S2's stack at once, the strike 0.15 s later. */
    const cast = (battle, unit, key, accuse) => {
      const sk = unit.skill;
      if (sk && sk.active && sk.id === S2 && num(b2.thunder_atk) > 0) {
        battle.addBuff(unit, { key: S2_ATK_KEY, refresh: 'stack', stacks: 1, maxStacks: Math.max(1, Math.floor(num(b2.thunder_max_stack_cnt, 25))), mods: { atkPct: num(b2.thunder_atk) }, tags: ['skill'] });
      }
      const seq = unit.deploySeq;
      battle.after(STRIKE_DELAY, () => {
        if (!up(unit) || unit.deploySeq !== seq) return;    // _stopWhenSourceInvalid
        const r = Math.floor(key / COLS), c = key % COLS;
        battle.fx('lightning', { x: c, y: r, id: unit.id, skill: accuse ? 'leizi2:accuse' : 'leizi2:thunder' });
        const scale = num(accuse ? t1.atk_scale_t2 : t0.atk_scale_t, 1);
        for (const e of battle.enemiesInKeys([key], unit, AIR)) {
          if (!e.alive) continue;
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale * unit.s.atkScaleMul, type: 'arts', tags: ['talent', accuse ? 'leizi2:accuse' : 'leizi2:thunder'] });
          if (accuse && e.alive && num(t1.not_combat) > 0) battle.applyStatus(e, 'tremble', { duration: num(t1.not_combat), source: unit });
        }
      }, { owner: unit });
    };

    return {
      trait: {
        // LIB-X “一念” 部署后获得+100%加成: the trait's start (the module's hidden talent; her trait part has no blackboard)
        ...(num(hidden.init_atk) > 0 ? { rampInit: num(hidden.init_atk) } : {}),
        // S2 / S3: no attack while she lands (PRTS "降落动作计入技能总时长")
        canAttack: (b, u) => !(num(u.mem.leiziLandUntil) > b.time + 1e-9),
      },
      skills: {
        [S1]: {
          kind: 'duration',
          duration: S1_TIME,
          targeting: { rangeGrid: s1?.rangeGrid ?? R3_19 },
          attack: { noAttack: true },     // the three attacks below are the skill's
          onStart({ battle, unit, skill }) {
            const seq = unit.deploySeq, act = skill.activations;
            battle.after(S1_STRIKE_AT, () => {
              if (!up(unit) || unit.deploySeq !== seq || skill.activations !== act) return;
              battle.fx('aoe', { x: unit.x, y: unit.y, radius: 3, id: unit.id, skill: 'leizi2:s1' });
              for (const arm of S1_ARMS) {
                for (const e of battle.enemiesInKeys(keysOf(unit, arm), unit, GROUND)) {
                  if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b1['attack@atk_scale_s1'], 1) * unit.s.atkScaleMul, type: 'phys', isSkill: true, tags: ['skill', 'leizi2:s1'] });
                }
              }
            }, { owner: unit });
          },
        },
        [S2]: {
          kind: 'duration',
          targeting: { rangeGrid: s2Grid, canHitFly: true, maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target_s2'], 3))) },
          attack: { atkScale: num(b2['attack@atk_scale_s2'], 1) },
          onStart({ battle, unit }) {
            const g = floodGrid(battle, unit);
            s2Grid.length = 0;
            for (const p of g) s2Grid.push(p);
            battle.refreshRange(unit);
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, S2_ATK_KEY); },
        },
        [S3]: {
          kind: 'duration',
          mods: { batPct: batMod(b3.base_attack_time, chess) },
          targeting: { rangeGrid: s3?.rangeGrid ?? R2_1, canHitFly: true },
          attack: {
            atkScale: num(b3['attack@atk_scale_s3'], 1),
            splashRadius: num(b3['attack@range_radius'], 1.65),
            splashScale: 1,
            onHit({ battle, unit, x, y }) {   // the currents leave the target's spot
              const seq = unit.deploySeq;
              CURRENT_DIRS.forEach(([dr, dc], i) => {
                const spawn = () => {
                  if (!up(unit) || unit.deploySeq !== seq) return;
                  (unit.mem.leiziCurrents ??= []).push({ x, y, dr, dc, life: CURRENT_LIFE, seq, hitAt: new Map() });
                };
                if (i === 0) spawn();
                else battle.after(CURRENT_GAP * i, spawn, { owner: unit });
              });
              battle.fx('pulse', { x, y, id: unit.id, skill: 'leizi2:current' });
            },
          },
        },
      },
      talents: [
        { install(battle, unit) { // 明断: the strikes, 起飞 while no skill runs, ×atk_scale[skill_up] during a skill
          const lift = () => { if (up(unit)) battle.addBuff(unit, { key: LIFTOFF_KEY, flags: { liftoff: true }, tags: ['talent'] }); };
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            if (!unit.skill?.active) lift();
            if (c.move) return;
            // the strike counters: a new list with every deployment
            const seq = unit.deploySeq;
            const counters = new Map();
            battle.every(COUNT_IV, (b, sc) => {
              if (!up(unit) || unit.deploySeq !== seq) { sc.cancel(); return; }
              if (!unit.canAct) return;
              for (const k of unit.rangeKeys) {
                if (!onField(b, k)) continue;
                if (!counters.has(k)) { counters.set(k, b.rng.int(COUNT_MAX)); continue; }
                const n = counters.get(k) + 1;
                if (n >= COUNT_MAX) { counters.set(k, RESET_MIN + b.rng.int(RESET_SPAN)); cast(b, unit, k, false); } else counters.set(k, n);
              }
            }, { owner: unit });
          }, { owner: unit });
          battle.on('skillStart', (c) => {
            if (c.unit !== unit) return;
            battle.removeBuff(unit, LIFTOFF_KEY);
            unit.mem.leiziLandUntil = battle.time + (LANDING[unit.skill.id] ?? 0);
            if (skillUp !== 1) battle.addBuff(unit, { key: SKILL_UP_KEY, mods: { atkScaleMul: skillUp }, tags: ['talent'] });
          }, { owner: unit, priority: 50 });
          battle.on('skillEnd', (c) => {
            if (c.unit !== unit) return;
            battle.removeBuff(unit, SKILL_UP_KEY);
            unit.mem.leiziLandUntil = 0;
            if (c.reason === 'death') return;
            // (the trait's own handler releases what she blocked) — 起飞 again once the take-off clip is over
            const seq = unit.deploySeq;
            battle.after(TAKEOFF[unit.skill.id] ?? 0, () => { if (unit.deploySeq === seq && !unit.skill?.active) lift(); }, { owner: unit });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 追责: every cast strikes the low tiles of her range, ring by ring from her tile
          if (!(num(t1.atk_scale_t2) > 0)) return;
          battle.on('skillStart', (c) => {
            if (c.unit !== unit) return;
            const gap = unit.skill?.id === S1 ? RING_DELAY_S1 : RING_DELAY;
            const rings = new Map();
            for (const k of unit.rangeKeys) {
              const r = Math.floor(k / COLS), cc = k % COLS;
              if (!onField(battle, k) || !battle.grid.isLow(r, cc)) continue;
              const d = Math.abs(r - unit.tileR) + Math.abs(cc - unit.tileC);
              if (!rings.has(d)) rings.set(d, []);
              rings.get(d).push(k);
            }
            const seq = unit.deploySeq;
            for (const d of [...rings.keys()].sort((a, b) => a - b)) {
              const fire = () => { if (up(unit) && unit.deploySeq === seq) for (const k of rings.get(d)) cast(battle, unit, k, true); };
              if (d === 0) fire();
              else battle.after(d * gap, fire, { owner: unit });
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const id = unit.skill?.id;
        if (id === S2) {
          // The owner's larger-range auto-cast rule also covers this terrain-dependent range (no static rangeId).
          // Keep SEARCH when the actual running area does not strictly contain her initial range.
          unit.skill.addTriggerRange(() => {
            const extend = unit.s.baseRangeExtend || 0;
            const keys = absoluteRangeKeys(floodGrid(battle, unit), unit.tileR, unit.tileC, unit.dir, extend);
            const initial = absoluteRangeKeys(unit.def.rangeGrid, unit.tileR, unit.tileC, unit.dir, extend);
            const set = new Set(keys);
            return set.size > initial.length && initial.every(k => set.has(k)) ? [{ keys, profile: AIR }] : [];
          });
        }
        if (id === S1) {
          // 充能耗尽前特性不重置: the trait resets the ramp on skillEnd (priority 0) — keep it while a charge remains
          battle.on('skillEnd', (c) => {
            if (c.unit === unit) unit.mem.leiziRamp = c.reason !== 'death' && unit.skill.charges > 0 ? num(unit.trait.ramp) : null;
          }, { owner: unit, priority: 100 });
          battle.on('skillEnd', (c) => {
            if (c.unit !== unit || unit.mem.leiziRamp == null) return;
            unit.trait.ramp = unit.mem.leiziRamp;
            unit.mem.leiziRamp = null;
            if (unit.trait.ramp > 0 && unit.alive) battle.addBuff(unit, { key: 'trait:libratorRamp', mods: { atkPct: unit.trait.ramp } });
          }, { owner: unit, priority: -100 });
        }
        if (id !== S3) return;
        // S3: the currents
        const scale = num(b3['attack@atk_scale_current']), prob = num(b3.prob), stop = num(b3.not_combat);
        battle.on('tick', ({ dt }) => {
          const list = unit.mem.leiziCurrents;
          if (!list || !list.length) return;
          const keep = [];
          for (const cur of list) {
            cur.life -= dt;
            if (cur.life <= 1e-9 || !up(unit) || unit.deploySeq !== cur.seq) continue;
            const nx = cur.x + cur.dc * CURRENT_SPEED * dt, ny = cur.y + cur.dr * CURRENT_SPEED * dt;
            const r = Math.round(ny), c = Math.round(nx);
            if (r !== Math.round(cur.y) || c !== Math.round(cur.x)) {
              // about to enter (r, c): back off a high tile (高台), her own tile or the field's edge [ASSUMED]
              if (!battle.grid.inRect(r, c) || battle.grid.tile(r, c).height === 'HIGH' || (r === unit.tileR && c === unit.tileC)) { cur.dr = 0 - cur.dr; cur.dc = 0 - cur.dc; } else { cur.x = nx; cur.y = ny; }
            } else { cur.x = nx; cur.y = ny; }
            keep.push(cur);
            const s3On = !!(unit.skill?.active && unit.skill.id === S3);
            for (const e of battle.enemiesInKeys([Math.round(cur.y) * COLS + Math.round(cur.x)], unit, GROUND)) {
              const at = cur.hitAt.get(e);
              if (!e.alive || (at != null && battle.time - at < CURRENT_REHIT - 1e-9)) continue;
              cur.hitAt.set(e, battle.time);
              const dealt = battle.dealDamage(unit, e, { amount: unit.s.atk * scale * unit.s.atkScaleMul, type: 'arts', isSkill: true, tags: ['skill', 'leizi2:current'] });
              if (s3On && dealt > 0 && e.alive && stop > 0 && battle.rng.chance(prob)) battle.applyStatus(e, 'tremble', { duration: stop, source: unit });
            }
            if (!unit.alive) break;
          }
          unit.mem.leiziCurrents = keep;
        }, { owner: unit });
      },
    };
  },
};
