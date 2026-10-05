// The server's counters and its last error, derived from the lines the logger already writes.
//
// Every failure in this server already has a declared log event on its path, and the household standard says a
// metric emission has a matching error log. So the counters are DERIVED from that one stream rather than
// incremented a second time at each call site: a wrapper around the sink observes each line, counts the ones that
// name a failure or a lifecycle change, and keeps the most recent error. The counter and the log line cannot
// disagree, because the counter is reading the line.
//
// What a person reads during a problem: the quiet failures (a refused or failed or uncertain send, an engine exit
// and restart, a refused socket, a refused request, a crash, a spilled log line) and the last error. Deliberately
// NOT measured here: the success path (a send that worked, a request that answered), which belongs to traces and
// metrics rather than to a counter read on the Server screen. docs/observability.md records that omission.

// The declared events that move a counter, and the counter each moves. A new failure event is added here, not at
// the call site, so there is one list rather than one increment per file.
const COUNTERS = {
  'send.refused': 'sends_refused',
  'send.failed': 'sends_failed',
  'send.uncertain': 'sends_uncertain',
  'engine.start': 'engine_starts',
  'engine.exit': 'engine_restarts',
  'engine.error': 'engine_errors',
  'engine.overflow': 'engine_overflows',
  'ws.refused': 'ws_refused',
  'ws.error': 'ws_errors',
  'auth.refused': 'auth_refused',
  'http.error': 'http_errors',
  'server.crash': 'crashes',
  'log.spilled': 'logs_spilled',
  'webhook.gaveup': 'webhooks_given_up',
  'webhook.disabled': 'webhooks_disabled',
  'update.rolled_back': 'updates_rolled_back',
};
const ERROR_LEVELS = new Set(['error', 'fatal']);

export function createDiagnostics({ now = Date.now } = {}) {
  const startedAt = now();
  const counters = Object.create(null);
  let lastError = null;

  // One already approved log line. Unknown events are ignored on purpose: a counter is added to the table above
  // before it can count anything, so a typo cannot invent a metric that nothing reads.
  function observe(line) {
    if (!line || typeof line !== 'object') return undefined;
    const key = COUNTERS[line.event];
    if (key) counters[key] = (counters[key] || 0) + 1;
    if (ERROR_LEVELS.has(line.level)) {
      lastError = {
        at: line.ts || new Date(now()).toISOString(),
        event: String(line.event || ''),
        message: String(line.error || line.problem || line.msg || ''),
      };
    }
    return undefined;
  }

  function snapshot() {
    return {
      startedAt: new Date(startedAt).toISOString(),
      uptimeMs: Math.max(0, now() - startedAt),
      counters: { ...counters },
      lastError,
    };
  }

  return { observe, snapshot };
}
