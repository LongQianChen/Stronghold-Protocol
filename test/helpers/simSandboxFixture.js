// Shared Node/browser driver using the production descriptor loader and SDK. Never imported by app code.
import { createSimWorker, prepareScriptRuntime } from '../../public/js/battle/simWorkerRuntime.js';
import { loadBrowserSim } from '../../public/js/battle/simLoader.js';
import { initializeSandbox } from '../../shared/plugins/sandbox.js';
import { escapeCases } from './sandboxCases.js';
import { createPluginCompartment } from '../../shared/plugins/sandbox.js';

export function fixtureRuntime({ base, loadSES, parse }) {
  let battle;
  const loadMath = () => import(`${base}detmath.js`);
  const initialize = () => initializeSandbox({ loadSES, loadMath });
  const dispatch = createSimWorker({
    prepareScripts: content => prepareScriptRuntime(content, {loadSES,loadMath,loadParser:async()=>({parse})}),
    loadSim: async content => {
      const sim = await loadBrowserSim({ ...content, base });
      const create = sim.spec.createBattleFromSpec;
      sim.spec = { ...sim.spec, createBattleFromSpec: (...args) => (battle = create(...args)) };
      // A malformed data path which validation missed; isolates a truly blocked engine step, not a stalled fake port.
      if (content.data.__slow) {
        sim.spec = { ...sim.spec };
        const original = sim.spec.createBattleFromSpec;
        sim.spec.createBattleFromSpec = (...args) => { const b = original(...args); b.step = () => { for (;;) { /* data loop */ } }; return b; };
      }
      return sim;
    },
  });
  return async (method, args) => {
    if (method === 'evaluate') { await initialize(); return createPluginCompartment({}).evaluate(args[0]); }
    if (method === 'budget') {
      const budget = await import(`${base}content/dsl/budget.js`);
      return {used:budget.budgetUsed(battle,args[0]),disabled:budget.budgetDisabled(battle,args[0]),errors:battle.errors,
        alive:!Object.isFrozen(battle)&&battle.allyUnits.every(u=>!Object.isFrozen(u))};
    }
    if (method === 'bounds') return (await import(new URL('../../shared/plugins/officialBounds.js', import.meta.url))).bbCap('times');
    if (method === 'escapes') {
      await initialize();
      const c = createPluginCompartment({});
      return escapeCases.map(([label, source, expected]) => {
        try { return { label, expected, value: c.evaluate(source) }; }
        catch { return { label, expected, value: 'throws' }; }
      });
    }
    return dispatch(method, args);
  };
}
