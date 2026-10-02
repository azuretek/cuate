// Looking after the server on a Mac: a LaunchAgent that runs it at login and again after a crash, publishing it
// on the tailnet with tailscale serve, updating the checkout it runs from, and checking a running server from
// anywhere. The pure parts are exported for the tests; the rest runs launchctl, plutil, tailscale, git and pnpm
// directly, never through a shell.
import { spawnSync } from 'node:child_process';
import {
  accessSync, closeSync, constants, existsSync, fstatSync, mkdirSync, openSync, readFileSync, readSync, renameSync,
  statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, naming } from './paths.js';

export const LABEL = naming.ids.server;
const MAIN = path.join(ROOT, 'server', 'src', 'main.js');
const TAILSCALE_APP = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Where the LaunchAgent and its log live, both named from core/spec/naming.json. */
export function servicePaths(home = os.homedir()) {
  return {
    plist: path.join(home, 'Library', 'LaunchAgents', LABEL + '.plist'),
    log: path.join(home, 'Library', 'Logs', naming.slug + '-server.log'),
  };
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The LaunchAgent: this checkout's server with its data folder, at login and again after a crash. */
export function renderPlist({ label = LABEL, node, main = MAIN, dataDir, root = ROOT, log, pathDirs }) {
  const args = [node, main, 'run', '--data', dataDir];
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key><string>${xml(label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    ...args.map((a) => `    <string>${xml(a)}</string>`),
    '  </array>',
    `  <key>WorkingDirectory</key><string>${xml(root)}</string>`,
    '  <key>EnvironmentVariables</key>',
    '  <dict>',
    `    <key>PATH</key><string>${xml(pathDirs.join(':'))}</string>`,
    '  </dict>',
    '  <key>RunAtLoad</key><true/>',
    '  <key>KeepAlive</key><true/>',
    '  <key>ThrottleInterval</key><integer>10</integer>',
    `  <key>StandardOutPath</key><string>${xml(log)}</string>`,
    `  <key>StandardErrorPath</key><string>${xml(log)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

/** The fields that matter from launchctl print. */
export function parseLaunchd(text) {
  const get = (re) => {
    const m = re.exec(String(text || ''));
    return m ? m[1].trim() : null;
  };
  return { state: get(/^\s*state = (.+)$/m), pid: get(/^\s*pid = (\d+)$/m), lastExit: get(/^\s*last exit code = (.+)$/m) };
}

/**
 * What to do about port 443 of the Mac's tailnet name, from tailscale serve status --json: add the server, it is
 * already there, or something else holds the port, which is never taken over. Other served ports are not ours.
 */
export function serveDecision(status, port) {
  const want = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`]);
  const web = (status && status.Web) || {};
  const key = Object.keys(web).find((k) => /:443$/.test(k));
  const tcp = status && status.TCP && status.TCP['443'];
  if (!key && !tcp) return { action: 'add' };
  const handlers = (key && web[key] && web[key].Handlers) || {};
  const root = handlers['/'];
  const others = Object.keys(handlers).filter((p) => p !== '/');
  if (key && root && want.has(String(root.Proxy)) && !others.length) return { action: 'present', host: key.replace(/:443$/, '') };
  return { action: 'conflict', detail: key ? 'port 443 already serves ' + JSON.stringify(handlers) : 'port 443 is held by a TCP forward' };
}

/** The newest log line for an event, and for one run if given; torn and foreign lines are skipped. */
export function lastEvent(text, name, run = null) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line.startsWith('{') || !line.includes(name)) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch {
      continue;
    }
    if (o && o.event === name && (run === null || o.run === run)) return o;
  }
  return null;
}

/** The first executable called name on PATH, without resolving links, so a versioned install path is not baked in. */
export function which(name, env = process.env) {
  for (const dir of String(env.PATH || '').split(path.delimiter)) {
    if (!dir) continue;
    const p = path.join(dir, name);
    try {
      accessSync(p, constants.X_OK);
      if (statSync(p).isFile()) return p;
    } catch {
      // not in this directory
    }
  }
  return null;
}

