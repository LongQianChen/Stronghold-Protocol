// server/sim/content/kits/ops/op-weedy.js — 温蒂 (char_400_weedy) 自选 operator kit: 6★ 推击手 (特种), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait, both modules (PUS-X 仿生海龙改型, PUS-Y 新型仿生原型) at
// every form, and the kit of her summon 工程蓄水炮 (token_10009_weedy_cannon). Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_400_weedy, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json; the cannon's
// owner-form / module variants) and PRTS 温蒂 (蓄水炮强化 备注 "天赋文本后半段效果（及模组效果）的作用对象为温蒂自身"; S2 "攻击间隔增大
// (+220%)", 备注 "溅射范围为0.9半径"; S3 备注 "蓄水炮以温蒂的攻击力进行发射…技能范围内没有敌人时温蒂/蓄水炮不会对应发射出液氮炮 /
// 自身优先攻击剩余路径最短的敌人，水炮优先攻击距离自身最近的敌人；液氮炮溅射范围半径1.2，均可对空 / “正比于距离的真实伤害”即…
// 移动创伤（1200伤害/格），再次施加…时仅刷新BUFF的持续时间，不改变真实伤害的来源与每格伤害比例"), PRTS 工程蓄水炮 (备注 "持有禁疗 /
// 蓄水炮的技能和攻击均优先选择离自身最近的敌人作为目标 / 普通攻击…该位移效果仅对前方三格内的地面敌方单位生效 / 部署后20秒自动撤退";
// 技能备注 "蓄水炮进行的发射除基本力度外均以本体的数值为准"), PRTS 特殊机制 移动创伤 (every 0.066 s and once at the end: (distance
// moved since the last update) × 每格伤害 预计算的真实持续伤害, nothing when the difference is > 4 tiles), PRTS 卫戍协议/帮助 (a
// placed summon deploys with the board; "若召唤物在战斗期间退场，将在满足条件后立即原地再部署1个"; a summon's manual skill is
// force-opened).
// - Trait (推击手) "同时攻击阻挡的所有敌人 / 可以放置于远程位": the profession default (pusher `hitAllBlocked`, block 2; melee,
//   ground-only — PRTS 分支特性信息 推击手) and the placement rule of the prep (shared/highGround.js: her trait line lets the
//   match put her on a 高台, where she attacks and blocks nothing). Module PUS-X "可以放置于远程位，并返还该次部署费用的一半"
//   (trait bb value): a redeployment on a ranged (高台) tile gives value × her cost back (as 见行者's PUS-X; the battle-start
//   deployment costs nothing). Module PUS-Y "阻挡2个及以上敌人时自身推力增加一级" (trait bb cnt / base_force_level): her
//   pushes +base_force_level while she blocks ≥ cnt enemies.
// - T1 工程蓄水炮 (the cannon, a hand piece the player places — "部署位置=全部位"): deploys with the board, leaves 20 s after
//   each deployment (its talent `duration`) and comes back on its tile after its redeploy time (35 s; PUS-Y stage 3 "再部署
//   时间减少8秒": the module variant's 27 s), paying its 5 DP, while she is on the field [ASSUMED, as 鸿雪's 打字机]. The
//   cannon: untargetable ("不会受到攻击"), 禁疗, blocks nothing, 3-2 range, ranged physical, hits air, the nearest enemy to
//   itself first; each attack pushes its target 小力 + 蓄水炮强化's base_force_level along its facing — a ground enemy on the
//   three tiles ahead only. Its skill (the copy of S3 the data gives, sktok_weedy_token, MANUAL, 0 SP) is force-opened by the
//   卫戍 strategy: free, once per deployment, by the data's DEFAULT (cast on its attack) — and it fires with every S3 of hers
//   while it stands on one of the 4 tiles around her. It fires with her numbers (her ATK, her S3 level; the damage counts
//   as hers [ASSUMED: "均以本体的数值为准"]) but its own force (+1 by 蓄水炮强化).
// - T2 蓄水炮强化 (the cannon's talent, x-5): while the cannon stands on one of the 4 tiles around her she gains `sp` SP every
//   `interval` s of it (3 s; PUS-X stage 2+: 2.5 / 2 s — the module's token variant) [ASSUMED: the clock runs while it is
//   there] and, PUS-X stage 2+, ATK +atk (the module's hidden token talent, 15 % / 20 %; PRTS 备注: on 温蒂 herself).
// - S1 炮管敲击 (AUTO, data DEFAULT — a "next attack"): that attack (every enemy she blocks) at atk_scale × ATK, each target
//   pushed along her facing with `force` (中力) and 晕眩 `stun` s.
// - S2 水炮模式 (AUTO, 持续时间无限; SP_FULL — a mode switch on herself, the owner's AUTO rule): attack interval ×(1 +
//   base_attack_time) (PRTS lists it as a ratio, "+220%"), ATK +atk, range +ability_range_forward_extend, a ranged attack
//   — one shot with a 0.9-tile splash (PRTS 备注), air units too [ASSUMED: a ranged attack reaches air] — every enemy it hits
//   pushed with base_force_level (小力) along her facing.
// - S3 液氮大炮 (MANUAL, data SKILL_RANGE on its 4-1): at once, the enemy of the 4-1 with the shortest remaining path and
//   every enemy within 1.2 of it (air units too) take atk_scale × ATK arts, the 移动创伤 (`value` × `dist` per tile moved,
//   true damage, `duration` s) and a push of `force` along her facing; the cannon fires too (above). The shot is instant
//   [ASSUMED: no travel time]. Pushes go along her facing (knockback[dir], as every 推击手 push) [ASSUMED for S2 / S3,
//   whose text gives no direction].

