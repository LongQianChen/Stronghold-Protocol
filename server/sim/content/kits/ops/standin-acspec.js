// server/sim/content/kits/ops/standin-acspec.js — Misery (char_615_acspec, 卫戍协议 6★ 特种·处决者) 补位 stand-in kit.
// Stands in for 缄默德克萨斯 (tier 4, S2), 山 (tier 5, S3 + EXE-X) and 新约能天使 / 锏 (tier 6, S3 + EXE-X):
// data/backups.json `units.char_615_acspec.standsIn`. Kit contract: ../README.md "Stand-in kits".
// Numbers: the blackboards of data/backups.json (skill_table / character_table / battle_equip_table); what the data
// does not carry: PRTS Misery(卫戍协议), cited where used.

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff } from '../shared/tier1.js';
import { lonely } from '../shared/tier4.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyInRange } from '../../../body.js';

const S1 = 'skchr_acspec_1';
const S2 = 'skchr_acspec_2';
const S3 = 'skchr_acspec_3';
const PULL_TAG = 'acspec:pull';
/** A 被动 ON_DEPLOY skill with a duration: a duration skill every deployment starts (no SP, never cast otherwise). */
const ON_DEPLOY = Object.freeze({ kind: 'duration', activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER' });
const s1On = (unit) => !!(unit.skill && unit.skill.active && unit.skill.id === S1);
/**
 * 四维分离's "周围四格": her tile and the four tiles beside it [ASSUMED: her own tile counts — an enemy she blocks stands
 * on it, and the talent is about her being alone with one enemy].
 */
const AROUND4 = Object.freeze([[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]);
/** 空间的归依's area when the record has none: range x-4, her tile and the eight around it. */
const RING_X4 = Object.freeze([[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]]);

/** Living enemies whose body is on her tile or the four beside it, targetable or not (flyers too). */
function enemiesAround4(battle, unit) {
  const keys = new Set(absoluteRangeKeys(AROUND4, unit.tileR, unit.tileC, unit.dir, 0));
  let n = 0;
  for (const e of battle.enemies) if (e.alive && e.deployed && !e.hidden && bodyInRange(e, keys)) n++;
  return n;
}

/**
 * 空间的归依 at a deployment: atk_scale × ATK physical damage to every ground enemy around her (技能范围 x-4), then each
 * enemy of that area nobody blocks is dragged to her front with 力度 `force` (0 = 小力: Battle.pullToFront, 力度 − 重量)
 * and slowed (停顿) for `sluggish` s. PRTS 备注: "※不可对空" and "施加拖动与停顿效果的实际方式为：对目标进行一次0%攻击力
 * 的近战攻击，此次附带了拖拽与停顿效果" — so the drag and the 停顿 ride a 0-damage physical hit, and an enemy that dodges it
 * (or is out of reach of a hit: invulnerable, asleep) keeps its place. [ASSUMED] that hit is not a normal attack (no
 * isAttack procs); the drag area is the damage area (the text names no other).
 */
function spaceBurst(battle, unit, rec) {
  const sb = rec?.bb ?? {};
  const grid = Array.isArray(rec?.rangeGrid) && rec.rangeGrid.length ? rec.rangeGrid : RING_X4;
  const keys = absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, 0);
  const around = battle.enemiesInKeys(keys, unit, { canHitFly: false, groundOnly: true });
  for (const e of around) battle.dealDamage(unit, e, { amount: unit.s.atk * num(sb.atk_scale, 0), type: 'phys', isSkill: true, tags: ['skill', 'acspec:burst'] });
  const landed = new Set();
  const h = battle.on('damaged', (c) => { if (c.source === unit && c.dmg?.tags?.includes(PULL_TAG)) landed.add(c.target); }, { owner: unit, priority: 1000 });
  try {
    for (const e of around) if (e.alive && !e.blockedBy) battle.dealDamage(unit, e, { amount: 0, type: 'phys', isSkill: true, tags: ['skill', PULL_TAG] });
  } finally {
    battle.off(h);
  }
  for (const e of around) {
    if (!landed.has(e) || !e.alive) continue;
    battle.pullToFront(e, unit, num(sb.force, 0));
    if (e.alive) battle.applyStatus(e, 'sluggish', { duration: num(sb.sluggish, 2.5), source: unit });
  }
}

export default {
  // Misery — trait 再部署时间大幅度减少: the data's respawnTime (18 s). Talent 1 二象命末: each attack is a double hit with
  // attack@prob (PRTS 备注: it is her normal attack's basic logic; EXE-X levels 2 / 3 make it +atk ATK and a higher
  // chance). Talent 2 四维分离: ATK +atk while exactly `cnt` enemy stands on her tile or the four beside it.
  // All three skills are 被动, ON_DEPLOY — they start at every deployment (the battle-start one included, when no enemy
  // is on the field yet: S3 then hits nothing, as in the official mode; it matters on a redeploy). S1 / S2 last the
  // skill's duration (10 s): duration skills started by the deployment (`activateOnDeploy`, the deploy-timed skill
  // contract of PR #109 — their own skillStart / skillEnd and the client's skill on / off), not a passive holding a timed
  // buff:
  // S1 物理的服从: while it runs the talent-1 chance is attack@prob and physical dodge prob.
  // S2 战争的恭顺: while it runs ATK +atk, ASPD +attack_speed.
  // S3 空间的归依: spaceBurst above (ground only), right after each deployment (install).
  // Module EXE-X (trait atk): ATK +atk while no ally stands on the four tiles beside her (PRTS: unlike the usual EXE-X;
  // shared/tier4.js lonely, as 缄默德克萨斯's module of the same text).
  // [ASSUMED] PRTS's 存疑 note on talent 1 — a 1 s trigger cooldown that would make her wait 1 s after each attack — is not
  // modelled: her attack interval is the data's (0.93 s base).
  // Ground only, ground-targetable (data canHitFly false, no flag).
  char_615_acspec: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const moduleAtk = num(traitBb(chess).atk, 0);
    const r1 = skillRec(chess, S1), r2 = skillRec(chess, S2), r3 = skillRec(chess, S3);
    const b1 = r1?.bb ?? {}, b2 = r2?.bb ?? {};
    const talentProb = num(t0['attack@prob'], 0), s1Prob = num(b1['attack@prob'], talentProb);
    const cnt = Math.max(1, Math.floor(num(t1.cnt, 1)));
    return {
      skills: {
        [S1]: { ...ON_DEPLOY, duration: num(r1?.duration, 10), mods: { dodgePhys: num(b1.prob) } },
        [S2]: { ...ON_DEPLOY, duration: num(r2?.duration, 10), mods: { atkPct: num(b2.atk), aspd: num(b2.attack_speed) } },
        [S3]: { kind: 'passive' },
      },
      trait: { hitsFn: (battle, unit) => (battle.rng.chance(s1On(unit) ? s1Prob : talentProb) ? 2 : 1) },
      talents: [
        { install(battle, unit) { statBuff(battle, unit, 'acspec:t1', { atkPct: num(t0.atk) }); } },
        { install(battle, unit) { toggleBuff(battle, unit, 'acspec:t2', () => enemiesAround4(battle, unit) === cnt, { atkPct: num(t1.atk) }); } },
      ],
      install(battle, unit) {
        if (moduleAtk > 0) toggleBuff(battle, unit, 'acspec:module', () => lonely(battle, unit), { atkPct: moduleAtk });
        // 空间的归依 "部署后立即": at the `deploy` of every deployment, after the deploy-time buffs (module / talent-2
        // toggles, priority 0) are on — a passive's onStart runs earlier, inside skill.reset; a 【移动】 (move: true)
        // restarts no passive, as everywhere in the engine
        if (unit.skill?.id === S3) {
          battle.on('deploy', (c) => { if (c.unit === unit && !c.move && unit.alive && unit.deployed) spaceBurst(battle, unit, r3); }, { owner: unit, priority: -10 });
        }
      },
    };
  },
};
