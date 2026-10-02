import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { naming, logSpec, serverVersion } from '../paths.js';

// The fields of a Mac event that go on the wire. The log line keeps its own shape; this is the event's, so a
// client sees the same handful of things whatever the action was.
const EVENT_FIELDS = ['what', 'on', 'locked', 'reason'];
const macEvent = (name, fields) => {
  const out = { name };
  for (const k of EVENT_FIELDS) if (fields && fields[k] !== undefined) out[k] = fields[k];
  return out;
};

export default {
  name: 'run',
  async run({ dataDir, store, engineSetup }) {
    const config = loadConfig(dataDir);
    const { createLogger } = await import('../../../core/kit/log.js');
    const { installCrashHandlers } = await import('../crash.js');
    const { createEngine } = await import('../engine/index.js');
    const { startServer } = await import('../app.js');
    const { makeAttachmentId } = await import('../ids.js');
    const { createLogSink } = await import('../syslog.js');
    const { createMac } = await import('../mac.js');
    const { createRestarts } = await import('../watchdog.js');
    const { startMacCare } = await import('../mac-care.js');
    // The process's own sink is stdout and stderr, which launchd keeps on the Mac. When a collector is configured,
    // every approved line is also shipped to it as syslog, and a line the collector will not take is spilled and
    // reported through this same logger.
    let logger = null;
    const sink = createLogSink({
      spec: logSpec,
      app: naming.slug + '-server',
      syslog: config.log.syslog,
      spillPath: path.join(dataDir, 'log-spill.jsonl'),
      log: { emit: (event, fields) => { if (logger) logger.emit(event, fields); } },
    });
    logger = createLogger({ spec: logSpec, app: naming.slug + '-server', version: serverVersion, run: randomUUID().slice(0, 8), pid: process.pid, sink, now: Date.now, level: process.env.LOG_LEVEL || config.log.level });
    installCrashHandlers({ log: logger, logger, dataDir });
    // Every Mac action is one declared log event, and the run path sends each on as an event too, so the Server
    // screen sees a sleep hold, a lock, a relaunch and a restart as they happen. The sender exists once the
    // server does, so a Mac action taken before that would have no event to send.
    let publish = () => {};
    const macLog = {
      emit: (event, fields = {}) => {
        logger.emit(event, fields);
        if (String(event).startsWith('mac.')) publish('mac.state', macEvent(event, fields));
      },
      child: () => macLog,
    };
    const s = store();
    const secret = readFileSync(path.join(dataDir, 'secret'), 'utf8').trim();
    const { makeTransport, attachmentsRoot } = await engineSetup(config);
    const engineLog = logger.child('engine');
    const engine = createEngine({ kind: config.engine.kind, makeTransport: () => makeTransport(engineLog), log: engineLog, attachmentId: makeAttachmentId({ secret, store: s }) });
    logger.emit('server.start', { port: config.port, engine: config.engine.kind, sending: config.sending.enabled });
    await engine.start();
    const mac = createMac({ log: macLog, settings: config.mac, platform: process.platform, engineNeedsScreen: Boolean(config.engine.needsScreen) });
    let restartServer = () => process.exit(0);
    const restarts = createRestarts({ engine, mac, log: macLog, exit: () => restartServer() });
    const srv = await startServer({ config, store: s, engine, log: logger.child('http'), dataDir, attachmentsRoot, mac, restarts });
    publish = srv.publish;
    // The Mac care starts with the server listening, so every one of its events has somewhere to go.
    const care = startMacCare({ mac, engine, log: macLog });
    await care.start();
    let stopping = false;
    const stop = async (reason) => {
      if (stopping) return;
      stopping = true;
      logger.emit('server.stop', { reason });
      setTimeout(() => process.exit(0), 8000).unref();
      care.stop();
      sink.close();
      await srv.close();
      await engine.stop();
      s.close();
      process.exit(0);
    };
    // A restart of the whole server is the same clean stop, so the LaunchAgent starts it again.
    restartServer = () => { stop('restart requested'); };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
    // A hooks change is read on SIGHUP, so adding or removing an endpoint never drops the connected clients. A config
    // that no longer reads is reported and the endpoints the server already has are kept.
    process.on('SIGHUP', () => {
      try { srv.reloadHooks(loadConfig(dataDir)); } catch (e) { logger.emit('config.problem', { problem: String(e.message || e) }); }
    });
  },
};
