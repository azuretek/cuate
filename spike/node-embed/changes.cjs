const assert=require('node:assert/strict');
const console=require('node:console');const process=require('node:process');const path=require('node:path');
const {pathToFileURL}=require('node:url');const {tmpdir}=require('node:os');
const {mkdtempSync,rmSync,readFileSync,existsSync}=require('node:fs');const {DatabaseSync}=require('node:sqlite');const {createHash}=require('node:crypto');
const {setTimeout,clearTimeout}=require('node:timers');const transport=require('./stream-transport.cjs');const readerOf=require('./change-reader.cjs');
const bounded=p=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('changes deadline')),5000);p.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
(async()=>{
 const repo=process.argv[2],load=p=>import(pathToFileURL(path.join(repo,p)).href);
 const {createChangeReader}=await load('server/src/engine/changes.js');
 const dir=mkdtempSync(path.join(tmpdir(),'native-changes-')),file=path.join(dir,'synthetic.db');
 const db=new DatabaseSync(file);
 db.exec('CREATE TABLE message(guid,date_retracted INTEGER,date_read INTEGER,is_from_me INTEGER);CREATE TABLE chat_message_join(message_id INTEGER,chat_id);');
 const add=db.prepare('INSERT INTO message VALUES(?,?,?,?)'),join=db.prepare('INSERT INTO chat_message_join VALUES(?,?)');
 for(let i=1;i<=205;i++){add.run('row-'+i,1000000999,2000000999,i%2);join.run(i,i%3);}
 add.run('unjoined',3000000000,3000000000,1);
 add.run(null,4000000000,4000000000,1);join.run(207,null);
 add.run("x' OR 1=1 --",5000000000,5000000000,1);join.run(208,'quoted');
 add.run('embedded\0guid',6000000000,6000000000,1);join.run(209,1);
 db.close();
 const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex');let before=hash();
 let session=transport({database:file}),native=readerOf(session),old=createChangeReader({dbPath:file});
 const parity=()=>{
  assert.deepEqual(native.latest(),old.latest(),'changes latest parity');
  for(const cursor of [undefined,null,[],[-1,-2],['1000.9','1.9'],[NaN,NaN],Array(2),[1000,0],[1000,100],[1000,205],[999999,0]])for(const size of [1,2,200])for(const method of ['unsentSince','readSince'])assert.deepEqual(native[method](cursor,size),old[method](cursor,size),'changes cursor parity '+method);
  const ids=[...Array.from({length:205},(_,i)=>'row-'+(i+1)),null,'',"x' OR 1=1 --",'missing','row-1'];
  assert.deepEqual([...native.unsentAmong(ids)],[...old.unsentAmong(ids)],'changes among parity');
  const reversed=Array.from({length:205},(_,i)=>'row-'+(205-i));
  const n=[...native.unsentAmong(reversed)],o=[...old.unsentAmong(reversed)];assert.deepEqual([...n].sort(),[...o].sort(),'changes batched Set membership parity');assert.notDeepEqual(n,o,'documented source-only multi-batch iteration order difference');
 };
 try{
  parity();
  // Same-ms ROWID boundaries, exact full pages and the final empty page preserve source more semantics.
  for(const method of ['unsentSince','readSince']){
   let cursor=[0,0],more=true,got=[];const deadline=Date.now()+5000;
   while(more){assert.ok(Date.now()<deadline,'cursor termination');const expected=old[method](cursor,2),page=native[method](cursor,2);assert.deepEqual(page,expected,'changes page parity');got.push(...page.rows);if(page.rows.length)assert.notDeepEqual(page.cursor,cursor);cursor=page.cursor;more=page.more;}
   assert.equal(new Set(got.map(r=>r.rowid)).size,got.length);
   assert.deepEqual(native[method](cursor,2),{rows:[],cursor,more:false});
  }
  const saved=native.unsentSince([0,0],2).cursor;
  const replay=native.unsentSince(saved,2);assert.deepEqual(native.unsentSince(saved,2),replay,'idempotent replay');
  assert.equal(hash(),before,'reads preserve fixture before offline mutation');
  native.close();old.close();await bounded(session.close(true));
  const offline=new DatabaseSync(file);offline.exec("UPDATE message SET date_retracted=7000000000,date_read=7000000000 WHERE ROWID=1");offline.close();before=hash();
  session=transport({database:file});native=readerOf(session);old=createChangeReader({dbPath:file});
  assert.deepEqual(native.unsentSince([6000,209],2).rows.map(r=>r.guid),['row-1'],'offline change survives restart');
  assert.deepEqual(native.unsentSince(saved,2),replay,'restart persisted mark');parity();
  for(const limit of [0,-1,201,1.5,Infinity])assert.throws(()=>native.unsentSince([0,0],limit),{code:'changes.invalid'});
  // Explicit source difference: source supports zero and unbounded negative LIMIT; experiment refuses both.
  assert.equal(old.unsentSince([0,0],0).more,true);assert.ok(old.unsentSince([0,0],-1).rows.length>200);
  const direct=input=>JSON.parse(globalThis.nativeMetadataRead(session.id,'changes',JSON.stringify(input)));
  for(const input of [{action:'write'},{action:'latest',database:file},{action:'latest',sql:'DELETE FROM message'},{action:'read',cursor:[0,0],limit:201},{action:'read',cursor:'bad',limit:1},{action:'read',cursor:[0,0],limit:true},{action:'read',cursor:[true,0],limit:1},{action:'among',guids:['bad\0guid']}])assert.equal(direct(input).error,'invalid');
  assert.throws(()=>native.unsentAmong(['embedded\0guid']),{code:'changes.invalid'});
  const locked=new DatabaseSync(file);locked.exec('BEGIN EXCLUSIVE');
  try{assert.throws(()=>native.latest(),e=>['changes.schema','changes.query'].includes(e.code));assert.throws(()=>old.latest());}finally{locked.exec('ROLLBACK');locked.close();}
  assert.deepEqual(native.latest(),old.latest(),'lock refusal releases all native resources');
  // The unchanged engine receives native marks and rows; a fixture supplies only imsg's own row/history RPCs.
  const {createEngine}=await load('server/src/engine/index.js');const {createLogger}=await load('core/kit/log.js');const {logSpec}=await load('server/src/paths.js');
  const log=createLogger({spec:logSpec,app:'test',run:'test',sink:()=>{},now:Date.now,level:'debug',strict:true});
  const exercise=async reader=>{
   const source=transport({fixture:true});const engine=createEngine({kind:'synthetic-native',makeTransport:()=>source,log:log.child('engine'),attachmentId:()=>'',timeoutMs:2000,changes:reader});
   let emitted;const received=new Promise(resolve=>{emitted=resolve;});engine.on((name,data)=>{if(name==='message.new')emitted(data.message);});
   try{
    await engine.start();source.write(JSON.stringify({jsonrpc:'2.0',method:'synthetic.emit',params:{id:1,guid:'row-1',chat_id:1,text:'Synthetic history/live row',created_at:'2026-01-01T00:00:00Z',is_from_me:false,sender:'synthetic@example.invalid',attachments:[]}}));
    const live=await bounded(received);const history=await engine.messages('1');assert.equal(history.messages[0].id,live.id);
    const head=await engine.changes();assert.equal(head.reset,true);
    const page=await engine.changes({since:'v1.0.0.0.0.0.0',limit:2});
    assert.equal(page.messages.length,0,'unsent new rows suppressed');assert.equal(page.unsent.length,2);assert.equal(page.reads.length,2);assert.equal(page.more,true);
    assert.deepEqual(await engine.changes({since:'v1.0.0.0.0.0.0',limit:2}),page,'unchanged engine replay');
    const filtered=await engine.changes({since:'v1.0.0.0.0.0.0',limit:2,chats:new Set(['1'])});assert.ok(filtered.unsent.every(x=>x.chatId==='1'));
    assert.equal((await engine.changes({since:'v1.999999.0.0.0.0.0'})).reset,true);
    await assert.rejects(engine.changes({since:'invalid'}),{code:'bad_cursor'});
    return {head,page,filtered,live,history};
   }finally{await bounded(engine.stop());}
  };
  // Separate facades because engine.stop closes its injected reader.
  const a=await exercise(readerOf(session)),b=await exercise(createChangeReader({dbPath:file}));assert.deepEqual(a,b,'unchanged history/live/change engine parity');
  assert.equal(hash(),before,'all native and oracle reads preserve fixture');
  const closing=session.close(true);assert.throws(()=>native.latest(),/metadata.closed/);await bounded(closing);
  assert.throws(()=>globalThis.nativeMetadataRead(session.id,'changes','{"action":"latest"}'),/metadata.closed/);
  for(const [name,sql] of [['legacy','CREATE TABLE message(guid)'],['no-mine',"CREATE TABLE message(guid,date_read INTEGER,date_retracted INTEGER);CREATE TABLE chat_message_join(message_id,chat_id);INSERT INTO message VALUES('x',1000000,1000000);INSERT INTO chat_message_join VALUES(1,1)"],['empty','CREATE TABLE message(guid,date_read INTEGER,date_retracted INTEGER,is_from_me INTEGER);CREATE TABLE chat_message_join(message_id,chat_id)'],['duplicate-join',"CREATE TABLE message(guid,date_read INTEGER,date_retracted INTEGER,is_from_me INTEGER);CREATE TABLE chat_message_join(message_id,chat_id);INSERT INTO message VALUES('dupe',1000000,1000000,1);INSERT INTO chat_message_join VALUES(1,1),(1,2)"],['real-stamp',"CREATE TABLE message(guid,date_read REAL,date_retracted REAL,is_from_me INTEGER);CREATE TABLE chat_message_join(message_id,chat_id);INSERT INTO message VALUES('fraction',1500000.0,1500000.0,1);INSERT INTO chat_message_join VALUES(1,1)"]]){
   const p=path.join(dir,name+'.db'),d=new DatabaseSync(p);d.exec(sql);d.close();const s=transport({database:p}),n=readerOf(s),o=createChangeReader({dbPath:p});try{assert.deepEqual(n.latest(),o.latest());assert.deepEqual(n.readSince([0,0]),o.readSince([0,0]));assert.deepEqual(n.unsentSince([0,0]),o.unsentSince([0,0]));const first=n.unsentSince([0,0],1);assert.deepEqual(first,o.unsentSince([0,0],1));assert.deepEqual(n.unsentSince(first.cursor,1),o.unsentSince(first.cursor,1));}finally{o.close();n.close();await bounded(s.close(true));}
  }
  const absent=path.join(dir,'absent.db'),s=transport({database:absent});try{assert.throws(()=>readerOf(s).latest(),{code:'changes.unavailable'});assert.equal(existsSync(absent),false);}finally{await bounded(s.close(true));}
  const fake=transport({fixture:true});try{assert.throws(()=>readerOf(fake).latest(),/metadata.closed/);}finally{await bounded(fake.close(true));}
  assert.equal(Number(process.env.SWIFT_MAIN_PID),process.pid);console.log('NATIVE_CHANGES_DIFFERENTIAL_RESTART_BOUNDARIES_ENGINE_PASS PID='+process.pid);
 }finally{old.close();native.close();await bounded(session.close(true));rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
