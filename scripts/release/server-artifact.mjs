// Builds, verifies and boots the server's release artifact: a tarball of the server, the core it imports and its
// production dependencies, stamped by scripts/gen-server-stamp.mjs; a manifest naming the version, the commit, the
// Node range and the SHA-256 of every file; and the SHA-256 of the tarball. The checks themselves are the server's
// (server/src/artifact.js), so the publisher and, later, the installed server's updater run the same ones.
//
//   node scripts/release/server-artifact.mjs build OUT              stage, stamp, pack into OUT (BUILD_VERSION if set)
//   node scripts/release/server-artifact.mjs verify DIR VERSION [SHA]   every check the publisher runs
//   node scripts/release/server-artifact.mjs smoke DIR VERSION      unpack the verified files and boot them
//
// What ships: every tracked file under core/ and server/ except their tests, LICENSE, the stamp, and server's
// production dependencies copied out of the workspace install as plain files under server/node_modules. A link or
// any other non-file in the staged tree refuses the build rather than being followed or skipped.
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run as stampRun } from '../gen-server-stamp.mjs';
import { artifactNames, digestText, manifestOf, verifyArtifact, writeFiles, writeTarball } from '../../server/src/artifact.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const naming = JSON.parse(readFileSync(path.join(ROOT, 'core/spec/naming.json'), 'utf8'));
const TESTS = /^(core|server)\/test\//;

export const serverAssetNames = (version) => artifactNames(naming.slug, version);
export const serverAssets = (version) => Object.values(serverAssetNames(version));

/** The tracked files the server runs from. */
export function sourceFiles(root = ROOT) {
  return execFileSync('git', ['ls-files', '-z', '--', 'core', 'server', 'LICENSE'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(Boolean).filter((p) => !TESTS.test(p) && p !== 'server/stamp.json');
}

// Node's own lookup: each ancestor's node_modules, skipping folders that are themselves node_modules. In the pnpm
// store that finds a package's siblings, which are its dependencies.
function resolveDep(from, name) {
  for (let dir = from; ;) {
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name);
      if (existsSync(path.join(candidate, 'package.json'))) return realpathSync(candidate);
    }
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

/** server's production dependencies, flattened: [{ name, version, dir }]. Two versions of one name refuse. */
export function productionDeps(root = ROOT) {
  const out = new Map();
  const pkg = (dir) => JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const queue = [];
  const enqueue = (dir, from) => {
    const p = pkg(dir);
    for (const name of Object.keys(p.dependencies || {})) queue.push({ name, from, optional: false });
    for (const name of Object.keys(p.optionalDependencies || {})) queue.push({ name, from, optional: true });
  };
  enqueue(path.join(root, 'server'), path.join(root, 'server'));
  enqueue(path.join(root, 'core'), path.join(root, 'core'));
  while (queue.length) {
    const { name, from, optional } = queue.shift();
    const dir = resolveDep(from, name);
    if (!dir) {
      if (optional) continue;
      throw new Error('server dependency ' + name + ' is not installed: run pnpm install first');
    }
    const version = pkg(dir).version;
    const seen = out.get(name);
    if (seen) {
      if (seen.version !== version) throw new Error('two versions of ' + name + ' (' + seen.version + ', ' + version + ') cannot be flattened into one server');
      continue;
    }
    out.set(name, { name, version, dir });
    enqueue(dir, dir);
  }
  return [...out.values()];
}

function copyTree(from, to, { skip = () => false } = {}) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    if (skip(entry.name)) continue;
    if (entry.isDirectory()) copyTree(source, path.join(to, entry.name), { skip });
    else if (entry.isFile()) {
      mkdirSync(to, { recursive: true });
      writeFileSync(path.join(to, entry.name), readFileSync(source), { mode: statSync(source).mode & 0o777 });
    } else throw new Error('refusing to stage something other than a file: ' + source);
  }
}

/** Every file under dir, relative with forward slashes. A link or other non-file refuses. */
export function walk(dir, prefix = '') {
  const files = [];
  for (const name of readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    const rel = prefix ? prefix + '/' + name : name;
    const st = lstatSync(full);
    if (st.isDirectory()) files.push(...walk(full, rel));
    else if (st.isFile()) files.push({ path: rel, data: readFileSync(full), executable: Boolean(st.mode & 0o111) });
    else throw new Error('the staged server holds something other than a file: ' + rel);
  }
  return files;
}

