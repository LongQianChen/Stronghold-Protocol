// server/sim/content/kits/ops/op-doroth.js — 多萝西 (char_4048_doroth) 自选 operator kit: 6★ 陷阱师 (特种), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait, both modules (TRP-Y 童话书, TRP-X 梦中人) at
// every form, and the kit of her trap 共振装置 (token_10025_doroth_recttp). Kit contract and the 自选 rules: ../README.md
// ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4048_doroth): normal = E2 Lv1, skills at rank 4, no module; elite = E2 Lv60, rank 7,
// the picked module at stage 1 (tier 5) or 3 (tier 6) — the owner's decision of 2026-10-05. Full potential (the owner's
// decision of 2026-10-07). Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json),
// PRTS 多萝西 / 共振装置 (备注) and 分支特性信息 §陷阱师, and the client's battle data (charpack char_4048_doroth: SpawnTokens,
// KillTokens, the T2 mode switch; skills skchr_doroth_1–3 / sktok_doroth_1–3; equips doroth_equip_1_* / 2_3_p1; buff
// templates doroth_t_2, doroth_token[*], trapper_e_trait[*], doroth_e_003[advanced_spawn_token], charge_token[refresh],
// trigger_charge_token, die_to_kill_token).
// - Trait (陷阱师) "可以使用陷阱来协助作战，但陷阱无法放置于敌人已在的格子中": ranged physical arrows, 3-3, hits air units
//   (分支特性信息 "可对空"; the data's canHitFly over the profession table), blocks 1, ground enemies target her. Her traps
//   never (re)deploy on a tile a ground enemy stands on (分支特性信息: "适用飞行单位判定的敌人（如浮空、近地悬浮）不影响陷阱的部署")
//   and leave when she leaves the field (分支特性信息 "干员离场后，附属的陷阱随之消失"; die_to_kill_token).
// - The traps in this mode: her 共振装置 are hand pieces the player places (data `placeable`; the prep hands out a stack —
//   content/tokens.js, server/match/player/diy.js). Placed pieces deploy with the board, free and ignoring her stock (PRTS
//   卫戍协议/帮助 "所有手动部署的召唤物，无视所属干员的持有状态…作战开始时立即部署一次"); a used-up one stays its tile's piece and
//   comes back there (PRTS "若召唤物在战斗期间退场，将在满足条件后立即原地再部署1个") once the deployment conditions hold: she is on
//   the field, her stock holds a trap, the token card's redeploy time has run since the last trap deployment (data
//   respawnTime 5 s: 备注 "…会让共振装置进入再部署CD"), its player has its cost in DP (3; TRP-X 2), fewer of her traps than
//   the deploy limit stand (data deployLimit 10; TRP-X 13 — 备注 "陷阱部署上限与最多拥有数量相同") and no ground enemy is on
//   the tile; one piece per check (uid order), paying the cost and spending one trap.
// - T1 共振装置 "可以使用8个共振装置（最多拥有10个），踩上去的第一个敌人会触发其效果，部署后立刻在攻击范围内召唤2个共振装置"
//   (full potential: 10个; bb cnt, attack@max_cnt; TRP-X: 13 and stage 3: 3): her stock is refilled to cnt at each deployment
//   (charge_token[refresh]) and holds at most the deploy limit; at each deployment attack@max_cnt traps appear on free melee
//   tiles of her attack range with no ground enemy (the enemies' ground paths first, random among equals — [ASSUMED]: the client's selector
//   filter 16 is not decoded), spending no trap but counting toward the limit (备注); the placed pieces off the field keep
//   their slots (no summon takes one) [ASSUMED]. 阻回 while the stock is full (备注; `_stopSpWhenTokenIsFull`) — at full
//   potential her deployment stock 10 fills the limit 10 (TRP-X 13 leaves room), so 阻回 until a trap is spent.
// - 共振装置 (its kit below): 不会受到攻击 (data: untargetable), blocks nothing, no normal attack. The first selectable ground
//   enemy standing on its tile (sktok_doroth_* SkillTrigger: targetMotion ground, range 0-1; the earliest spawned of
//   several) sets it off — the effect of the token skill of her pick (bySkill), with her current ATK (PRTS "技能伤害始终借用
//   持有者的攻击力计算"), from the trap (its source) —, then it withdraws (doroth_token[withdraw]; the blast fx carries
//   `consumed`). S1 危险目标清除: that enemy takes atk_scale × ATK physical and DEF ×(1 + def) for `duration` s (formula
//   FINAL_SCALER: the catalogue `defDown`). S2 流沙区域生成: every selectable ground enemy within 1.2 (备注 "陷阱爆炸范围为1.2半径
//   的圆") takes atk_scale × ATK physical and 束缚 `duration` s — `duration_2` s when it hit only one (cnt_2). S3
//   高速共振排障: every selectable ground enemy on the trap's x-6 takes atk_scale × ATK arts and 停顿 `sluggish` s, and every
//   other trap of hers on that x-6 goes off `interval` s later (备注 "延迟触发时长为2s"; doroth_token_s3[trigger]: once — a
//   trap already waiting keeps its time [ASSUMED]), with no enemy needed, and sets off its own x-6 the same way.
// - T2 梦想家 "陷阱触发后，多萝西获得2%的攻击力，最多叠加10层" (full potential: 12层; bb atk, max_stack_cnt; TRP-Y stage 3: 4%):
//   every trap that goes off gives her one stack (ATK +atk, 直接乘算) until she leaves the field; with S1 / S2 before its
//   damage, with S3 after it (备注). Full stacks switch her attack mode (doroth_t_2 SwitchMode: the Attack_2 clip — cosmetic here).
// - TRP-Y 童话书 "有20%概率部署造成2倍伤害的陷阱" (trait bb prob, atk_scale): each trap deployment rolls prob; such a trap deals
//   ×atk_scale (trapper_e_trait[token_atk_scale] AtkScaleUp; the red "!" — fx 'mark'). Stage 3: T2 4 %.
// - TRP-X 梦中人: traps cost 1 less and the limit is 13 (the token's module stats), T1 "最多拥有13个"; stage 3: T1 summons 3 and
//   "部署共振装置时有50%概率在攻击范围内额外召唤一个共振装置" (hidden talent prob, max_cnt, rangeGrid): on each deployment of a
//   placed piece (备注 "仅手动部署的共振装置可触发模组3级效果" — the pieces the player placed [ASSUMED]: the start deployment and
//   the redeploys) prob to summon max_cnt more on a tile as T1's, within the limit, spending no trap and ignoring the card's
//   redeploy time but restarting it (备注); and when her T2 stacks fill (her attack mode switch) every placed piece standing
//   rolls again (备注 "多萝西切换攻击模式时…为所有已手动部署的共振装置重新判定“概率额外召唤”").
// - S1 / S2 / S3 (AUTO, 19 / 16 SP, the data's DEFAULT): 被动效果 = the trap's effect above; 主动效果 "立即获得一个陷阱" (bb cnt):
//   +cnt to her stock (trigger_charge_token). The cast acts on herself only, so it fires as soon as its SP is full
//   (`trigger: 'SP_FULL'` — the owner's AUTO rule, kits/README.md checklist 5; skchr_doroth_* `_allowNoTarget`).

