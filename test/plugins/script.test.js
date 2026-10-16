import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {checkScript} from '../../shared/plugins/scriptCheck.js';
import {createSDK,kit} from '../../shared/plugins/sdk.js';
import {resetExtensions,extensionRegistrations,registerKit,EXTENSIONS} from '../../server/sim/content/extensions.js';
import {budgetUsed,budgetDisabled} from '../../server/sim/content/dsl/budget.js';
import {scriptFixture} from '../helpers/scriptFixtures.js';
import {buildContentSet} from '../../server/plugins/contentSet.js';
import {trustDecision} from '../../server/plugins/trusted.js';
import {makeBattle,enemyRec} from '../helpers/battleHarness.js';
import {loadScripts} from '../../shared/plugins/scriptLoad.js';

const setup = id => `export default sp => { sp.kits.register('${id}', () => ({skill:{kind:'passive',mods:{atkPct:0.5}}})); };`;
test('lexical check refuses named escapes and foreign imports, tolerates comments and strings',()=>{
  for(const code of ['import("x")','eval("x")','new Function("x")','require("x")','process.pid','globalThis.x','fetch("x")','new XMLHttpRequest()','new WebSocket("x")','new Date()','Math.random()',"Math['random']()",'2 ** 0.1','x **= 0.1','"a".localeCompare("b")','import x from "./kit.js"','export * from "./x.js"','`${fetch("x")}`']) assert.equal(checkScript(code).sandboxable,false,code);
  assert.equal(checkScript('// fetch()\nimport {kit as k} from "sp:sdk@1"; export default sp => { const s="Date"; }').sandboxable,true);
});
test('SDK is frozen and contains only the promised capabilities',()=>{
  const sdk=createSDK({id:'demo'}, {settings:{x:{y:1}}});
  for(const key of ['fetch','import','storage','Date','random','process','globalThis']) assert.equal(sdk[key],undefined);
  assert.ok(Object.isFrozen(sdk));assert.ok(Object.isFrozen(sdk.settings.x));assert.equal(sdk.kit,kit);
});
test('registry starts empty, refuses collisions and undeclared official replacement',()=>{
  resetExtensions();assert.deepEqual(Object.keys(EXTENSIONS),[]);
  assert.throws(()=>registerKit({id:'first'},'chess_char_1_02',()=>({})),{code:'PLUGIN_SCRIPT_OVERRIDE'});
  registerKit({id:'first',overrides:['chess_char_1_02_a']},'chess_char_1_02',()=>({}));
  assert.throws(()=>registerKit({id:'second',overrides:['chess_char_1_02_a']},'chess_char_1_02_b',()=>({})),{code:'PLUGIN_SCRIPT_CONFLICT'});
  resetExtensions();
});
test('owner switch, exact lock pin, public bind refusal and explicit force',t=>{
  const lines=[];const f=scriptFixture(t,{log:{info:x=>lines.push(x),warn(){}}});
  f.put('demo',setup('char_x_demo_guard'));
  const p=f.registry.plugin('demo');assert.equal(p.status,'loaded');
  assert.equal(trustDecision(p,{mode:'',host:'127.0.0.1',pins:f.pins}).code,'PLUGIN_SCRIPTS_DISABLED');
  assert.equal(trustDecision(p,{mode:'trusted',host:'127.0.0.1',pins:{}}).code,'PLUGIN_TRUST_PIN');
  assert.equal(trustDecision(p,{mode:'trusted',host:'0.0.0.0',pins:f.pins}).code,'PLUGIN_TRUST_PUBLIC');
  assert.equal(trustDecision(p,{mode:'trusted-force',host:'0.0.0.0',pins:f.pins}),null);
  fs.appendFileSync(f.pluginsDir+'/demo/index.js','\n// changed');f.registry.rescan();
  assert.equal(f.registry.plugin('demo').disabled.code,'PLUGIN_TRUST_PIN');assert.ok(lines.some(x=>x.includes('哈希')));
});
test('composition resolves registrations in content order and rejects actual computed conflicts',async t=>{
  const f=scriptFixture(t);
  f.put('zeta',setup('char_x_zeta_guard'));
  f.put('alpha',setup('char_x_alpha_guard'));
  const a=buildContentSet({registry:f.registry,ids:['zeta','alpha']});
  const b=buildContentSet({registry:f.registry,ids:['alpha','zeta']});
  assert.deepEqual(a.problems,[]);assert.equal(a.cs,b.cs);
  await loadScripts(a.scripts,{hashInput:a.index});
  assert.deepEqual(extensionRegistrations().map(x=>x.pluginId),['alpha','zeta']);resetExtensions();
  f.put('other',`export default sp => sp.kits.register(['char','x','alpha','guard'].join('_'),()=>({}));`);
  const bad=buildContentSet({registry:f.registry,ids:['alpha','other']});assert.equal(bad.problems[0].code,'PLUGIN_SCRIPT_CONFLICT');
});
test('script callbacks and actions exhaust only their own battle budget and remove tagged buffs',()=>{
  resetExtensions();
  const bad=createSDK({id:'bad',budget:12});const good=createSDK({id:'good'});
  bad.content.register({install(b){b.on('battleStart',()=>{b.addBuff(b.allyUnits[0],{key:'bad',mods:{atkFlat:999}}); for(let i=0;i<50;i++) b.addDp('p1',1);});b.every(1,()=>b.addDp('p1',1));}});
  good.content.register({install(b){b.on('tick',()=>b.addDp('p1',1));}});
  const h=makeBattle({units:[{chessId:'chess_char_1_02_a',row:10,col:5}],defs:{enemies:{dummy:enemyRec({key:'dummy',hp:1e8,speed:0})}},enemies:[{key:'dummy',pos:[10,10]}]});
  h.step(3);assert.equal(budgetDisabled(h.b,'bad'),true);assert.equal(budgetUsed(h.b,'bad'),12);assert.ok(budgetUsed(h.b,'good')>0);
  assert.ok(!h.allies()[0].findBuff('bad'));assert.equal(h.b.errors.filter(x=>x.hook==='plugin:bad' || x.label==='plugin:bad').length,1);
  resetExtensions();
});

