import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function icons(check = false) {
  const input = new URL('../build/icon.svg', import.meta.url);
  const png = await sharp(fileURLToPath(input)).resize(1024, 1024).png().toBuffer();
  const save = (name, bytes) => { const target = new URL('../build/' + name, import.meta.url); if (check) { if (!readFileSync(target).equals(bytes)) throw new Error('Stale generated icon: ' + name); } else { mkdirSync(new URL('.', target), { recursive: true }); writeFileSync(target, bytes); } };
  save('icon.png', png);
  const sizes = await Promise.all([16, 32, 48, 256].map((size) => sharp(png).resize(size, size).png().toBuffer()));
  save('icon.ico', await pngToIco(sizes));
  // The tray's icons (src/tray.js trayIcon). macOS draws a template image: a black silhouette with its face cut out,
  // which the menu bar redraws light or dark to suit itself, at 16 points and twice that for Retina. Windows and Linux
  // show the app's own colours: an ICO with every size the notification area asks for at each display scaling, and a
  // PNG for the panel. They live under src/ so the packaged app carries them.
  const template = fileURLToPath(new URL('../build/tray-template.svg', import.meta.url));
  const tray = (name, bytes) => save('../src/assets/tray/' + name, bytes);
  tray('trayTemplate.png', await sharp(template).resize(16, 16).png().toBuffer());
  tray('trayTemplate@2x.png', await sharp(template).resize(32, 32).png().toBuffer());
  tray('tray.png', await sharp(png).resize(32, 32).png().toBuffer());
  const traySizes = await Promise.all([16, 20, 24, 32, 40, 48].map((size) => sharp(png).resize(size, size).png().toBuffer()));
  tray('tray.ico', await pngToIco(traySizes));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await icons(process.argv.includes('--check'));
