import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { parse, stringify } from 'yaml';
import { classify, changedFiles } from '../../scripts/release/changes.mjs';
import { versionOf } from '../../scripts/release/version.mjs';
import { expectedAssets, verifyAssets } from '../../scripts/release/assets.mjs';
import { collect } from '../../scripts/release/collect.mjs';
import { publish } from '../../scripts/release/release.mjs';
import config from '../electron-builder.mjs';
const naming = JSON.parse(readFileSync(new URL('../../core/spec/naming.json', import.meta.url)));
const sha = 'abcdef0123'.repeat(4);
const version = versionOf('0.1.0', 8, sha);

test('non-shipped paths never release, unknown and shipped paths do', () => {
  for (const file of ['docs/a.txt', 'README.md', 'desktop/README.md', '.github/workflows/release.yml', '.githooks/pre-push', 'scripts/release/version.mjs', 'LICENSE', '.gitignore', 'server/src/main.js']) assert.equal(classify([file]).release, false, file);
  for (const file of ['core/app/main.js', 'desktop/src/main.js', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'new-platform/app']) assert.equal(classify([file]).release, true, file);
  assert.equal(classify([]).release, false);
  assert.equal(classify(['docs/a.md', 'core/a.js']).release, true);
});
test('diff includes deletions and both sides of renames, dispatch uses release range', () => {
  const calls = [];
  const git = (args) => { calls.push(args); return args[0] === 'tag' ? 'v0.1.1-dev.4.abcdef0123\n' : 'desktop/deleted.js\0docs/a.md\0'; };
  assert.deepEqual(changedFiles({ GITHUB_EVENT_NAME: 'push', GITHUB_EVENT_BEFORE: sha }, git), ['desktop/deleted.js', 'docs/a.md']);
  assert.ok(calls[0].includes('--no-renames'));
  changedFiles({ GITHUB_EVENT_NAME: 'workflow_dispatch' }, git);
  assert.ok(calls.at(-1).includes('v0.1.1-dev.4.abcdef0123'));
});
test('one version format: next patch, commit count, ten SHA characters', () => {
  assert.equal(version, '0.1.1-dev.8.abcdef0123');
  for (const args of [['1.0', 2, sha], ['1.0.0', 0, sha], ['1.0.0', 1, 'no']]) assert.throws(() => versionOf(...args));
});
test('builder identity and install policy come from the naming spec', () => {
  assert.equal(config.productName, naming.product);
  assert.equal(config.appId, naming.ids.desktop);
  assert.equal(config.publish.owner + '/' + config.publish.repo, naming.repo);
  assert.equal(config.nsis.shortcutName, naming.product);
  assert.equal(config.nsis.perMachine, false);
  assert.equal(config.nsis.allowElevation, false);
  assert.equal(config.extraResources[0].to, 'core');
});
function fixture(t) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'release-assets-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const names = expectedAssets(version);
  for (const name of names) writeFileSync(path.join(dir, name), name);
  const asset = names.find((name) => name.endsWith('.exe'));
  for (const name of names.filter((name) => name.endsWith('.yml'))) {
    const files = names.filter((file) => name === 'dev.yml' ? file.endsWith('.exe') : name === 'dev-mac.yml' ? file.endsWith('.zip') : name === 'dev-linux.yml' ? file.endsWith('x86_64.AppImage') : file.endsWith('arm64.AppImage')).map((url) => { const bytes = readFileSync(path.join(dir, url)); return { url, size: bytes.length, sha512: createHash('sha512').update(bytes).digest('base64') }; });
    writeFileSync(path.join(dir, name), stringify({ version, files }));
  }
  return { dir, names, asset };
}
test('completeness refuses missing assets, bad versions and incorrect hashes', (t) => {
  const { dir, names, asset } = fixture(t);
  assert.deepEqual(verifyAssets(dir, version), names);
  writeFileSync(path.join(dir, asset), 'corrupt');
  assert.throws(() => verifyAssets(dir, version), /hash mismatch/);
  rmSync(path.join(dir, asset));
  assert.throws(() => verifyAssets(dir, version), /Missing/);
});
test('feed gate refuses a missing architecture even if every installer exists', (t) => {
  const { dir } = fixture(t);
  const file = path.join(dir, 'dev.yml');
  const doc = parse(readFileSync(file, 'utf8')); doc.files.pop(); writeFileSync(file, stringify(doc));
  assert.throws(() => verifyAssets(dir, version), /omits architecture/);
});
test('collector merges architecture feeds and refuses an asset collision', (t) => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'collect-assets-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const input = path.join(root, 'input'); const output = path.join(root, 'output');
  for (const arch of ['x64', 'arm64']) { const dir = path.join(input, arch); mkdirSync(dir, { recursive: true }); writeFileSync(path.join(dir, 'dev.yml'), stringify({ version, files: [{ url: arch + '.exe' }] })); writeFileSync(path.join(dir, arch + '.exe'), arch); }
  collect(input, output);
  assert.equal(parse(readFileSync(path.join(output, 'dev.yml'), 'utf8')).files.length, 2);
  writeFileSync(path.join(input, 'arm64', 'x64.exe'), 'duplicate');
  assert.throws(() => collect(input, output), /Duplicate asset/);
});
test('publisher is dry-run by default and deletes a partial draft on upload failure', (t) => {
  const { dir } = fixture(t);
  const calls = [];
  const gh = (args) => { calls.push(args); if (args[0] === 'api') return '[]'; if (args[1] === 'upload') throw new Error('upload failed'); return ''; };
  publish({ dir, version, sha, gh });
  assert.equal(calls.length, 0);
  assert.throws(() => publish({ dir, version, sha, gh, apply: true }), /upload failed/);
  assert.equal(calls.at(-1)[1], 'delete');
  assert.equal(calls.some((args) => args.includes('--draft=false')), false);
});
test('publication waits for remote digests and retains only the newest ten dev builds', (t) => {
  const { dir, names } = fixture(t);
  const calls = [];
  const releases = Array.from({ length: 11 }, (_, i) => ({ prerelease: true, draft: false, tag_name: 'v0.1.0-dev.' + i + '.abcdef0123', published_at: String(i).padStart(2, '0') }));
  releases.push({ prerelease: false, draft: false, tag_name: 'v0.1.0', published_at: '99' });
  const gh = (args) => {
    calls.push(args);
    if (args.includes('databaseId')) return JSON.stringify({ databaseId: 123 });
    if (args[0] === 'api' && args[1].includes('?')) return JSON.stringify(releases);
    if (args[0] === 'api') return JSON.stringify({ draft: true, assets: names.map((name) => { const bytes = readFileSync(path.join(dir, name)); return { name, size: bytes.length, digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }; }) });
    if (args.includes('isDraft,isPrerelease')) return JSON.stringify({ isDraft: false, isPrerelease: true });
    return '';
  };
  publish({ dir, version, sha, gh, apply: true });
  const edit = calls.findIndex((args) => args.includes('--draft=false'));
  assert.ok(edit > calls.findIndex((args) => args[0] === 'api' && args[1].endsWith('/123')));
  assert.equal(calls.filter((args) => args[1] === 'delete').length, 2);
  assert.ok(!calls.some((args) => args[1] === 'delete' && args.includes('v0.1.0')));
});
test('a remote digest mismatch withdraws the draft, never publishes', (t) => {
  const { dir, names } = fixture(t); const calls = [];
  const gh = (args) => { calls.push(args); if (args.includes('databaseId')) return JSON.stringify({ databaseId: 123 }); if (args[0] === 'api' && args[1].includes('?')) return '[]'; if (args[0] === 'api') return JSON.stringify({ draft: true, assets: names.map((name) => ({ name, size: 0, digest: 'wrong' })) }); return ''; };
  assert.throws(() => publish({ dir, version, sha, gh, apply: true }), /Uploaded asset differs/);
  assert.equal(calls.at(-1)[1], 'delete');
  assert.ok(!calls.some((args) => args.includes('--draft=false')));
});
test('all six native packaging legs and their tests gate the sole publisher', () => {
  const workflow = parse(readFileSync(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'));
  const packaging = parse(readFileSync(new URL('../../.github/workflows/package.yml', import.meta.url), 'utf8'));
  assert.equal(packaging.jobs.build.strategy.matrix.include.length, 6);
  // The publisher needs the platforms gate beside the build: a test build may not
  // publish from a run whose phone or desktop leg was red.
  assert.deepEqual(workflow.jobs.release.needs, ['prepare', 'platforms', 'build']);
  assert.match(workflow.jobs.release.if, /needs\.platforms\.result == 'success'/);
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  assert.deepEqual(workflow.on.push.branches, ['main']);
  assert.equal(workflow.on.push.paths, undefined);
  assert.ok(packaging.jobs.build.steps.some((step) => step.run === 'pnpm run test'));
  assert.ok(packaging.jobs.build.steps.some((step) => step.run?.includes('smoke-packed.mjs')));
});
