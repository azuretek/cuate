import { readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { naming, logSpec, serverVersion } from '../paths.js';

export default {
  name: 'run',
  async run({ dataDir, store, engineSetup }) {
    const config = loadConfig(dataDir);
    const { createLogger } = await import('../../../core/kit/log.js');
    const { installCrashHandlers } = await import('../crash.js');
    const { createEngine } = await import('../engine/index.js');
    const { startServer } = await import('../app.js');
    const { makeAttachmentId } = await import('../ids.js');
    const sink = (line) => {
      const s = JSON.stringify(line) + '\n';
      if (line.level === 'error' || line.level === 'fatal') process.stderr.write(s);
      else process.stdout.write(s);
    };
    const logger = createLogger({ spec: logSpec, app: naming.slug + '-server', version: serverVersion, run: randomUUID().slice(0, 8), pid: process.pid, sink, now: Date.now, level: process.env.LOG_LEVEL || config.log.level });
    installCrashHandlers({ log: logger, logger, dataDir });
    const s = store();
    const secret = readFileSync(path.join(dataDir, 'secret'), 'utf8').trim();
    const { makeTransport, attachmentsRoot } = await engineSetup(config);
    const engineLog = logger.child('engine');
    const engine = createEngine({ kind: config.engine.kind, makeTransport: () => makeTransport(engineLog), log: engineLog, attachmentId: makeAttachmentId({ secret, store: s }) });
    logger.emit('server.start', { port: config.port, engine: config.engine.kind, sending: config.sending.enabled });
    await engine.start();
    const srv = await startServer({ config, store: s, engine, log: logger.child('http'), dataDir, attachmentsRoot });
    let stopping = false;
    const stop = async (reason) => {
      if (stopping) return;
      stopping = true;
      logger.emit('server.stop', { reason });
      setTimeout(() => process.exit(0), 8000).unref();
      await srv.close();
      await engine.stop();
      s.close();
      process.exit(0);
    };
    process.on('SIGTERM', () => stop('SIGTERM'));
    process.on('SIGINT', () => stop('SIGINT'));
  },
};
