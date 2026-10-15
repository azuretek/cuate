// The status a person reads when something is wrong: the server's build stamp, the engine link and whether the
// Messages database is readable, the sending switch, the counters for the quiet failures and the last error. It
// answers to a reading token, because it is the server Abi already owns and the same facts a log line carries.
export default {
  id: 'diagnostics',
  handle({ res, json, diagnostics, engine, contacts, naming, serverVersion, serverChannel, serverBuild, serverCommit, serverBuiltAt, platform, config, epoch }) {
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
      // The system Contacts store (issue 393): an allowed store says how many people it holds, so an empty store
      // and a store that was never allowed are never the same answer. The engine's own Contacts grant is reported by
      // doctor, which asks the engine.
      contacts: contacts && contacts.status ? contacts.status() : null,
      sending: config.sending.enabled,
      counters: snap.counters,
      lastError: snap.lastError || null,
    });
  },
};
