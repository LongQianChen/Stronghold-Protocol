import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validHostMessage,HOST_IPC_LIMITS,boundedJson} from '../../server/match/host/ipc.js';
import {MatchProxy} from '../../server/match/host/proxy.js';
import {createMatchHosts} from '../../server/match/host/index.js';
import {scriptSet} from '../helpers/simHostFixture.js';
import {fileURLToPath} from 'node:url';

test('IPC limits and shape: logs, errors, match-only frames, replies and non-JSON payloads',()=>{
  const id='TEST-0-1',base={matchId:id};
  assert.ok(validHostMessage({type:'log',level:'info',text:'x'.repeat(HOST_IPC_LIMITS.log)}));
  for(const m of [
    {type:'log',level:'constructor',text:'bad'}, {type:'log',level:'info',text:{}},
    {type:'log',level:'info',text:'界'.repeat(1400)}, {type:'boot-error',error:'x'.repeat(301)},
    {...base,type:'send',playerId:{},msg:{t:'m.public'}}, {...base,type:'broadcast',msg:{t:'room.closed'}},
    {...base,type:'send',playerId:'p',msg:[]}, {...base,type:'reply',id:'1',result:{ok:true}},
    {...base,type:'reply',id:1,result:{error:[]}},{...base,type:'reply',id:1,result:{ok:'yes'}},
    {...base,type:'reply',id:1,result:{text:'x'.repeat(HOST_IPC_LIMITS.reply)}},
    {...base,type:'broadcast',msg:{t:'b.ev',text:'x'.repeat(HOST_IPC_LIMITS.message)}}])assert.equal(validHostMessage(m),false);
  const cycle={};cycle.self=cycle;assert.equal(boundedJson(cycle,1024),false);
  assert.equal(boundedJson({get evil(){throw Error('must not read');}},1024),false);
  assert.equal(boundedJson({fn(){}},1024),false);
  assert.equal(boundedJson({x:Infinity},1024),false);
  assert.ok(validHostMessage({...base,type:'broadcast',msg:{t:'b.ev',ev:[[1,2,3]]}}));
});

test('MatchProxy independently rejects bad payloads; malformed replies cannot settle another request',async t=>{
  const frames=[],sent=[];
  const p=new MatchProxy({matchId:'one',host:{post:m=>sent.push(m)},opts:{send:(_id,m)=>frames.push(m),broadcast:m=>frames.push(m),onEnd(){}},requestTimeoutMs:1000});
  t.after(()=>p.halt());
  const answer=p.handle('p',{t:'g.ready'}),id=sent[0].id;
  p.deliver({type:'reply',matchId:'two',id,result:{ok:true}});
  p.deliver({type:'reply',matchId:'one',id,result:{ok:'invalid'}});
  assert.equal(p.pending.size,1);
  p.deliver({type:'broadcast',matchId:'one',msg:{t:'room.closed'}});assert.equal(frames.length,0);
  p.deliver({type:'send',matchId:'one',playerId:'p',msg:{t:'m.toast',text:'ok'}});assert.equal(frames.length,1);
  p.deliver({type:'reply',matchId:'one',id,result:{ok:true}});assert.deepEqual(await answer,{ok:true});
});

test('parent receiver rejects forged log/boot-error/send/reply IPC before logger and proxy',async t=>{
  const set=scriptSet('export default () => {};','trusted',{bonds:{}});
  const files={bonds:Buffer.from(JSON.stringify(set.data.bonds))},lines=[],frames=[];
  const hosts=createMatchHosts({contents:{get:()=>set,dataBytes:()=>files},log:{info:x=>lines.push(x),warn:x=>lines.push(x),error:x=>lines.push(x)},
    options:{matchModule:fileURLToPath(new URL('../../server/match/StubMatch.js',import.meta.url))}});t.after(()=>hosts.close());
  const p=hosts.create(set.cs,{roomCode:'TEST',seats:[],send:(_id,m)=>frames.push(m),broadcast:m=>frames.push(m),onEnd(){}});
  const host=hosts._host(set.cs),before=lines.length;
  host.onMessage({type:'log',level:'info',text:'x'.repeat(4001)});
  host.onMessage({type:'boot-error',error:'x'.repeat(301)});
  host.onMessage({type:'send',matchId:p.matchId,playerId:'p',msg:{t:'room.closed'}});
  const answer=p.handle('p',{t:'g.ready'});
  host.onMessage({type:'reply',matchId:p.matchId,id:1,result:[]});
  assert.equal(lines.length,before);assert.equal(host.dead,null);assert.equal(frames.length,0);assert.equal(p.pending.size,1);
  host.onMessage({type:'reply',matchId:p.matchId,id:1,result:{ok:true}});assert.deepEqual(await answer,{ok:true});
  host.onMessage({type:'log',level:'info',text:'accepted'});assert.match(lines.at(-1),/accepted$/);
});
