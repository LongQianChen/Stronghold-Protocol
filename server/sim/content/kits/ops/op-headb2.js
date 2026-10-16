// server/sim/content/kits/ops/op-headb2.js — 怒潮凛冬 (char_1051_headb2) 自选 operator kit: 6★ 撼地者 (近卫), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and the module at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_1051_headb2, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, HAM-X at stage 1 (tier 5) or 3 (tier 6) when picked. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json; teamId `student`); PRTS
// 怒潮凛冬 (备注 of 汹涌怒火, 绝不罢休 and 无可抵挡); gamedata_const ba.sluggish 停顿, ba.root 束缚; the client's battle data read
// from the local install — charpack char_1051_headb2, battle/prefabs [uc]skills skchr_headb2_3 and [uc]equips headb2_equip_*,
// buff_template_data headb2_* (named below) — and the battle skeleton's Skill_3 clip events.
// - Trait (撼地者) "攻击使目标周围的其他敌人受到相当于攻击力50%的群体物理伤害": the profession splash (radius 1.0, 50 %, others only,
//   ground enemies — the trait bb).
// - Module HAM-X 迟到的勋章: trait "溅射范围内有大于或等于3个敌人时，使当次攻击力提升至115%" (trait bb cnt / atk_scale_e;
//   headb2_e_002_trait: ON_CALCULATE_DAMAGE, CheckEnemyCountWhenAttackDoCast ≥ cnt — the enemies the attack, or S3's ability,
//   strikes — then AtkScaleUp): an attack whose target and splash victims (radius 1.0 around the target, ground) number at least
//   cnt deals ×atk_scale_e on each of its damage instances (an ATK scale: before DEF); an S3 hammer counts its own 1.5 range,
//   every 高台 splash its own x-5 (PRTS "每个溅射效果独立计算X模组特性加成"). Stage 3: 汹涌怒火 +40 % (below).
// - T1 汹涌怒火 "特性溅射造成的物理伤害提升24%，且溅射到的每个高台对周围四格所有地面敌人造成相当于攻击力24%的物理伤害和0.5秒停顿"
//   (full potential: 攻击力27%; damage_scale; HAM-X stage 3 1.4 — attack@splash_atk_scale, attack@sluggish): the trait splash
//   ×damage_scale (headb2_t_1[damage_scale]: ON_OUTPUT_DAMAGE on the APPLY_TO_HAMMER_SUBCLASS_SPLASH_TARGET damage, PHYSICAL — PRTS
//   "伤害倍率提升而非攻击倍率提升，且不对特性主目标生效": dmg.mul, splash victims only). 高台 splash (PRTS "独立于攻击的效果，
//   其以该次攻击中心为中心，选择1.0半径内的地块触发溅射（重叠判定），伤害溅射范围为周围4格+本格x-5（格子判定），造成物理溅射伤害" /
//   "伤害会被视为远程途径伤害…由此伤害击倒的敌人会被视为无来源击杀"; the charpack's highland AoE: radius 1.0, x-5, targetMotion
//   ground, physical, `_attackType` ranged, sluggish from the blackboard, `_intervalTime` 0.1, SP via headb2_s_2[sp]): after each
//   attack, every 高台 (a HIGH tile of the field rect: walls and forbidden blocks) whose square the circle of radius 1.0 around the
//   target touches triggers; 0.1 s later the ground enemies she could select on its x-5 take attack@splash_atk_scale × her ATK at the
//   trigger (physical 溅射伤害: no dodge; 无来源 credited to her, 远程途径 — DamageInfo isProjectile) and 停顿 attack@sluggish s.
// - T2 万众巨潮 "技能期间所有场上干员攻击力和防御力+14%，【乌萨斯学生自治团】干员获得加成效果翻倍" (full potential: +18%; atk / def,
//   scale_bonus; the aura's validator: ally operators of every profession, herself included; headb2_skill_judge switches it with her
//   skill's start / finish; headb2_t_2[filter_tag]: CheckCharacterGroupTag `student` ⇒ ×scale_bonus, MULTIPLIER attributes): while a
//   skill of hers runs, every operator of the field (teammates' in a shared field — the kits' field-wide convention) ATK / DEF +atk /
//   +def, ×scale_bonus for the 【乌萨斯学生自治团】 (character_table teamId `student`) — given at the cast, renewed every TIDE_IV s
//   (operators deployed meanwhile) and taken back at the end; two sources keep the strongest.
// - S1 誓不低头 (MANUAL, data DEFAULT, 30 s): ATK +atk, ASPD +attack_speed.
// - S2 绝不罢休 (AUTO): "被动效果：每次有高台触发第一天赋的效果时，获得1点技力" (sp_per_highland; PRTS 备注 "根据单次天赋触发的高台
//   数量提供相应的sp") — +sp per 高台 that triggers, none while a skill runs (AK). "自动开启：攻击范围扩大，攻击力+60%，防御力+40%" —
//   a self buff, so it fires at full SP (`trigger: 'SP_FULL'`, the owner's AUTO rule, kits/README.md checklist 5): the 2-5
//   range, ATK / DEF for 16 s; "第二次及以后使用时能力加成变为最初的两倍，且持续时间无限" (headb2_s_2[second].atk / .def): from
//   the second cast of a deployment [ASSUMED: counted per deployment, as 提丰's S2] the doubled values until she leaves (a
//   toggle the kit ends after `duration` s on its first cast, as op-typhon.js).
// - S3 无可抵挡 (MANUAL, data CUSTOM_RANGE on its trigger grid; the ability headb2_s3: `_additionalTimes` 4, each hit on its
//   clip's attack event, not affected by ASPD — PRTS 备注 "锤击间隔1.8s…不受攻击速度影响"): ATK +atk_base; five hammers at the
//   Skill_3 clip's OnAttack events (HAMMER_FRAMES at 30 fps: 1.1 … 7.77 s after the cast) and the skill over with the clip
//   (SKILL3_FRAMES, 9.23 s); she makes no normal attack meanwhile. headb2_s_3: spell_times from −1, +1 at each hammer's spell
//   ⇒ hammer k at ATK +atk_base + atk_step × (k − 1). Each hammer is centred 1.0 ahead (备注 "每次锤击以正前方1.0距离位置为中心"):
//   an enemy on the tile ahead is its main target (her order; usually none), atk_scale × ATK physical; every other ground enemy
//   within HAMMER_SPLASH ("主攻击拥有1.5的溅射半径") takes the trait's splash share (`_splashAtkScaleKey` atk_scale_2 — × atk_scale
//   as well, the kits' 撼地者 convention, 佩佩 S1 [ASSUMED] — ×汹涌怒火) — skill damage, not a normal attack [ASSUMED]. Each hammer
//   runs 汹涌怒火's 高台 round at its centre with the skill's change "伤害效果提升至3.5倍，控制效果变为1秒束缚" (the skill's AoE:
//   splash_atk_scale_base × splash_atk_scale_bonus, headb2_s_3[unmovable] for `unmovable` s instead of 停顿, `_firstIntervalTime`
//   0.1 then `_intervalTime` 0.125 per step) and the spread (备注 "第二次锤击起，所有本次锤击触发第一天赋的高台生效时将令相邻的未受
//   影响的高台触发第一天赋（即扩散），最大扩散次数等同于当前已完成锤击次数；不论如何，一轮锤击中每个高台只会触发一次天赋效果" / "离场时，
//   未完成的天赋效果扩散将立刻终止"): hammer k spreads up to k − 1 steps to the four tiles next to each affected 高台 [ASSUMED:
//   "相邻" = the 4 neighbours]. A hammer due while she cannot act is lost [ASSUMED].