import { num, talentBb, moduleBb, traitBb, up, toggleBuff, summonTileFree } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy } from '../../../targeting.js';
import { bodyOnTile } from '../../../body.js';
import { COLS } from '../../../constants.js';
import { atPotential } from '../../../../../shared/potential.js';
import { textCount } from '../../../../../shared/plugins/textNumber.js';

const S1 = 'skchr_doroth_1';
const S2 = 'skchr_doroth_2';
const S3 = 'skchr_doroth_3';
/** 共振装置, her trap. */
export const RESONATOR = 'token_10025_doroth_recttp';
const TS1 = 'sktok_doroth_1';
const TS2 = 'sktok_doroth_2';
const TS3 = 'sktok_doroth_3';
/** S2's blast (PRTS S2 备注 "陷阱爆炸范围为1.2半径的圆"). */
const S2_RADIUS = 1.2;
/** S3's area when the token skill carries no grid: range x-6 (the cross of radius 2). */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
/** S3's delayed trigger when the blackboard carries none (PRTS 备注 "延迟触发时长为2s"). */
const S3_DELAY = 2;
/** How often a used-up piece checks its redeploy conditions. */
const WATCH = 0.25;
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });
const DREAM_KEY = 'talent:doroth:dream';

const tokenOf = (t) => t && t.kind === 'token' && t.defId === RESONATOR;
/** A ground enemy stands on tile (r, c) — a huge one on any tile of its body (body.js); air units never count. */
function groundEnemyOn(battle, r, c) {
  for (const e of battle.enemies) {
    if (!e.alive || e.hidden || e.isFlying) continue;
    if (e.hitArea ? bodyOnTile(e, r, c) : Math.abs(e.x - c) <= 0.5 && Math.abs(e.y - r) <= 0.5) return true;
  }
  return false;
}

