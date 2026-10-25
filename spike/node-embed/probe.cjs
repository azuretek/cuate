// Synthetic, headless probe. Production server modules are imported unchanged.
const process = require('node:process');
const console = require('node:console');
const { setTimeout, clearTimeout } = require('node:timers');
delete process.env.DYLD_PRINT_LIBRARIES;
const { nativeAsync, nativeCancel } = globalThis;
(async () => {
  const assert = require('node:assert/strict');
  const { pathToFileURL } = require('node:url');
  const path = require('node:path');
  const { DatabaseSync } = require('node:sqlite');
  const { Worker } = require('node:worker_threads');
  console.log('RUNTIME_NODE_VERSION=' + process.versions.node + ' ABI=' + process.versions.modules);
  const pid = Number(process.env.SWIFT_MAIN_PID);
  assert.equal(process.pid, pid);
  const db = new DatabaseSync(':memory:');
  assert.equal(db.prepare('select 479 as n').get().n, 479); db.close();
  const native = await nativeAsync(1, 10);
  assert.equal(native.pid,pid); assert.equal(native.mainThread,true);
  const cancelled = nativeAsync(2,80);
  assert.equal(nativeCancel(2),true);
  assert.equal(nativeCancel(2),false);
  await assert.rejects(cancelled,/native_cancelled/);
  assert.equal(nativeCancel(999),false);
  assert.throws(()=>nativeAsync(3,-1),/invalid native request/);
  const replies = await Promise.all(Array.from({length:32},(_,i)=>nativeAsync(10+i,10)));
  assert.ok(replies.every(r=>r.pid===pid && r.mainThread));
  const worker = new Worker('require("node:worker_threads").parentPort.postMessage(process.pid)',{eval:true});
  assert.equal(await new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);}),pid);
  await worker.terminate();
  const repo=process.argv[2];
  const {boot,openSocket,waitFor}=await import(pathToFileURL(path.join(repo,'server/test/helpers.js')));
  const server=await boot();
  try {
    assert.equal((await server.get('/healthz')).status,200);
    assert.equal((await server.get('/api/v1/info')).status,401);
    assert.equal((await server.get('/api/v1/info',server.tokens.device)).status,200);
    const chats=await (await server.get('/api/v1/chats',server.tokens.device)).json();
    assert.equal(chats.chats.length,3);
    const connection=await openSocket(server.base);
    connection.ws.send(JSON.stringify({type:'auth',token:server.tokens.device}));
    await waitFor(()=>connection.frames.some(f=>f.type==='hello'));
    server.world.incoming(1,'Synthetic embedded event');
    await waitFor(()=>connection.frames.some(f=>f.type==='event' && f.name==='message.new'));
    connection.ws.close();
    await waitFor(()=>connection.ws.readyState===3);
    process.stdout.write('NATIVE_ASYNC_CANCEL_AFFINITY_WORKER_ESM_SQLITE_HTTP_WS_PASS PID='+pid+'\n');
  } finally { await server.close(); }
  let signalDeadline;
  const signal = new Promise((resolve,reject) => {
    signalDeadline = setTimeout(()=>reject(new Error('SIGTERM not delivered')),2000);
    process.once('SIGTERM', () => {
    nativeAsync(500,40).then(value => {
      assert.equal(value.pid,pid); assert.equal(value.mainThread,true);
      process.stdout.write('SIGNAL_NATIVE_DRAIN_PASS PID='+pid+'\n');
      resolve();
    },reject);
    });
  });
  process.kill(process.pid,'SIGTERM');
  await signal;
  clearTimeout(signalDeadline);
  // A cancelled native completion is still in flight. Teardown must retain the
  // uv handle until it returns, without resolving the rejected promise again.
  const late=nativeAsync(100,120);
  nativeCancel(100);
  await assert.rejects(late,/native_cancelled/);
  process.stdout.write('GRACEFUL_NATIVE_DRAIN_PENDING PID='+pid+'\n');
})().catch(error=>{process.stderr.write(error.stack+'\n');process.exitCode=1;});