import { num, talentBb, traitBb, skillRec, up, giveSp } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_headb2_1';
const S2 = 'skchr_headb2_2';
const S3 = 'skchr_headb2_3';
/** PRTS 汹涌怒火 备注: "选择1.0半径内的地块触发溅射（重叠判定）". */
const HIGHLAND_PICK_RADIUS = 1.0;
/** PRTS 汹涌怒火 备注: "伤害溅射范围为周围4格+本格x-5（格子判定）" (symmetric: no rotation). */
const X5 = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
/** 汹涌怒火's 高台 AoE: `_intervalTime` 0.1 (PRTS "高台溅射效果从触发/被扩散到生效具有0.1秒内置延迟"); S3's own AoE: `_firstIntervalTime`
 *  0.1, then `_intervalTime` 0.125 per spread step. */
const HIGHLAND_DELAY = 0.1, S3_SPREAD_STEP = 0.125;
/** The battle skeleton's Skill_3 clip (30 fps): 277 frames, OnAttack at frames 33, 84, 133, 182 and 233 (PRTS "锤击间隔1.8s"). */
const FPS = 30, SKILL3_FRAMES = 277, HAMMER_FRAMES = Object.freeze([33, 84, 133, 182, 233]);
/** PRTS 无可抵挡 备注: "每次锤击以正前方1.0距离位置为中心" / "主攻击拥有1.5的溅射半径". */
const HAMMER_REACH = 1.0, HAMMER_SPLASH = 1.5;
/** 【乌萨斯学生自治团】: character_table teamId `student` (古米, 凛冬, 烈夏, 苦艾, 真理, 早露, 怒潮凛冬; as op-poca.js). */
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);
/** 万众巨潮: the renewal of the aura while a skill of hers runs. */
const TIDE_IV = 0.25;
const TIDE_KEY = 'talent:headb2:tide';
const S2_KEY = 'skill:headb2:s2';
const STEP_KEY = 'skill:headb2:step';
const HAMMER_TAG = 'headb2Hammer';
const HIGHLAND_TAG = 'headb2Highland';
const GROUND = Object.freeze({ canHitFly: false });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tagged = (d, tag) => !!d && Array.isArray(d.tags) && d.tags.includes(tag);
const isOp = (a) => !!a && a.kind === 'op';

