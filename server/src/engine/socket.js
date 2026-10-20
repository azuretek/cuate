// A launchd-owned helper is reached, never spawned, through the same line interface as the engine.
import { createConnection } from 'node:net';
import { createInterface } from 'node:readline';

export function socketTransport({ path, connect = createConnection }) {
  const lines = new Set();
  const exits = new Set();
  const socket = connect({ path });
  let exited = false;
  let failure = null;
  const done = () => {
    if (exited) return;
    exited = true;
    for (const cb of exits) cb({ code: null, signal: null, error: failure });
  };
  createInterface({ input: socket }).on('line', (line) => {
    for (const cb of lines) cb(line);
  }).on('error', (error) => { failure = error.code || 'socket_error'; });
  socket.on('error', (error) => { failure = error.code || 'socket_error'; });
  socket.on('close', done);
  return {
    write(line) { if (!exited && !socket.destroyed) socket.write(line + '\n'); },
    onLine(cb) { lines.add(cb); },
    onExit(cb) {
      exits.add(cb);
      if (exited) cb({ code: null, signal: null, error: failure });
    },
    close() {
      if (exited) return Promise.resolve();
      return new Promise((resolve) => {
        exits.add(resolve);
        socket.destroy();
      });
    },
  };
}