import { num, traitBb, skillRec, up, giveSp } from '../shared/tier1.js';
import { stepOf, STEP_PER_TICK } from '../../../../../shared/plugins/steps.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { startCountdown } from '../../tokens.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_weedy_1';
const S2 = 'skchr_weedy_2';
const S3 = 'skchr_weedy_3';
export const CANNON = 'token_10009_weedy_cannon';
/** S3's / the cannon skill's 4-1 when the data carries no grid. */
const GRID_4_1 = Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]]);
/** PRTS S3 备注 "液氮炮溅射范围半径1.2". */
export const NITRO_SPLASH = 1.2;
/** PRTS S2 备注 "溅射范围为0.9半径". */
export const WATER_SPLASH = 0.9;
/** The 移动创伤 buff on an enemy (one per enemy whoever applies it — PRTS: a new one only refreshes its duration). */
export const RUPTURE_KEY = 'weedy:rupture';
/** PRTS 特殊机制 移动创伤: an update whose distance difference is above this deals nothing. */
const RUPTURE_MAX_STEP = 4;
/** 工程蓄水炮's life when the token carries no `duration` talent (E2: 20 s). */
const LIFE_FALLBACK = 20;
/** Seconds between two tries of a cannon to come back (tile busy, DP short, 温蒂 off the field). */
const RETRY = 0.25;
const TAG_NITRO = 'weedy:nitro';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** First talent of a normalised token def whose blackboard holds `key` (token talents keep no index). */
const tokTalent = (def, key, not = null) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null && (not == null || t.bb[not] == null)) ?? null;
/** Push direction along a unit's facing (knockback[dir]). */
const along = (u) => ({ x: u.fwd[1], y: u.fwd[0] });
/** On one of the 4 tiles around (周围4格). */
const beside = (a, b) => Math.abs(a.tileR - b.tileR) + Math.abs(a.tileC - b.tileC) === 1;

/**
 * 移动创伤 (PRTS 特殊机制) on enemy `e`: for `duration` s every `interval` s — and once more at the end — the distance it
 * moved since the last update × `perTile` as true 持续伤害 from `src` (none when that difference is > 4 tiles). A new
 * application while one runs only refreshes its duration: the source and the per-tile damage stay the first one's.
 */
