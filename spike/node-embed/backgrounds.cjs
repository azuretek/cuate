const assert=require('node:assert/strict'),console=require('node:console'),process=require('node:process'),path=require('node:path');
const {pathToFileURL}=require('node:url'),{tmpdir}=require('node:os'),{mkdtempSync,rmSync,readFileSync,existsSync}=require('node:fs'),{DatabaseSync}=require('node:sqlite'),{createHash}=require('node:crypto'),{setTimeout,clearTimeout}=require('node:timers');
const transport=require('./stream-transport.cjs'),readersOf=require('./metadata-readers.cjs');
const bounded=p=>new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('background deadline')),5000);p.then(v=>{clearTimeout(t);resolve(v);},e=>{clearTimeout(t);reject(e);});});
(async()=>{
 const repo=process.argv[2],load=p=>import(pathToFileURL(path.join(repo,p)).href);
 const {createBackgroundReader}=await load('server/src/engine/backgrounds.js');
 const dir=mkdtempSync(path.join(tmpdir(),'native-backgrounds-')),file=path.join(dir,'synthetic.db');
 const db=new DatabaseSync(file);db.exec('CREATE TABLE message(guid TEXT UNIQUE,item_type INTEGER,group_action_type INTEGER,date INTEGER);CREATE TABLE chat_message_join(message_id INTEGER,chat_id)');
 const add=db.prepare('INSERT INTO message VALUES(?,?,?,?)'),join=db.prepare('INSERT INTO chat_message_join VALUES(?,?)');
 for(const row of [['set',3,4,100],['clear',3,6,100],['ordinary',0,4,900],['unknown',3,5,900],['other',1,6,900],["x' OR 1=1 --",3,4,200],['unjoined',3,4,300],['nul\0event',3,6,400]])add.run(...row);
 join.run(1,1);join.run(2,1);join.run(6,null);join.run(8,'nul\0chat');join.run(2,2);
 for(let i=0;i<140;i++){add.run('batch-'+i,3,i%2?6:4,500+i);join.run(9+i,3);}
 db.close();const hash=()=>createHash('sha256').update(readFileSync(file)).digest('hex'),before=hash();
 const session=transport({database:file}),native=readersOf(session),old=createBackgroundReader({dbPath:file,bin:'never-run'});
 const ids=['set','clear','ordinary','unknown','other',"x' OR 1=1 --",'absent','set',...Array.from({length:140},(_,i)=>'batch-'+i)];
 const sorted=m=>[...m].sort(([a],[b])=>a.localeCompare(b));
 try{
  assert.deepEqual(sorted(native.backgrounds.among(ids)),sorted(old.among(ids)),'background among parity');
  assert.deepEqual([...native.backgrounds.latest()],[...old.latest()],'background latest parity');
  assert.deepEqual(native.backgrounds.latest().get('1'),{chatId:'1',guid:'clear',action:'clear'},'same-date ROWID tie');
  assert.equal(native.backgrounds.latest().get('null').guid,"x' OR 1=1 --");assert.equal(native.backgrounds.latest().get('nul\0chat').guid,'nul\0event');
  assert.equal(native.backgrounds.among(['ordinary','unknown','other']).size,0);assert.equal(native.backgrounds.among(["x' OR 1=1 --"]).size,1);
  assert.deepEqual([...native.backgrounds.latest()],[...native.backgrounds.latest()],'repeatable latest');
  const direct=(kind,ids)=>JSON.parse(globalThis.nativeMetadataRead(session.id,kind,JSON.stringify(ids)));
  assert.equal(direct('backgroundLatest',['caller filter']).error,'invalid');assert.equal(direct('backgrounds',['bad\0id']).error,'invalid');assert.equal(direct('backgrounds',Array(129).fill('set')).error,'invalid');
  const lock=new DatabaseSync(file);lock.exec('BEGIN EXCLUSIVE');try{assert.throws(()=>native.backgrounds.latest(),e=>['metadata.schema','metadata.query'].includes(e.code));}finally{lock.exec('ROLLBACK');lock.close();}
  assert.deepEqual([...native.backgrounds.latest()],[...old.latest()],'lock failure releases resources');
  const {createEngine}=await load('server/src/engine/index.js'),{createLogger}=await load('core/kit/log.js'),{logSpec}=await load('server/src/paths.js');
  const log=createLogger({spec:logSpec,app:'test',run:'test',sink:()=>{},now:Date.now,level:'debug',strict:true});
  const exercise=async backgrounds=>{
   const source=transport({fixture:true}),engine=createEngine({kind:'synthetic-native',makeTransport:()=>source,log:log.child('engine'),attachmentId:()=>'',timeoutMs:2000,backgrounds});const events=[];
   try{await engine.start();for(const [n,guid,action] of [[1,'set','set'],[2,'clear','clear']]){
    let received;const wait=new Promise(resolve=>{received=resolve;});engine.on((name,data)=>{if(name==='message.new'&&data.message.id===guid)received(data.message);});
    source.write(JSON.stringify({jsonrpc:'2.0',method:'synthetic.emit',params:{id:n,guid,chat_id:1,text:'',created_at:'2026-01-01T00:00:00Z',is_from_me:false,sender:'synthetic@example.invalid',attachments:[]}}));
    const live=await bounded(wait);assert.deepEqual(live.event,{kind:'background',action});const history=await engine.messages('1');assert.deepEqual(history.messages.find(m=>m.id===guid).event,live.event);events.push(live.event);
   }return events;}finally{await bounded(engine.stop());}
  };
  assert.deepEqual(await exercise(native.backgrounds),await exercise(createBackgroundReader({dbPath:file,bin:'never-run'})),'unchanged history/live engine parity');
  assert.equal(hash(),before,'native and oracle reads preserve fixture');
  const closing=session.close(true);assert.throws(()=>native.backgrounds.latest(),/metadata.closed/);await bounded(closing);native.close();assert.throws(()=>native.backgrounds.among(['set']),/metadata.closed/);
  for(const [name,sql] of [['legacy','CREATE TABLE message(guid TEXT)'],['missing-action','CREATE TABLE message(guid TEXT,item_type INTEGER)'],['empty','CREATE TABLE message(guid TEXT,item_type INTEGER,group_action_type INTEGER,date INTEGER);CREATE TABLE chat_message_join(message_id,chat_id)']]){
   const f=path.join(dir,name+'.db'),d=new DatabaseSync(f);d.exec(sql);d.close();const s=transport({database:f}),r=readersOf(s),o=createBackgroundReader({dbPath:f,bin:'never-run'});try{assert.deepEqual([...r.backgrounds.among(['set'])],[...o.among(['set'])]);assert.deepEqual([...r.backgrounds.latest()],[...o.latest()]);}finally{o.close();r.close();await bounded(s.close(true));}
  }
  for(const [name,sql] of [['no-date','CREATE TABLE message(guid TEXT,item_type INTEGER,group_action_type INTEGER);CREATE TABLE chat_message_join(message_id,chat_id)'],['no-join','CREATE TABLE message(guid TEXT,item_type INTEGER,group_action_type INTEGER,date INTEGER)'],['malformed','CREATE TABLE unrelated(value)']]){
   const f=path.join(dir,name+'.db'),d=new DatabaseSync(f);d.exec(sql);d.close();const s=transport({database:f});try{assert.throws(()=>readersOf(s).backgrounds.latest(),{code:'metadata.schema'});}finally{await bounded(s.close(true));}
  }
  const absent=path.join(dir,'absent.db'),missing=transport({database:absent});try{assert.throws(()=>readersOf(missing).backgrounds.latest(),{code:'metadata.unavailable'});assert.equal(existsSync(absent),false);}finally{await bounded(missing.close(true));}
  const big=path.join(dir,'big.db'),d=new DatabaseSync(big);d.exec('CREATE TABLE message(guid TEXT,item_type INTEGER,group_action_type INTEGER,date INTEGER);CREATE TABLE chat_message_join(message_id,chat_id)');const row=d.prepare('INSERT INTO message VALUES(?,3,4,?)'),link=d.prepare('INSERT INTO chat_message_join VALUES(?,1)');for(let i=1;i<=201;i++){row.run('row-'+i,i);link.run(i);}d.close();const many=transport({database:big}),oracle=createBackgroundReader({dbPath:big,bin:'never-run'});try{assert.equal(oracle.latest().size,1);assert.throws(()=>readersOf(many).backgrounds.latest(),{code:'metadata.limit'});}finally{oracle.close();await bounded(many.close(true));}
  const fake=transport({fixture:true});try{assert.throws(()=>readersOf(fake).backgrounds.latest(),/metadata.closed/);}finally{await bounded(fake.close(true));}
  assert.equal(Number(process.env.SWIFT_MAIN_PID),process.pid);console.log('NATIVE_BACKGROUND_METADATA_LATEST_ENGINE_PASS PID='+process.pid);
 }finally{old.close();native.close();await bounded(session.close(true));rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
