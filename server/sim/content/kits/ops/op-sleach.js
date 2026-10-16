// server/sim/content/kits/ops/op-sleach.js — 琴柳 (char_479_sleach) 自选 operator kit: 6★ 执旗手 (先锋), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules (BEA-X 牧人的歌, BEA-Y “友谊万岁”) at every
// form. Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_479_sleach): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7, the
// picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), PRTS 琴柳 (不退之旗 备注
// "与军旗相关的效果可视为地块效果，效果影响范围跟随军旗所在地块移动；军旗对干员的效果无视孤立"; 精神感召 备注 and its Y-module 修正
// "在场期间一次，当有干员部署时，若干员为地面位干员，则立刻回复…部署费用"; S2 备注 "生命回复速度…不受治疗加成和禁疗影响" / "不会
// 选择召唤物/装置所在位置…技能效果不会应用于召唤物/装置"; S3 备注 "停顿与脆弱效果会在军旗落地前就开始生效，眩晕与伤害效果会在军旗
// 落地（约1s延迟）后再生效", "技能无法选择空中目标释放，但效果可对空", the 军旗索敌逻辑), PRTS 分支特性信息 执旗手, Arknights Terra
// Wiki Saileach (the talent's 3×3 range), and the client's battle data read from the local install — charpack char_479_sleach
// (talent 1: four x-4 auras, operators only — professionMask 639 — ignoring 孤立, enemies ground and air), the skill prefabs
// skchr_sleach_1/2/3 (S2's Flag selector: operators, lowest HP share, one target; FlagBuff atk_to_hp_recovery every 1 s and DEF
// MULTIPLIER on the 0-1 of the flag; S3's DamageFlag: TalentToEnemy / TalentToAlly / Damage / Debuff on one ground tile),
// the projectiles projectile_chr_sleach_s2 / _s3 / _s3_2 / _t1 / _t1_2 (`_immediatelyReach` flags; the S3 strike's
// `_lifeTime` 1 s, its x-4 hitting ground and air), buff_template_data sleach_s_2 (Flag `_excludeTargetType` SOURCE),
// sleach_s_3, sleach_t_2, sleach_trait_e / [trigger] (BEA-X: every 0.2 s the operator of the 1-1 but her own tile, not
// stunned / asleep, BLOCK_CNT +block_cnt until her skill ends), sleach_e_003[tr] (BEA-Y: CAMOUFLAGE for the skill),
// sleach_e_003[t] / [t2] / [t][effect] (BEA-Y Lv2+: the next MELEE deployment +cost DP, once), periodic_cost / charge_cost /
// atk_to_hp_recovery.
// - Trait (执旗手) "技能发动期间阻挡数变为0": the profession's bearer install (block ×0 while a skill runs, the blocked enemies
//   released). Melee physical, 1-1, ground only (data), ground enemies target her. Every skill "停止攻击": no attack meanwhile.
//   BEA-X “牧人的歌” "但使身前一名干员阻挡数+1" (trait bb block_cnt): while her skill runs, every 0.2 s the operator on the tile
//   in front of her (not stunned or asleep) gets block +block_cnt, kept until the skill ends. BEA-Y “友谊万岁” "但获得迷彩":
//   迷彩 (flag camou) while her skill runs.
// - T1 不退之旗 "部署时自身持有军旗；军旗周围8格的干员攻击速度+10，敌人的攻击速度-10" (full potential: ±12; bb
//   sleach_t_1[ally/enemy].attack_speed; BEA-X stage 3: ±15): the flag is a tile effect — its tile and the 8 around it
//   (x-4) — on her own tile while she holds it, on the tile S2 / S3 throw it to while they run. Operators there (summons
//   not; 孤立 ones too) ASPD +ally, enemies there (ground and air, the ones her side can select) ASPD +enemy; one buff per
//   琴柳 (the client's independentCharacterSource), refreshed every AURA_IV s and taken off a unit that left the area.
// - T2 精神感召 "部署后，下一名部署的干员费用-2" (bb value): from each deployment of hers until the next deployment of one of
//   her player's operators (PRTS 备注 "于任一受影响干员首次部署后失效"), every operator of hers off the field costs −value DP
//   (野鬃's convention: base.cost, at least 0, given back when the effect ends); an operator that leaves the field meanwhile
//   gets it too [ASSUMED: the client's card filter covers the cards entering the hand]; her leaving ends it (Terra Wiki). In
//   this mode the battle-start deployment is free, so it only saves DP when the next deployment is a redeploy. BEA-Y stage 2+
//   adds "若该干员为地面干员，则部署后获得2点部署费用" (hidden module talent cost; PRTS 修正 "在场期间一次"): that next operator
//   deployment gives +cost DP when the operator is a 近战位 one (def.position MELEE), else it is wasted — once per deployment
//   of hers. A 【移动】 is no deployment; summons neither consume nor trigger either effect [ASSUMED].
// - S1 支援号令·γ型 (MANUAL, data SP_FULL — the official ALWAYS of the 执旗手 row; 8 s): +cost DP every `interval` s (the first
//   after one interval), `value` in all (18 at 0.44 s: the last at 7.92 s).
// - S2 信仰传承 (MANUAL, SP_FULL, 15 s): 20 DP (sleach_s_2[cost].cost every …interval 0.75 s, the 20th as the skill ends);
//   the flag is thrown (`_immediatelyReach`: at once) to the tile of the operator with the lowest HP share on the x-1, her
//   aside (Flag `_excludeTargetType` SOURCE; summons / devices never; a 孤立 one neither — the selector does not ignore it),
//   on her own tile when there is none (Terra Wiki), ties broken by the earliest deployed [ASSUMED]. The operator standing on that tile (a tile effect: whoever stands there,
//   herself included) has DEF +def (MULTIPLIER = Σpct) and 生命回复速度 +atk_to_hp_recovery_ratio × her ATK (an hpRegen buff,
//   never a heal: 禁疗 / 无法被友方治疗 do not stop it — kits/README.md checklist 11), the value read from her ATK at the throw
//   and every 1 s after (the template's 1 s trigger). T1's area follows the flag. Back to her when the skill ends.
// - S3 光辉旗帜 (MANUAL, SP_FULL, 10 s): +cost DP at once; the flag goes to one ground tile of the 2-1 (PRTS 军旗索敌逻辑): the
//   tile of the selectable ground enemy her targeting ranks first (blocked → taunt → nearest the goal …: the highest 仇恨),
//   else the free ground tile nearest to it, else her own tile when no selectable ground enemy is there (flyers are never
//   chosen). At once every enemy of the flag's 3×3 (ground and air) is 停顿 and 脆弱 debuff.damage_scale (refreshed while it
//   stays there; the client's [inf] statuses — 抵抗 does not shorten a status that lasts while in the area); FLAG_FLIGHT s
//   after the throw the strike lands: every enemy of the 3×3 (ground and air) takes atk_scale × her ATK of the throw physical
//   and a `stun` s 晕眩. T1's area follows the flag; back to her when the skill ends.

