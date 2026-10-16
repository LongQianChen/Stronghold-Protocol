// server/sim/content/kits/ops/op-ray.js — 莱伊 (char_4117_ray) 自选 operator kit: 6★ 猎手 (狙击), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait, both modules (HUN-X 《跳舞的月光》, HUN-Y 证明什么？) at
// every form, and the kit of her summon 沙地兽 (token_10034_ray_sndbst). Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4117_ray): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table / the token's character_table row (zh_CN, as
// built into backups.json) and PRTS 莱伊 (巡哨伙伴 / 入神 / S1 / S2 / S3 备注), PRTS 沙地兽 (备注 "持有禁疗、无敌", "退场时返还1
// 个可部署的沙地兽", "莱伊退场时强制撤退场上的沙地兽"; its skill "仅在持有者携带技能2时才会携带"), PRTS 分支特性信息 猎手, BWIKI
// 莱伊 ("装填间隔即为攻击间隔，初始子弹数即为最大子弹数"), PRTS 卫戍协议/帮助 (a placed summon that leaves is deployed again on
// its tile "在满足条件后"); the client's battle data read from the local install — buff_template_data ray_tr / ray_tr_add /
// ray_tr_sub (the magazine), ray_s_1[konckback] (Knockback _useSourceDirection, _decreaseForceLevelWhenNotInDirection 1),
// ray_s_1[kill_add_bullet], ray_t_1[damage_scale] (PHYSICAL DamageScale on targets holding ray_sndbst_aura), ray_s_2[deck],
// ray_s_3[reload] / [check_full] / [sp], ray_sndbst_tr / ray_sndbst_collect, and charpack char_4117_ray.
// - Trait (猎手) "攻击时需要消耗子弹且攻击力提升至120%，不攻击时会缓慢地装填子弹（最多8发）" (trait bb value / atk_scale; the
//   hunter profile's ×atk_scale on every bullet attack, skill attacks included). PRTS 分支特性信息 猎手: "入场时持有自身子弹上限
//   数的子弹" — full at every deployment; "存在子弹且攻击范围内存在目标时进行攻击，不存在子弹/子弹未满且攻击范围内无目标时进行
//   装弹，通常情况下每次装填1颗" and "装弹行为属于普通攻击行为，持续时间使用装填间隔，装填间隔默认为自身基础攻击间隔，不受攻速/
//   攻击间隔变化影响": a reload is an action of her attack loop lasting her BASE attack time (1.6 s; ASPD never shortens it),
//   loading one bullet when it ends — taken when the magazine is empty (targets or not) or not full with nobody to shoot.
//   This kit's own reload (kit trait install / canAttack / afterAttack); the engine's hunter profile (1 bullet per second
//   after 1 s without attacking) stays for 雪猎. Can hit air units (PRTS "可对空"), blocks 1, ground enemies target her.
//   HUN-X adds "子弹数量为空时下次装填额外加装1发子弹" (trait bb extra_add): a reload begun on an empty magazine loads 1 + that.
//   HUN-Y raises the trait to atk_scale 1.33 (and ASPD +5 / +7 in the stats).
// - T1 巡哨伙伴 "可以在攻击范围内部署沙地兽于25秒内侦察一片区域延伸攻击范围，自身优先攻击该区域内的目标且对其造成的物理伤害提
//   高15%" (bb damage_scale; HUN-X stage 3: 20 % and "沙地兽的再部署时间-10秒" — the token's module stats, respawn 20 s).
//   PRTS 备注: "攻击范围内" of her attacks, talents and skills means "自己或自己的召唤物的攻击范围内" — while a 沙地兽 scouts,
//   the enemies of its x-4 (3×3) are in her range (Battle.setExtraRange) and in her skills' trigger range
//   (skill.addTriggerRange); she picks a target of that area before any other (after the ones she blocks); her physical
//   damage on an enemy there ×(1 + damage_scale) ("伤害倍率提升": DamageInfo mul).
//   The 沙地兽 is a hand piece the player places in her range (data ownerRange): it deploys with the board, scouts for the
//   token talent's `duration` (25 s) and then leaves [ASSUMED: the scouting ends with its stay — PRTS "退场时返还1个可部署
//   的沙地兽"]; it is untargetable (its trait text), 无敌 and 禁疗 (PRTS 备注), makes no attack (实体类型 装置) [ASSUMED], and
//   is withdrawn when 莱伊 leaves the field (PRTS 备注). A 沙地兽 that left comes back on its tile once its redeploy time
//   (×(1 + S2 respawn_time) while 广域警觉 runs) has passed, paying its cost (3 DP), while 莱伊 is on the field.
// - T2 入神 "攻击相同目标时每次攻击提高自身攻击力8%，最多3层" (full potential: 9 %; bb atk / max_stack_cnt; HUN-Y stage 3: 10 %, 4 layers). PRTS 备注:
//   "每次攻击前：若目标与上次攻击目标不同，失去之前获得的增益；随后获得一层增益，持续时间无限" — before each attack (the special
//   bullet of S1 too; never a reload), lost on a new target, gone when she leaves the field.
// - S1 脱身矢 (MANUAL, 2 charges, data DEFAULT): "立即用额外特殊子弹攻击目标，造成相当于攻击力N%的物理伤害并将其中等力度地推开，
//   若将其击倒则使下次装填额外加装1发子弹". PRTS 备注: "'额外特殊子弹'实际为无需消耗子弹的一次攻击，可受特性加成" — an attack
//   at once (Battle.forceAttack; the cast's normal attack follows as usual) at atk_scale × ATK × the trait scale that takes no
//   bullet; a 中力 (bb force) push along her facing, radial at 力度 −1 when the target is off it (PRTS "推动方向默认为自身朝
//   向，因角度过大变为径向推力时，力度仅-1": the engine's directional rule with a −1 instead of −2); a kill adds bb cnt bullets
//   to the next reload ("额外装填效果可叠加并于下1次装填时一同生效"). With an empty magazine (no attack to wait for) the cast
//   comes as soon as an enemy is in range [ASSUMED, as 雪猎's special bullets]. The 地穴 clause has nothing to act on here.
// - S2 广域警觉 (AUTO, attack SP; 持续时间无限 — a toggle): range 4-10, ATK +atk, the 沙地兽's redeploy time ×(1 +
//   respawn_time). Self / summon effects only: it fires at full SP (`trigger: 'SP_FULL'`, the owner's AUTO rule).
//   Passive "沙地兽撤退时回收命中该区域的子弹": while she carries S2, the bullets of her attacks that hit an enemy inside a
//   scouting 沙地兽's area are counted (its own counter: ≤ its trait value 8 — ray_sndbst_tr) and come back to her magazine
//   when it leaves, while she is on the field (ray_sndbst_collect → ray_tr_add: HUN-X's extra_add first on an empty
//   magazine, capped at her maximum); S1's special bullet is no bullet. PRTS "装弹行为不触发攻击回复": no reload gives
//   attack SP.
// - S3 “得见光芒” (MANUAL, 16 s, data ACTIVE_RANGE on its 3-8): "立即停止攻击直至子弹装满，装填间隔大幅缩短(-1.2)": at the cast
//   she stops attacking and reloads (a reload under way is cut to the new interval) until her magazine is full, every reload
//   while it runs lasting base attack time + reload_interval (0.4 s); range 3-8; every attack attack@atk_scale × ATK
//   (× the trait scale) and 束缚 (bind) attack@unmove_duration s; a kill of hers during it ⇒ +sp SP when it ends, through
//   阻回 (PRTS 备注 "获得技力效果无视阻回").

