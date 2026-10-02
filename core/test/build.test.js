// The About page's one spec and the half each value comes from. These fail when a value is taken from the wrong half
// rather than relying on anyone to notice, and they hold the version to its one source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD_SPEC } from '../app/rules/build-spec.js';
import { copyToClipboard } from '../app/clipboard.js';
import {
  UNKNOWN, channelOf, buildNumberOf, clientReport, reportRows, commitState, bugReportBlock, aboutModel,
} from '../kit/rules/build.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(ROOT, p), 'utf8');

test('the generated mirror is the one build spec', () => {
  assert.deepEqual(BUILD_SPEC, JSON.parse(read('core/spec/build.json')));
});

test('the server half is the server route model, so the two cannot drift', () => {
  const model = JSON.parse(read('core/spec/api.json')).models.Info;
  for (const { key } of BUILD_SPEC.halves.server.fields) assert.ok(Object.hasOwn(model, key.split('.')[0]), 'the Info model is missing ' + key);
});

test('the version has one source both halves read', () => {
  const version = JSON.parse(read('core/spec/version.json'));
  assert.match(version.version, /^\d+\.\d+\.\d+$/);
  assert.ok(version.channel === 'dev' || version.channel === 'stable');
  assert.equal(BUILD_SPEC.versionFile, 'core/spec/version.json');
  assert.match(read('server/src/paths.js'), /spec\/version\.json/);
  assert.match(read('desktop/electron-builder.mjs'), /spec\/version\.json/);
  assert.match(read('scripts/release/version.mjs'), /spec\/version\.json/);
});

test('the client version comes from the shell and the server version from the server', () => {
  const host = { version: '1.2.3-client', channel: 'dev', commit: 'a'.repeat(40), builtAt: 'now', platform: 'darwin', arch: 'arm64', packaged: true };
  const info = { serverVersion: '9.9.9-server', serverChannel: 'stable', serverCommit: 'b'.repeat(40), serverPlatform: 'linux', engine: { kind: 'fake', version: '0.1' }, apiVersion: 1 };
  const model = aboutModel(BUILD_SPEC, host, info);
  const clientVersion = model.clientRows.find((r) => r.label === 'Client version');
  const serverVersion = model.serverRows.find((r) => r.label === 'Server version');
  assert.equal(clientVersion.value, host.version);
  assert.equal(serverVersion.value, info.serverVersion);
  // A value taken from the wrong half would show up here.
  assert.notEqual(clientVersion.value, info.serverVersion);
  assert.notEqual(serverVersion.value, host.version);
  assert.equal(model.serverRows.find((r) => r.label === 'Engine').value, 'fake');
});

test('the About page wires each half to its own report', () => {
  const page = read('core/app/components/app-about.js').replace(/\s+/g, ' ');
  assert.ok(page.includes('aboutModel(BUILD_SPEC, this.host || {}, this.info || {})'), 'the client half is the shell and the server half is the server');
  const root = read('core/app/components/app-root.js').replace(/\s+/g, ' ');
  assert.ok(root.includes('.host=${this.host}'), 'the shell report reaches the page');
  assert.ok(root.includes('.info=${this.info}'), 'the server report reaches the page');
});

test('a pair on different commits is stated, and an unmatched pair is never called a match', () => {
  const client = { commit: 'a'.repeat(40) };
  const server = { serverCommit: 'b'.repeat(40) };
  const mismatch = commitState(client, server);
  assert.equal(mismatch.state, 'mismatch');
  assert.match(mismatch.text, /different commits/);
  assert.ok(mismatch.text.includes('a'.repeat(10)) && mismatch.text.includes('b'.repeat(10)));
  assert.equal(commitState({ commit: 'c'.repeat(40) }, { serverCommit: 'c'.repeat(40) }).state, 'match');
  assert.equal(commitState({}, {}).state, 'unknown');
  assert.equal(commitState({ commit: 'a'.repeat(40) }, {}).state, 'unknown');
});

test('every declared field renders and a missing value is Unknown', () => {
  const rows = reportRows(BUILD_SPEC, 'server', { serverVersion: '1', engine: { kind: 'fake' } });
  assert.equal(rows.length, BUILD_SPEC.halves.server.fields.length);
  assert.equal(rows.find((r) => r.label === 'Server version').value, '1');
  assert.equal(rows.find((r) => r.label === 'Engine').value, 'fake');
  assert.equal(rows.find((r) => r.label === 'Server commit').value, UNKNOWN);
});

test('channel and build number are read from the version string', () => {
  assert.equal(channelOf('0.1.1-dev.8.abcdef0123'), 'dev');
  assert.equal(channelOf('0.1.1'), 'stable');
  assert.equal(buildNumberOf('0.1.1-dev.8.abcdef0123'), '8');
  assert.equal(buildNumberOf('0.1.1'), null);
});

test('the shell report derives the channel, install source and update channel', () => {
  const r = clientReport({ product: 'Widget', version: '0.1.1-dev.8.abcdef0123', versions: { electron: '44', chrome: '136', node: '24' }, platform: 'darwin', arch: 'arm64', packaged: true });
  assert.equal(r.channel, 'dev');
  assert.equal(r.build, '8');
  assert.equal(r.updateChannel, 'dev');
  assert.equal(r.installSource, 'disk image');
  assert.equal(r.electron, '44');
  assert.equal(r.chromium, '136');
  assert.equal(r.node, '24');
  assert.equal(r.packaged, true);
  const source = clientReport({ product: 'Widget', version: '0.1.1', packaged: false });
  assert.equal(source.installSource, 'source');
  assert.equal(source.channel, 'stable');
  assert.equal(source.updateChannel, 'latest');
});

test('the one action copies the whole block', async () => {
  const host = { product: 'Widget', version: '1.2.3', commit: 'a'.repeat(40) };
  const info = { serverVersion: '0.0.0', serverCommit: 'b'.repeat(40) };
  const block = bugReportBlock(BUILD_SPEC, host, info, host.product);
  assert.ok(block.startsWith('Widget bug report'));
  assert.ok(block.includes('Client version: 1.2.3'));
  assert.ok(block.includes('Server version: 0.0.0'));
  assert.ok(block.includes('different commits'));
  const copied = [];
  assert.equal(await copyToClipboard(block, { clipboard: { writeText: (t) => { copied.push(t); return Promise.resolve(); } } }), true);
  assert.deepEqual(copied, [block]);
  assert.equal(await copyToClipboard(block, { clipboard: null, document: null }), false);
});
