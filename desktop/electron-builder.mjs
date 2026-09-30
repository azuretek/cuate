import { readFileSync } from 'node:fs';
const naming = JSON.parse(readFileSync(new URL('../core/spec/naming.json', import.meta.url)));
const [owner, repo] = naming.repo.split('/');
export default {
  appId: naming.ids.desktop,
  productName: naming.product,
  directories: { app: '.', output: 'dist', buildResources: 'build' },
  asar: true,
  files: ['src/**', 'package.json', 'build/icon.png'],
  extraResources: [{ from: '../core', to: 'core', filter: ['app/**', 'kit/**', 'spec/**'] }],
  extraMetadata: { version: process.env.BUILD_VERSION || JSON.parse(readFileSync(new URL('./package.json', import.meta.url))).version },
  artifactName: naming.slug + '-desktop-${version}-${arch}.${ext}',
  publish: { provider: 'github', owner, repo, channel: 'dev', releaseType: 'draft' },
  generateUpdatesFilesForAllChannels: false,
  mac: { target: ['dmg', 'zip'], icon: 'build/icon.png', category: 'public.app-category.social-networking', hardenedRuntime: true, notarize: Boolean(process.env.APPLE_API_KEY) },
  dmg: { sign: true },
  win: { target: 'nsis', icon: 'build/icon.ico', signAndEditExecutable: true },
  nsis: { oneClick: true, perMachine: false, allowElevation: false, createDesktopShortcut: true, createStartMenuShortcut: true, shortcutName: naming.product },
  linux: { target: 'AppImage', icon: 'build/icon.png', category: 'Network', executableName: naming.slug },
};
