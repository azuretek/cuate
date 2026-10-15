# Observability

What Cuate measures, where the numbers can be read, and what it deliberately does not measure. The design rules
live in [DESIGN.md](DESIGN.md); the household standard is the Software standards page, sections Observability and
Configuration. The logging side is owned by the [logging skill](https://github.com/azuretek/cuate) shape this repo
already follows: one JSON object per line, every event and field declared in `core/spec/log-events.json`.

## Read from the field, without a terminal

- **The log**, one JSON object per line. On a Mac it is the LaunchAgent's file, and when a collector is configured
  every approved line is also shipped to the household's rsyslog. The first place to look, and the only place the
  full history lives.
- **`GET /healthz`** answers `{ok, version, commit}` with no token, so an updater can tell the server answering is
  the one it just switched to.
- **`GET /api/v1/info`** (any token) names the build stamp, the engine link and the sending switch.
- **`GET /api/v1/diagnostics`** (a reading token) adds uptime, whether the Messages database is readable, the
  counters for the quiet failures, and the last error.
- **About** on every client shows the app's and the server's build stamps side by side and copies them for a bug
  report, so a report never has to ask the reader to open a terminal.

## The counters

The counters are derived from the log stream (`server/src/diagnostics.js`), so a counter and its log line cannot
disagree: the counter is reading the line. They count the quiet failures, one named counter each:
`sends_refused`, `sends_failed`, `sends_uncertain`, `engine_starts`, `engine_restarts`, `engine_errors`,
`engine_overflows`, `ws_refused`, `ws_errors`, `auth_refused`, `http_errors`, `crashes`, `logs_spilled`,
`webhooks_given_up`, `webhooks_disabled`, `updates_rolled_back`.

## The gates are instrumentation too

- The desktop smoke evaluates its required checks against a table in `desktop/scripts/smoke.mjs`, each check naming
  the bound it enforces. A failing run prints `check <key>: measured <value>, required <bound>` for every check it
  failed, and a passing run writes every measured value to `checks.json`. CI uploads the captures, the report, the
  measured checks and a failure note on every run, so a red run leaves the numbers behind.
- The platforms gate refuses to publish unless every pipeline that builds a platform concluded green on the commit,
  and names the platform that did not.
- The phone legs' evidence is the boot capture and the instrumented tests, both uploaded as artifacts.

## Deliberately not measured

- **A metrics or tracing backend.** The fleet runs none, and a personal messenger does not need one. The counters
  above are read on demand from a JSON endpoint rather than scraped by a pipeline nobody reads. When a metrics and
  tracing track is chosen, `core/spec/metrics.json` and an OpenTelemetry exporter are where it lands.
- **The success path.** A send that worked, a request that answered, a conversation that opened: success belongs to
  traces and metrics, and a log line per success buries the one line that matters. A request's duration is available
  at `LOG_LEVEL=debug` (`http.request`), and there is no per-action latency histogram on top of it.
- **Per-action client latency as a stored number.** The client keeps no telemetry sink today, so the time to first
  paint, to open a conversation, to switch, to send and to receive is not written anywhere. The server's request
  timing at debug is the closest measure, and the client half waits for the metrics track rather than growing a
  second logger.
- **Message content, handles, search words and coordinates.** Never, in any telemetry. The log keeps ids, counts,
  durations and states, and the one free text field (an error) is scrubbed.