import { num, talentBb, moduleBb, traitBb, moduleOn, skillRec, up } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { offsetTile } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skcom_assist_cost[3]';
const S2 = 'skchr_sleach_2';
const S3 = 'skchr_sleach_3';
/** The flag's area: its tile and the 8 around it (the client's x-4 auras of 不退之旗 and of S3's flag / strike). */
const X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);
/** S3's strike lands this long after the throw (PRTS 备注 "约1s延迟"; projectile_chr_sleach_s3_2 `_lifeTime` 1). */
export const FLAG_FLIGHT = 1;
/** Refresh period / lifetime of the flag's tile effects while a unit stands in their area. */
const AURA_IV = 0.2;
const AURA_DUR = 0.35;
/** BEA-X: the client's sleach_trait_e[trigger] interval. */
const FRONT_IV = 0.2;
/** Selection profile of the flag's enemy effects: ground and air (targetMotion ALL), the enemies her side can select. */
const ANY = Object.freeze({ canHitFly: true });
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });

export const FLAG_ALLY = 'sleach:flag:ally';
export const FLAG_ENEMY = 'sleach:flag:enemy';
export const S2_KEY = 'sleach:s2';
export const FRONT_KEY = 'sleach:front';
export const CAMOU_KEY = 'sleach:camou';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tileKey = (r, c) => r * COLS + c;
/** A living deployed operator (summons / devices are no 干员). */
const isOp = (a) => !!a && a.kind === 'op' && a.alive && a.deployed && !a.hidden;

