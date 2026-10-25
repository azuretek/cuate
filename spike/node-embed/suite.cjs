const process = require('node:process');
delete process.env.DYLD_PRINT_LIBRARIES;
const { pathToFileURL } = require('node:url');
const assert = require('node:assert/strict');
assert.equal(process.pid,Number(process.env.SWIFT_MAIN_PID));
// Import the existing test file unchanged in this embedded environment.
import(pathToFileURL(process.argv[2]).href).catch(error=>{
  process.stderr.write(error.stack+'\n'); process.exitCode=1;
});
