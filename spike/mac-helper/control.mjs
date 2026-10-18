// The control: Node spawns the helper's own executable as a plain child, then calls it over a
// socket exactly as the launchd-run helper is called. Prints the child's pid, keeps it alive for
// HOLD_SECONDS (default 30) so it can be inspected, then stops it.
// Usage: node control.mjs <executable> <socket>
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';

const [exe, socket] = process.argv.slice(2);
const hold = Number(process.env.HOLD_SECONDS ?? 30) * 1000;
if (!exe || !socket) {
  console.error('usage: node control.mjs <executable> <socket>');
  process.exit(2);
}
const child = spawn(exe, ['--socket', socket], { stdio: ['ignore', 'inherit', 'inherit'] });
const stop = (code) => {
  child.kill('SIGTERM');
  process.exit(code);
};
setTimeout(() => stop(4), hold + 15_000);

const call = (method) =>
  new Promise((resolve, reject) => {
    const conn = net.connect(socket, () => conn.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method }) + '\n'));
    let buf = '';
    conn.on('data', (d) => {
      buf += d;
      const nl = buf.indexOf('\n');
      if (nl >= 0) {
        conn.end();
        resolve(JSON.parse(buf.slice(0, nl)));
      }
    });
    conn.on('error', reject);
  });

const started = Date.now();
while (!existsSync(socket)) {
  if (Date.now() - started > 5000) stop(3);
  await new Promise((r) => setTimeout(r, 100));
}
console.log(JSON.stringify({ nodePid: process.pid, childPid: child.pid, hello: (await call('hello')).result }));
console.log(JSON.stringify({ count: (await call('chatdb.count')).result }));
setTimeout(() => stop(0), hold);