/** The tile of her flag: the one S2 / S3 threw it to while they run, else her own (she holds it). */
function flagTile(unit) {
  const f = unit.mem.sleachFlag;
  return f ? [f.r, f.c] : [unit.tileR, unit.tileC];
}
const areaKeys = (unit, r, c) => new Set(absoluteRangeKeys(X4, r, c, unit.dir, 0));

/**
 * A skill's DP over time: `step` DP every `iv` s from `first` s on, `total` in all; a skill that runs its full duration pays
 * the rest at its end (the last tick may fall on the end itself — S2's 20th DP at 15 s). One 'dp' fx with the sum at the end.
 */
function dpOverTime({ total, step = 1, iv, first = iv }) {
  const stepIv = stepOf('interval', iv, iv);
  const stepN = stepOf('cost', step, step);
  const firstAt = first === iv ? stepIv : stepOf('interval', first, first);
  return {
    start(unit) { unit.mem.sleachDp = { t: 0, next: firstAt, given: 0 }; },
    tick(battle, unit, dt) {
      const d = unit.mem.sleachDp;
      if (!d || !(stepIv > 0) || !(stepN > 0)) return;
      d.t += dt;
      let guard = 0;
      while (d.t + 1e-9 >= d.next && d.given + stepN <= total + 1e-9 && guard++ < STEP_PER_TICK) { // loop-cap: stepOf interval/cost
        d.given += stepN;
        d.next += stepIv;
        battle.addDp(unit.ownerId, stepN);
      }
    },
    end(battle, unit, reason) {
      const d = unit.mem.sleachDp;
      unit.mem.sleachDp = null;
      if (!d) return;
      const rest = total - d.given;
      if (reason === 'duration' && rest > 1e-9) { battle.addDp(unit.ownerId, rest); d.given += rest; }
      if (d.given > 0) battle.fx('dp', { x: unit.x, y: unit.y, n: d.given, id: unit.id });
    },
  };
}

/**
 * S2's target tile: the operator with the lowest HP share on the x-1 (not her; not a 孤立 one — the selector, unlike the flag's
 * own effects, does not ignore 孤立), else her own tile.
 */
function s2Tile(battle, unit, grid) {
  const keys = new Set(absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0));
  const cands = battle.allyUnits.filter((a) => isOp(a) && a !== unit && battle.allySelectable(a, unit) && keys.has(tileKey(a.tileR, a.tileC)));
  cands.sort((a, b) => a.hpRatio - b.hpRatio || a.deploySeq - b.deploySeq || a.id - b.id);
  const t = cands[0];
  return t ? [t.tileR, t.tileC] : [unit.tileR, unit.tileC];
}

/**
 * S3's target tile (PRTS 军旗索敌逻辑): ground tiles of the 2-1 only — the tile of the selectable ground enemy ranked first
 * (her targeting order: the highest 仇恨), else the free ground tile of the range nearest to it, else her own tile.
 */
