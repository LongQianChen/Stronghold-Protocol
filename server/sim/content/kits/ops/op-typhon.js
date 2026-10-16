// server/sim/content/kits/ops/op-typhon.js — 提丰 (char_2012_typhon) 自选 operator kit: 6★ 攻城手 (狙击), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and all three modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_2012_typhon, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 提丰 (备注 of 锐如兽牙,
// 重如沼泥, 冰原秩序 and “永恒狩猎”); PRTS 分支特性信息 攻城手 ("可对空").
// - Trait (攻城手) "优先攻击重量最重的敌人": target priority 'heaviest' (targeting.js); ranged physical arrows that hit air units,
//   range 4-3 (as 早露, kits/ops/op-poca.js).
// - Module SIE-X 自然的包容: trait "攻击重量较重（重量等级大于等于3）的敌人时，攻击力提升至115%" (the hidden module talent's atk_scale /
//   value on 锐如兽牙's index): ×atk_scale on her attacks against an enemy of 重量等级 ≥ value (profile dmgMul); stage 2+ 锐如兽牙's
//   numbers (12 % a stack, 10 s) come with the composed talent.
// - Module SIE-Y 冰原的影子: trait "攻击越远的敌人造成的伤害越高（最高提升12%）" — as 早露's SIE-Y (her attack damage, linear between
//   min_dist and max_dist [ASSUMED]); ASPD in the stats; stage 2+ 重如沼泥 "前两次…攻击力提升至220%" (full potential: 230%;
//   max_stack_cnt / atk_scale).
// - Module ISW-A 提丰特限证章: its trait and talent parts say "在集成战略中" — no effect in this mode (the hidden damage_scale /
//   arrow-rain blackboards are ignored); its HP / ATK are in the stats.
// - T1 锐如兽牙 "连续攻击时逐渐无视敌人的防御力，最高无视其防御力的50%（每次攻击提升10%的无视防御比例），8秒内未攻击则失去加成": every
//   attack she makes adds a stack (max_stack_cnt) of +def_penetrate 物理穿透 (defIgnorePct, added — PRTS 备注 "增加自身物理穿透（百分
//   比）属性（直接加算）") before its damage ("获得的加成可应用于当次伤害"), all of them lost `duration` s after her last attack.
// - T2 重如沼泥 "技能期间对每个敌人首次造成伤害时，攻击力提升至160%并使目标停顿3秒" (full potential: 170%): while a skill of hers
//   runs, her first (SIE-Y stage 2+: first max_stack_cnt) damage instances on each enemy deal ×atk_scale (攻击力倍率) and,
//   when they land, 停顿 `sluggish` s — every damage of hers, the S3 arrow rain included ("造成伤害"); the marks are cleared
//   when the skill ends or she leaves (PRTS 备注 "非首次标记…自身技能结束时或自身离场时移除"). A dodged instance spends its mark
//   [ASSUMED: "于计算伤害前触发"].
// - S1 迅捷打击·γ型 (35 s): ATK +atk, ASPD +attack_speed.
// - S2 冰原秩序: ATK +atk; every attack shoots two arrows, at two different enemies when there are two (targeting 2), else both
//   at the one (PRTS "优先攻击不同目标"); each arrow attack@prob to stun attack@stun s. first_duration s on its first cast of a
//   deployment, then "持续时间无限" until she leaves (a toggle the kit ends after first_duration s; PRTS 备注 "每次部署提丰时，
//   重新计算该技能的使用次数").
// - S3 “永恒狩猎” (ammo attack@s3_trigger_time): base attack time +base_attack_time s (flat: batMod). At the cast she marks the first
//   enemy of her own range (未开启技能时的攻击范围: the initial range, her heaviest-first order); the mark area (radius MARK_RADIUS,
//   碰撞判定 — foesInColliderRadius: the enemies' 0.1 colliders) follows that enemy until it leaves the field, then stays; its enemies are re-read every MARK_SCAN s.
//   Her range is the whole field (the card shows 全场) but she attacks only while an enemy is in the mark area; each attack
//   deals nothing itself and drops a round of s3_max_hit_num arrows, RAIN_GAP s apart, each on a random enemy of the area: a
//   physical skill hit (not an attack: PRTS "不属于普通攻击/技能攻击的直接伤害", so the SIE-X / SIE-Y attack riders do not apply
//   [ASSUMED]) of s3_atk_scale × ATK, then 晕眩 s3_stun s once that damage landed.
//   Auto-cast: the data's DEFAULT (the whole-field range exists only in PRTS's note; the mark is picked from her own range).

