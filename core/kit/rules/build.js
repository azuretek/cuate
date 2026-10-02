// Pure: the build report both halves show on the About page. The fields and their owner come from
// core/spec/build.json, so a value is always read from the half that owns it: the client's own build from the shell's
// report, the server's from the server's. Nothing here does I/O, so the rules are tested without a shell or a server.
export const UNKNOWN = 'Unknown';

const missing = (v) => v === undefined || v === null || v === '';

// A checkout's channel is the one the version carries: a test build names its commit count, a plain version is a
// stable one. This is the same split the updater uses to pick a feed.
export function channelOf(version) {
  return /-/.test(String(version || '')) ? 'dev' : 'stable';
}

// The number after -dev. in a test build, so the About page can show it apart from the version it sits in.
export function buildNumberOf(version) {
  const m = /(?:^|-)dev\.(\d+)(?:\.|$)/.exec(String(version || ''));
  return m ? m[1] : null;
}

// What is wrong with a server stamp (server/stamp.json, written by scripts/gen-server-stamp.mjs), or null when it is
// sound. The server refuses to start on a stamp this rejects, and the generator's --check holds a written stamp to it,
// so a version and a commit that do not belong together are never reported.
export function stampProblem(stamp) {
  if (!stamp || typeof stamp !== 'object') return 'the stamp is not an object';
  const { version, commit, channel, builtAt } = stamp;
  if (!/^\d+\.\d+\.\d+(-dev\.\d+\.[a-f0-9]{10})?$/.test(String(version))) return 'the version is not a release version: ' + version;
  if (!/^[a-f0-9]{40}$/.test(String(commit))) return 'the commit is not a full commit id';
  if (channelOf(version) === 'dev' && !version.endsWith('.' + commit.slice(0, 10))) return 'the version does not name the commit';
  if (channel !== channelOf(version)) return 'the channel does not match the version';
  if (missing(builtAt)) return 'the build time is missing';
  return null;
}

// Where an install came from, from the facts the shell owns. A source run is not installed at all.
export function installSource({ packaged, appImage, platform } = {}) {
  if (!packaged) return 'source';
  if (appImage) return 'AppImage';
  if (platform === 'darwin') return 'disk image';
  if (platform === 'win32') return 'installer';
  return 'package';
}

// The client's own half, composed by the shell from facts only the shell holds. Nothing here reads the server.
export function clientReport(facts = {}) {
  const version = facts.version;
  const channel = facts.channel || channelOf(version);
  const versions = facts.versions || {};
  return {
    product: facts.product,
    version,
    channel,
    build: buildNumberOf(version),
    commit: facts.commit || null,
    builtAt: facts.builtAt || null,
    electron: versions.electron || null,
    chromium: versions.chrome || null,
    node: versions.node || null,
    platform: facts.platform || null,
    arch: facts.arch || null,
    packaged: Boolean(facts.packaged),
    installSource: installSource(facts),
    updateChannel: channel === 'dev' ? 'dev' : 'latest',
  };
}

// A dotted path into one half's report, so a nested value (the engine's kind) is named in the spec like any other.
export function pick(source, dotted) {
  return String(dotted).split('.').reduce((value, key) => (value === undefined || value === null ? value : value[key]), source);
}

// The rows for one half, in the spec's order, with a missing value shown as Unknown rather than an empty cell.
export function reportRows(spec, half, source) {
  const fields = (spec && spec.halves && spec.halves[half] && spec.halves[half].fields) || [];
  return fields.map(({ key, label }) => {
    const value = pick(source || {}, key);
    return { key, label, value: missing(value) ? UNKNOWN : String(value) };
  });
}

// The one thing a bug report must rule out first: an unmatched pair. The statement names both commits.
export function commitState(report, serverReport) {
  const client = report && report.commit ? String(report.commit) : null;
  const server = serverReport && serverReport.serverCommit ? String(serverReport.serverCommit) : null;
  const short = (value) => value.slice(0, 10);
  if (client && server && client !== server) {
    return { state: 'mismatch', text: 'The client and server are on different commits: the client is on ' + short(client) + ', the server on ' + short(server) + '.' };
  }
  if (client && server) return { state: 'match', text: 'The client and server are on the same commit (' + short(client) + ').' };
  return { state: 'unknown', text: 'The client and server commits cannot be compared.' };
}

// The whole About body: one set of rows per half and the comparison between them.
export function aboutModel(spec, report, serverReport) {
  return {
    clientRows: reportRows(spec, 'client', report || {}),
    serverRows: reportRows(spec, 'server', serverReport || {}),
    commit: commitState(report, serverReport),
  };
}

// The pasteable block, in the same order the page draws, with the comparison at the end.
export function bugReportBlock(spec, report, serverReport, product) {
  const lines = [(product ? product : 'Client') + ' bug report'];
  const section = (title, rows) => {
    lines.push('', title);
    for (const row of rows) lines.push('  ' + row.label + ': ' + row.value);
  };
  section('Client', reportRows(spec, 'client', report || {}));
  section('Server', reportRows(spec, 'server', serverReport || {}));
  lines.push('', 'Compare', '  ' + commitState(report, serverReport).text);
  return lines.join('\n') + '\n';
}