export function rupture(battle, src, e, { duration, perTile, interval }) {
  if (!e || !e.alive || !(duration > 0) || !(perTile > 0)) return;
  const cur = e.findBuff(RUPTURE_KEY);
  if (cur) {
    cur.timeLeft = Math.max(cur.timeLeft, duration);
    cur.duration = Math.max(cur.duration, duration);
    return;
  }
  const st = { x: e.x, y: e.y, moved: 0, acc: 0 };
  const step = (u) => { st.moved += hypot(u.x - st.x, u.y - st.y); st.x = u.x; st.y = u.y; };
  const flush = (u) => {
    const m = st.moved;
    st.moved = 0;
    if (!(m > 1e-9) || m > RUPTURE_MAX_STEP || !u.alive) return;
    battle.dealDamage(src, u, { amount: m * perTile, type: 'true', canDodge: false, isSkill: true, tags: ['skill', 'dot', RUPTURE_KEY] });
  };
  const iv = interval > 0 ? interval : 0.066;
  battle.addBuff(e, {
    key: RUPTURE_KEY, duration, source: src, tags: ['skill'], data: st,
    onTick: ({ unit, dt }) => {
      step(unit);
      st.acc += dt;
      if (st.acc + 1e-9 >= iv) { st.acc -= iv; flush(unit); }
    },
    onExpire: ({ unit }) => { step(unit); flush(unit); },
  });
}

/**
 * One 液氮炮 of `shooter` (温蒂 or her cannon): the target of the skill range (`grid`, the shooter's facing) — `pick`
 * 'path' = the shortest remaining path (温蒂), 'nearest' = nearest to the shooter (the cannon) — and every enemy within
 * NITRO_SPLASH of it: atk_scale × 温蒂's ATK arts from `src`, the 移动创伤, a push of `force` along the shooter's facing.
 * Returns false when no enemy can be selected there (nothing fires).
 */
export function liquidNitrogen(battle, { shooter, src, atk, sbb, grid, force, pick }) {
  const keys = absoluteRangeKeys(grid ?? GRID_4_1, shooter.tileR, shooter.tileC, shooter.dir, 0);
  const cands = battle.enemiesInKeys(keys, shooter, { canHitFly: true });
  if (!cands.length) return false;
  const key = pick === 'nearest' ? (e) => hypot(e.x - shooter.x, e.y - shooter.y) : (e) => battle.remainingDistance(e);
  let target = null, best = Infinity;
  for (const e of cands) {
    const v = key(e);
    if (v < best - 1e-9 || (Math.abs(v - best) <= 1e-9 && target && e.spawnSeq < target.spawnSeq)) { best = v; target = e; }
  }
  const x = target.x, y = target.y;
  battle.fx('frostNova', { x, y, r: NITRO_SPLASH, id: shooter.id, src: shooter.id, target: target.id, dmgType: 'arts', skill: 'weedy_3' });
  const amount = atk * num(sbb.atk_scale, 1);
  const rup = { duration: num(sbb.duration), perTile: num(sbb.value) * num(sbb.dist, 1), interval: num(sbb.interval, 0.066) };
  const dir = along(shooter);
  for (const e of battle.foesInRadius(x, y, NITRO_SPLASH, true)) {
    if (!e.alive) continue;
    battle.dealDamage(src, e, { amount, type: 'arts', isSkill: true, tags: ['skill', TAG_NITRO] });
    if (!e.alive) continue;
    rupture(battle, src, e, rup);   // before the push: the push's displacement counts
    battle.push(e, force, { from: shooter, dir });
  }
  return true;
}

/** 温蒂's deployed cannons. */
const cannonsOf = (battle, unit) => battle.allyUnits.filter((a) => a.kind === 'token' && a.defId === CANNON && a.ownerUnit === unit && a.alive && a.deployed);

