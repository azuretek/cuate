// Phase 2f: ship the server's own log lines to the household's syslog collector. The process's sink is stdout and
// stderr, which launchd keeps on the Mac, so a machine that runs the server keeps its lines only there. This adds a
// second sink that sends each already approved line on as syslog (RFC 5424) over TCP, framed with the octet count
// (RFC 6587), to an off the shelf rsyslog. Producers ship their own lines; no custom receiver is written. The
// collector's address and port are configuration. Nothing is dropped silently: a line the collector would not take is
// kept in a spill file and the failure is said out loud as a declared log event.
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { appendFileSync, mkdirSync } from 'node:fs';

// local0, so a collector can route these apart from its own messages; the severities are the syslog ones.
const FACILITY = 16;
const SEVERITY = { debug: 7, info: 6, notice: 5, warn: 4, error: 3, fatal: 2 };
const MAX_MSGID = 32;
const MAX_APP = 48;
// The one event the ship never sends: it announces a failure of this very sink, so sending it would recurse, and the
// server's own log is where the failure belongs.
export const SPILL_EVENT = 'log.spilled';

/** One RFC 5424 line whose MSG is the JSON log line, ready for RFC 6587 octet counted framing. */
export function syslogFrame(line, { hostname = os.hostname(), app = 'server' } = {}) {
  const pri = FACILITY * 8 + (SEVERITY[line.level] ?? SEVERITY.notice);
  const ts = line.ts || new Date(0).toISOString();
  const msgid = String(line.event || '-').slice(0, MAX_MSGID) || '-';
  const name = String(app || '-').slice(0, MAX_APP) || '-';
  const host = hostname && hostname.length <= 255 ? hostname : '-';
  const message = '<' + pri + '>1 ' + ts + ' ' + host + ' ' + name + ' ' + (line.pid ?? '-') + ' ' + msgid + ' - ' + JSON.stringify(line);
  return Buffer.byteLength(message, 'utf8') + ' ' + message;
}

export function createSyslogShip({
  host,
  port,
  spec,
  app = 'server',
  hostname = os.hostname(),
  spillPath = null,
  log = null,
  connect = (h, p) => net.connect({ host: h, port: p }),
  maxBuffer = 1000,
} = {}) {
  const buffer = [];
  const stats = { sent: 0, spilled: 0, refused: 0 };
  let socket = null;
  let connected = false;
  let closed = false;

  function writeSpill(line) {
    if (!spillPath) return false;
    try {
      mkdirSync(path.dirname(spillPath), { recursive: true });
      appendFileSync(spillPath, JSON.stringify(line) + '\n', { mode: 0o600 });
      return true;
    } catch {
      return false; // the disk may be full; the notice below still says what was lost
    }
  }

  // One notice per failure, so a collector that is down for a while does not flood the very log it is missing.
  function spill(lines) {
    if (!lines.length) return;
    for (const line of lines) { writeSpill(line); stats.spilled += 1; }
    if (log) log.emit(SPILL_EVENT, { host, port, count: lines.length });
  }

  function flush() {
    while (buffer.length && socket && socket.writable) {
      const line = buffer.shift();
      try {
        socket.write(syslogFrame(line, { hostname, app }));
        stats.sent += 1;
      } catch {
        spill([line]);
      }
    }
  }

  function down() {
    const s = socket;
    socket = null;
    connected = false;
    if (s) { try { s.removeAllListeners(); s.destroy(); } catch { /* already gone */ } }
    spill(buffer.splice(0));
  }

  function open() {
    if (socket || closed) return;
    let s;
    try { s = connect(host, port); } catch { return; }
    socket = s;
    if (s.setNoDelay) s.setNoDelay(true);
    s.on('connect', () => { if (socket === s) { connected = true; flush(); } });
    s.on('error', () => { if (socket === s) down(); });
    s.on('close', () => { if (socket === s) down(); });
  }

  function send(line) {
    if (closed) return false;
    if (line.event === SPILL_EVENT) return false;
    // The last gate before the wire: only an event the spec declares ever leaves the process.
    if (!spec || !spec.events || !spec.events[line.event]) { stats.refused += 1; return false; }
    if (connected && socket && socket.writable) {
      try {
        socket.write(syslogFrame(line, { hostname, app }));
        stats.sent += 1;
        return true;
      } catch { /* buffered below */ }
    }
    if (buffer.length >= maxBuffer) { spill([line]); return false; }
    buffer.push(line);
    open();
    return true;
  }

  function close() {
    closed = true;
    const s = socket;
    socket = null;
    connected = false;
    buffer.length = 0;
    if (s) { try { s.removeAllListeners(); s.end(); } catch { /* gone */ } }
  }

  return { send, close, flush, stats, connected: () => connected };
}

/** The process's whole sink: the line written to stdout or stderr, and the syslog ship when a collector is configured. */
export function createLogSink({
  spec,
  app = 'server',
  syslog = null,
  spillPath = null,
  log = null,
  hostname = os.hostname(),
  connect = undefined,
  write = (line) => {
    const s = JSON.stringify(line) + '\n';
    if (line.level === 'error' || line.level === 'fatal') process.stderr.write(s);
    else process.stdout.write(s);
  },
} = {}) {
  const ship = syslog ? createSyslogShip({ host: syslog.host, port: syslog.port, spec, app, hostname, spillPath, log, connect }) : null;
  const sink = (line) => {
    write(line);
    if (ship) ship.send(line);
  };
  sink.ship = ship;
  sink.close = () => { if (ship) ship.close(); };
  return sink;
}