/** A handoff command's arguments with {id}, {scope} and {name} filled in from the new token; never the token. */
export function fillHandoff(args, t) {
  return args.map((a) => String(a).replace(/\{(id|scope|name)\}/g, (_, k) => String(t[k])));
}

/** One line about a server from its info route: versions, engine and the sending switch. */
export function describeInfo(info) {
  const e = (info && info.engine) || {};
  const engine = [e.kind || 'unknown engine', e.version, e.ready === false ? '(not ready)' : null].filter(Boolean).join(' ');
  return `server ${info.serverVersion}, API ${info.apiVersion}, engine ${engine}, sending ${info.sending ? 'on' : 'off'}`;
}

function sh(cmd, args, { cwd, timeout = 120000 } = {}) {
  const r = spawnSync(cmd, args, { cwd, timeout, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  if (r.error) return { code: 1, out: '', err: r.error.message };
  return { code: r.status === null ? 1 : r.status, out: String(r.stdout || '').trim(), err: String(r.stderr || '').trim() };
}

/** The end of a file, which is where the newest log lines are. */
function tailText(file, bytes = 256 * 1024) {
  let fd;
  try {
    fd = openSync(file, 'r');
    const size = fstatSync(fd).size;
    const len = Math.min(size, bytes);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, size - len);
    return buf.toString('utf8');
  } catch {
    return '';
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

const target = () => 'gui/' + process.getuid() + '/' + LABEL;

export function launchdState() {
  const r = sh('/bin/launchctl', ['print', target()], { timeout: 15000 });
  return r.code === 0 ? { loaded: true, ...parseLaunchd(r.out) } : { loaded: false };
}

async function bootstrap(plist) {
  for (let i = 0; ; i++) {
    const r = sh('/bin/launchctl', ['bootstrap', 'gui/' + process.getuid(), plist], { timeout: 30000 });
    if (r.code === 0) return;
    // A job booted out a moment ago can still be leaving, and launchd refuses the bootstrap until it has.
    if (i >= 4) throw new Error('launchctl bootstrap failed: ' + (r.err || r.out));
    await sleep(2000);
  }
}

async function get(url, headers = {}) {
  try {
    const res = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(8000) });
    return { status: res.status, text: await res.text() };
  } catch (e) {
    return { status: 0, text: String(e && e.message ? e.message : e) };
  }
}

/**
 * Wait for a NEW run to say it is ready, then for the port to answer. Answering alone proves nothing after a
 * restart, because the old process, or anything else on the port, answers just the same.
 */
async function waitReady(log, prevRun, port, seconds = 40) {
  const until = Date.now() + seconds * 1000;
  for (;;) {
    const ev = lastEvent(tailText(log), 'server.ready');
    if (ev && ev.run !== prevRun && (await get('http://127.0.0.1:' + port + '/healthz')).status === 200) return ev.run;
    if (Date.now() > until) throw new Error('the server did not come up within ' + seconds + ' s; read ' + log);
    await sleep(1000);
  }
}

function findTailscale(env) {
  return which('tailscale', env) || (existsSync(TAILSCALE_APP) ? TAILSCALE_APP : null);
}

function tailscaleJson(ts, args) {
  const r = sh(ts, args, { timeout: 20000 });
  if (r.code !== 0) throw new Error('tailscale ' + args.join(' ') + ' failed: ' + (r.err || r.out));
  return r.out ? JSON.parse(r.out) : {};
}
const serveStatus = (ts) => tailscaleJson(ts, ['serve', 'status', '--json']);
const tailnetName = (ts) => String((tailscaleJson(ts, ['status', '--json', '--peers=false']).Self || {}).DNSName || '').replace(/\.$/, '');

async function publish({ port, print, env }) {
  const ts = findTailscale(env);
  if (!ts) throw new Error('tailscale is not installed, so nothing was published; the server still answers on 127.0.0.1');
  const d = serveDecision(serveStatus(ts), port);
  if (d.action === 'conflict') throw new Error('nothing was published, because ' + d.detail);
  if (d.action === 'add') {
    const r = sh(ts, ['serve', '--bg', '--https=443', 'http://127.0.0.1:' + port], { timeout: 30000 });
    if (r.code !== 0) throw new Error('tailscale serve failed: ' + (r.err || r.out));
    if (serveDecision(serveStatus(ts), port).action !== 'present') throw new Error('tailscale serve did not take');
    print("done  published on port 443 of this Mac's tailnet name");
  }
  const url = 'https://' + tailnetName(ts);
  const h = await get(url + '/healthz');
  if (h.status !== 200) throw new Error(url + '/healthz answered ' + (h.status || h.text));
  print('ok    ' + url + ' answers');
}

/** Write and load the LaunchAgent after doctor passes, and prove a new run answers; --tailscale publishes it. */
export async function install({ dataDir, config, doctor, tailscale = false, node = null, print = console.log, env = process.env, home = os.homedir() }) {
  if (!Number.isInteger(config.port) || config.port < 1) {
    throw new Error('a service needs a fixed port, and the config says ' + config.port + ': set port in ' + path.join(dataDir, 'config.json'));
  }
  const report = await doctor();
  for (const line of report.lines) print(line);
  if (report.failed) throw new Error('doctor found a problem, so nothing was installed');
  const bin = node || which('node', env) || process.execPath;
  try {
    accessSync(bin, constants.X_OK);
  } catch {
    throw new Error('cannot run ' + bin);
  }
  const engineBin = config.engine.kind === 'imsg' ? (path.isAbsolute(config.engine.bin) ? config.engine.bin : which(config.engine.bin, env)) : null;
  if (config.engine.kind === 'imsg' && !engineBin) throw new Error('cannot find the engine ' + config.engine.bin + ' on PATH');
  const pathDirs = [...new Set([path.dirname(bin), ...(engineBin ? [path.dirname(engineBin)] : []), ...SYSTEM_PATH])];
  const P = servicePaths(home);
  const want = renderPlist({ node: bin, dataDir, log: P.log, pathDirs });
  const have = existsSync(P.plist) ? readFileSync(P.plist, 'utf8') : null;
  if (have !== want) {
    mkdirSync(path.dirname(P.plist), { recursive: true });
    mkdirSync(path.dirname(P.log), { recursive: true });
    const tmp = P.plist + '.new';
    writeFileSync(tmp, want, { mode: 0o644 });
    const lint = sh('/usr/bin/plutil', ['-lint', tmp]);
    if (lint.code !== 0) {
      unlinkSync(tmp);
      throw new Error('plutil refused the LaunchAgent: ' + (lint.err || lint.out));
    }
    renameSync(tmp, P.plist);
    print('done  wrote ' + P.plist + ', running ' + bin);
  } else {
    print('ok    ' + P.plist + ' is current');
  }
  const prev = lastEvent(tailText(P.log), 'server.ready');
  const st = launchdState();
  if (st.loaded && have === want) {
    const h = await get('http://127.0.0.1:' + config.port + '/healthz');
    if (h.status !== 200) throw new Error(LABEL + ' is loaded but 127.0.0.1:' + config.port + ' does not answer; read ' + P.log);
    print('ok    ' + LABEL + ' is running and answers on 127.0.0.1:' + config.port);
  } else {
    if (st.loaded) sh('/bin/launchctl', ['bootout', target()], { timeout: 30000 });
    await bootstrap(P.plist);
    await waitReady(P.log, prev ? prev.run : null, config.port);
    print('done  ' + (st.loaded ? 'reloaded ' : 'loaded ') + LABEL + ': it runs at every login and again after a crash, and answers on 127.0.0.1:' + config.port + ' (pid ' + (launchdState().pid || '?') + ')');
  }
  if (tailscale) await publish({ port: config.port, print, env });
  return true;
}

/** The LaunchAgent, the port, the switch the running server started with, its log, and the tailnet entry. */
export async function status({ config, print = console.log, env = process.env, home = os.homedir() }) {
  const P = servicePaths(home);
  const st = launchdState();
  const detail = st.loaded ? [st.state, st.pid && 'pid ' + st.pid, st.lastExit && 'last exit ' + st.lastExit].filter(Boolean).join(', ') : 'not loaded; run service install';
  print((st.loaded ? 'ok    ' : 'warn  ') + LABEL + ': ' + detail);
  const h = await get('http://127.0.0.1:' + config.port + '/healthz');
  print((h.status === 200 ? 'ok    ' : 'fail  ') + '127.0.0.1:' + config.port + (h.status === 200 ? ' answers' : ' does not answer'));
  const start = lastEvent(tailText(P.log), 'server.start');
  if (start) {
    const differs = start.sending !== config.sending.enabled;
    print((differs ? 'warn  ' : 'ok    ') + 'the server started with sending ' + (start.sending ? 'on' : 'off') + (differs ? ', and the config now says ' + (config.sending.enabled ? 'on' : 'off') + ': service restart applies it' : ''));
  }
  print('ok    log: ' + P.log);
  const ts = findTailscale(env);
  if (ts) {
    const d = serveDecision(serveStatus(ts), config.port);
    print(d.action === 'present' ? 'ok    tailnet: https://' + d.host : d.action === 'add' ? 'warn  not published on the tailnet' : 'warn  tailnet: ' + d.detail);
  }
  return st.loaded && h.status === 200;
}

/** Restart the service and wait until a new run answers; returns that run's id. */
export async function restart({ config, print = console.log, home = os.homedir() }) {
  const P = servicePaths(home);
  if (!launchdState().loaded) throw new Error(LABEL + ' is not loaded; run service install');
  const prev = lastEvent(tailText(P.log), 'server.ready');
  const r = sh('/bin/launchctl', ['kickstart', '-k', target()], { timeout: 30000 });
  if (r.code !== 0) throw new Error('launchctl kickstart failed: ' + (r.err || r.out));
  const run = await waitReady(P.log, prev ? prev.run : null, config.port);
  print('done  restarted; answering on 127.0.0.1:' + config.port + ' (pid ' + (launchdState().pid || '?') + ')');
  return run;
}

/** Fast-forward this checkout to its upstream, install the server dependency, and restart the service. */
export async function update({ config, print = console.log, env = process.env, home = os.homedir() }) {
  const git = (...args) => sh('git', ['-C', ROOT, ...args], { timeout: 300000 });
  if (git('rev-parse', '--git-dir').code !== 0) throw new Error(ROOT + ' is not a git checkout, so update it the way it was installed');
  const dirty = git('status', '--porcelain', '--untracked-files=no').out;
  if (dirty) throw new Error('the checkout has uncommitted changes, so it was left as it is: ' + dirty.split('\n').slice(0, 5).join('; '));
  const upstream = git('rev-parse', '--abbrev-ref', '@{u}');
  if (upstream.code !== 0) throw new Error("the checkout's branch has no upstream to update from");
  const f = git('fetch', '--quiet');
  if (f.code !== 0) throw new Error('git fetch failed: ' + (f.err || f.out));
  const head = git('rev-parse', 'HEAD').out;
  const tip = git('rev-parse', '@{u}').out;
  if (head === tip) {
    print('ok    already at ' + head.slice(0, 7) + ', the tip of ' + upstream.out);
    return true;
  }
  if (git('merge-base', '--is-ancestor', 'HEAD', '@{u}').code !== 0) throw new Error('the checkout has commits ' + upstream.out + ' lacks, so it was left as it is');
  const m = git('merge', '--ff-only', '--quiet', '@{u}');
  if (m.code !== 0) throw new Error('the fast-forward failed: ' + (m.err || m.out));
  print('done  updated ' + head.slice(0, 7) + '..' + tip.slice(0, 7));
  const pnpm = which('pnpm', env);
  if (!pnpm) throw new Error('pnpm is not on PATH, so the server dependency was not installed and nothing was restarted');
  const i = sh(pnpm, ['install', '--frozen-lockfile', '--prod', '--filter', 'server'], { cwd: ROOT, timeout: 600000 });
  if (i.code !== 0) throw new Error('pnpm install failed: ' + (i.err || i.out).split('\n').slice(-5).join(' | '));
  print('ok    the server dependency is installed');
  if (launchdState().loaded) await restart({ config, print, home });
  else print('warn  ' + LABEL + ' is not loaded, so nothing was restarted');
  return true;
}

/** Unload and delete the LaunchAgent and withdraw the tailnet entry it published; keep the data and the code. */
export async function remove({ config, print = console.log, env = process.env, home = os.homedir() }) {
  const P = servicePaths(home);
  if (launchdState().loaded) {
    sh('/bin/launchctl', ['bootout', target()], { timeout: 30000 });
    for (let i = 0; i < 10 && launchdState().loaded; i++) await sleep(1000);
    if (launchdState().loaded) throw new Error(LABEL + ' is still loaded');
    print('done  unloaded ' + LABEL);
  }
  if (existsSync(P.plist)) {
    unlinkSync(P.plist);
    print('done  deleted ' + P.plist);
  }
  const ts = config ? findTailscale(env) : null;
  if (ts) {
    const d = serveDecision(serveStatus(ts), config.port);
    if (d.action === 'present') {
      const r = sh(ts, ['serve', '--https=443', 'off'], { timeout: 30000 });
      if (r.code !== 0 || serveDecision(serveStatus(ts), config.port).action === 'present') throw new Error('the tailnet entry is still there: ' + (r.err || r.out));
      print('done  withdrew https://' + d.host);
    }
  }
  print('ok    removed; the data folder and the code are kept');
  return true;
}

/**
 * After a config change: restart a service that runs from this data folder and return the new run's start line.
 * Null when no service runs from it here, so the change waits for the next start.
 */
export async function applyIfInstalled({ dataDir, config, print = console.log, home = os.homedir() }) {
  if (process.platform !== 'darwin') return null;
  const P = servicePaths(home);
  if (!existsSync(P.plist) || !readFileSync(P.plist, 'utf8').includes('<string>' + xml(dataDir) + '</string>')) return null;
  if (!launchdState().loaded) return null;
  const run = await restart({ config, print, home });
  return lastEvent(tailText(P.log), 'server.start', run) || {};
}

/**
 * After a hooks change: tell a service that runs from this data folder to read its hook endpoints again (SIGHUP), so
 * no client is dropped, and return the reload line it wrote. Null when no service runs from it here.
 */
export async function reloadIfInstalled({ dataDir, home = os.homedir(), seconds = 10 }) {
  if (process.platform !== 'darwin') return null;
  const P = servicePaths(home);
  if (!existsSync(P.plist) || !readFileSync(P.plist, 'utf8').includes('<string>' + xml(dataDir) + '</string>')) return null;
  if (!launchdState().loaded) return null;
  const prev = lastEvent(tailText(P.log), 'webhook.reloaded');
  const r = sh('/bin/launchctl', ['kill', 'SIGHUP', target()], { timeout: 15000 });
  if (r.code !== 0) throw new Error('launchctl kill SIGHUP failed: ' + (r.err || r.out));
  for (const t0 = Date.now(); Date.now() - t0 < seconds * 1000; await sleep(250)) {
    const seen = lastEvent(tailText(P.log), 'webhook.reloaded');
    if (seen && (!prev || seen.ts !== prev.ts)) return seen;
  }
  throw new Error('the service was sent SIGHUP but wrote no webhook.reloaded line within ' + seconds + ' seconds: run service restart');
}

/** Does a server answer, and read, for this token? One line per step, and never the token. */
export async function check({ url, token, print = console.log }) {
  const base = url.replace(/\/+$/, '');
  const auth = { authorization: 'Bearer ' + token };
  const h = await get(base + '/healthz');
  print((h.status === 200 ? 'ok    ' : 'fail  ') + base + '/healthz answered ' + (h.status || h.text));
  const i = await get(base + '/api/v1/info', auth);
  let info;
  try {
    info = i.status === 200 ? JSON.parse(i.text) : null;
  } catch {
    info = null;
  }
  print(info ? 'ok    ' + describeInfo(info) : 'fail  info answered ' + (i.status || i.text));
  const c = await get(base + '/api/v1/chats?limit=5', auth);
  let n;
  try {
    n = c.status === 200 ? (JSON.parse(c.text).chats || []).length : null;
  } catch {
    n = null;
  }
  print(n === null ? 'fail  chats answered ' + (c.status || c.text) : 'ok    chats: ' + n + ' returned');
  return h.status === 200 && info !== null && n !== null;
}