export default {
  char_4048_doroth: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // cnt, attack@max_cnt
    const t1 = talentBb(chess, 1);   // atk, max_stack_cnt
    const tb = traitBb(chess);       // TRP-Y: prob, atk_scale
    const hidden = moduleBb(chess);  // TRP-X stage 3: prob, max_cnt
    const hiddenGrid = (chess?.talents ?? []).find((t) => t && t.index === -1 && t.rangeGrid)?.rangeGrid ?? null;
    const stockRefill = Math.max(0, Math.floor(num(t0.cnt, 0)));
    const onDeploy = Math.max(0, Math.floor(num(t0['attack@max_cnt'], 0)));
    const dream = { atk: num(t1.atk), max: Math.max(0, Math.floor(num(t1.max_stack_cnt, 0))) };
    const dbl = { prob: num(tb.prob), scale: num(tb.atk_scale, 1) };
    const extra = { prob: num(hidden.prob), cnt: Math.max(0, Math.floor(num(hidden.max_cnt, 0))) };
    // her trap stock, the card's ready time, whether her T2 has filled this deployment, the deploy limit (per unit: the
    // factory runs per unit; also `unit.trait.doroth` for diagnostics and tests)
    const D = { stock: 0, readyAt: -Infinity, full: false, limit: Infinity };

    const traps = (battle, unit) => battle.allyUnits.filter((t) => tokenOf(t) && t.ownerUnit === unit);
    const standing = (battle, unit) => traps(battle, unit).filter((t) => t.alive).length;
    /** Placed pieces still to come (not on the field, not gone): the T1 summons leave their slots free. */
    const waiting = (battle, unit) => traps(battle, unit).filter((t) => t.uid != null && !t.alive && !t.removed).length;

    /** The token's deploy limit for her loadout (variant stats, the module's when it carries one); her max stock too. */
    function limitOf(battle, unit) {
      const raw = battle.data.rawToken?.(RESONATOR);
      const v = atPotential(raw?.variants?.[unit.def?.tokenOwner], unit.def?.loadout?.potential);
      const mod = unit.def?.loadout?.moduleId;
      const n = num(v?.byModule?.[mod]?.stats?.deployLimit, num(v?.stats?.deployLimit, num(raw?.deployLimit, 0)));
      if (n > 0) return n;
      const owned = textCount(String(chess?.talents?.find((t) => t && t.index === 0)?.desc ?? ''), /最多拥有(\d+)个/, NaN, 'own-max');
      return Number.isFinite(owned) && owned > 0 ? owned : Infinity; // loop-cap: textCount own-max
    }

    /** Free melee tiles of her range (or of `grid` around her) with no ground enemy: enemy paths first, then random. */
    function summonTiles(battle, unit, grid = null) {
      const keys = grid ? absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend || 0) : unit.rangeKeys || [];
      const path = battle.groundPathTiles();
      const out = [];
      for (const k of keys) {
        const r = Math.floor(k / COLS), c = k % COLS;
        if (!summonTileFree(battle, r, c) || !battle.grid.canStand(r, c) || groundEnemyOn(battle, r, c)) continue;
        out.push({ r, c, p: path.has(k) ? 0 : 1 });
      }
      battle.rng.shuffle(out);
      return out.sort((a, b) => a.p - b.p);
    }

    /** Summon up to `n` traps (no stock spent) on summonTiles, within the limit (`room` more at most). */
    function summon(battle, unit, n, grid = null, room = Infinity) {
      let left = Math.min(n, room, D.limit - standing(battle, unit));
      if (!(left > 0)) return 0;
      let made = 0;
      for (const { r, c } of summonTiles(battle, unit, grid)) {
        if (left <= 0) break;
        const t = battle.spawnToken(unit, RESONATOR, r, c, { kit: trapKit(unit) });
        if (!t) continue;
        battle.fx('summon', { x: t.x, y: t.y, id: t.id, token: RESONATOR });
        left--; made++;
      }
      return made;
    }

    /** TRP-X stage 3 on a placed piece's deployment (and her mode switch): prob to summon max_cnt more. */
    function rollExtra(battle, unit) {
      if (!(extra.prob > 0) || !(extra.cnt > 0) || !up(unit) || !battle.rng.chance(extra.prob)) return;
      summon(battle, unit, extra.cnt, hiddenGrid, D.limit - standing(battle, unit) - waiting(battle, unit));
    }

    /** 梦想家: one stack (to max_stack_cnt); full stacks are her attack mode switch (TRP-X stage 3 re-rolls). */
    function dreamStack(battle, unit) {
      if (!up(unit) || !(dream.atk > 0) || !(dream.max > 0)) return;
      const b = unit.findBuff(DREAM_KEY);
      const n = b ? b.stacks : 0;
      if (n >= dream.max) return;
      battle.addBuff(unit, { key: DREAM_KEY, refresh: 'stack', stacks: 1, maxStacks: dream.max, mods: { atkPct: dream.atk }, tags: ['talent'] });
      if (n + 1 >= dream.max && !D.full) {
        D.full = true;
        for (const t of traps(battle, unit)) if (t.alive && t.uid != null) rollExtra(battle, unit);
      }
    }

    /** The trap `t` goes off (`e` = the enemy that stepped on it; null for a delayed S3 trigger). */
    function fire(battle, unit, t, e) {
      if (!t.alive || t.mem.dorFired) return;
      t.mem.dorFired = true;
      const sk = t.def?.skill ?? null;
      const tb2 = sk?.bb ?? {};
      const id = sk?.id ?? TS1;
      const s3 = id === TS3;
      if (!s3) dreamStack(battle, unit);   // 备注: with S1 / S2 before the damage
      const atk = (unit.s ? unit.s.atk : t.s.atk) * (t.mem.dorDouble ? dbl.scale : 1);
      const tags = ['summon', 'trap', 'doroth:trap'];
      if (id === TS2) {
        const victims = battle.foesInRadius(t.x, t.y, S2_RADIUS, true).filter((x) => canTargetEnemy(t, x, GROUND));
        const dur = victims.length === Math.max(1, Math.floor(num(tb2.cnt_2, 1))) ? num(tb2.duration_2, num(tb2.duration)) : num(tb2.duration);
        for (const x of victims) {
          battle.dealDamage(t, x, { amount: atk * num(tb2.atk_scale), type: 'phys', isSkill: true, tags });
          if (x.alive && dur > 0) battle.applyStatus(x, 'bind', { duration: dur, source: t });
        }
        battle.fx('explode', { x: t.x, y: t.y, r: S2_RADIUS, id: t.id, consumed: true, kind: 'doroth:quicksand' });
      } else if (s3) {
        const keys = absoluteRangeKeys(sk?.rangeGrid ?? X6, t.tileR, t.tileC, t.dir, 0);
        for (const x of battle.enemiesOnTiles(keys, t, GROUND)) {
          battle.dealDamage(t, x, { amount: atk * num(tb2.atk_scale), type: 'arts', isSkill: true, tags });
          if (x.alive && num(tb2.sluggish) > 0) battle.applyStatus(x, 'sluggish', { duration: num(tb2.sluggish), source: t });
        }
        // 并延迟触发范围内的其他共振装置
        const set = new Set(keys);
        const delay = num(tb2.interval, S3_DELAY);
        for (const o of traps(battle, unit)) {
          if (o === t || !o.alive || o.mem.dorFired || o.mem.dorWaiting || !set.has(o.tileR * COLS + o.tileC)) continue;
          o.mem.dorWaiting = true;
          const seq = o.deploySeq;
          battle.after(delay, () => { if (o.alive && o.deploySeq === seq) fire(battle, unit, o, null); }, { owner: o });
        }
        battle.fx('explode', { x: t.x, y: t.y, r: 2, id: t.id, consumed: true, dmgType: 'arts', kind: 'doroth:resonance' });
        dreamStack(battle, unit);   // 备注: with S3 after the damage
      } else {
        if (e && e.alive) {
          battle.dealDamage(t, e, { amount: atk * num(tb2.atk_scale), type: 'phys', isSkill: true, tags });
          if (e.alive && num(tb2.duration) > 0 && num(tb2.def) < 0) battle.applyStatus(e, 'defDown', { duration: num(tb2.duration), value: -num(tb2.def), source: t });
        }
        battle.fx('explode', { x: t.x, y: t.y, r: 0.6, id: t.id, consumed: true, kind: 'doroth:clear' });
      }
      battle.retreat(t, { reason: 'expired', permanent: true });
    }

    /** 共振装置's kit (`unit` = 多萝西): its rolls at each deployment, the trigger, a placed piece kept for its redeploys. */
    function trapKit(unit) {
      return {
        skill: null,
        trait: { noAttack: true },
        install(battle, t) {
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== t) return;
            t.mem.dorFired = false;
            t.mem.dorWaiting = false;
            t.mem.dorDouble = dbl.prob > 0 && dbl.scale !== 1 && battle.rng.chance(dbl.prob);
            if (t.mem.dorDouble) battle.fx('mark', { x: t.x, y: t.y, id: t.id, kind: 'doroth:double' });
            D.readyAt = battle.time + Math.max(0, num(t.base.respawnTime, 0));
            if (t.uid != null) rollExtra(battle, unit);
          }, { owner: t });
          battle.on('tick', () => {
            if (!t.alive || t.mem.dorFired) return;
            let hit = null;
            for (const e of battle.enemies) {
              if (!canTargetEnemy(t, e, GROUND)) continue;
              const on = e.hitArea ? bodyOnTile(e, t.tileR, t.tileC) : Math.abs(e.x - t.tileC) <= 0.5 && Math.abs(e.y - t.tileR) <= 0.5;
              if (on && (!hit || e.spawnSeq < hit.spawnSeq)) hit = e;
            }
            if (hit) fire(battle, unit, t, hit);
          }, { owner: t });
          // a placed piece stays its tile's piece (redeployed by her kit's watch), whatever took it off the field
          if (t.uid != null) battle.on('death', (ctx) => { if (ctx.unit === t && !battle.finished) t.removed = false; }, { owner: t, priority: -10 });
        },
      };
    }

    const skillSpec = () => ({
      kind: 'instant', trigger: 'SP_FULL',
      onStart({ skill }) { // 主动效果：立即获得一个陷阱
        D.stock = Math.min(D.limit, D.stock + Math.max(1, Math.floor(num(skill.bb?.cnt, 1))));
      },
    });

    return {
      skills: { [S1]: skillSpec(), [S2]: skillSpec(), [S3]: skillSpec() },
      talents: [
        { install(battle, unit) { // 共振装置: the pieces' kit, the stock, the summons at each deployment, the redeploys
          D.limit = limitOf(battle, unit);
          unit.trait.doroth = D;
          for (const t of battle.allyUnits) {
            if (!tokenOf(t) || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);   // a piece set up before her: drop its generic kit's hooks
            battle._setupUnit(t, trapKit(unit));
          }
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit || ctx.move) return;
            D.stock = Math.min(D.limit, stockRefill);   // charge_token[refresh]
            D.full = false;
            if (onDeploy > 0) summon(battle, unit, onDeploy, null, D.limit - standing(battle, unit) - waiting(battle, unit));
          }, { owner: unit });
          // her traps leave with her (die_to_kill_token); the placed pieces wait for her return
          battle.on('death', (ctx) => {
            if (ctx.unit !== unit) return;
            for (const t of traps(battle, unit)) if (t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
          }, { owner: unit });
          // a used-up / withdrawn piece comes back on its tile once the deployment conditions hold (see the header)
          battle.every(WATCH, () => {
            if (!up(unit) || D.stock < 1 || battle.time + 1e-9 < D.readyAt || standing(battle, unit) >= D.limit) return;
            const pieces = traps(battle, unit).filter((t) => t.uid != null && !t.alive && !t.removed).sort((a, b) => a.uid - b.uid);
            for (const p of pieces) {
              if (groundEnemyOn(battle, p.homeR, p.homeC)) continue;
              if (battle.redeploy(p, { free: false })) { D.stock--; break; }
            }
          }, { owner: unit });
          // 阻回 while her stock is full (_stopSpWhenTokenIsFull)
          toggleBuff(battle, unit, 'talent:doroth:full', () => D.stock >= D.limit, {}, { flags: { noSp: true } });
        } },
        { install() {} }, // 梦想家: the stacks come with every trap that goes off (fire → dreamStack)
      ],
    };
  },
};
