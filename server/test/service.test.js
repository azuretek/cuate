import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { naming } from '../src/paths.js';
import { installLayout } from '../src/install.js';
import { LABEL, describeInfo, fillHandoff, lastEvent, parseLaunchd, renderPlist, serveDecision, serviceLabel, servicePaths, which } from '../src/service.js';
import { boot } from './helpers.js';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const run = (args, opts = {}) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...opts });
// Asynchronous, for a test whose server runs in this process: a synchronous child would block it.
const runAsync = (args, input, delayMs = 0) => new Promise((resolve) => {
  const c = spawn(process.execPath, [cli, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  c.stdout.on('data', (d) => (stdout += d));
  c.stderr.on('data', (d) => (stderr += d));
  c.on('close', (status) => resolve({ status, stdout, stderr }));
  setTimeout(() => c.stdin.end(input), delayMs);
});
const scratch = () => mkdtempSync(path.join(os.tmpdir(), 'srv-svc-'));

test('the LaunchAgent is named from naming.json, and so is its log', () => {
  assert.equal(LABEL, naming.ids.server);
  const p = servicePaths('/h');
  assert.equal(p.plist, path.join('/h', 'Library', 'LaunchAgents', naming.ids.server + '.plist'));
  assert.equal(p.log, path.join('/h', 'Library', 'Logs', naming.slug + '-server.log'));
});

test('a second install root gets its own LaunchAgent label and log, and the usual one keeps the server id', () => {
  const home = mkdtempSync(path.join(os.tmpdir(), 'srv-label-'));
  try {
    const usual = installLayout(path.join(home, 'Library', 'Application Support', naming.slug + '-server-install'));
    assert.equal(serviceLabel(null, home), LABEL, 'a checkout');
    assert.equal(serviceLabel(usual, home), LABEL, 'the install root under the home folder');
    const other = serviceLabel(installLayout(path.join(home, 'rehearsal')), home);
    assert.match(other, new RegExp('^' + LABEL.replace(/\./g, '\\.') + '\\.[a-f0-9]{10}$'));
    assert.notEqual(serviceLabel(installLayout(path.join(home, 'another')), home), other, 'each root has its own');
    assert.equal(serviceLabel(installLayout(path.join(home, 'rehearsal')), home), other, 'and keeps it');
    const p = servicePaths(home, other);
    assert.equal(p.plist, path.join(home, 'Library', 'LaunchAgents', other + '.plist'));
    assert.equal(p.log, path.join(home, 'Library', 'Logs', naming.slug + '-server-' + other.slice(LABEL.length + 1) + '.log'));
    assert.notEqual(p.log, servicePaths(home).log, 'it never writes into the usual service log');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('the LaunchAgent runs this server with its data folder, at login and after a crash', () => {
  const x = renderPlist({ node: '/opt/n/node', main: '/r/server/src/main.js', dataDir: '/d/a b&c', root: '/r', log: '/l/s.log', pathDirs: ['/opt/n', '/usr/bin'] });
  assert.ok(x.includes('<key>Label</key><string>' + LABEL + '</string>'));
  assert.ok(x.includes(['/opt/n/node', '/r/server/src/main.js', 'run', '--data', '/d/a b&amp;c'].map((a) => '    <string>' + a + '</string>').join('\n')));
  assert.match(x, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(x, /<key>KeepAlive<\/key><true\/>/);
  assert.equal(x.split('<string>/l/s.log</string>').length - 1, 2, 'stdout and stderr both go to the log');
  assert.ok(x.includes('<key>PATH</key><string>/opt/n:/usr/bin</string>'));
  assert.ok(x.includes('<key>WorkingDirectory</key><string>/r</string>'));
});

test('launchctl print is read for the state, pid and last exit', () => {
  const text = 'gui/501/x = {\n\tactive count = 1\n\tstate = running\n\n\tpid = 4242\n\tlast exit code = 0\n}';
  assert.deepEqual(parseLaunchd(text), { state: 'running', pid: '4242', lastExit: '0' });
  assert.deepEqual(parseLaunchd(''), { state: null, pid: null, lastExit: null });
});

test('port 443 is added when free, recognised when it is ours, and never taken from anything else', () => {
  const other = { TCP: { 8443: { HTTPS: true } }, Web: { 'mac.example.ts.net:8443': { Handlers: { '/': { Proxy: 'https+insecure://127.0.0.1:9' } } } } };
  assert.deepEqual(serveDecision({}, 7447), { action: 'add' });
  assert.deepEqual(serveDecision(other, 7447), { action: 'add' }, 'another port is not ours to touch');
  const ours = { TCP: { ...other.TCP, 443: { HTTPS: true } }, Web: { ...other.Web, 'mac.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:7447' } } } } };
  assert.deepEqual(serveDecision(ours, 7447), { action: 'present', host: 'mac.example.ts.net' });
  const taken = { TCP: { 443: { HTTPS: true } }, Web: { 'mac.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:9000' } } } } };
  assert.equal(serveDecision(taken, 7447).action, 'conflict');
  const shared = { TCP: { 443: { HTTPS: true } }, Web: { 'mac.example.ts.net:443': { Handlers: { '/': { Proxy: 'http://127.0.0.1:7447' }, '/x': { Proxy: 'http://127.0.0.1:9' } } } } };
  assert.equal(serveDecision(shared, 7447).action, 'conflict');
  assert.equal(serveDecision({ TCP: { 443: { TCPForward: '127.0.0.1:22' } } }, 7447).action, 'conflict');
});

