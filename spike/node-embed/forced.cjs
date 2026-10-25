const console = require('node:console');
const process = require('node:process');
const { nativeAsync } = globalThis;
const assert = require('node:assert/strict');
const {setTimeout} = require('node:timers');
nativeAsync(91, 200).then(() => console.log('LATE_NATIVE_COMPLETION'));
setTimeout(() => { throw new Error('synthetic_forced_failure'); }, 5);
assert.equal(Number(process.env.SWIFT_MAIN_PID), process.pid);