import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { acquireTargets, effectiveProfile } from '../../../ai.js';
import { sortEnemyTargets } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';
import { PUSH_DIRECTIONAL_MIN_DIST } from '../../../constants.js';
import { startCountdown } from '../../tokens.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_ray_1';
const S2 = 'skchr_ray_2';
const S3 = 'skchr_ray_3';
export const SANDBEAST = 'token_10034_ray_sndbst';
/** 巡哨伙伴 (E2): the 沙地兽's scouting when its def carries no duration (PRTS: "持续25秒"). */
const LIFE_FALLBACK = 25;
/** Seconds between two tries of a 沙地兽 that left to come back (tile busy, DP short, 莱伊 away). */
const RETRY = 0.25;
/** Tag of S1's special bullet (no bullet of the magazine). */
export const SPECIAL_TAG = 'ray:special';
const TRANCE_KEY = 'talent:ray:trance';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** The magazine of the trait ("最多8发"). */
const ammoMax = (unit) => Math.max(1, Math.floor(num(unit.profile?.ammoMax, 8)));
/** First talent of a normalised token def holding `key` (token talents keep no index). */
const tokTalent = (def, key) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null) ?? null;

/** The 沙地兽's kit: no attack, 无敌, 禁疗 (its untargetability comes from its trait text, simdata normalizeToken). */
function sandbeastKit() {
  return {
    skill: null,
    trait: { noAttack: true },
    talents: [],
    install(battle, t) {
      battle.addBuff(t, { key: 'ray:sandbeast', flags: { invulnerable: true, noHeal: true }, persist: true, allowDead: true });
    },
  };
}

