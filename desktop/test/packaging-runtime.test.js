import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { parse } from 'yaml';
import { EventEmitter } from 'node:events';

test('cached CommonJS builder tools run outside the application module scope', (t) => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'builder-scope-'));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const workspace = path.join(temp, 'workspace');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ type: 'module' }));
  const workflow = parse(readFileSync(new URL('../../.github/workflows/package.yml', import.meta.url), 'utf8'));
  const job = workflow.jobs.build;
  const cache = job.steps.find((step) => step.uses === 'actions/cache@v4');
  const expand = (value) => value.replaceAll('${{ github.workspace }}', workspace).replaceAll('${{ runner.temp }}', path.join(temp, 'runner'));
  const setup = job.steps.find((step) => step.name === 'Set packaging cache outside application module scope');
  let builderCache = job.env.ELECTRON_BUILDER_CACHE;
  if (setup) {
    const envFile = path.join(temp, 'github-env');
    const setupResult = spawnSync('bash', ['-c', setup.run], { encoding: 'utf8', env: { ...process.env, PACKAGING_CACHE: expand(setup.env.PACKAGING_CACHE).replaceAll('\\', '/'), GITHUB_ENV: envFile.replaceAll('\\', '/') } });
    assert.equal(setupResult.status, 0, setupResult.stderr);
    const env = Object.fromEntries(readFileSync(envFile, 'utf8').trim().split('\n').map((line) => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
    builderCache = env.ELECTRON_BUILDER_CACHE;
    assert.equal(path.normalize(builderCache), path.join(expand(cache.with.path), 'electron-builder'));
  }
  const dir = expand(builderCache) + '/icons';
  mkdirSync(dir, { recursive: true });
  const script = path.join(dir, 'icon-tool.js');
  writeFileSync(script, "console.log(typeof require('node:fs').readFileSync);\n");
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'function');
});

test('smoke cleanup waits for server close before removing its data', async () => {
  const source = readFileSync(new URL('../scripts/smoke.mjs', import.meta.url), 'utf8');
  const cleanup = source.slice(source.indexOf('clearTimeout(killer);'), source.indexOf('const ok ='));
  const server = new EventEmitter();
  let closed = false;
  server.kill = () => { setImmediate(() => { closed = true; server.emit('close', 0); }); };
  const removed = [];
  const remove = (name) => { assert.equal(closed, true, 'server data removed before child close'); removed.push(name); };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('killer', 'server', 'rmSync', 'data', 'path', 'out', cleanup)(undefined, server, remove, 'server-data', path, 'shots');
  assert.deepEqual(removed, ['server-data', path.join('shots', 'user-data')]);
});
