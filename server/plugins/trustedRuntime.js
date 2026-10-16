import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { splitUrl } from '../http/common.js';
import { healthJson, trustedRouteAllowed } from './trustedApi.js';

/** Experimental activate(api) bridge. IPC carries copies, never live lobby/session objects. */
export async function createTrustedRuntime({registry,log}) {
  const plugins = registry.plugins('trusted').filter(p => p.status === 'loaded' && p.manifest.entry.server)
    .map(p => ({id:p.id,hash:p.script.lockHash,manifestSource:p.script.manifestSource,sources:p.script.sources}));
  if (!plugins.length) return null;
  const pluginIds = new Set(plugins.map(p => p.id));
  const child = fork(fileURLToPath(new URL('./trustedEntry.js',import.meta.url)),[],{stdio:['ignore','ignore','ignore','ipc'],execArgv:['--max-old-space-size=128']});
  const routes = new Set(), health = Object.create(null), pending = new Map();
  let seq = 0, stopping = false, activated = false, stopReason = 'plugin stopped', stopPromise;
  let readyResolve, exitResolve;
  const ready = new Promise(r => {readyResolve=r;});
  const exited = new Promise(r => {exitResolve=r;});
  const timer = setTimeout(() => {
    log.warn('[plugins] trusted server activation timed out');
    void stop('plugin activation timed out');
  },5000);
  function clearState() {
    clearTimeout(timer);
    routes.clear();
    for (const id of Object.keys(health)) delete health[id];
  }
  function onExit() {
    stopping = true;
    clearState();
    for (const resolve of pending.values()) resolve({error:stopReason});
    pending.clear();
    readyResolve(false);
    exitResolve();
  }
  function stop(reason = 'plugin stopped') {
    if (stopPromise) return stopPromise;
    stopping = true;
    stopReason = reason;
    clearState();
    // kill() only sends the signal. Await exit before reporting cleanup or answering pending HTTP.
    if (child.pid && child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    stopPromise = exited;
    return stopPromise;
  }
  const send = m => {
    if (stopping || !child.connected) return;
    child.send(m, e => { if (e) { log.warn('[plugins] trusted server: '+e.message); void stop(); } });
  };
  child.on('exit',onExit);
  child.on('error',e => {
    log.warn('[plugins] trusted server: '+e.message);
    if (!child.pid) onExit(); // A failed spawn has no process and does not emit exit.
    else void stop();
  });
  child.on('message',m => {
    if (stopping || !m || typeof m !== 'object') return;
    if (m.type === 'route' && pluginIds.has(m.pluginId) && trustedRouteAllowed(m.pluginId,m.route)) routes.add(m.route);
    if (m.type === 'health' && pluginIds.has(m.id)) {
      try { health[m.id] = healthJson(m.value); }
      catch (e) { log.warn('[plugins] trusted server: '+e.message); }
    }
    if (m.type === 'ready') {clearTimeout(timer);activated=true;readyResolve(true);}
    if (m.type === 'error') {
      log.warn('[plugins] trusted server: '+m.message);
      if (!activated && !m.id) void stop('plugin activation failed');
    }
    if ((m.type === 'reply' || m.type === 'error') && pending.has(m.id)) {
      pending.get(m.id)(m.type === 'error' ? {error:m.message} : m.value);
      pending.delete(m.id);
    }
  });
  send({type:'init',plugins});
  if (!await ready) {await stop();return null;}
  return {
    health,
    event:(event,value) => send({type:'event',event,value:JSON.parse(JSON.stringify(value))}),
    async route(req,res,rawPath = splitUrl(req.url)?.rawPath) {
      // Compare the same raw path the HTTP dispatcher checked; never normalize dot segments here.
      if (stopping || !routes.has(rawPath)) return false;
      const id = ++seq;
      const value = await new Promise(resolve => {
        const timer = setTimeout(() => { void stop('plugin request timed out'); },5000);
        pending.set(id,v => {clearTimeout(timer);resolve(v);});
        send({type:'http',id,request:{method:req.method,path:rawPath,url:req.url}});
      });
      res.writeHead(value?.error ? 502 : 200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
      res.end(JSON.stringify(value ?? null)); return true;
    },
    close: () => stop(),
  };
}