test('enemy registration installs at spawn and content registerMeta joins the prep registry',async()=>{
  resetExtensions();
  const sp=createSDK({id:'enemy-demo'});
  sp.enemies.register('enemy_script_dummy',def=>({install(b,u){b.addBuff(u,{key:'enemy-script',mods:{atkFlat:17}});}}));
  sp.content.register({registerMeta(reg){reg.register('global:enemy-demo',{onRoundStart(ctx){ctx.addFunds(3);}});}});
  const {createRegistry}=await import('../../server/match/effectsMeta.js');
  const reg=createRegistry({builtins:false});let funds=0;
  reg.get('global:enemy-demo').onRoundStart({addFunds:n=>{funds+=n;}});assert.equal(funds,3);
  const h=makeBattle({defs:{enemies:{enemy_script_dummy:enemyRec({key:'enemy_script_dummy',atk:100,hp:1000,speed:0})}},enemies:[{key:'enemy_script_dummy',pos:[10,10]}]});
  h.step();assert.equal(h.enemy('enemy_script_dummy').s.atk,117);resetExtensions();
});

test('disabled scripts remain in the catalogue as sandboxable without executing setup',t=>{
  const f=scriptFixture(t,{mode:''});f.put('off-script','export default sp => { throw Error("must never execute"); };');
  const item=f.registry.pluginIndex().plugins.find(p=>p.id==='off-script');
  assert.equal(item.status,'disabled');assert.equal(item.disabled.code,'PLUGIN_SCRIPTS_DISABLED');assert.equal(item.sandboxable,true);
  assert.ok(!buildContentSet({registry:f.registry,ids:['off-script']}).cs);
});

test('script hook removal preserves off(name, fn) and buff callbacks also spend budget',()=>{
  resetExtensions();const sp=createSDK({id:'callbacks',budget:10});let removedCalls=0;
  sp.content.register({install(b){
    const fn=()=>{removedCalls++;};b.on('tick',fn);b.off('tick',fn);
    b.on('battleStart',()=>b.addBuff(b.allyUnits[0],{key:'callback',persist:true,onTick(){}}));
  }});
  const h=makeBattle({units:[{chessId:'chess_char_1_02_a',row:10,col:5}],autoFinish:false});h.step(20);
  assert.equal(removedCalls,0);assert.equal(budgetDisabled(h.b,'callbacks'),true);assert.ok(!h.allies()[0].findBuff('callback'));resetExtensions();
});
