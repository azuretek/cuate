import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const naming = JSON.parse(readFileSync(new URL('../core/spec/naming.json', import.meta.url)));
const versionFile = JSON.parse(readFileSync(new URL('../core/spec/version.json', import.meta.url)));
const [owner, repo] = naming.repo.split('/');
// The commit and the build date the packaged app reports on its About page. A build supplies them through the
// environment; otherwise they are read from the checkout the packaging step runs in.
const git = (args) => {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null; } catch { return null; }
};
const buildCommit = process.env.BUILD_COMMIT || git(['rev-parse', 'HEAD']);
const buildTime = process.env.BUILD_TIME || new Date().toISOString();
export default {
  appId: naming.ids.desktop,
  productName: naming.product,
  directories: { app: '.', output: 'dist', buildResources: 'build' },
  asar: true,
  files: ['src/**', 'package.json', 'build/icon.png'],
  extraResources: [{ from: '../core', to: 'core', filter: ['app/**', 'kit/**', 'spec/**'] }],
  // Flat keys: a nested object under extraMetadata lands as the deprecated --em.build switch and electron-builder refuses it.
  extraMetadata: { version: process.env.BUILD_VERSION || versionFile.version, buildCommit, buildTime },
  artifactName: naming.slug + '-desktop-${version}-${arch}.${ext}',
  publish: { provider: 'github', owner, repo, channel: 'dev', releaseType: 'draft' },
  generateUpdatesFilesForAllChannels: false,
  mac: { target: ['dmg', 'zip'], icon: 'build/icon.png', category: 'public.app-category.social-networking', hardenedRuntime: true, notarize: Boolean(process.env.APPLE_API_KEY) },
  dmg: { sign: true },
  win: { target: 'nsis', icon: 'build/icon.ico', signAndEditExecutable: true },
  nsis: { oneClick: true, perMachine: false, allowElevation: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: naming.product },
  linux: { target: 'AppImage', icon: 'build/icon.png', category: 'Network', executableName: naming.slug },
};
