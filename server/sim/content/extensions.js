// Trusted scripts use the DSL counter too. A real infinite loop still needs the P3b watchdog.
import { charge, trackTimer, budgetDisabled } from './dsl/budget.js';
const STOP = Symbol('plugin budget exhausted');
const ACTIONS = new Set(['emit','dealDamage','heal','loseHp','applyStatus','removeStatus','applyStrongest','addBuff','removeBuff',
  'spawnToken','spawnEnemy','spawnDevice','addProjectile','addLayers','addCoins','addDp','retreat','relocate','moveRedeploy',
  'redeploy','push','pull','pullToFront','forceAttack','fx']);

function scriptGuard(pluginId, limit) {
  const views = new WeakMap(), originals = new WeakMap();
  const isBattle = v => v && typeof v.on === 'function' && typeof v._handlerError === 'function';
  function invoke(fn, battle, unit, self, args) {
    battle = originals.get(battle) || battle;
    if (!charge(battle, unit, pluginId, limit)) return;
    try { return fn.apply(self, args.map(v => isBattle(v) ? view(v) : v?.battle === battle
      ? new Proxy(v, { get: (o,k) => k === 'battle' ? view(battle) : o[k], set: (o,k,x) => (o[k] = x, true) }) : v)); }
    catch (e) { if (e !== STOP) battle._handlerError('plugin:' + pluginId, unit, e); }
  }
  function view(battle) {
    if (views.has(battle)) return views.get(battle);
    const methods = new Map(), hooks = [];
    const proxy = new Proxy(battle, { get(o,k) {
      const v = o[k];
      if (typeof v !== 'function' || k === 'rng') return v;
      if (methods.has(k)) return methods.get(k);
      const f = (...args) => {
        if (budgetDisabled(battle, pluginId)) throw STOP;
        if (k === 'off' && typeof args[0] === 'string' && typeof args[1] === 'function') {
          for (let i = hooks.length - 1; i >= 0; i--) if (hooks[i].name === args[0] && hooks[i].fn === args[1]) {
            battle.off(hooks[i].handle); hooks.splice(i,1);
          }
          return;
        }
        let hook = null;
        if (k === 'on') {
          const fn = args[1]; args[1] = (...a) => invoke(fn, battle, args[2]?.owner, undefined, a);
          hook = {name:args[0],fn,handle:null};
        } else if (k === 'every' || k === 'after') {
          const fn = args[1]; args[1] = (...a) => invoke(fn, battle, args[2]?.owner, undefined, a);
        }
        if (ACTIONS.has(k) && !charge(battle, args[0]?.kind ? args[0] : null, pluginId, limit)) throw STOP;
        if (k === 'addBuff') {
          args[1] = { ...args[1], tags: [...(args[1]?.tags || []), 'plugin:' + pluginId] };
          for (const name of ['onTick','onExpire','onRemove']) if (typeof args[1][name] === 'function') args[1][name] = wrap(args[1][name]);
        }
        if (k === 'addProjectile' && typeof args[0]?.onHit === 'function') {
          const fn = args[0].onHit;
          args[0] = {...args[0],onHit:(...a) => invoke(fn,battle,null,undefined,a)};
        }
        if (k === 'spawnToken' && args[4]?.kit) args[4] = {...args[4],kit:wrap(args[4].kit)};
        const result = v.apply(battle, args);
        if (hook) { hook.handle = result; hooks.push(hook); }
        if (k === 'every' || k === 'after') trackTimer(battle, pluginId, result, limit);
        return result;
      };
      methods.set(k,f); return f;
    }});
    views.set(battle, proxy); views.set(proxy,proxy); originals.set(proxy,battle); return proxy;
  }
  function wrap(value) {
    if (typeof value === 'function') return function(...args) {
      const b = args.find(isBattle) || args.find(a => isBattle(a?.battle))?.battle;
      return b ? invoke(value, b, args[0]?.unit || args[1]?.kind && args[1], this, args) : value.apply(this,args);
    };
    if (Array.isArray(value)) return value.map(wrap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,wrap(v)]));
    return value;
  }
  return { view, wrap, invoke };
}

// C2, API v1. One registry per content realm; vanilla is empty. Setup registration is transactional.
import { KITS } from './kits/index.js';

