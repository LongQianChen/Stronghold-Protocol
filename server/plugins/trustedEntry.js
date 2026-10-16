// Server-level trusted modules execute in a dedicated child, never in the HTTP/lobby process.
import { importScript } from '../../shared/plugins/scriptLoad.js';
import { healthJson, trustedRouteAllowed } from './trustedApi.js';
const send = m => { if (process.connected) process.send(m); };
const routes = new Map(), listeners = new Map();
const freeze = v => { if (v && typeof v === 'object') { Object.values(v).forEach(freeze); Object.freeze(v); } return v; };
process.on('disconnect',() => process.exit(0));
process.on('message', async m => {
  try {
    if (m.type === 'init') {
      for (const p of m.plugins) {
        const manifest = JSON.parse(p.manifestSource);
        const api = freeze({
          http:{route(route,fn) {
            if (!manifest.permissions.includes('trusted.server') || !trustedRouteAllowed(p.id,route) || typeof fn !== 'function' || routes.has(route)) throw new Error('route must be unique and inside /x/'+p.id+'/');
            routes.set(route,fn); send({type:'route',pluginId:p.id,route});
          }},
          lobby:{on(event,fn) {
            if (!['roomCreated','playerJoined','playerLeft','matchStarted','roomClosed'].includes(event) || typeof fn !== 'function') throw new Error('unknown lobby event');
            const list = listeners.get(event) || []; list.push(fn); listeners.set(event,list);
          }},
          health:{extend(value) { send({type:'health',id:p.id,value:healthJson(value)}); }},
        });
        const mod = await importScript(p.sources[manifest.entry.server],{checked:false,nonce:p.id+'-'+p.hash});
        const activate = mod.activate || mod.default;
        if (typeof activate !== 'function') throw new Error(p.id+': activate(api) required');
        await activate(api);
      }
      send({type:'ready'});
    } else if (m.type === 'http') {
      const value = await routes.get(m.request.path)?.(freeze(m.request));
      send({type:'reply',id:m.id,value:value ?? null});
    } else if (m.type === 'event') {
      for (const fn of listeners.get(m.event) || []) { try { fn(freeze(m.value)); } catch (e) { send({type:'error',message:String(e.message)}); } }
    }
  } catch (e) { send({type:'error',id:m.id,message:String(e.message)}); }
});
