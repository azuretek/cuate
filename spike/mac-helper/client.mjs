// Calls one method on the helper's socket and prints the reply.
// Usage: node client.mjs <socket> [method] [params-json]   (TIMEOUT_MS overrides the 10 s limit)
import net from 'node:net';

const [socket, method = 'chatdb.count', params] = process.argv.slice(2);
if (!socket) {
  console.error('usage: node client.mjs <socket> [method] [params-json]');
  process.exit(2);
}
const request = { jsonrpc: '2.0', id: 1, method };
if (params) request.params = JSON.parse(params);
const timer = setTimeout(() => {
  console.error('timed out');
  process.exit(3);
}, Number(process.env.TIMEOUT_MS ?? 10_000));
const conn = net.connect(socket, () => conn.write(JSON.stringify(request) + '\n'));
let buf = '';
conn.on('data', (d) => {
  buf += d;
  const nl = buf.indexOf('\n');
  if (nl >= 0) {
    console.log(buf.slice(0, nl));
    clearTimeout(timer);
    conn.end();
  }
});
conn.on('error', (e) => {
  console.error(e.message);
  process.exit(1);
});