function s3Tile(battle, unit, grid) {
  const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
  const ground = (r, c) => battle.grid.inRect(r, c) && battle.grid.isLow(r, c);
  const foes = battle.enemiesInKeys(keys, unit, GROUND).filter((e) => !e.isFlying);
  if (!foes.length) return [unit.tileR, unit.tileC];
  sortEnemyTargets(battle, unit, foes, null);
  const top = foes[0];
  const er = Math.round(top.y), ec = Math.round(top.x);
  if (keys.includes(tileKey(er, ec)) && ground(er, ec)) return [er, ec];
  let best = null, bd = Infinity;
  for (const k of keys) {
    const r = (k / COLS) | 0, c = k % COLS;
    if (!ground(r, c) || battle.unitAt(r, c)) continue;
    const d = hypot(c - top.x, r - top.y);
    if (d < bd - 1e-9) { bd = d; best = [r, c]; }
  }
  return best ?? [unit.tileR, unit.tileC];
}

export default {
  char_479_sleach: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const allyAspd = num(t0['sleach_t_1[ally].attack_speed']), enemyAspd = num(t0['sleach_t_1[enemy].attack_speed']);
    const hidden = moduleBb(chess);           // BEA-Y stage 2+: cost (the next ground operator's DP)
    const frontBlock = num(traitBb(chess).block_cnt);
    const camou = moduleOn(chess) && /迷彩/.test(String(chess?.trait?.desc ?? ''));
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const X1 = s2?.rangeGrid ?? [[2, 0], [1, -1], [1, 0], [1, 1], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, -1], [-1, 0], [-1, 1], [-2, 0]];
    const R21 = s3?.rangeGrid ?? [[2, 0], [1, 0], [1, 1], [0, 0], [0, 1], [0, 2], [-1, 0], [-1, 1], [-2, 0]];

    const dp1 = dpOverTime({ total: num(b1.value), step: num(b1.cost, 1), iv: num(b1.interval, 0.44) });
    const dp2 = dpOverTime({ total: num(b2.value), step: num(b2['sleach_s_2[cost].cost'], 1), iv: num(b2['sleach_s_2[cost].interval'], 0.75) });

    /** S2's flag effect on the operator of its tile: DEF +def, 生命回复速度 from her ATK (re-read every second). */
    const s2Effect = (battle, unit) => {
      const m = unit.mem, f = m.sleachFlag;
      if (!f || !up(unit)) return;
      if (m.sleachS2Regen == null || m.sleachS2T + 1e-9 >= m.sleachS2Next) {
        m.sleachS2Regen = unit.s.atk * num(b2.atk_to_hp_recovery_ratio);
        while (m.sleachS2T + 1e-9 >= m.sleachS2Next) m.sleachS2Next += 1; // loop-cap: constant one-second step
      }
      const a = battle.unitAt(f.r, f.c);
      const key = `${S2_KEY}:${unit.id}`;
      const cur = m.sleachS2On;
      if (cur && cur !== a) battle.removeBuff(cur, key);
      m.sleachS2On = null;
      if (!isOp(a)) return;
      const b = a.findBuff(key);
      if (!b || b.mods?.hpRegen !== m.sleachS2Regen) battle.addBuff(a, { key, mods: { defPct: num(b2.def), hpRegen: m.sleachS2Regen }, source: unit, tags: ['skill'] });
      m.sleachS2On = a;
    };
    const s2Clear = (battle, unit) => {
      const a = unit.mem.sleachS2On;
      if (a) battle.removeBuff(a, `${S2_KEY}:${unit.id}`);
      unit.mem.sleachS2On = null;
    };

    return {
      skills: {
        [S1]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ unit }) { dp1.start(unit); },
          onTick({ battle, unit, dt }) { dp1.tick(battle, unit, dt); },
          onEnd({ battle, unit, reason }) { dp1.end(battle, unit, reason); },
        },
        [S2]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            dp2.start(unit);
            const [r, c] = s2Tile(battle, unit, X1);
            unit.mem.sleachFlag = { r, c };
            Object.assign(unit.mem, { sleachS2T: 0, sleachS2Next: 0, sleachS2Regen: null, sleachS2On: null });
            battle.fx('zone', { x: c, y: r, radius: 0.5, dur: num(s2?.duration, 15), id: unit.id, skill: 'sleach:flag' });
            s2Effect(battle, unit);
          },
          onTick({ battle, unit, dt }) {
            dp2.tick(battle, unit, dt);
            unit.mem.sleachS2T += dt;
            s2Effect(battle, unit);
          },
          onEnd({ battle, unit, reason }) {
            dp2.end(battle, unit, reason);
            s2Clear(battle, unit);
            unit.mem.sleachFlag = null;
          },
        },
        [S3]: {
          kind: 'duration',
          attack: { noAttack: true },
          onStart({ battle, unit }) {
            const cost = num(b3.cost);
            if (cost > 0) { battle.addDp(unit.ownerId, cost); battle.fx('dp', { x: unit.x, y: unit.y, n: cost, id: unit.id }); }
            const [r, c] = s3Tile(battle, unit, R21);
            const seq = (unit.mem.sleachThrow ?? 0) + 1;
            unit.mem.sleachThrow = seq;
            unit.mem.sleachFlag = { r, c, s3: true };
            battle.fx('zone', { x: c, y: r, radius: 1.5, dur: num(s3?.duration, 10), id: unit.id, skill: 'sleach:flag' });
            unit.mem.sleachS3Acc = AURA_IV; // the 停顿 / 脆弱 start at once (before the flag lands)
            // the strike: FLAG_FLIGHT s later on the flag's 3×3 (ground and air), with her ATK of the throw
            const atk = unit.s.atk, scale = num(b3.atk_scale, 1), stun = num(b3.stun);
            battle.after(FLAG_FLIGHT, () => {
              if (battle.finished) return;
              const keys = [...areaKeys(unit, r, c)];
              battle.fx('aoe', { x: c, y: r, radius: 1.5, id: unit.id, skill: 'sleach:strike' });
              for (const e of battle.enemiesInKeys(keys, unit, ANY)) {
                if (!e.alive) continue;
                battle.dealDamage(unit, e, { amount: atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'sleach:strike'] });
                if (e.alive && stun > 0) battle.applyStatus(e, 'stun', { duration: stun, source: unit });
              }
            }, { owner: unit });
          },
          onTick({ battle, unit, dt }) {
            const f = unit.mem.sleachFlag;
            if (!f) return;
            unit.mem.sleachS3Acc += dt;
            if (unit.mem.sleachS3Acc + 1e-9 < AURA_IV) return;
            unit.mem.sleachS3Acc = 0;
            const frag = num(b3['debuff.damage_scale'], num(b3.damage_scale, 1) - 1);
            for (const e of battle.enemiesInKeys([...areaKeys(unit, f.r, f.c)], unit, ANY)) {
              battle.applyStatus(e, 'sluggish', { duration: AURA_DUR, source: unit, resistApplied: true });
              if (frag > 0) battle.applyStatus(e, 'fragile', { duration: AURA_DUR, value: frag, source: unit, resistApplied: true });
            }
          },
          onEnd({ unit }) { unit.mem.sleachFlag = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 不退之旗: the flag's 3×3 — operators ASPD +ally, enemies ASPD +enemy (follows the flag)
          if (!allyAspd && !enemyAspd) return;
          const aKey = `${FLAG_ALLY}:${unit.id}`, eKey = `${FLAG_ENEMY}:${unit.id}`;
          let cur = new Set();
          battle.every(AURA_IV, () => {
            const next = new Set();
            if (up(unit)) {
              const [r, c] = flagTile(unit);
              const keys = areaKeys(unit, r, c);
              if (allyAspd) {
                for (const a of battle.allyUnits) {
                  if (!isOp(a) || !keys.has(tileKey(a.tileR, a.tileC))) continue;
                  battle.addBuff(a, { key: aKey, duration: AURA_DUR, refresh: 'extend', mods: { aspd: allyAspd }, source: unit, tags: ['aura'] });
                  next.add(a);
                }
              }
              if (enemyAspd) {
                for (const e of battle.enemiesInKeys([...keys], unit, ANY)) {
                  battle.addBuff(e, { key: eKey, duration: AURA_DUR, refresh: 'extend', mods: { aspd: enemyAspd }, source: unit, tags: ['aura'] });
                  next.add(e);
                }
              }
            }
            for (const x of cur) if (!next.has(x)) { battle.removeBuff(x, aKey); battle.removeBuff(x, eKey); }
            cur = next;
          }, { owner: unit, immediate: true });
        } },
        { install(battle, unit) { // 精神感召 (+ BEA-Y Lv2+: the next ground operator +cost DP, once per deployment of hers)
          const cut = Math.abs(num(t1.value)), bonus = num(hidden.cost);
          if (!(cut > 0) && !(bonus > 0)) return;
          const cuts = new Map();
          let pending = false, bonusReady = false;
          const mine = (a) => !!a && a.kind === 'op' && a !== unit && a.ownerId === unit.ownerId;
          const waiting = (a) => mine(a) && !a.alive && !a.removed;
          const applyCut = (a) => {
            if (!(cut > 0) || cuts.has(a)) return;
            const d = Math.min(cut, Math.max(0, num(a.base.cost)));
            if (d > 0) a.base.cost -= d;
            cuts.set(a, d);
          };
          const restore = () => {
            for (const [a, d] of cuts) if (d > 0) a.base.cost += d;
            cuts.clear();
          };
          battle.on('deploy', (ctx) => {
            const a = ctx.unit;
            if (a === unit) {
              restore();
              pending = true;
              bonusReady = bonus > 0;
              for (const x of battle.allyUnits) if (waiting(x)) applyCut(x);
              return;
            }
            if (!pending || !mine(a) || ctx.move) return;
            // the next deployment of one of her player's operators uses both up
            restore();
            pending = false;
            if (bonusReady) {
              bonusReady = false;
              if (String(a.def?.position ?? '').toUpperCase() === 'MELEE') {
                battle.addDp(unit.ownerId, bonus);
                battle.fx('dp', { x: a.x, y: a.y, n: bonus, id: unit.id });
              }
            }
          }, { owner: unit });
          battle.on('death', (ctx) => {
            if (ctx.unit === unit) { restore(); pending = false; bonusReady = false; return; }
            if (pending && waiting(ctx.unit)) applyCut(ctx.unit);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // BEA-X 牧人的歌: while a skill of hers runs, the operator in front of her (not stunned / asleep) block +block_cnt
        if (frontBlock > 0) {
          const key = `${FRONT_KEY}:${unit.id}`;
          let given = new Set();
          let timer = null;
          const give = () => {
            if (!up(unit) || !unit.skill?.active) return;
            const [r, c] = offsetTile(unit.tileR, unit.tileC, 0, 1, unit.dir);
            const a = battle.grid.inRect(r, c) ? battle.unitAt(r, c) : null;
            if (!isOp(a) || a === unit || a.s.flags.stun || a.s.flags.freeze || a.s.flags.sleep) return;
            if (!a.findBuff(key)) battle.addBuff(a, { key, mods: { blockCnt: frontBlock }, source: unit, tags: ['trait'] });
            given.add(a);
          };
          battle.on('skillStart', (ctx) => {
            if (ctx.unit !== unit) return;
            give();
            if (timer) timer.cancel();
            timer = battle.every(FRONT_IV, () => give(), { owner: unit });
          }, { owner: unit });
          battle.on('skillEnd', (ctx) => {
            if (ctx.unit !== unit) return;
            if (timer) { timer.cancel(); timer = null; }
            for (const a of given) battle.removeBuff(a, key);
            given = new Set();
          }, { owner: unit });
        }
        // BEA-Y “友谊万岁”: 迷彩 while a skill of hers runs
        if (camou) {
          battle.on('skillStart', (ctx) => { if (ctx.unit === unit) battle.addBuff(unit, { key: CAMOU_KEY, flags: { camou: true }, tags: ['trait'] }); }, { owner: unit });
          battle.on('skillEnd', (ctx) => { if (ctx.unit === unit) battle.removeBuff(unit, CAMOU_KEY); }, { owner: unit });
        }
      },
    };
  },
};