/** The cannon's kit: its attack push, its skill, 蓄水炮强化 on 温蒂, its life and its redeploys. `owner` = 温蒂. */
function cannonKit(t, owner) {
  const def = t.def;
  const life = num(tokTalent(def, 'duration')?.bb?.duration, LIFE_FALLBACK);
  const boost = tokTalent(def, 'base_force_level')?.bb ?? {};                 // 蓄水炮强化: base_force_level, interval, sp
  const forceUp = num(boost.base_force_level);
  const every = stepOf('interval', num(boost.interval), 1), sp = num(boost.sp);
  const atkUp = num(tokTalent(def, 'atk', 'base_force_level')?.bb?.atk);      // PUS-X stage 2+: 温蒂 ATK +atk beside it
  const sk = def.skill ?? null;
  const sbb = sk?.bb ?? {};
  const AHEAD = [[0, 1], [0, 2], [0, 3]];
  return {
    skill: sk ? {
      kind: 'instant',
      onStart({ battle, unit }) {
        liquidNitrogen(battle, { shooter: unit, src: owner, atk: owner.s.atk, sbb, grid: sk.rangeGrid ?? GRID_4_1, force: num(sbb.force) + forceUp, pick: 'nearest' });
      },
    } : null,
    trait: {
      priority: 'nearest',
      // "能攻击单个敌人并将其小力度地推开，该位移效果仅对前方三格内的地面敌方单位生效"
      afterHit(battle, unit, target) {
        if (!target || !target.alive || target.side !== 'enemy' || target.isFlying) return;
        const ahead = new Set(absoluteRangeKeys(AHEAD, unit.tileR, unit.tileC, unit.dir, 0));
        if (!bodyInRange(target, ahead)) return;
        battle.push(target, forceUp, { from: unit, dir: along(unit) });
      },
    },
    install(battle, unit) {
      battle.addBuff(unit, { key: 'trait:weedyCannon', flags: { noHeal: true }, persist: true, allowDead: true });   // 持有禁疗
      // 部署后20秒自动撤退 — a countdown summon (content/tokens.js startCountdown): 无敌 [ASSUMED], 禁疗, its bar = the life left
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== unit || !(life > 0)) return;
        startCountdown(battle, unit, life);
        const seq = unit.deploySeq;
        battle.after(life, () => { if (unit.alive && unit.deploySeq === seq) battle.retreat(unit, { reason: 'expired', permanent: true }); }, { owner: unit });
      }, { owner: unit });
      // back on its tile after its redeploy time, paying its cost, while 温蒂 is on the field (the piece is kept)
      battle.on('death', (ctx) => {
        if (ctx.unit !== unit || battle.finished) return;
        unit.removed = false;
        const at = battle.time + Math.max(0, num(unit.base.respawnTime));
        battle.every(RETRY, (b, sched) => {
          if (unit.alive || unit.removed) { sched.cancel(); return; }
          if (b.time + 1e-9 < at || !up(owner)) return;
          if (b.redeploy(unit, { free: false })) sched.cancel();
        }, { owner: unit });
      }, { owner: unit, priority: -10 });
      // 蓄水炮强化 on 温蒂: +sp SP every `interval` s beside her; PUS-X stage 2+: her ATK +atk meanwhile
      let acc = 0;
      const atkKey = `talent:weedy:cannonAtk:${unit.id}`;
      battle.on('tick', ({ dt }) => {
        const on = up(unit) && up(owner) && beside(unit, owner);
        if (!on) {
          acc = 0;
          if (atkUp && owner.findBuff(atkKey)) battle.removeBuff(owner, atkKey);
          return;
        }
        if (atkUp && !owner.findBuff(atkKey)) battle.addBuff(owner, { key: atkKey, mods: { atkPct: atkUp }, source: unit, tags: ['talent'] });
        if (!(every > 0) || !(sp > 0)) return;
        acc += dt;
        let guard = 0;
        while (acc + 1e-9 >= every && guard++ < STEP_PER_TICK) { acc -= every; giveSp(owner, sp); } // loop-cap: stepOf interval
      }, { owner: unit });
    },
  };
}

