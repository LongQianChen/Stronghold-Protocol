import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { scriptFixture } from '../helpers/scriptFixtures.js';
import { createTrustedRuntime } from '../../server/plugins/trustedRuntime.js';
import { createRequestHandler } from '../../server/http/routes.js';
import { startServer } from '../../server/index.js';

const quiet = {info(){},warn(){},error(){}};
const invalid = ['/healthz','/','/x/service2/ok','/x/service/../healthz','/x/service/%2e%2e/healthz',
  '/x/service/%2E%2e/healthz','/x/service/\\healthz','/x/service/query?query','/x/service/fragment#fragment'];
const bypasses = ['/x/../healthz','/x/%2e%2e/healthz','/x/../'];
function install(f) {
  f.put('service','export default () => {};',{
    class:'trusted',scope:['server'],permissions:['trusted.server'],entry:{server:'server.js'},
  },{'server.js':`export function activate(api) {
    let refused = 0;
    for (const route of ${JSON.stringify(invalid)}) {
      try { api.http.route(route,()=>({hijacked:true})); } catch { refused++; }
      process.send({type:'route',pluginId:'service',route});
    }
    process.send({type:'route',pluginId:'unknown',route:'/x/unknown/ok'});
    process.send({type:'route',route:'/healthz'});
    api.http.route('/x/service/ok',req=>({path:req.path,url:req.url,refused}));
  }`});
}
function invoke(handle, url) {
  return new Promise(resolve => {
    let status;
    handle({url,method:'GET',headers:{},socket:{remoteAddress:'127.0.0.1'}},{
      setHeader(){},writeHead:s => {status=s;},end:b => resolve({status,body:String(b)}),
    });
  });
}

test('parent rejects forged IPC routes and raw traversal requests reach the original handler',async t => {
  const f = scriptFixture(t);install(f);
  const runtime = await createTrustedRuntime({registry:f.registry,log:quiet});assert.ok(runtime);t.after(() => runtime.close());
  // Test route() directly too: the dispatcher prefix alone must not protect the core routes.
  for (const url of [...invalid,'/x/unknown/ok',...bypasses]) {
    assert.equal(await runtime.route({url,method:'GET'},{writeHead(){assert.fail('invalid route claimed');},end(){}}),false,url);
  }
  const served = [];
  const handler = createRequestHandler({trustedRuntime:runtime,log:quiet,
    health:{startedAt:Date.now(),network:{connectionCount:0},registry:{size:0},lobby:{stats:() => ({rooms:0,matches:0})}},
    serveStatic:async (req,res,rawPath) => {served.push(rawPath);res.writeHead(404);res.end('original static');},
  });
  for (const url of bypasses) {
    const result = await invoke(handler,url);
    assert.equal(result.status,404);assert.equal(result.body,'original static');assert.equal(served.at(-1),url);
  }
  assert.equal(JSON.parse((await invoke(handler,'/healthz')).body).ok,true);
  const valid = JSON.parse((await invoke(handler,'/x/service/ok?test=1')).body);
  assert.deepEqual(valid,{path:'/x/service/ok',url:'/x/service/ok?test=1',refused:invalid.length});
});

function rawGet(port, url) {
  return new Promise((resolve,reject) => {
    const req = http.get({host:'127.0.0.1',port,path:url,agent:false},res => {
      let body = '';res.on('data',b => {body+=b;});res.on('end',() => resolve({status:res.statusCode,body}));
    });
    req.on('error',reject);req.setTimeout(5000,() => req.destroy(new Error('HTTP timeout')));
  });
}

test('raw HTTP traversal cannot intercept core health or static responses',async t => {
  const f = scriptFixture(t);install(f);
  const old = process.env.SP_PLUGIN_SCRIPTS;process.env.SP_PLUGIN_SCRIPTS='trusted';
  t.after(() => {if (old === undefined) delete process.env.SP_PLUGIN_SCRIPTS;else process.env.SP_PLUGIN_SCRIPTS=old;});
  let server;
  try {server = await startServer({host:'127.0.0.1',port:0,pluginsDir:f.pluginsDir,quiet:true,studio:false,assetIndex:false});}
  catch (e) {if (e.code === 'EPERM') {t.skip('未运行：此环境不允许监听 localhost');return;}throw e;}
  t.after(() => server.close());
  for (const url of bypasses) {
    const result = await rawGet(server.port,url);
    assert.notEqual(result.body,'null',url);assert.ok(!result.body.includes('hijacked'),url);
    assert.ok(result.status >= 400,url);
  }
  const health = await rawGet(server.port,'/healthz');assert.equal(health.status,200);assert.equal(JSON.parse(health.body).ok,true);
  const valid = await rawGet(server.port,'/x/service/ok?test=1');assert.equal(valid.status,200);
  assert.deepEqual(JSON.parse(valid.body),{path:'/x/service/ok',url:'/x/service/ok?test=1',refused:invalid.length});
});
