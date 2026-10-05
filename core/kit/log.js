// The one structured logger for the server and every client. Every line is one JSON object whose event and
// fields are declared in core/spec/log-events.json; free text is scrubbed. The sink, clock and ids are injected.
// A fixed-size flight recorder keeps the most recent lines at every level, so a crash record shows what led up to it
// even when the emitted level is higher.
import { scrub } from './rules/scrub.js';

export const LEVELS = ['debug', 'info', 'notice', 'warn', 'error', 'fatal'];
// Fields whose value is free text, so the scrub runs over them. A chat id is free text and not a plain identifier:
// the engine's chat id is a GUID that can embed the handle it belongs to, a phone number included, so it is scrubbed
// like any other free text (core/test/log-privacy.test.js). A child's last stderr line is free text too: it is the
// engine's own output and can carry a body, a handle or a number, so it is scrubbed like any other line.
const FREE_TEXT = new Set(['error', 'line', 'problem', 'chat', 'stderr']);

export function createLogger({ spec, app, version = null, run, pid = null, sink, now, level = 'notice', recorderSize = 2000, strict = false }) {
  const recorder = [];
  const state = { min: LEVELS.indexOf(level) };
  const typeOk = (t, v) => typeof v === t.replace(/\?$/, '');

  function emit(component, name, fields = {}, ctx = {}) {
    let def = spec.events[name];
    if (!def) {
      if (strict) throw new Error('undeclared log event: ' + name);
      fields = { name: String(name) };
      name = 'log.undeclared';
      def = spec.events[name];
    }
    const line = { ts: new Date(now()).toISOString(), level: def.level, event: name, msg: def.msg, app, component, run };
    if (pid !== null) line.pid = pid;
    if (version) line.version = version;
    if (ctx.traceId) line.trace_id = ctx.traceId;
    if (ctx.spanId) line.span_id = ctx.spanId;
    for (const [k, v] of Object.entries(fields)) {
      const t = def.fields[k];
      if (!t) { if (strict) throw new Error(`undeclared field ${k} on ${name}`); continue; }
      if (v === undefined || v === null) continue;
      if (!typeOk(t, v)) { if (strict) throw new Error(`field ${k} on ${name} should be ${t}`); line[k] = scrub(String(v)); continue; }
      line[k] = FREE_TEXT.has(k) ? scrub(v) : v;
    }
    recorder.push(line);
    if (recorder.length > recorderSize) recorder.shift();
    if (LEVELS.indexOf(def.level) >= state.min) sink(line);
    return line;
  }

  const make = (component) => ({
    emit: (name, fields, ctx) => emit(component, name, fields, ctx),
    child: (c) => make(c),
    setLevel: (l) => { if (LEVELS.includes(l)) state.min = LEVELS.indexOf(l); },
    recorder: () => recorder.slice(),
  });
  return make('main');
}
