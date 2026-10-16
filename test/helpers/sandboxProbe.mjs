// Test-only child entry. Never served. Parent terminates non-returning source and caps this process's heap.
import { initializeSandbox, createPluginCompartment, loadSandboxPlugin } from '../../shared/plugins/sandbox.js';
import { parse } from 'acorn';
import { writeFileSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// `node --test` also loads every file under test/: without the parent's IPC channel there is nothing to probe
if (typeof process.send !== 'function') process.exit(0);
await initializeSandbox({ loadSES: () => import('ses') });
process.send({ ready: true, permission: !!process.permission });
process.on('message', async ({ source, plugin, probePermissions, probeSdk, probeLength }) => {
  try {
    let value;
    if (probeSdk) {
      const { createSDK } = await import('../../shared/plugins/sdk.js');
      const record = { talents: [{ index:-1, bb:{x:{n:1}} }] };
      const c = createPluginCompartment({...createSDK({id:'probe'}), record: () => record});
      value = c.evaluate(`(() => {
        const data = sp.kit.moduleBb(sp.record());
        let refused = false;
        try { data.x.n = 9; } catch { refused = true; }
        const u = {alive:true,deployed:true,kind:'op',tileR:1,tileC:1};
        const b = {allyUnits:[u],allySelectable:()=>true};
        const list = sp.kit.alliesInGridOf(b,{rangeKeys:[1 * sp.constants.COLS + 1]});
        u.mem = {works:true};
        return {refused,frozen:Object.isFrozen(data.x),listFrozen:Object.isFrozen(list),live:!Object.isFrozen(u)&&u.mem.works};
      })()`);
      value.originalUntouched = !Object.isFrozen(record.talents[0].bb.x) && record.talents[0].bb.x.n === 1;
    } else if (probeLength) {
      const bytes = new Array(1024*1024+1);
      Object.defineProperty(bytes,0,{get(){throw Error('copied oversized source');}});
      loadSandboxPlugin({plugin:{class:'script',entry:'main.js',files:{'main.js':{bytes,sha256:''}}},sp:{},parse});
    } else if (probePermissions) {
      const denied = fn => { try { fn(); return false; } catch (e) { return e.code === 'ERR_ACCESS_DENIED'; } };
      value = { write: denied(() => writeFileSync('/tmp/sp-sandbox-must-not-exist', 'bad')),
        read: denied(() => readFileSync('/etc/hosts')), spawn: denied(() => spawnSync(process.execPath, ['-v'])), ipc: true };
    } else if (plugin) {
      const sp = { capture: v => { value = v; } };
      loadSandboxPlugin({ plugin, sp, parse });
    } else value = createPluginCompartment({}).evaluate(source);
    process.send({ ok: true, value });
  } catch (e) { process.send({ ok: false, error: { name: e.name, code: e.code, message: String(e.message) } }); }
});
