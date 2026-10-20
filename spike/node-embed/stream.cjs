const console = require('node:console');
const { setTimeout, clearTimeout } = require('node:timers');
const { fetch } = globalThis;
const assert = require('node:assert/strict');
const process = require('node:process');
const { mkdtempSync, rmSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { pathToFileURL } = require('node:url');
const transport = require('./stream-transport.cjs');
const { nativeStreamOpen, nativeStreamWrite, nativeStreamClose } = globalThis;
const bounded = (promise, label) => new Promise((resolve,reject) => {
  const timer=setTimeout(()=>reject(new Error('deadline: '+label)),5000);
  promise.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});
});
(async()=>{
  const repo=process.argv[2]; const load = p => import(pathToFileURL(path.join(repo,p)).href);
  const { createRpc } = await load('server/src/engine/rpc.js');
  // The actual pinned library remains open across requests, without reading a store.
  const library=transport({database:path.join(tmpdir(),'absent-stream-'+process.pid)});
  const rpc=createRpc({transport:library,timeoutMs:2000});
  await assert.rejects(rpc.request('synthetic.unknown',{}),{code:-32601});
  await assert.rejects(rpc.request('synthetic.unknown',{}),{code:-32601});
  assert.equal((await bounded(library.close(),'library EOF')).code,0);
  assert.equal(nativeStreamWrite(library.id,'{}'),2);
  const cancelled=transport({fixture:true});
  await bounded(cancelled.close(true),'idle source cancel');
  assert.equal(nativeStreamClose(cancelled.id,true),false);
  assert.throws(()=>nativeStreamOpen('bad','',true,()=>{},()=>{}),/invalid stream/);
  const slots=Array.from({length:8},()=>transport({fixture:true}));
  assert.throws(()=>transport({fixture:true}),/admission refused/);
  assert.equal(nativeStreamOpen(slots[0].id,'',true,()=>{},()=>{}),false);
  await bounded(Promise.all(slots.map(t=>t.close(true))),'eight session cancellation');
  const live=transport({fixture:true});const liveRpc=createRpc({transport:live,timeoutMs:2000});let notifications=0;
  liveRpc.onNotification(method=>{if(method==='message')notifications++;});
  await liveRpc.request('watch.subscribe',{});await liveRpc.request('synthetic.emit',{id:1});assert.equal(notifications,1);
  await liveRpc.request('watch.unsubscribe',{subscription:1});await liveRpc.request('synthetic.emit',{id:2});assert.equal(notifications,1);
  await bounded(live.close(),'subscription EOF');
  // Oversize input refuses before engine dispatch and still reaches terminal drain.
  const big=transport({fixture:true});
  assert.throws(()=>big.write('x'.repeat(65537)),/admission refused: 3/);
  await bounded(big.done,'oversize terminal');
  const nul=transport({fixture:true});assert.equal(nativeStreamWrite(nul.id,'{}\0ignored'),3);await bounded(nul.close(true),'NUL refusal terminal');
  // Output overflow while the isolate cannot consume is explicit terminal failure.
  const flood=transport({fixture:true});
  let accepted=0, rejected=0;
  const until=Date.now()+1000;
  while(Date.now()<until && rejected===0){
    for(let n=0;n<16;n++){
      const status=nativeStreamWrite(flood.id,JSON.stringify({jsonrpc:'2.0',id:accepted,method:'synthetic.unknown'}));
      if(status===0)accepted++; else if(status===2)rejected++; // full input means caller must retry, not silent admission
    }
  }
  const flooded=await bounded(flood.done,'output backpressure');
  assert.equal(flooded.code,3); assert.ok(accepted>64);
  let callbackCount=0, callbackEnd;
  const callbackDone=new Promise(resolve=>{callbackEnd=resolve;});
  assert.equal(nativeStreamOpen(90000,'',true,()=>{callbackCount++;throw new Error('intentional callback rejection');},callbackEnd),true);
  nativeStreamWrite(90000,JSON.stringify({jsonrpc:'2.0',id:1,method:'synthetic.unknown'}));
  assert.equal(await bounded(callbackDone,'callback failure drain'),4); assert.equal(callbackCount,1);
  // Unchanged server components consume the long-lived Swift fixture transport.
  const {createLogger}=await load('core/kit/log.js');
  const {logSpec}=await load('server/src/paths.js');
  const {normalizeConfig}=await load('server/src/config.js');
  const {openStore}=await load('server/src/store.js');
  const {createEngine}=await load('server/src/engine/index.js');
  const {startServer}=await load('server/src/app.js');
  const {makeAttachmentId}=await load('server/src/ids.js');
  const {createApiClient}=await load('core/kit/api.js');
  const dir=mkdtempSync(path.join(tmpdir(),'native-stream-server-'));
  const log=createLogger({spec:logSpec,app:'test',run:'test',sink:()=>{},now:Date.now,level:'debug',strict:true});
  const config=normalizeConfig({port:0,engine:{kind:'fake'},sending:{enabled:false},push:{relay:null}});
  const store=openStore(path.join(dir,'state.db'));
  const sessions=[];
  const engine=createEngine({kind:'synthetic-native',makeTransport:()=>{const t=transport({fixture:true});sessions.push(t);return t;},log:log.child('engine'),attachmentId:makeAttachmentId({secret:'test-secret',store}),timeoutMs:2000});
  let srv,client;
  try{
    await engine.start(); assert.equal(engine.info().ready,true);
    srv=await startServer({config,store,engine,log:log.child('http'),dataDir:dir,attachmentsRoot:dir,pushFetch:undefined});
    const base='http://127.0.0.1:'+srv.port;
    const token=store.createToken('device','synthetic stream client').token;
    const tooling=store.createToken('tooling','synthetic read only').token;
    assert.equal((await fetch(base+'/healthz')).status,200);
    assert.equal((await fetch(base+'/api/v1/chats')).status,401);
    const info=await (await fetch(base+'/api/v1/info',{headers:{authorization:'Bearer '+token}})).json();
    assert.equal(info.engine.ready,true);
    assert.deepEqual(await (await fetch(base+'/api/v1/chats',{headers:{authorization:'Bearer '+token}})).json(),{chats:[]});
    assert.equal((await fetch(base+'/api/v1/chats/1/messages',{method:'POST',headers:{authorization:'Bearer '+tooling,'content-type':'application/json'},body:JSON.stringify({text:'never dispatched',clientKey:'native-forbidden-01'})})).status,403);
    const refused=await fetch(base+'/api/v1/chats/1/messages',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({text:'synthetic never sent',clientKey:'native-off-0000001'})});
    assert.equal(refused.status,403);assert.equal((await refused.json()).error.code,'sending_off');
    assert.equal(sessions.at(-1).methods.includes('send'),false);
    config.sending.enabled=true;
    const syntheticSend=()=>fetch(base+'/api/v1/chats/1/messages',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({text:'synthetic uncertain; no platform send',clientKey:'native-uncertain-0001'})});
    const uncertain=await syntheticSend();assert.equal(uncertain.status,202);assert.equal((await uncertain.json()).status,'uncertain');
    const repeated=await syntheticSend();assert.equal(repeated.status,200);assert.equal((await repeated.json()).duplicate,true);
    assert.equal(sessions.at(-1).methods.filter(x=>x==='send').length,1);
    let opened;const open=new Promise(resolve=>{opened=resolve;}); let event;
    const received=new Promise(resolve=>{event=resolve;});
    client=createApiClient({baseUrl:base,token,onState:s=>{if(s==='open')opened();},onEvent:e=>{if(e.name==='message.new')event(e);}});
    client.connect(); await bounded(open,'authenticated WebSocket');
    const raw={id:71,guid:'SYNTHETIC-STREAM-71',chat_id:1,text:'synthetic native event',created_at:'2026-01-01T00:00:00Z',is_from_me:false,attachments:[],sender:'synthetic@example.invalid'};
    // createRpc ids are transport-local; use a notification so the engine owns all request ids.
    sessions.at(-1).write(JSON.stringify({jsonrpc:'2.0',method:'synthetic.emit',params:raw}));
    const e=await bounded(received,'Swift to engine to authenticated WS');
    assert.equal(e.data.message.id,raw.guid);assert.equal(e.data.message.text,raw.text);
    const history=await client.messages('1'); assert.equal(history.messages[0].id,raw.guid);
    assert.equal(history.messages[0].text,raw.text);
    // A restart drains the previous native source and subscribes exactly once to a new generation.
    const old=sessions[0]; await engine.restart(); await bounded(old.done,'restart terminal');
    assert.equal(engine.info().ready,true);assert.equal(sessions.length,2);
    const retained=await syntheticSend();assert.equal(retained.status,200);assert.equal((await retained.json()).status,'uncertain');
    assert.equal(sessions.at(-1).methods.includes('send'),false);
    assert.equal((await client.messages('1')).messages.length,0);
    assert.equal((await fetch(base+'/api/v1/info',{headers:{authorization:'Bearer '+token}})).status,200);
    assert.equal(Number(process.env.SWIFT_MAIN_PID),process.pid);
    console.log('NATIVE_STREAM_SERVER_AUTH_WS_STATE_DRAIN_PASS PID='+process.pid);
  } finally {
    client?.close(); if(srv)await srv.close(); await bounded(engine.stop(),'server stop');store.close();rmSync(dir,{recursive:true,force:true});
  }
  console.log('NATIVE_STREAM_BACKPRESSURE_CANCEL_LIBRARY_PASS PID='+process.pid);
})().catch(e=>{console.error(e);process.exit(1);});
