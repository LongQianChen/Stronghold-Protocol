// server/sim/content/kits/ops/standin-acfend.js — Mechanist (char_610_acfend) 补位 stand-in kit: 4 星熊 (S2), 5 号角 /
// 6 余 (S3 + module PRO-X on the elite). Stand-in contract and rules: ../README.md "Stand-in kits".

import { num, talentBb, traitBb, skillRec, statBuff, toggleBuff, up } from '../shared/tier1.js';

const S1 = 'skchr_acfend_1', S2 = 'skchr_acfend_2', S3 = 'skchr_acfend_3';
/** 反馈装甲 on an enemy she blocks, and its S2 version (×talent_mult): one buff per target whatever applies it (同名). */
const FEEDBACK_KEY = 'acfend:feedback';
const FEEDBACK_S2_KEY = 'acfend:feedback2';
/** PRTS Mechanist(卫戍协议) 天赋备注: 精研材料's HP ratio and 反馈装甲's block are checked every 0.1 s. */
const CHECK_INTERVAL = 0.1;
/** S3 应力倒置 "每秒…": one pulse per second of the skill, the first 1 s after the cast [ASSUMED: no pulse at the cast]. */
const STRESS_INTERVAL = 1;

export default {
  // Mechanist (铁卫, blocks 3) — numbers from data/backups.json (normal E2 Lv1 rank 4, elite E2 Lv60 rank 7; skill_table and
  // PRTS Mechanist(卫戍协议) agree):
  //   精研材料: DEF +def; below hp_ratio HP another +`acfend_t_1[extra].def` (module PRO-X Lv3: 0.2) — PRTS 备注 "生命比例每0.1秒
  //      检测一次".
  //   反馈装甲: enemies she blocks ASPD `attack_speed` (−7). PRTS 备注: applied every 0.1 s to the enemies she blocks; then the
  //      TARGET checks every 0.1 s whether anyone still blocks it — it lasts until nobody blocks it (whoever blocked it), her
  //      S2 starts, or her S2 ends (a buff with its own 0.1 s check here, so it outlives her knock-out the same way).
  //   S1 结构稳定 (40 s): max HP +max_hp, DEF +def.
  //   S2 不变性原理 (20 s): DEF +def, 反馈装甲 ×talent_mult (−14 / −21). PRTS 备注: at the cast the talent's effect on the
  //      enemies she blocks ends and the enhanced one is applied; at the end every enhanced one she applied ends (the
  //      0.1 s talent check then gives the enemies she still blocks the plain one again).
  //   S3 应力倒置 (30 s): DEF +def, block +block_cnt, every second ATK × atk_scale arts damage to each enemy she blocks.
  //   Module PRO-X (elite, trait addition): "阻挡敌人时防御力+20%" — DEF +def (trait blackboard) while she blocks.
  //   Triggers (data, nothing set here): every skill DEFAULT with the official TAKE_DAMAGE as rawRule — the owner's 重装
  //      exception for the stand-ins (tools/build-data.mjs STANDIN_TRIGGER_DEVIATIONS): she casts with an enemy in range.
  char_610_acfend: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1), tb = traitBb(chess);
    const r1 = skillRec(chess, S1), r2 = skillRec(chess, S2), r3 = skillRec(chess, S3);
    const fbAspd = num(t1.attack_speed, 0);
    const fbMult = num(r2?.bb?.talent_mult, 1);
    /** Her S2 runs (the enhanced 反馈装甲). */
    const s2On = (unit) => !!(unit.skill && unit.skill.active && unit.skill.id === S2);
    /** A 反馈装甲 buff: it ends at the first 0.1 s check of its target that finds nobody blocking it. */
    const feedback = (battle, unit, e, key, aspd) => battle.addBuff(e, {
      key, mods: { aspd }, source: unit, data: { v: aspd }, tags: ['talent'], interval: CHECK_INTERVAL,
      onTick({ battle: b, unit: t, buff }) { if (!t.blockedBy) b.removeBuff(t, buff); },
    });
    /** Apply 反馈装甲 (its S2 version while S2 runs) to every enemy she blocks — the talent's 0.1 s application. */
    const applyFeedback = (battle, unit) => {
      if (!fbAspd || !up(unit)) return;
      const enhanced = s2On(unit);
      for (const e of unit.blocking) {
        if (!e.alive || e.blockedBy !== unit) continue;
        if (enhanced) {
          if (e.findBuff(FEEDBACK_S2_KEY)) continue;
          battle.removeBuff(e, FEEDBACK_KEY);
          feedback(battle, unit, e, FEEDBACK_S2_KEY, fbAspd * fbMult);
        } else if (!e.findBuff(FEEDBACK_S2_KEY) && !e.findBuff(FEEDBACK_KEY)) {
          feedback(battle, unit, e, FEEDBACK_KEY, fbAspd);
        }
      }
    };
    const skills = {};
    if (r1) skills[S1] = { kind: 'duration', mods: { hpPct: num(r1.bb?.max_hp), defPct: num(r1.bb?.def) } };
    if (r2) {
      skills[S2] = {
        kind: 'duration',
        mods: { defPct: num(r2.bb?.def) },
        onStart({ battle, unit }) { applyFeedback(battle, unit); },
        onEnd({ battle, unit }) {
          for (const e of battle.enemies) {
            const b = e.findBuff(FEEDBACK_S2_KEY);
            if (b && b.source === unit) battle.removeBuff(e, b);
          }
        },
      };
    }
    if (r3) {
      const scale = num(r3.bb?.atk_scale, 0);
      skills[S3] = {
        kind: 'duration',
        mods: { defPct: num(r3.bb?.def), blockCnt: num(r3.bb?.block_cnt) },
        onStart({ unit }) { unit.mem.acfendStress = 0; },
        onTick({ battle, unit, dt }) {
          unit.mem.acfendStress = (unit.mem.acfendStress ?? 0) + dt;
          while (unit.mem.acfendStress + 1e-6 >= STRESS_INTERVAL) { // loop-cap: constant STRESS_INTERVAL
            unit.mem.acfendStress -= STRESS_INTERVAL;
            const v = battle.blockedTargets(unit, { canHitFly: true });
            if (v.length) battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, radius: 0.5, skill: S3 });
            for (const e of v) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', isSkill: true, tags: ['skill', 'stress'] });
          }
        },
        onEnd({ unit }) { unit.mem.acfendStress = 0; },
      };
    }
    return {
      skills,
      talents: [
        { install(battle, unit) { // 精研材料
          statBuff(battle, unit, 'acfend:t1', { defPct: num(t0.def) });
          const extra = num(t0['acfend_t_1[extra].def']), ratio = num(t0.hp_ratio, 0);
          if (!extra || !(ratio > 0)) return;
          const check = () => {
            const want = up(unit) && unit.hpRatio < ratio - 1e-9;
            const has = !!unit.findBuff('acfend:t1:extra');
            if (want && !has) battle.addBuff(unit, { key: 'acfend:t1:extra', mods: { defPct: extra }, tags: ['talent'] });
            else if (!want && has) battle.removeBuff(unit, 'acfend:t1:extra');
          };
          battle.every(CHECK_INTERVAL, check, { owner: unit });
        } },
        { install(battle, unit) { // 反馈装甲
          if (fbAspd) battle.every(CHECK_INTERVAL, () => applyFeedback(battle, unit), { owner: unit });
        } },
      ],
      install(battle, unit) {
        const md = num(tb.def, 0); // module PRO-X: 阻挡敌人时防御力+20%
        if (md) toggleBuff(battle, unit, 'acfend:pro', () => unit.blocking.length > 0, { defPct: md });
      },
    };
  },
};