/** Stage, stamp and pack. Returns the three asset names written to out and the manifest. */
export function buildServerArtifact({ out, root = ROOT, env = process.env, log = console.log } = {}) {
  const staging = mkdtempSync(path.join(os.tmpdir(), 'server-artifact-'));
  try {
    for (const rel of sourceFiles(root)) {
      const source = path.join(root, rel);
      const st = lstatSync(source);
      if (!st.isFile()) throw new Error('refusing to stage something other than a file: ' + rel);
      mkdirSync(path.dirname(path.join(staging, rel)), { recursive: true });
      writeFileSync(path.join(staging, rel), readFileSync(source), { mode: st.mode & 0o777 });
    }
    for (const dep of productionDeps(root)) copyTree(dep.dir, path.join(staging, 'server', 'node_modules', ...dep.name.split('/')), { skip: (name) => name === 'node_modules' });
    // The generator stamps the staged copy and then checks it, so the stamp in the tarball is the generator's own.
    if (!stampRun(['--root', staging], env) || !stampRun(['--check', '--root', staging], env)) throw new Error('the server stamp was not written');
    const stamp = JSON.parse(readFileSync(path.join(staging, 'server', 'stamp.json'), 'utf8'));
    if (env.BUILD_VERSION && stamp.version !== env.BUILD_VERSION) throw new Error('the stamp names ' + stamp.version + ', not BUILD_VERSION ' + env.BUILD_VERSION);
    const files = walk(staging);
    const names = serverAssetNames(stamp.version);
    const node = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).engines.node;
    const manifest = manifestOf({ name: naming.slug + '-server', version: stamp.version, commit: stamp.commit, node, files });
    const tarball = writeTarball(files, Math.floor(Date.parse(stamp.builtAt) / 1000));
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, names.tarball), tarball);
    writeFileSync(path.join(out, names.digest), digestText(tarball, names.tarball));
    writeFileSync(path.join(out, names.manifest), JSON.stringify(manifest, null, 2) + '\n');
    log(JSON.stringify({ version: stamp.version, commit: stamp.commit, files: files.length, bytes: tarball.length, assets: Object.values(names) }));
    return { names, manifest };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

/** The publisher's checks over the three assets in dir. Returns their names; throws on the first problem. */
export function verifyServerAssets(dir, version, { commit } = {}) {
  const names = serverAssetNames(version);
  for (const name of Object.values(names)) {
    const file = path.join(dir, name);
    if (!existsSync(file) || !statSync(file).size) throw new Error('Missing or empty asset: ' + name);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path.join(dir, names.manifest), 'utf8'));
  } catch {
    throw new Error('the server manifest is not JSON: ' + names.manifest);
  }
  const files = verifyArtifact({ tarball: readFileSync(path.join(dir, names.tarball)), digest: readFileSync(path.join(dir, names.digest), 'utf8'), manifest, names, version, commit });
  return { assets: Object.values(names), files, manifest };
}

const get = (url) => new Promise((resolve, reject) => {
  const req = http.get(url, { timeout: 5000 }, (res) => {
    let body = '';
    res.on('data', (d) => { body += d; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('timeout', () => req.destroy(new Error('timed out')));
  req.on('error', reject);
});

/** Unpack the verified files, boot them over the fake engine and require their health route to name this build. */
export async function smoke(dir, version) {
  const { files, manifest } = verifyServerAssets(dir, version);
  const scratch = mkdtempSync(path.join(os.tmpdir(), 'server-smoke-'));
  const app = path.join(scratch, 'app');
  const data = path.join(scratch, 'data');
  let server;
  try {
    writeFiles(files, app);
    const cli = path.join(app, 'server', 'src', 'main.js');
    execFileSync(process.execPath, [cli, 'init', '--engine', 'fake', '--port', '0', '--data', data], { stdio: 'inherit', timeout: 30000 });
    server = spawn(process.execPath, [cli, 'run', '--data', data], { stdio: ['ignore', 'pipe', 'inherit'] });
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('the unpacked server did not become ready')), 20000);
      server.on('exit', (code) => { clearTimeout(t); reject(new Error('the unpacked server exited with ' + code)); });
      server.stdout.on('data', (d) => {
        buf += d;
        for (const line of buf.split('\n')) {
          try {
            const j = JSON.parse(line);
            if (j.event === 'server.ready') { clearTimeout(t); resolve(j.port); }
          } catch { /* a partial line */ }
        }
      });
    });
    const health = await get('http://127.0.0.1:' + port + '/healthz');
    const body = JSON.parse(health.body);
    if (health.status !== 200 || body.version !== manifest.version || body.commit !== manifest.commit) throw new Error('the unpacked server answered ' + health.status + ' ' + health.body + ', not ' + manifest.version + ' at ' + manifest.commit);
    console.log('server artifact boots: ' + JSON.stringify(body));
    return body;
  } finally {
    if (server && server.exitCode === null) await new Promise((resolve) => { server.once('close', resolve); server.kill('SIGTERM'); });
    rmSync(scratch, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd, a, b, c] = process.argv.slice(2);
  if (cmd === 'build' && a) buildServerArtifact({ out: path.resolve(a) });
  else if (cmd === 'verify' && a && b) console.log(JSON.stringify(verifyServerAssets(a, b, { commit: c }).assets));
  else if (cmd === 'smoke' && a && b) await smoke(a, b);
  else {
    console.error('usage: server-artifact.mjs build OUT | verify DIR VERSION [SHA] | smoke DIR VERSION');
    process.exitCode = 2;
  }
}
