const process = require('node:process');
// Spike only: use the database authority captured by one admitted library session.
// No SQLite, process or platform API on the JS side of the replacement readers.
module.exports = function metadataReaders(session) {
  let closed = false;
  const reader = kind => ({
    among(guids) {
      if (closed) throw Object.assign(new Error('metadata.closed'), { code: 'metadata.closed' });
      const ids=[...new Set((guids||[]).map(String))].filter(Boolean);
      const result=new Map();
      for(let i=0;i<ids.length;i+=128){
        const value=JSON.parse(globalThis.nativeMetadataRead(session.id,kind,JSON.stringify(ids.slice(i,i+128))));
        if(value.error)throw Object.assign(new Error('metadata.'+value.error),{code:'metadata.'+value.error});
        if(value.pid!==process.pid)throw new Error('metadata.pid');
        for(const [guid,row] of value.rows)result.set(guid,row);
      }
      return result;
    },
    close() {},
  });
  return {voices:reader('voices'),renames:reader('renames'),sendEffects:reader('sendEffects'),members:reader('members'),backgrounds:{...reader('backgrounds'),latest(){
    if(closed)throw Object.assign(new Error('metadata.closed'),{code:'metadata.closed'});
    const value=JSON.parse(globalThis.nativeMetadataRead(session.id,'backgroundLatest','[]'));
    if(value.error)throw Object.assign(new Error('metadata.'+value.error),{code:'metadata.'+value.error});
    if(value.pid!==process.pid)throw new Error('metadata.pid');
    const found=new Map();for(const [rawId,rawGuid,action] of value.rows){const id=String(rawId);if(!found.has(id))found.set(id,{chatId:id,guid:String(rawGuid),action});}return found;
  }},close(){closed=true;}};
};
