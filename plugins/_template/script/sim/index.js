import { kit } from 'sp:sdk@1';

export default function setup(sp) {
  sp.kits.register('char_x_script_demo_guard', (bb) => ({
    skill: { kind: 'duration', duration: 10, spCost: 10, initSp: 10, trigger: 'SP_FULL', mods: { atkPct: kit.num(bb.atk, 0.5) } },
    talents: [{ install(battle, unit) {
      battle.on('deploy', ({unit: landed}) => {
        if (landed === unit) sp.kit.statBuff(battle, unit, 'script:training', {atkFlat: 25});
      }, {owner:unit});
    } }],
  }));
}
