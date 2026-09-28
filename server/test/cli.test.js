import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/main.js');
const run = (dir, ...args) => execFileSync(process.execPath, [cli, ...args, '--data', dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

test('init, tokens, the send switch and doctor work from the command line', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'srv-cli-'));
  try {
    assert.match(run(dir, 'init', '--engine', 'fake', '--port', '0'), /initialised/);
    const cfg = JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8'));
    assert.equal(cfg.engine.kind, 'fake');
    assert.equal(cfg.sending.enabled, false);
    const token = run(dir, 'token', 'create', '--scope', 'device', '--name', 'laptop').trim().split('\n').pop();
    assert.match(token, /^tok_[A-Za-z0-9_-]{40,}$/);
    const list = run(dir, 'token', 'list');
    assert.match(list, /device/);
    assert.ok(!list.includes(token), 'token list must never print a token');
    assert.match(run(dir, 'sending', 'on'), /sending is on/);
    assert.equal(JSON.parse(readFileSync(path.join(dir, 'config.json'), 'utf8')).sending.enabled, true);
    const doc = run(dir, 'doctor');
    assert.match(doc, /^ok +engine fake/m);
    assert.ok(!/^fail/m.test(doc), doc);
    for (const f of ['state.db', 'state.db-wal']) {
      if (existsSync(path.join(dir, f))) assert.ok(!readFileSync(path.join(dir, f)).includes(Buffer.from(token)), 'tokens are stored hashed');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
