import sharp from 'sharp';
import pngToIco from 'png-to-ico';
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
export async function icons(check = false) {
  const input = new URL('../build/icon.svg', import.meta.url);
  const png = await sharp(fileURLToPath(input)).resize(1024, 1024).png().toBuffer();
  const save = (name, bytes) => { const target = new URL('../build/' + name, import.meta.url); if (check) { if (!readFileSync(target).equals(bytes)) throw new Error('Stale generated icon: ' + name); } else writeFileSync(target, bytes); };
  save('icon.png', png);
  const sizes = await Promise.all([16, 32, 48, 256].map((size) => sharp(png).resize(size, size).png().toBuffer()));
  save('icon.ico', await pngToIco(sizes));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await icons(process.argv.includes('--check'));
