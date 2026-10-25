const process=require('node:process');
const mark=m=>Array.isArray(m)&&m.length===2?[m[0],m[1]].map(n=>Math.max(0,Math.trunc(Number(n)||0))):[0,0];
module.exports=function changeReader(session){
 let closed=false;
 const call=request=>{
  if(closed)throw Object.assign(new Error('changes.closed'),{code:'changes.closed'});
  const value=JSON.parse(globalThis.nativeMetadataRead(session.id,'changes',JSON.stringify(request)));
  if(value.error)throw Object.assign(new Error('changes.'+value.error),{code:'changes.'+value.error});
  if(value.pid!==process.pid)throw new Error('changes.pid');
  return value.value;
 };
 const since=(action,cursor,limit=200)=>{
  const normalized=mark(cursor);
  if(!normalized.every(Number.isSafeInteger)||!Number.isInteger(limit)||limit<1||limit>200)throw Object.assign(new Error('changes.invalid'),{code:'changes.invalid'});
  const page=call({action,cursor:normalized,limit});
  return {...page,rows:page.rows.map(([rowid,guid,chat,at])=>({rowid:Number(rowid),guid:String(guid),chatId:String(chat),...(action==='read'?{readAt:new Date(Date.UTC(2001,0,1)+Number(at)).toISOString()}:{})}))};
 };
 return {
  latest(){const v=call({action:'latest'});return {...v,rowid:Number(v.rowid)||0};},
  unsentSince:(cursor,limit)=>since('unsent',cursor,limit),
  readSince:(cursor,limit)=>since('read',cursor,limit),
  unsentAmong(guids){
   if(closed)throw Object.assign(new Error('changes.closed'),{code:'changes.closed'});
   const ids=[...new Set((guids||[]).map(String))].filter(Boolean),result=new Set();
   for(let i=0;i<ids.length;i+=128)for(const guid of call({action:'among',guids:ids.slice(i,i+128)}).guids)result.add(String(guid));
   return result;
  },
  close(){closed=true;},
 };
};
