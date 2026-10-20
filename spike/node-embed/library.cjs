const console = require('node:console');
const process = require('node:process');
const { nativeRPC } = globalThis;
const assert = require('node:assert/strict');
const {existsSync, mkdtempSync, rmSync} = require('node:fs');
const {DatabaseSync} = require('node:sqlite');
const {tmpdir} = require('node:os');
const path = require('node:path');
(async () => {
  const db = path.join(tmpdir(), 'synthetic-native-' + process.pid + '.db');
  assert.equal(existsSync(db), false);
  const replies = await Promise.all(Array.from({length:16}, (_, i) => nativeRPC(200+i, JSON.stringify({jsonrpc:'2.0',id:i,method:'synthetic.unknown'}), db)));
  replies.forEach((raw,i) => { const reply = JSON.parse(raw); assert.equal(reply.pid,process.pid); const [line] = reply.lines; const value=JSON.parse(line); assert.equal(value.id,i); assert.equal(value.error.code,-32601); });
  assert.equal(existsSync(db),false);
  assert.equal(Number(process.env.SWIFT_MAIN_PID),process.pid);
  const fixtureDir = mkdtempSync(path.join(tmpdir(),'native-library-fixture-'));
  try {
    const fixture = path.join(fixtureDir,'synthetic.db');
    const sql = new DatabaseSync(fixture);
    sql.exec(`CREATE TABLE message (ROWID INTEGER PRIMARY KEY, handle_id INTEGER,text TEXT,destination_caller_id TEXT,date INTEGER,is_from_me INTEGER,service TEXT);
CREATE TABLE chat (ROWID INTEGER PRIMARY KEY,chat_identifier TEXT,guid TEXT,display_name TEXT,service_name TEXT);
CREATE TABLE handle (ROWID INTEGER PRIMARY KEY,id TEXT);
CREATE TABLE chat_message_join (chat_id INTEGER,message_id INTEGER);
CREATE TABLE chat_handle_join (chat_id INTEGER,handle_id INTEGER);
CREATE TABLE message_attachment_join (message_id INTEGER,attachment_id INTEGER);
INSERT INTO chat VALUES (1,'synthetic@example.invalid','synthetic;+;chat1','Synthetic','synthetic');
INSERT INTO message VALUES (1,NULL,'synthetic-library-read','synthetic@example.invalid',1000000000,1,'synthetic');
INSERT INTO chat_message_join VALUES (1,1);`);
    sql.close();
    const raw = JSON.parse(await nativeRPC(301,JSON.stringify({jsonrpc:'2.0',id:301,method:'messages.history',params:{chat_id:1,limit:5}}),fixture));
    assert.equal(raw.pid,process.pid);
    const value = JSON.parse(raw.lines[0]);
    assert.equal(value.error,undefined,JSON.stringify(value));
    assert.equal(value.result.messages.length,1);
    assert.equal(value.result.messages[0].text,'synthetic-library-read');
    console.log('PINNED_CORE_SYNTHETIC_HISTORY_PASS PID='+process.pid);
  } finally { rmSync(fixtureDir,{recursive:true}); }
  console.log('PINNED_LIBRARY_16_REPLIES_SAME_PID_PASS PID='+process.pid);
})().catch(error => { console.error(error); process.exitCode=1; });
