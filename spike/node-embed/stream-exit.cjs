const process = require('node:process');
const { nativeStreamOpen } = globalThis;
if (!nativeStreamOpen(1,'',true,()=>{throw new Error('LATE_NATIVE_COMPLETION');},()=>{throw new Error('LATE_NATIVE_COMPLETION');})) throw new Error('open refused');
process.exit(7);
