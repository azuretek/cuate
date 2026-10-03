// A theme's type, fetched once on the server so it draws on every client. A tweakcn theme names its fonts (Poppins,
// IBM Plex Mono) and its own page loads them from Google Fonts; the app's pages load nothing from the network (their
// Content-Security-Policy allows fonts from the app alone), so a theme that only named its font would draw in
// whatever the device happens to have. The server fetches the font files when the theme is imported, keeps them under
// the data folder named by their digest, and the theme carries { family, weight, style, id } for each; a client
// reads the bytes through the API (GET /api/v1/themes/fonts/:fontId) and adds them with the FontFace API.
//
// Only Google Fonts is asked, only its latin subset is kept, every file must come from fonts.gstatic.com as woff2,
// and every answer is bounded in time and size. A family Google does not have, or a network that is down, leaves
// the theme without that font, said in the import's answer; it never refuses the theme.
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mkdir, writeFile, stat } from 'node:fs/promises';

export const FONT_CSS = 'https://fonts.googleapis.com/css2';
export const FONT_FETCH_MS = 10000;
export const FONT_CSS_MAX = 65536;
export const FONT_FILE_MAX = 1048576;
export const FONT_FILES_MAX = 8;
// Google answers woff2 only to a browser it recognises; this is the Chromium the desktop shell ships.
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
// The weights the app draws (regular, medium, bold), widest first; a family that lacks one is asked again for fewer.
const WEIGHTS = ['400;500;600;700', '400;700', ''];
const GENERIC = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'ui-sans-serif', 'ui-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong', '-apple-system', 'blinkmacsystemfont', 'inherit', 'initial']);

export const FONT_ID = /^[a-f0-9]{64}$/;
export const FAMILY = /^[A-Za-z0-9][A-Za-z0-9 ]{0,59}$/;

// The family a font stack leads with, when it is one a font service could have: '"IBM Plex Mono", monospace' is
// IBM Plex Mono, and 'system-ui, sans-serif' is nothing to fetch.
export function leadFamily(stack) {
  const first = String(stack ?? '').split(',')[0].trim().replace(/^["']|["']$/g, '').trim();
  if (!first || GENERIC.has(first.toLowerCase()) || !FAMILY.test(first)) return null;
  return first;
}

// The faces a Google Fonts stylesheet declares for the latin subset: { weight, style, url }. A stylesheet with no
// subset comments (a family with one subset) is read whole.
export function fontFaces(css) {
  const text = String(css);
  const blocks = [...text.matchAll(/(?:\/\*\s*([a-z0-9-]+)\s*\*\/\s*)?@font-face\s*\{([^}]*)\}/g)];
  const subsetted = blocks.some((m) => m[1]);
  const out = [];
  for (const m of blocks) {
    if (subsetted && m[1] !== 'latin') continue;
    const body = m[2];
    const url = (body.match(/src:\s*url\(([^)]+)\)\s*format\(['"]?woff2['"]?\)/) || [])[1];
    const weight = (body.match(/font-weight:\s*(\d{3})\s*;/) || [])[1];
    const style = (body.match(/font-style:\s*(normal|italic)\s*;/) || [])[1] || 'normal';
    if (!url || !weight || !/^https:\/\/fonts\.gstatic\.com\/[A-Za-z0-9/_.-]+\.woff2$/.test(url)) continue;
    if (out.some((f) => f.weight === weight && f.style === style)) continue;
    out.push({ weight, style, url });
  }
  return out.slice(0, FONT_FILES_MAX);
}

async function bounded(res, max) {
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > max) throw new Error('too large');
  return buf;
}

export function createThemeFonts({ dataDir, fetchImpl = globalThis.fetch, cssBase = FONT_CSS, timeoutMs = FONT_FETCH_MS }) {
  const root = path.join(dataDir, 'theme-fonts');
  const get = (url, accept) => fetchImpl(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs), headers: { accept, 'user-agent': BROWSER } });

  // The faces of one family, written to disk, or [] when the service has no such family or cannot be reached.
  async function family(name) {
    let faces = [];
    for (const w of WEIGHTS) {
      const url = cssBase + '?family=' + encodeURIComponent(name).replace(/%20/g, '+') + (w ? ':wght@' + w : '') + '&display=swap';
      try {
        const res = await get(url, 'text/css,*/*;q=0.1');
        if (!res.ok) { await res.body?.cancel().catch(() => {}); continue; }
        faces = fontFaces((await bounded(res, FONT_CSS_MAX)).toString('utf8'));
      } catch {
        return [];
      }
      if (faces.length) break;
    }
    const kept = await Promise.all(faces.map(async (f) => {
      try {
        const res = await get(f.url, 'font/woff2');
        if (!res.ok) return null;
        const bytes = await bounded(res, FONT_FILE_MAX);
        const id = createHash('sha256').update(bytes).digest('hex');
        await mkdir(root, { recursive: true });
        await writeFile(path.join(root, id + '.woff2'), bytes);
        return { family: name, weight: f.weight, style: f.style, id };
      } catch {
        return null;
      }
    }));
    return kept.filter(Boolean);
  }

  return {
    root,
    // Every font the theme's type names (font.family, font.mono), fetched; and the families that could not be.
    async forTheme(theme) {
      const names = [...new Set([theme.font?.family, theme.font?.mono].map(leadFamily).filter(Boolean))];
      const fonts = [];
      const missing = [];
      for (const name of names) {
        const got = await family(name);
        if (got.length) fonts.push(...got);
        else missing.push(name);
      }
      return { fonts, missing };
    },
    // The file for a font id, or null when the server holds none by that id.
    async file(id) {
      if (!FONT_ID.test(String(id))) return null;
      const file = path.join(root, id + '.woff2');
      const st = await stat(file).catch(() => null);
      return st && st.isFile() ? { file, size: st.size } : null;
    },
  };
}