export const EXTENSIONS = Object.create(null);
const enemies = new Map(), content = new Map(), meta = new Map(), owners = new Map();
let sealed = false;
const metaOwners = new WeakMap();
export const extensionMetaOwner = handler => metaOwners.get(handler);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const canon = id => id.startsWith('chess_') ? id.replace(/_[ab]$/, '') : id;
const official = new Set(Object.keys(KITS).map(canon));

function reserve(kind, plugin, id) {
  if (sealed) fail('PLUGIN_SCRIPT_CONFLICT', 'registration is closed after setup');
  if (typeof id !== 'string' || !/^[A-Za-z0-9_:.#-]{1,128}$/.test(id)) fail('PLUGIN_SCRIPT_CONFLICT', 'invalid registration id');
  const key = kind + ':' + (kind === 'kit' ? canon(id) : id);
  if (owners.has(key)) fail('PLUGIN_SCRIPT_CONFLICT', `${id}: ${owners.get(key)} and ${plugin.id} both register this id`);
  // [ASSUMED] Explicit manifest overrides authorizes replacing an official kit, never another plugin's kit.
  if (kind === 'kit' && official.has(canon(id)) && !(plugin.overrides || []).some(x => canon(x) === canon(id)))
    fail('PLUGIN_SCRIPT_OVERRIDE', `${plugin.id} must declare overrides for official kit ${id}`);
  owners.set(key, plugin.id);
}
export function registerKit(plugin, id, builder) {
  if (typeof builder !== 'function') fail('PLUGIN_SCRIPT_CONFLICT', 'kit builder must be a function');
  reserve('kit',plugin,id);
  const guard = scriptGuard(plugin.id, plugin.budget);
  const fn = (...a) => guard.wrap(builder(...a));
  EXTENSIONS[id] = fn;
  if (id.startsWith('chess_')) for (const key of [canon(id),canon(id)+'_a',canon(id)+'_b']) EXTENSIONS[key] = fn;
}
/** Enemy builder: (def) => { install(battle, enemy) }, installed before enemySpawn's official handlers. */
export function registerEnemy(plugin, id, builder) {
  if (typeof builder !== 'function') fail('PLUGIN_SCRIPT_CONFLICT', 'enemy builder must be a function');
  reserve('enemy',plugin,id); enemies.set(id,{ plugin, builder, guard: scriptGuard(plugin.id,plugin.budget) });
}
export function registerMeta(plugin, id, handler) {
  if (!handler || !['object','function'].includes(typeof handler)) fail('PLUGIN_SCRIPT_CONFLICT','meta handler required');
  reserve('meta',plugin,id);
  const h = typeof handler === 'function' ? {run:handler} : {...handler};
  metaOwners.set(h,plugin.id); meta.set(id,{ plugin, handler:h });
}
export function registerContent(plugin, module) {
  const id = module?.id || plugin.id;
  reserve('content',plugin,id);
  const guard = scriptGuard(plugin.id,plugin.budget);
  content.set(id,{ plugin, install: guard.wrap(module.install) });
  // Resolve registration now so conflicts fail composition, not the first match.
  module.registerMeta?.(Object.freeze({ register: (key, h) => registerMeta(plugin,key,h) }));
}
export function installExtensions(battle) {
  for (const { plugin, install } of content.values()) {
    try { install?.(battle); } catch (e) { battle._handlerError('plugin:'+plugin.id,null,e); }
  }
  if (enemies.size) battle.on('enemySpawn', ({enemy}) => {
    const r = enemies.get(enemy.defId) || enemies.get(enemy.def?.key) || enemies.get(enemy.def?.id);
    if (r) r.guard.invoke(() => r.guard.wrap(r.builder(enemy.def)).install?.(r.guard.view(battle),enemy), battle, enemy, null, []);
  }, { priority: 1000 });
}
export function registerExtensionMeta(registry) {
  for (const [id, {handler}] of meta) registry.register(id,handler);
}
export function resetExtensions() {
  for (const k of Object.keys(EXTENSIONS)) delete EXTENSIONS[k];
  enemies.clear(); content.clear(); meta.clear(); owners.clear(); sealed = false;
}
export function sealExtensions() { sealed = true; }
export function extensionRegistrations() { return [...owners].map(([key,pluginId]) => ({key,pluginId})); }
