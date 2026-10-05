// The status a person reads when something is wrong: the server's build stamp, the engine link and whether the
// Messages database is readable, the sending switch, the counters for the quiet failures and the last error. It
// answers to a reading token, because it is the server Abi already owns and the same facts a log line carries.
export default {
  id: 'diagnostics',
  handle({ res, json, diagnostics, engine, naming, serverVersion, serverChannel, serverBuild, serverCommit, serverBuiltAt, platform, config, epoch }) {
    const info = engine.info();
    const snap = diagnostics ? diagnostics.snapshot() : { startedAt: null, uptimeMs: 0, counters: {}, lastError: null };
    json(res, 200, {
      product: naming.product,
      serverVersion,
      serverChannel,
      serverBuild,
      serverCommit,
      serverBuiltAt,
      serverPlatform: platform,
      epoch,
      startedAt: snap.startedAt,
      uptimeMs: snap.uptimeMs,
      engine: info,
      database: { ready: Boolean(info && info.ready) },
      sending: config.sending.enabled,
      counters: snap.counters,
      lastError: snap.lastError || null,
    });
  },
};
