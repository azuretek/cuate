// The images the desktop shell shows for the app, redrawn from the active theme (issue 189): the tray's (a template
// image in the macOS menu bar, the theme's colours in the Windows notification area and the Linux panel), the window's
// icon on Windows and Linux, the taskbar overlay that carries the unread count on Windows, and the count macOS's Dock
// and Linux launchers draw themselves. No Electron in it, so one node --test run holds every platform's answer; main.js
// turns each image into a nativeImage.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseGlyph, iconPalette, iconColours, renderIcon } from '../../core/app/rules/icon.js';

// The two masters, from the one spec every platform's generator reads.
export function loadMasters(coreDir) {
  const read = (name) => parseGlyph(readFileSync(path.join(coreDir, 'spec', 'icon', name), 'utf8'));
  return { full: read('flor-de-muerto.svg'), small: read('flor-de-muerto-small.svg') };
}

// The tray's sizes per platform, each with the display scale it serves: macOS a 16 point template and its Retina
// double; Windows every size the notification area asks for at each scaling; Linux the panel's one image.
export const TRAY_SIZES = {
  darwin: [[16, 1], [32, 2]],
  win32: [[16, 1], [20, 1.25], [24, 1.5], [32, 2], [40, 2.5], [48, 3]],
  linux: [[32, 1]],
};
// The window icon Windows and Linux draw in the taskbar and the switcher, and the overlay's size.
export const WINDOW_ICON = 256;
export const OVERLAY_ICON = 32;

// Every image the shell sets for one state: the scheme the page draws, the colour tokens it resolved (any it leaves
// out or cannot be read fall back to the default tokens) and the unread count.
export function shellIcons({ platform, masters, tokens, scheme = 'light', colors = {}, unread = 0 }) {
  const s = scheme === 'dark' ? 'dark' : 'light';
  const count = Math.max(0, Math.floor(Number(unread) || 0));
  const palette = iconPalette(iconColours(tokens[s], colors), s);
  const sizes = TRAY_SIZES[platform] || TRAY_SIZES.linux;
  const template = platform === 'darwin';
  const tray = sizes.map(([size, scale]) => ({ scale, image: renderIcon({ masters, palette, kind: template ? 'template' : 'tray', size, unread: count }) }));
  const windowIcon = platform === 'darwin' ? null : renderIcon({ masters, palette, kind: 'app', size: WINDOW_ICON });
  const overlay = platform === 'win32' && count > 0 ? renderIcon({ masters, palette, kind: 'overlay', size: OVERLAY_ICON, unread: count }) : null;
  return {
    palette,
    tray: { template, reps: tray },
    window: windowIcon,
    overlay,
    description: count === 0 ? '' : count === 1 ? '1 unread message' : count + ' unread messages',
    badgeCount: count,
    // What decides every image, so the shell redraws only when one of them would change.
    key: JSON.stringify([platform, palette, Math.min(count, 10), count > 0 ? count : 0]),
  };
}

// An image as a PNG file's bytes, straight alpha, so Electron's nativeImage reads it with no byte-order guesswork.
export function encodePng({ width, height, data }) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const tagged = Buffer.concat([Buffer.from(type, 'ascii'), body]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(tagged));
    return Buffer.concat([head, tagged, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(rows, y * (width * 4 + 1) + 1);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