/** Tile keys of the 高台 (HIGH tiles of the field rect) whose square the circle of radius `r` around (x, y) touches. */
function highlandsAround(battle, x, y, r = HIGHLAND_PICK_RADIUS) {
  const g = battle.grid, out = [];
  for (let row = Math.floor(y - r); row <= Math.ceil(y + r); row++) {
    for (let col = Math.floor(x - r); col <= Math.ceil(x + r); col++) {
      if (!g.inRect(row, col) || g.tile(row, col).height !== 'HIGH') continue;
      const dx = Math.max(Math.abs(x - col) - 0.5, 0), dy = Math.max(Math.abs(y - row) - 0.5, 0);
      if (dx * dx + dy * dy <= r * r + 1e-9) out.push(row * COLS + col);
    }
  }
  return out;
}
/** The 高台 next to tile key `k` (the spread of S3). */
function highlandNeighbours(battle, k) {
  const r = Math.floor(k / COLS), c = k % COLS, g = battle.grid, out = [];
  for (const [dr, dc] of X5) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (g.inRect(rr, cc) && g.tile(rr, cc).height === 'HIGH') out.push(rr * COLS + cc);
  }
  return out;
}

export default {
  char_1051_headb2: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const splashMul = num(t0.damage_scale, 1);
    const hxScale = num(tb.atk_scale_e, 1), hxCnt = num(tb.cnt, Infinity);
    const hamx = (n) => (hxScale !== 1 && n >= hxCnt ? hxScale : 1);
    const traitShare = num(tb['attack@atk_scale_2'], 0.5);

    /** One 高台 taking effect: its x-5 ground enemies take the splash and 停顿 (束缚 during S3). */
    const highlandStrike = (battle, unit, k, atk, s3) => {
      const r = Math.floor(k / COLS), c = k % COLS;
      const keys = [];
      for (const [dr, dc] of X5) if (battle.grid.inRect(r + dr, c + dc)) keys.push((r + dr) * COLS + c + dc);
      const foes = battle.enemiesOnTiles(keys, unit, GROUND);
      battle.fx('aoe', { x: c, y: r, radius: 1, id: unit.id, skill: 'headb2:highland' });
      if (!foes.length) return;
      const amount = atk * num(t0['attack@splash_atk_scale']) * (s3 ? num(b3.splash_atk_scale_bonus, 1) : 1) * hamx(foes.length);
      for (const e of foes) {
        if (!e.alive) continue;
        battle.dealDamage(unit, e, { amount, type: 'phys', isSplash: true, canDodge: false, sourceless: true, isProjectile: true, tags: [HIGHLAND_TAG] });
        if (!e.alive) continue;
        if (s3) battle.applyStatus(e, 'bind', { duration: num(b3.unmovable, 1), source: unit });
        else if (num(t0['attack@sluggish']) > 0) battle.applyStatus(e, 'sluggish', { duration: num(t0['attack@sluggish']), source: unit });
      }
    };
    /**
     * A round of 汹涌怒火's 高台 splashes centred on (x, y): every 高台 within 1.0 triggers now and takes effect
     * HIGHLAND_DELAY s later; with `depth` > 0 (S3) each one that takes effect makes the 高台 next to it that this round has
     * not touched yet trigger — S3_SPREAD_STEP s later —, up to `depth` steps. S2's passive: +sp per 高台 that triggers.
     */
    const highlandRound = (battle, unit, x, y, depth = 0) => {
      const tiles = highlandsAround(battle, x, y);
      if (!tiles.length) return;
      const seq = unit.deploySeq, atk = unit.s.atk;
      const s3 = !!(unit.skill?.active && unit.skill.id === S3);
      const sp = unit.skill?.id === S2 ? num(b2.sp_per_highland) : 0;
      const seen = new Set(tiles);
      const trigger = (k, step) => {
        if (sp > 0) giveSp(unit, sp);
        battle.after(step > 0 && s3 ? S3_SPREAD_STEP : HIGHLAND_DELAY, () => {
          if (!(unit.alive && unit.deployed && unit.deploySeq === seq)) return;   // 离场: the round stops
          highlandStrike(battle, unit, k, atk, s3);
          if (step >= depth) return;
          for (const nb of highlandNeighbours(battle, k)) if (!seen.has(nb)) { seen.add(nb); trigger(nb, step + 1); }
        }, { owner: unit });
      };
      for (const k of tiles) trigger(k, 0);
    };
    /** S3 hammer `k` (1-based): centred 1.0 ahead, a main target on the tile ahead if any, the 1.5 splash, the 高台 round. */
    const hammer = (battle, unit, k) => {
      const [fr, fc] = unit.fwd;
      const cx = unit.x + fc * HAMMER_REACH, cy = unit.y + fr * HAMMER_REACH;
      const tr = unit.tileR + fr, tc = unit.tileC + fc;
      let main = null;
      if (battle.grid.inRect(tr, tc)) {
        const cands = battle.enemiesInKeys([tr * COLS + tc], unit, unit.profile);
        sortEnemyTargets(battle, unit, cands, unit.profile?.priority ?? null);
        main = cands[0] ?? null;
      }
      const around = battle.foesInRadius(cx, cy, HAMMER_SPLASH, true).filter((e) => e !== main && !e.isFlying);
      const atk = unit.s.atk, scale = num(b3.atk_scale, 1) * hamx((main ? 1 : 0) + around.length);
      battle.fx('aoe', { x: cx, y: cy, radius: HAMMER_SPLASH, id: unit.id, skill: 'headb2:hammer' });
      if (main && main.alive) battle.dealDamage(unit, main, { amount: atk * scale, type: 'phys', isSkill: true, tags: ['skill', HAMMER_TAG] });
      for (const e of around) {
        if (!e.alive) continue;
        battle.dealDamage(unit, e, { amount: atk * scale * traitShare, type: 'phys', isSkill: true, isSplash: true, mul: splashMul, tags: ['skill', HAMMER_TAG] });
      }
      highlandRound(battle, unit, cx, cy, k - 1);
    };

    return {
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } },
        [S2]: {
          kind: 'toggle',
          trigger: { rule: 'SP_FULL' },
          targeting: { rangeGrid: s2?.rangeGrid ?? null },
          onStart({ battle, unit, skill }) {
            const later = (unit.mem.headb2S2Casts ?? 0) >= 1;
            unit.mem.headb2S2Casts = (unit.mem.headb2S2Casts ?? 0) + 1;
            const atk = later ? num(b2['headb2_s_2[second].atk']) : num(b2.atk);
            const def = later ? num(b2['headb2_s_2[second].def']) : num(b2.def);
            battle.addBuff(unit, { key: S2_KEY, mods: { atkPct: atk, defPct: def }, tags: ['skill'] });
            skill.timeLeft = later ? Infinity : Math.max(0.01, skill.duration);
          },
          onTick({ skill, dt }) {
            if (!Number.isFinite(skill.timeLeft)) return;
            skill.timeLeft -= dt;
            if (skill.timeLeft <= 1e-9) skill.end('duration');
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, S2_KEY); },
        },
        [S3]: {
          kind: 'duration',
          duration: SKILL3_FRAMES / FPS,
          mods: { atkPct: num(b3.atk_base) },
          attack: { noAttack: true },
          onStart({ battle, unit, skill }) {
            const n0 = skill.activations, seq = unit.deploySeq, step = num(b3.atk_step);
            let done = 0;
            for (const f of HAMMER_FRAMES) {
              battle.after(f / FPS, () => {
                if (!(unit.alive && unit.deployed && unit.deploySeq === seq && skill.active && skill.activations === n0)) return;
                if (!unit.canAct) return;   // a hammer due while she cannot act is lost [ASSUMED]
                hammer(battle, unit, done + 1);
                done++;
                if (step) battle.addBuff(unit, { key: STEP_KEY, mods: { atkPct: step * done }, tags: ['skill'] });
              }, { owner: unit });
            }
          },
          onEnd({ battle, unit }) { battle.removeBuff(unit, STEP_KEY); },
        },
      },
      talents: [
        { install(battle, unit) { // 汹涌怒火: the trait splash ×damage_scale (the 高台 rounds: trait.afterHit and the hammers)
          if (splashMul === 1) return;
          battle.on('hit', (c) => {
            const d = c.dmg;
            if (c.source === unit && d.isAttack && d.isSplash && !tagged(d, HAMMER_TAG)) d.mul *= splashMul;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 万众巨潮: every operator of the field ATK / DEF + while a skill of hers runs (students ×)
          const a = num(t1.atk), d = num(t1.def), x = num(t1.scale_bonus, 1);
          if (!a && !d) return;
          const inSkill = () => !!(unit.skill && unit.skill.active && unit.skill.kind !== 'passive');
          const give = () => {
            if (!up(unit) || !inSkill()) return;
            for (const o of battle.alliesFor(unit)) {
              if (!isOp(o)) continue;
              const k = STUDENTS.has(o.def?.charId) ? x : 1;
              const cur = o.findBuff(TIDE_KEY);
              if (cur && cur.source !== unit && (cur.data?.v ?? 0) > a * k && cur.timeLeft > 0.05) continue;
              battle.addBuff(o, { key: TIDE_KEY, duration: TIDE_IV + 0.1, mods: { atkPct: a * k, defPct: d * k }, source: unit, data: { v: a * k }, tags: ['aura'] });
            }
          };
          battle.every(TIDE_IV, give, { owner: unit });
          battle.on('skillStart', (c) => { if (c.unit === unit) give(); }, { owner: unit });
          battle.on('skillEnd', (c) => {
            if (c.unit !== unit) return;
            for (const o of battle.allyUnits) { const b = o.findBuff(TIDE_KEY); if (b && b.source === unit) battle.removeBuff(o, b); }
          }, { owner: unit });
        } },
      ],
      // 汹涌怒火's 高台 round after each attack, centred on its target
      trait: { afterHit: (battle, unit, target, hctx) => { if (unit.alive && unit.deployed) highlandRound(battle, unit, hctx.x, hctx.y); } },
      install(battle, unit) {
        // S2: the cast count of a deployment [ASSUMED per deployment]
        battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.headb2S2Casts = 0; }, { owner: unit });
        // HAM-X: ≥ cnt ground enemies in the splash range of the attack's target ⇒ ×atk_scale_e on each of its instances
        if (hxScale === 1) return;
        battle.on('hit', (c) => {
          const d = c.dmg;
          if (c.source !== unit || !d.isAttack || !d.attackId || tagged(d, HAMMER_TAG)) return;
          const m = unit.mem;
          if (m.headb2HamxId !== d.attackId) {
            // the first instance of an attack is its target's (ai.js resolveHit: the main hit, then the splash)
            const t = c.target;
            m.headb2HamxId = d.attackId;
            m.headb2HamxMul = hamx(1 + battle.foesInRadius(t.x, t.y, unit.profile?.splashRadius || 1, true).filter((e) => e !== t && !e.isFlying).length);
          }
          d.amount *= m.headb2HamxMul ?? 1;
        }, { owner: unit, priority: 5 });
      },
    };
  },
};