test('the newest log line for an event is found by name and by run, past torn lines', () => {
  const log = ['{"event":"server.start","run":"a","sending":false}', 'not json', '{"event":"server.ready","run":"a"}',
    '{"event":"server.start","run":"b","sending":true}', '{"event":"server.re'].join('\n');
  assert.equal(lastEvent(log, 'server.start').run, 'b');
  assert.equal(lastEvent(log, 'server.start').sending, true);
  assert.equal(lastEvent(log, 'server.ready').run, 'a');
  assert.equal(lastEvent(log, 'server.start', 'a').sending, false);
  assert.equal(lastEvent(log, 'server.stop'), null);
  assert.equal(lastEvent('', 'server.start'), null);
});

test('which finds an executable on PATH and keeps the path it was found by', { skip: process.platform === 'win32' }, () => {
  const dir = scratch();
  try {
    mkdirSync(path.join(dir, 'bin'));
    writeFileSync(path.join(dir, 'bin', 'tool'), '#!/bin/sh\n');
    chmodSync(path.join(dir, 'bin', 'tool'), 0o755);
    writeFileSync(path.join(dir, 'bin', 'plain'), 'x');
    const env = { PATH: [path.join(dir, 'none'), path.join(dir, 'bin')].join(path.delimiter) };
    assert.equal(which('tool', env), path.join(dir, 'bin', 'tool'));
    assert.equal(which('plain', env), null, 'a file that cannot run is not a command');
    assert.equal(which('absent', env), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a handoff fills in the id, scope and name, and nothing else', () => {
  assert.deepEqual(fillHandoff(['--title', 'server token {name}', '--text', 'id={id}', 'scope={scope}', '{token}'], { id: 'i1', scope: 'device', name: 'phone' }),
    ['--title', 'server token phone', '--text', 'id=i1', 'scope=device', '{token}']);
});

test('the info line names versions, the engine and the switch', () => {
  assert.equal(describeInfo({ serverVersion: '1.2.3', apiVersion: 1, sending: false, engine: { kind: 'imsg', version: '0.1', ready: true } }), 'server 1.2.3, API 1, engine imsg 0.1, sending off');
  assert.equal(describeInfo({ serverVersion: '1', apiVersion: 1, sending: true, engine: { kind: 'fake', ready: false } }), 'server 1, API 1, engine fake (not ready), sending on');
  assert.equal(describeInfo({ serverVersion: '0.0.1-dev.9.abcdef0123', serverCommit: 'abcdef0123' + '4'.repeat(30), apiVersion: 1, sending: false, engine: { kind: 'fake' } }), 'server 0.0.1-dev.9.abcdef0123 (abcdef0123), API 1, engine fake, sending off');
});

test('token create hands the token to a command on stdin and never prints it', () => {
  const dir = scratch();
  try {
    assert.equal(run(['init', '--engine', 'fake', '--port', '0', '--data', dir]).status, 0);
    const got = path.join(dir, 'got.txt');
    const script = "const fs = require('fs'); fs.writeFileSync(process.argv[1], fs.readFileSync(0, 'utf8') + '|' + process.argv.slice(2).join(','))";
    const r = run(['token', 'create', '--scope', 'device', '--name', 'phone', '--data', dir, '--', process.execPath, '-e', script, got, '{id}', '{scope}', '{name}']);
    assert.equal(r.status, 0, r.stderr);
    const [stdin, args] = readFileSync(got, 'utf8').split('|');
    assert.match(stdin, /^tok_[A-Za-z0-9_-]{40,}\n$/);
    const [id, scope, name] = args.split(',');
    assert.deepEqual([scope, name], ['device', 'phone']);
    assert.ok(!(r.stdout + r.stderr).includes(stdin.trim()), 'the token is not printed');
    assert.match(r.stdout, new RegExp('token ' + id + ' \\(device\\) for phone was handed to'));
    assert.match(run(['token', 'list', '--data', dir]).stdout, new RegExp('^' + id + '\\s+device\\s+active', 'm'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a token whose handoff fails is revoked at once, and never printed', () => {
  const dir = scratch();
  try {
    run(['init', '--engine', 'fake', '--port', '0', '--data', dir]);
    const r = run(['token', 'create', '--scope', 'device', '--name', 'phone', '--data', dir, '--', process.execPath, '-e', 'process.exit(3)']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /exit 3\), so token \S+ was revoked/);
    assert.doesNotMatch(r.stdout + r.stderr, /tok_/);
    assert.match(run(['token', 'list', '--data', dir]).stdout, /\bdevice\s+revoked\s+phone\b/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a -- handoff goes only with token create', () => {
  const r = run(['doctor', '--data', os.tmpdir(), '--', 'x']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /goes only with token create/);
});

test('check reads a token on stdin and proves a server answers and reads', async () => {
  const s = await boot();
  try {
    const good = await runAsync(['check', '--url', s.base], s.tokens.tooling + '\n');
    assert.equal(good.status, 0, good.stdout + good.stderr);
    assert.match(good.stdout, /^ok +server .*, engine fake/m);
    assert.match(good.stdout, /^ok +chats: \d+ returned$/m);
    assert.ok(!good.stdout.includes(s.tokens.tooling), 'the token is not printed');
    const bad = await runAsync(['check', '--url', s.base], 'tok_not-a-real-token-at-all-000000000000000000\n');
    assert.equal(bad.status, 1);
    assert.match(bad.stdout, /^fail +info answered 401$/m);
  } finally {
    await s.close();
  }
});

test('check waits for a token that arrives late, as one piped from a password manager does', async () => {
  const s = await boot();
  try {
    const late = await runAsync(['check', '--url', s.base], s.tokens.tooling + '\n', 700);
    assert.equal(late.status, 0, late.stdout + late.stderr);
    assert.match(late.stdout, /^ok +chats: \d+ returned$/m);
  } finally {
    await s.close();
  }
});

test('check refuses a URL that could carry a credential', () => {
  for (const url of ['http://user:pw@127.0.0.1:1', 'http://127.0.0.1:1/?token=x', 'ftp://127.0.0.1']) {
    const r = run(['check', '--url', url], { input: 'x\n' });
    assert.notEqual(r.status, 0, url);
    assert.match(r.stderr, /no credentials, query or fragment/, url);
  }
});

test('service refuses off macOS', { skip: process.platform === 'darwin' }, () => {
  const r = run(['service', 'status', '--data', os.tmpdir()]);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /macOS LaunchAgent/);
});
