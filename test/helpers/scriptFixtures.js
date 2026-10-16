import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createPluginRegistry } from '../../server/plugins/registry.js';
import { packPlugin } from '../../server/plugins/pack.js';
import { nodeSha256 } from '../../server/plugins/identity.js';
import { ROOT } from '../../server/data.js';
export function scriptFixture(t,{mode='trusted',host='127.0.0.1',log}={}) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'sp-p3a-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const pluginsDir=path.join(root,'plugins'); fs.mkdirSync(pluginsDir);
  const pins={};
  const registry=createPluginRegistry({publicDir:path.join(ROOT,'public'),dataDir:path.join(ROOT,'data'),packsDir:path.join(root,'packs'),pluginsDir}, {scriptMode:mode,scriptHost:host,log});
  const put=(id,source,extra={},files={})=>{
    const dir=path.join(pluginsDir,id);fs.mkdirSync(dir,{recursive:true});
    const manifest={manifest:2,id,version:'1.0.0',app:'*',api:1,class:'script',scope:['room'],permissions:['sim.code'],entry:{sim:'index.js'},...extra};
    fs.writeFileSync(path.join(dir,'plugin.json'),JSON.stringify(manifest));
    for (const [rel,value] of Object.entries({'index.js':source,...files})) {
      fs.mkdirSync(path.dirname(path.join(dir,rel)),{recursive:true});fs.writeFileSync(path.join(dir,rel),typeof value==='string'?value:JSON.stringify(value));
    }
    const packed=packPlugin(dir);
    if (!packed.wrote) throw new Error(JSON.stringify(packed.build));
    pins[id]=nodeSha256(fs.readFileSync(path.join(dir,'plugin.lock.json')));
    fs.writeFileSync(path.join(pluginsDir,'config.json'),JSON.stringify({trusted:pins,classes:{script:true,trusted:true}}));
    registry.rescan();return dir;
  };
  return {root,pluginsDir,registry,put,pins};
}
