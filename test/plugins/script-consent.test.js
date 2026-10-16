import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Lobby} from '../../server/lobby.js';
import {SessionRegistry} from '../../server/net.js';
import {validateC2S} from '../../shared/protocol.js';
import {hasScriptConsent,rememberScriptConsent} from '../../public/js/content.js';
const cs='a'.repeat(64),other='b'.repeat(64);
test('consent gates start, belongs to each seat, survives reconnect and resets on cs change',t=>{
 const plugins={resolve:ids=>({ok:true,set:{cs:ids[0]==='first'?cs:other,plugins:[{id:ids[0],class:'script',hash:'1'.repeat(64)}],trusted:{plugins:[{id:ids[0],version:'1.0.0',hash:'1'.repeat(64),permissions:['sim.code']}]}}})};
 const lobby=new Lobby({registry:new SessionRegistry(),content:{cs:'c'.repeat(64)},plugins});t.after(()=>lobby.shutdown());
 const host={playerId:'h',name:'Host',connected:true,ws:null},guest={playerId:'g',name:'Guest',connected:true,ws:null};
 lobby.create(host,{mode:'coop',difficulty:'NORMAL'});lobby.join(guest,{code:host.roomCode});
 assert.deepEqual(lobby.setPlugins(host,{plugins:[{id:'first'}]}),{ok:true});
 const room=lobby.roomOf(host);lobby.startMatch=()=>({ok:true});
 assert.equal(lobby.start(host).error,'PLUGIN_CONSENT');
 lobby.consent(host,{cs,accept:true,seat:1});assert.deepEqual(room.toState().content.trusted.consent,{'0':true,'1':false});
 assert.equal(lobby.start(host).error,'PLUGIN_CONSENT');
 lobby.consent(guest,{cs,accept:false});assert.equal(room.seatOf('g').consentCs,null);
 lobby.consent(guest,{cs,accept:true});guest.connected=false;lobby.onDisconnect(guest);
 guest.connected=true;lobby.onHello(guest,{resumed:true,repeat:false});assert.equal(room.seatOf('g').consentCs,cs);
 for(const s of room.seats.filter(Boolean)){s.content='ready';s.ready=true;}
 assert.deepEqual(lobby.start(host),{ok:true});
 lobby.setPlugins(host,{plugins:[{id:'second'}]});assert.deepEqual(room.toState().content.trusted.consent,{'0':false,'1':false});
 assert.equal(lobby.consent(guest,{cs,accept:true}).error,'PLUGIN_CONSENT');
 assert.equal(lobby.start(host).error,'PLUGIN_CONSENT');
 assert.equal(validateC2S({t:'room.consent',cs,accept:true}),null);
 assert.equal(validateC2S({t:'room.consent',cs,accept:true,seat:1}),null, 'unknown fields are ignored by protocol and handler');
});
test('browser consent is stored by cs only, revocable, and absent by default',()=>{
 const map=new Map(),storage={getItem:k=>map.get(k),setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
 assert.equal(hasScriptConsent(cs,storage),false);rememberScriptConsent(cs,true,storage);assert.equal(hasScriptConsent(cs,storage),true);
 assert.equal(hasScriptConsent(other,storage),false);rememberScriptConsent(cs,false,storage);assert.equal(hasScriptConsent(cs,storage),false);
});
