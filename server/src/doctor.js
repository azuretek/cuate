// Checks the Mac and the engine and says what to fix, one line each. It never changes anything.
import { accessSync, constants } from 'node:fs';
import { createRpc } from './engine/rpc.js';

export async function runDoctor({ config, store, makeTransport, dataDir, attachmentsRoot, platform = process.platform }) {
  const lines = [];
  let failed = false;
  const ok = (m) => lines.push('ok    ' + m);
  const warn = (m) => lines.push('warn  ' + m);
  const bad = (m) => { failed = true; lines.push('fail  ' + m); };
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj > 22 || (maj === 22 && min >= 13)) ok('Node ' + process.versions.node);
  else bad('Node ' + process.versions.node + ' is too old: 22.13 or newer is needed');
  ok('data folder ' + dataDir);
  const tokens = store.listTokens().filter((t) => !t.revoked_at);
  if (tokens.some((t) => t.scope === 'device')) ok(tokens.length + ' active token(s)');
  else warn('no device token yet: run token create --scope device --name <device>');
  const transport = makeTransport();
  const rpc = createRpc({ transport });
  let exited = false;
  transport.onExit(() => { exited = true; });
  try {
    const st = await rpc.request('status', {}, 10000);
    const version = st && st.version != null ? ' ' + st.version : '';
    if (st && st.database && st.database.ready) ok('engine ' + config.engine.kind + version + ': the Messages database is readable');
    else bad('engine ' + config.engine.kind + version + ' cannot read the Messages database: give Full Disk Access to the program that starts the server, then run doctor again');
  } catch (e) {
    bad('engine ' + config.engine.kind + ' did not answer (' + (exited ? 'it exited' : e.message) + '): check engine.bin in config.json (' + config.engine.bin + ')');
  } finally {
    await transport.close();
  }
  if (config.sending.enabled) ok('sending is on, at most ' + config.sending.perMinute + ' a minute');
  else warn('sending is off: switch it on with the command "sending on"');
  if (platform === 'darwin' || config.attachmentsRoot) {
    try {
      accessSync(attachmentsRoot, constants.R_OK);
      ok('attachments folder readable');
    } catch {
      warn('attachments folder not readable: ' + attachmentsRoot);
    }
  }
  return { failed, lines };
}