export default {
  char_4117_ray: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const extraAdd = Math.max(0, Math.floor(num(traitBb(chess).extra_add)));
    const picked = chess?.skill?.skillId ?? null;
    const tokenId = (chess?.talents ?? []).find((t) => t && t.tokenKey)?.tokenKey ?? SANDBEAST;

    /** One reload: her base attack time, S3's reload_interval while it runs (PRTS: ASPD never changes it). */
    const reloadInterval = (unit) => {
      const s3on = !!(unit.skill && unit.skill.active && unit.skill.id === S3);
      return Math.max(0.05, num(unit.base?.bat, 1.6) + (s3on ? num(b3.reload_interval) : 0));
    };
    const startReload = (unit) => {
      const m = unit.mem;
      m.rayReloading = true;
      if ((unit.trait.ammo ?? 0) <= 0 && extraAdd > 0) m.rayLoadExtra = (m.rayLoadExtra ?? 0) + extraAdd;   // HUN-X
      unit.atkCd = reloadInterval(unit);
    };
    const finishReload = (unit) => {
      const m = unit.mem;
      m.rayReloading = false;
      const add = 1 + Math.max(0, Math.floor(num(m.rayLoadExtra)));
      m.rayLoadExtra = 0;
      unit.trait.ammo = Math.min(ammoMax(unit), (unit.trait.ammo ?? 0) + add);
    };
    const resetTrait = (unit) => {
      unit.trait.ammo = ammoMax(unit);
      Object.assign(unit.mem, { rayReloading: false, rayLoadExtra: 0, rayFill: false });
    };

    return {
      trait: {
        // 猎手 (PRTS 分支特性信息): her own reload, an action of the attack loop (canAttack runs once the cooldown is over)
        install(battle, unit) {
          resetTrait(unit);
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) resetTrait(unit); }, { owner: unit });
        },
        canAttack(battle, unit) {
          const m = unit.mem;
          if (m.rayReloading) finishReload(unit);
          const max = ammoMax(unit), ammo = unit.trait.ammo ?? 0;
          if (m.rayFill) {   // S3: no attack until the magazine is full
            if (ammo < max) { startReload(unit); return false; }
            m.rayFill = false;
          }
          if (ammo <= 0 || (ammo < max && !acquireTargets(battle, unit, effectiveProfile(unit)).length)) { startReload(unit); return false; }
          return true;
        },
        afterAttack(battle, unit) { unit.trait.ammo = Math.max(0, (unit.trait.ammo ?? 0) - 1); },
      },
      skills: {
        [S1]: {
          kind: num(skillRec(chess, S1)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          // the special bullet: an attack that spends no bullet (its own afterAttack) and takes the trait scale
          attack: {
            atkScale: num(b1.atk_scale, 1),
            tags: ['skill', SPECIAL_TAG],
            afterAttack() {},
            onHit({ battle, unit, target }) {
              if (!target) return;
              if (!target.alive) { unit.mem.rayLoadExtra = num(unit.mem.rayLoadExtra) + Math.max(0, Math.floor(num(b1.cnt, 1))); return; }
              const force = num(b1.force, 1);
              const [fr, fc] = unit.fwd;
              const vx = target.x - unit.x, vy = target.y - unit.y, d = hypot(vx, vy);
              if (d >= PUSH_DIRECTIONAL_MIN_DIST && vx * fc + vy * fr >= d * Math.SQRT1_2) battle.push(target, force, { from: unit, dir: { x: fc, y: fr }, fixed: true });
              else battle.push(target, force - 1, { from: unit });
            },
          },
          onStart({ battle, skill, unit }) {
            if (battle.forceAttack(unit)) return;
            // nobody to shoot after all: no cast
            skill.pending = false;
            skill.addCharge(1);
          },
        },
        [S2]: {
          kind: 'toggle',
          trigger: 'SP_FULL',
          mods: { atkPct: num(b2.atk) },
          targeting: s2?.rangeGrid ? { rangeGrid: s2.rangeGrid.map((p) => [p[0], p[1]]) } : undefined,
        },
        [S3]: {
          kind: 'duration',
          targeting: s3?.rangeGrid ? { rangeGrid: s3.rangeGrid.map((p) => [p[0], p[1]]) } : undefined,
          attack: {
            atkScale: num(b3['attack@atk_scale'], 1),
            onHit({ battle, unit, target }) {
              if (target && target.alive) battle.applyStatus(target, 'bind', { duration: num(b3['attack@unmove_duration'], 2), source: unit });
            },
          },
          onStart({ unit }) {
            const m = unit.mem;
            m.rayFill = true;
            m.rayKilled = false;
            // 立即停止攻击: the reload starts now (one under way is cut to the new interval)
            unit.atkCd = m.rayReloading ? Math.min(unit.atkCd, reloadInterval(unit)) : 0;
          },
          onEnd({ unit, reason }) {
            const m = unit.mem;
            m.rayFill = false;
            if (m.rayKilled && reason !== 'death' && up(unit) && unit.skill) unit.skill.gainSp(num(b3.sp), 'init');   // 无视阻回
            m.rayKilled = false;
          },
        },
      },
      talents: [
        { install(battle, unit) { // 巡哨伙伴 + the 沙地兽 (and S2's bullet recovery)
          const m = unit.mem;
          const mine = (t) => !!t && t.kind === 'token' && t.defId === tokenId && t.ownerUnit === unit;
          // her placed 沙地兽 pieces run the 沙地兽's kit (set up here, before the battle starts — as 鸿雪's 打字机)
          for (const t of battle.allyUnits) {
            if (!mine(t) || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, sandbeastKit());
          }
          const ds = num(t0.damage_scale);
          m.rayArea = null;
          m.rayBullets = 0;
          if (unit.skill) unit.skill.addTriggerRange(() => (m.rayAreaKeys ? [m.rayAreaKeys] : []));
          const endArea = () => { m.rayArea = null; m.rayAreaKeys = null; m.rayBeast = null; battle.setExtraRange(unit, null); };
          battle.on('deploy', (ctx) => {
            const t = ctx.unit;
            if (!mine(t)) return;
            const life = num(tokTalent(t.def, 'duration')?.bb?.duration, LIFE_FALLBACK);
            m.rayBeast = t;
            m.rayAreaKeys = [...t.rangeKeys];
            m.rayArea = new Set(m.rayAreaKeys);
            m.rayBullets = 0;
            m.rayCounted = 0;
            battle.setExtraRange(unit, m.rayAreaKeys);
            startCountdown(battle, t, life); // a countdown summon (content/tokens.js): its bar = the life left
            const seq = t.deploySeq;
            battle.after(life, () => { if (t.alive && t.deploySeq === seq) battle.retreat(t, { reason: 'expired', permanent: true }); }, { owner: unit });
          }, { owner: unit });
          battle.on('death', (ctx) => {
            const t = ctx.unit;
            if (t === unit) { // "莱伊退场时强制撤退场上的沙地兽"
              for (const x of battle.allyUnits) if (mine(x) && x.alive) battle.retreat(x, { reason: 'retreat', permanent: true });
              return;
            }
            if (!mine(t) || battle.finished) return;
            t.removed = false; // the piece stays (Battle.redeploy needs it; its hooks are kept)
            if (m.rayBeast === t) endArea();
            // S2 passive: the bullets that hit in its area come back (ray_sndbst_collect → ray_tr_add: its count — ≤ its own
            // trait value — onto her magazine, HUN-X's extra_add first when she is empty, capped at her maximum)
            if (picked === S2 && m.rayBullets > 0 && up(unit)) {
              const back = Math.min(m.rayBullets, Math.max(1, Math.floor(num(t.def?.traitBb?.value, ammoMax(unit)))));
              const empty = (unit.trait.ammo ?? 0) <= 0 ? extraAdd : 0;
              unit.trait.ammo = Math.min(ammoMax(unit), (unit.trait.ammo ?? 0) + empty + back);
            }
            m.rayBullets = 0;
            const left = battle.time;
            battle.every(RETRY, (b, sched) => {
              if (t.alive || t.removed || b.finished) { sched.cancel(); return; }
              const mul = unit.skill && unit.skill.active && unit.skill.id === S2 ? Math.max(0, 1 + num(b2.respawn_time)) : 1;
              if (b.time + 1e-9 < left + Math.max(0, num(t.base.respawnTime)) * mul || !up(unit)) return;
              if (b.redeploy(t, { free: false })) sched.cancel();
            }, { owner: unit });
          }, { owner: unit, priority: -10 });
          // 自身优先攻击该区域内的目标 (after the enemies she blocks)
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !m.rayArea || !ctx.targets.length) return;
            const area = m.rayArea, prof = ctx.profile ?? unit.profile;
            const all = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
            for (const e of battle.blockedTargets(unit, prof)) if (!all.includes(e)) all.push(e);
            if (!all.some((e) => bodyInRange(e, area))) return;
            sortEnemyTargets(battle, unit, all, prof.priority ?? null);
            const rank = (e) => (e.blockedBy === unit ? 0 : bodyInRange(e, area) ? 1 : 2);
            const order = all.map((e, i) => ({ e, i, r: rank(e) })).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.e);
            ctx.targets = order.slice(0, ctx.targets.length);
          }, { owner: unit, priority: 10 });
          // ×(1 + damage_scale) on her physical damage to an enemy of the area
          if (ds > 0) {
            battle.on('hit', (ctx) => {
              if (ctx.source !== unit || !m.rayArea || !ctx.target || ctx.target.side !== 'enemy' || ctx.dmg.type !== 'phys') return;
              if (bodyInRange(ctx.target, m.rayArea)) ctx.dmg.mul *= 1 + ds;
            }, { owner: unit });
          }
          // S2 passive: count the bullets of her attacks that hit an enemy of the area (one per attack)
          if (picked === S2) {
            battle.on('damaged', (ctx) => {
              const d = ctx.dmg, e = ctx.target;
              if (ctx.source !== unit || !m.rayArea || !d || !d.isAttack || !e || e.side !== 'enemy' || (d.tags && d.tags.includes(SPECIAL_TAG))) return;
              if ((d.attackId && d.attackId === m.rayCounted) || !bodyInRange(e, m.rayArea)) return;
              m.rayCounted = d.attackId;
              m.rayBullets++;
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 入神: +atk per attack on the same target (≤ max_stack_cnt), lost on a new target
          const atk = num(t1.atk), max = Math.max(1, Math.floor(num(t1.max_stack_cnt, 3)));
          if (!(atk > 0)) return;
          const m = unit.mem;
          m.rayTrance = null;
          m.rayStacks = 0;
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) { m.rayTrance = null; m.rayStacks = 0; } }, { owner: unit });
          battle.on('beforeAttack', (ctx) => {
            const t = ctx.attacker === unit ? ctx.targets[0] : null;
            if (!t) return;
            if (m.rayTrance !== t) { m.rayTrance = t; m.rayStacks = 0; }
            m.rayStacks = Math.min(max, m.rayStacks + 1);
            battle.addBuff(unit, { key: TRANCE_KEY, mods: { atkPct: atk * m.rayStacks }, tags: ['talent'] });
          }, { owner: unit, priority: -10 });
        } },
      ],
      install(battle, unit) {
        // S3: 技能期间若击倒敌人 — a kill of hers while it runs
        if (picked === S3) {
          battle.on('kill', (ctx) => {
            if (ctx.killer === unit && unit.skill && unit.skill.active && unit.skill.id === S3) unit.mem.rayKilled = true;
          }, { owner: unit });
        }
        // S1 with an empty magazine (the attack loop only reloads then): cast once an enemy is in range [ASSUMED]
        if (picked !== S1) return;
        battle.on('tick', () => {
          const sk = unit.skill;
          if (!up(unit) || !unit.canAct || !sk || !sk.ready || sk.pending || sk.opCooling || unit.s.flags.silence || unit.s.flags.disarm) return;
          if ((unit.trait.ammo ?? 1) > 0) return;
          if (acquireTargets(battle, unit, effectiveProfile(unit)).length) sk.activate('DEFAULT');
        }, { owner: unit });
      },
    };
  },
};