export default {
  char_400_weedy: (bb, chess) => {
    const tb = traitBb(chess);                         // PUS-X: value; PUS-Y: cnt / base_force_level
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const blockCnt = num(tb.cnt), blockForce = num(tb.base_force_level);
    /**
     * PUS-Y: +base_force_level while she blocks ≥ cnt enemies — counted when the attack starts (`weedyBlocked`, set at
     * `beforeAttack`: the first push of an attack frees an enemy before the second is pushed) or when S3 is cast.
     */
    const bonus = (u, n = u.mem.weedyBlocked ?? u.blocking.length) => (blockForce && blockCnt > 0 && n >= blockCnt ? blockForce : 0);
    return {
      skills: {
        [S1]: {
          kind: 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 1),
            onHit({ battle, unit, target }) {
              if (!target || !target.alive || target.side !== 'enemy') return;
              battle.applyStatus(target, 'stun', { duration: num(b1.stun), source: unit });
              battle.push(target, num(b1.force) + bonus(unit), { from: unit, dir: along(unit) });
            },
          },
        },
        [S2]: {
          kind: 'toggle',
          trigger: { rule: 'SP_FULL' },
          mods: { atkPct: num(b2.atk), batPct: num(b2.base_attack_time) },
          targeting: { rangeExtend: num(b2.ability_range_forward_extend) },
          attack: {
            attack: 'ranged', projectile: 'bomb', splashRadius: WATER_SPLASH, canHitFly: true, hitAllBlocked: false, maxTargets: 1,
            // every enemy the shot hits is pushed once the hit is resolved (a push of the main target inside the hit would
            // move the splash centre: ai.js resolveHit centres it on the target after the main hit's callbacks)
            onEachHit({ unit, target }) {
              if (target && target.side === 'enemy') (unit.mem.weedyWet ??= []).push(target);
            },
            onHit({ battle, unit }) {
              const list = unit.mem.weedyWet ?? [];
              unit.mem.weedyWet = [];
              const f = num(b2.base_force_level) + bonus(unit);
              for (const e of list) if (e.alive) battle.push(e, f, { from: unit, dir: along(unit) });
            },
          },
        },
        [S3]: {
          kind: 'instant',
          onStart({ battle, unit }) {
            liquidNitrogen(battle, { shooter: unit, src: unit, atk: unit.s.atk, sbb: b3, grid: s3?.rangeGrid ?? GRID_4_1, force: num(b3.force) + bonus(unit, unit.blocking.length), pick: 'path' });
            // "如果蓄水炮在周围4格内的话也会同样进行发射" (its own skill numbers and force, her ATK)
            for (const c of cannonsOf(battle, unit)) {
              if (!beside(c, unit)) continue;
              const cs = c.def.skill ?? null;
              const cbb = cs?.bb ?? b3;
              const up1 = num(tokTalent(c.def, 'base_force_level')?.bb?.base_force_level);
              liquidNitrogen(battle, { shooter: c, src: unit, atk: unit.s.atk, sbb: cbb, grid: cs?.rangeGrid ?? GRID_4_1, force: num(cbb.force) + up1, pick: 'nearest' });
            }
          },
        },
      },
      talents: [
        // 工程蓄水炮 (and 蓄水炮强化, the cannon's own talent): her cannon pieces run the cannon's kit — set up here, before the
        // battle starts (Battle._setupUnit with a kit, as op-bgsnow.js does for its 打字机)
        { install(battle, unit) {
          for (const t of battle.allyUnits) {
            if (t.kind !== 'token' || t.defId !== CANNON || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, cannonKit(t, unit));
          }
        } },
        { install() {} },   // 蓄水炮强化 — the cannon's talent (cannonKit)
      ],
      install(battle, unit) {
        if (blockForce) battle.on('beforeAttack', (ctx) => { if (ctx.attacker === unit) unit.mem.weedyBlocked = unit.blocking.length; }, { owner: unit, priority: 100 });
        // PUS-X: "可以放置于远程位，并返还该次部署费用的一半" — a redeployment on a ranged tile (unit.ground false)
        const back = num(tb.value);
        if (back > 0) {
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit || ctx.initial || unit.ground) return;
            const n = unit.base.cost * back;
            battle.addDp(unit.ownerId, n);
            battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
          }, { owner: unit });
        }
      },
    };
  },
};