import { num, talentBb, moduleOn, traitBb, skillRec, batMod, onHitBy, skillBusy, up } from '../shared/tier1.js';
import { boundedCount } from '../../../../../shared/plugins/limits.js';
import { bbCap } from '../../../../../shared/plugins/officialBounds.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { ROWS, COLS } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skcom_quickattack[3]';
const S2 = 'skchr_typhon_2';
const S3 = 'skchr_typhon_3';
/** PRTS S3 备注: "标记区域半径1.3（碰撞判定），每0.2s更新范围内的敌人", "箭雨的每支箭间隔0.1s且分别索敌". */
const MARK_RADIUS = 1.3;
const MARK_SCAN = 0.2;
const RAIN_GAP = 0.1;
/** S3 "攻击范围扩大至全场": every offset that reaches the whole 19 × 21 field whatever her direction. */
const FIELD = (() => {
  const m = Math.max(ROWS, COLS) - 1;
  const g = [];
  for (let dr = -m; dr <= m; dr++) for (let dc = -m; dc <= m; dc++) g.push(Object.freeze([dr, dc]));
  return Object.freeze(g);
})();
const FANG_KEY = 'talent:typhon:fang';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const count = (v, d) => Math.max(1, Math.floor(num(v, d)));

export default {
  char_2012_typhon: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    // SIE-X: the hidden part merged into 锐如兽牙's blackboard (no module / SIE-Y / ISW-A ⇒ no atk_scale there)
    const xScale = moduleOn(chess) ? num(t0.atk_scale, 1) : 1;
    const heavyAt = num(t0.value, 3);
    const heavy = (e) => !!e && e.side === 'enemy' && e.weight >= heavyAt;
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);

    /** S3: the enemies of the mark area (last scan) her attacks may still select. */
    const areaFoes = (unit, st) => st.inArea.filter((e) => e.alive && e.deployed && !e.hidden && canTargetEnemy(unit, e, unit.profile));
    const follow = (st) => { const t = st.target; if (t && t.alive && t.deployed && !t.hidden) { st.x = t.x; st.y = t.y; } };
    const scan = (battle, unit, st) => { st.inArea = battle.foesInColliderRadius(st.x, st.y, MARK_RADIUS).filter((e) => canTargetEnemy(unit, e, unit.profile)); };
    const rain = (battle, unit) => {
      const st = unit.mem.typhonMark;
      if (!st) return;
      battle.fx('arrowRain', { x: st.x, y: st.y, radius: MARK_RADIUS, id: unit.id });
      const scale = num(b3['attack@s3_atk_scale'], 1), stun = num(b3['attack@s3_stun']);
      const arrow = () => {
        const pool = areaFoes(unit, st);
        if (!pool.length) return;
        const e = battle.rng.pick(pool);
        const dealt = battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'typhon:rain'] });
        if (dealt > 0 && e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
      };
      arrow();
      const rainHits = Math.max(1, Math.floor(boundedCount(num(b3['attack@s3_max_hit_num'], 4), bbCap('attack@s3_max_hit_num'), 4)));
      for (let k = 1; k < rainHits; k++) battle.after(RAIN_GAP * k, arrow, { owner: unit }); // loop-cap: bbCap attack@s3_max_hit_num
    };

    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } },
        [S2]: {
          kind: 'toggle',
          mods: { atkPct: num(b2.atk) },
          targeting: { maxTargets: 2 },
          attack: {
            onHit({ battle, unit, target }) {
              if (target && target.alive && battle.rng.chance(num(b2['attack@prob']))) battle.applyStatus(target, 'stun', { duration: num(b2['attack@stun'], 1), source: unit });
            },
          },
          onStart({ unit, skill }) {
            unit.mem.typhonS2Uses = (unit.mem.typhonS2Uses ?? 0) + 1;
            skill.timeLeft = unit.mem.typhonS2Uses > 1 ? Infinity : Math.max(0.01, num(b2.first_duration, skill.duration));
          },
          onTick({ skill, dt }) {
            if (!Number.isFinite(skill.timeLeft)) return;
            skill.timeLeft -= dt;
            if (skill.timeLeft <= 1e-9) skill.end('duration');
          },
        },
        [S3]: {
          kind: 'ammo',
          ammo: count(b3['attack@s3_trigger_time'], 8),
          mods: { batPct: batMod(b3.base_attack_time, chess) },
          targeting: { rangeGrid: FIELD },
          attack: {
            projectile: 'beam',
            hitsFn: () => 0,
            canAttack: (battle, unit) => !!unit.mem.typhonMark && areaFoes(unit, unit.mem.typhonMark).length > 0,
            onHit({ battle, unit }) { rain(battle, unit); },
          },
          onStart({ battle, unit }) {
            const cands = battle.enemiesInKeys(unit.baseRangeKeys ?? unit.rangeKeys, unit, unit.profile);
            sortEnemyTargets(battle, unit, cands, 'heaviest');
            const t = cands[0] ?? null;
            const st = { target: t, x: t ? t.x : unit.x, y: t ? t.y : unit.y, inArea: [], timer: null };
            unit.mem.typhonMark = st;
            scan(battle, unit, st);
            st.timer = battle.every(MARK_SCAN, (b, sc) => {
              if (unit.mem.typhonMark !== st) { sc.cancel(); return; }
              follow(st);
              scan(battle, unit, st);
            }, { owner: unit });
            battle.fx('mark', { x: st.x, y: st.y, radius: MARK_RADIUS, id: unit.id, target: t ? t.id : null });
          },
          onTick({ unit }) { const st = unit.mem.typhonMark; if (st) follow(st); },
          onEnd({ unit }) {
            const st = unit.mem.typhonMark;
            unit.mem.typhonMark = null;
            if (st && st.timer) st.timer.cancel();
          },
        },
      },
      talents: [
        { install(battle, unit) { // 锐如兽牙: +def_penetrate 物理穿透 a stack per attack (max_stack_cnt), gone `duration` s after the last
          const per = num(t0.def_penetrate);
          if (!(per > 0)) return;
          const max = count(t0.max_stack_cnt, 5), dur = num(t0.duration, 8);
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !up(unit)) return;
            battle.addBuff(unit, { key: FANG_KEY, duration: dur, refresh: 'stack', maxStacks: max, mods: { defIgnorePct: per }, tags: ['talent'] });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 重如沼泥: during a skill, the first max_stack_cnt damages on each enemy ×atk_scale + 停顿
          const scale = num(t1.atk_scale, 1), slug = num(t1.sluggish), max = count(t1.max_stack_cnt, 1);
          const marked = new WeakSet();
          battle.on('skillStart', (c) => { if (c.unit === unit) unit.mem.typhonMud = new Map(); }, { owner: unit });
          battle.on('skillEnd', (c) => { if (c.unit === unit) unit.mem.typhonMud = null; }, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.typhonMud = null; }, { owner: unit });
          onHitBy(battle, unit, ({ target, dmg }) => {
            const marks = unit.mem.typhonMud;
            if (!marks || !skillBusy(unit)) return;
            const n = marks.get(target.id) ?? 0;
            if (n >= max) return;
            marks.set(target.id, n + 1);
            dmg.amount *= scale;
            marked.add(dmg);
          });
          battle.on('damaged', (c) => {
            if (c.source !== unit || !marked.has(c.dmg) || !c.target.alive || !(slug > 0)) return;
            battle.applyStatus(c.target, 'sluggish', { duration: slug, source: unit });
          }, { owner: unit });
        } },
      ],
      // 攻城手: heaviest first; SIE-X ×atk_scale on her attacks against heavy enemies
      trait: { priority: 'heaviest', ...(xScale !== 1 ? { dmgMul: (b, u, target) => (heavy(target) ? xScale : 1) } : null) },
      install(battle, unit) {
        // S2: two arrows per attack — both at the one enemy when it is the only target
        if (unit.skill?.id === S2) {
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !unit.skill.active || ctx.targets.length !== 1) return;
            ctx.targets = [ctx.targets[0], ctx.targets[0]];
          }, { owner: unit });
        }
        // S3: the round is aimed at the marked enemy (else another one of the area): its 'atk' line points there
        if (unit.skill?.id === S3) {
          battle.on('beforeAttack', (ctx) => {
            const st = unit.mem.typhonMark;
            if (ctx.attacker !== unit || !unit.skill.active || !st) return;
            const pool = areaFoes(unit, st);
            const t = pool.includes(st.target) ? st.target : pool[0];
            if (t) ctx.targets = [t];
          }, { owner: unit });
        }
        // S2 counts its casts per deployment
        battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.typhonS2Uses = 0; }, { owner: unit });
        // SIE-Y: the farther the target, the more damage (attacks only)
        const ds = num(tb.damage_scale), lo = num(tb.min_dist, 1), hi = num(tb.max_dist, 4.5);
        if (ds > 0) {
          onHitBy(battle, unit, ({ target, dmg }) => {
            if (!dmg.isAttack) return;
            const d = hypot(target.x - unit.x, target.y - unit.y);
            dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo)));
          });
        }
      },
    };
  },
};
