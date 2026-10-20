const assert=require('node:assert/strict');
const console=require('node:console');
const process=require('node:process');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {tmpdir}=require('node:os');
const {mkdtempSync,rmSync,readFileSync,existsSync}=require('node:fs');
const {DatabaseSync}=require('node:sqlite');
const {createHash}=require('node:crypto');
const {setTimeout,clearTimeout}=require('node:timers');
const transport=require('./stream-transport.cjs');
const readersOf=require('./metadata-readers.cjs');
const bounded=p=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('metadata deadline')),5000);p.then(v=>{clearTimeout(timer);resolve(v);},e=>{clearTimeout(timer);reject(e);});});
(async()=>{
 const repo=process.argv[2],load=p=>import(pathToFileURL(path.join(repo,p)).href);
 const dir=mkdtempSync(path.join(tmpdir(),'native-metadata-'));
 const dbPath=path.join(dir,'synthetic.db');
 const db=new DatabaseSync(dbPath);
 db.exec('CREATE TABLE message (guid TEXT UNIQUE,is_audio_message INTEGER,is_played INTEGER,date_played INTEGER,item_type INTEGER,group_title TEXT,expressive_send_style_id TEXT)');
 const insert=db.prepare('INSERT INTO message VALUES(?,?,?,?,?,?,?)');
 insert.run('voice',1,1,1234567000000,0,null,null);
 insert.run('new-voice',1,0,0,0,null,null);
 insert.run('rename',0,0,0,2,'Synthetic group',null);
 insert.run('removed',0,0,0,2,null,null);
 insert.run('effect',0,0,0,0,null,'com.apple.MobileSMS.expressivesend.impact');
 insert.run("x' OR 1=1 --",0,0,0,2,'Bound literal',null);
 for(let i=0;i<140;i++)insert.run('batch-'+i,0,0,0,2,'Batch '+i,null);
 db.close();
 const hash=()=>createHash('sha256').update(readFileSync(dbPath)).digest('hex');const before=hash();
 const session=transport({database:dbPath});const native=readersOf(session);
 const factories={voices:(await load('server/src/engine/voices.js')).createVoiceReader,renames:(await load('server/src/engine/renames.js')).createRenameReader,sendEffects:(await load('server/src/engine/send-effects.js')).createSendEffectReader};
 const ids=['voice','new-voice','rename','removed','effect',"x' OR 1=1 --",'missing','voice',...Array.from({length:140},(_,i)=>'batch-'+i)];
 const sorted=m=>[...m].sort(([a],[b])=>a.localeCompare(b));
 try{
  for(const [kind,create] of Object.entries(factories)){
   const old=create({dbPath});try{assert.deepEqual(sorted(native[kind].among(ids)),sorted(old.among(ids)),kind+' parity');}finally{old.close();}
  }
  assert.equal(native.voices.among(['voice']).get('voice').played,true);
  assert.equal(native.renames.among(['rename']).get('rename'),'Synthetic group');
  assert.equal(native.sendEffects.among(['effect']).get('effect'),'com.apple.MobileSMS.expressivesend.impact');
  assert.equal(native.renames.among(['absent']).size,0);
  assert.equal(native.renames.among(["x' OR 1=1 --"]).size,1);
  const direct=(kind,ids)=>JSON.parse(globalThis.nativeMetadataRead(session.id,kind,JSON.stringify(ids)));
  assert.equal(direct('write',[]).error,'invalid');
  assert.equal(direct('voices',Array(129).fill('voice')).error,'invalid');
  assert.equal(direct('voices',['x\0bad']).error,'invalid');
  assert.equal(direct('voices',['x'.repeat(513)]).error,'invalid');
  assert.throws(()=>globalThis.nativeMetadataRead(session.id,'voices','[]\0ignored'),/metadata.invalid/);
  // Same native readers enrich the existing production mapper for history AND live events.
  const {createEngine}=await load('server/src/engine/index.js');
  const {createLogger}=await load('core/kit/log.js');const {logSpec}=await load('server/src/paths.js');
  const log=createLogger({spec:logSpec,app:'test',run:'test',sink:()=>{},now:Date.now,level:'debug',strict:true});
  const source=transport({fixture:true});
  const engine=createEngine({kind:'synthetic-native',makeTransport:()=>source,log:log.child('engine'),attachmentId:a=>'synthetic:'+a.original_path,timeoutMs:2000,...native});
  const raw={id:1,guid:'voice',chat_id:1,text:'',created_at:'2026-01-01T00:00:00Z',is_from_me:false,sender:'synthetic@example.invalid',attachments:[{filename:'note.caf',transfer_name:'note.caf',original_path:path.join(dir,'note.caf'),mime_type:'audio/x-caf',total_bytes:10}]};
  let arrived;const live=new Promise(resolve=>{arrived=resolve;});engine.on((name,data)=>{if(name==='message.new')arrived(data.message);});
  try{
   await engine.start();source.write(JSON.stringify({jsonrpc:'2.0',method:'synthetic.emit',params:raw}));
   const event=await bounded(live);assert.equal(event.attachments[0].voice,true);assert.equal(event.attachments[0].played,true);
   const page=await engine.messages('1');assert.equal(page.messages[0].attachments[0].voice,true);assert.equal(page.messages[0].attachments[0].played,true);
   source.write(JSON.stringify({jsonrpc:'2.0',method:'synthetic.emit',params:{...raw,id:2,guid:'effect',text:'Synthetic effect',attachments:[]}}));
   const effects=await engine.messages('1');assert.equal(effects.messages.find(m=>m.id==='effect').sendEffect,'slam');
   source.write(JSON.stringify({jsonrpc:'2.0',method:'synthetic.emit',params:{...raw,id:3,guid:'rename',text:'',attachments:[]}}));
   const renamed=await engine.messages('1');assert.deepEqual(renamed.messages.find(m=>m.id==='rename').event,{kind:'rename',name:'Synthetic group'});
  }finally{await bounded(engine.stop());}
  assert.equal(hash(),before,'Swift reads never change synthetic database');
  await bounded(session.close(true));
  assert.throws(()=>globalThis.nativeMetadataRead(session.id,'voices','[]'),/metadata.closed/);
  native.close();assert.throws(()=>native.voices.among(['voice']),/metadata.closed/);
  // Absent optional columns are empty; unreadable or invalid databases are not.
  const legacy=path.join(dir,'legacy.db');const old=new DatabaseSync(legacy);old.exec('CREATE TABLE message(guid TEXT)');old.close();
  const legacySession=transport({database:legacy});try{const r=readersOf(legacySession);for(const key of Object.keys(factories))assert.equal(r[key].among(['voice']).size,0);}finally{await bounded(legacySession.close(true));}
  const absent=path.join(dir,'absent.db');const missing=transport({database:absent});try{assert.throws(()=>readersOf(missing).voices.among(['voice']),{code:'metadata.unavailable'});assert.equal(existsSync(absent),false);}finally{await bounded(missing.close(true));}
  const fake=transport({fixture:true});try{assert.throws(()=>globalThis.nativeMetadataRead(fake.id,'voices','[]'),/metadata.closed/);}finally{await bounded(fake.close(true));}
  assert.equal(Number(process.env.SWIFT_MAIN_PID),process.pid);
  console.log('NATIVE_METADATA_DIFFERENTIAL_READONLY_CONSUMERS_PASS PID='+process.pid);
 }finally{await bounded(session.close(true));rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
