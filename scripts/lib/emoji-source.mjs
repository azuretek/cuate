// Pure: parses the pinned Unicode and CLDR sources under core/spec/emoji/ and derives the picker's
// catalogue. scripts/gen-emoji.mjs writes the result into core/app/rules/emoji-data.js; nothing here is
// bundled into a shell, so the parsing cost is paid once, at generation time.
//
// The two sources, both pinned by version in the generator:
//
//   - emoji-test.txt (Unicode emoji data): every fully-qualified sequence, in the standard's own group order,
//     with its group, its subgroup and its short name.
//   - CLDR annotations, English (common/annotations and common/annotationsDerived): the searchable keywords
//     and short names, keyed by code points.
//
// Unicode data files are copyright Unicode, Inc. and used under the Unicode Terms of Use
// (https://www.unicode.org/terms_of_use.html); SPDX-License-Identifier: Unicode-3.0.

// A sequence's join key: its code points, lower case, with no variation selectors, so the Unicode data and
// the CLDR annotations (which carry none) name the same sequence. The rendered character keeps its selectors.
export function codeKey(codes) {
  return String(codes)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((h) => h.toLowerCase())
    .filter((h) => h !== 'fe0f' && h !== 'fe0e')
    .join(' ');
}

function decodeEntities(text) {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

// The label a tab shows: the group's own name, shortened at its first ' & ' so the strip stays one line
// ('Smileys & Emotion' -> 'Smileys'). The id is that label, slugged. Nothing here is a hand-kept list.
function shortLabel(group) {
  const i = group.indexOf(' & ');
  return i > 0 ? group.slice(0, i) : group;
}

function slug(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

// Every fully-qualified sequence from emoji-test.txt, in file order, with the ordered groups it defines. A
// component (a skin tone or a hair style on its own) is not fully qualified and so is not offered.
export function parseEmojiTest(text) {
  const groups = [];
  const byGroup = new Map();
  const entries = [];
  let group = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (line.startsWith('# group:')) { group = line.slice(8).trim(); continue; }
    if (line.startsWith('# subgroup:') || line.startsWith('#')) continue;
    if (!line.includes(';')) continue;
    const hash = line.indexOf('#');
    const [codes, status] = line.slice(0, hash).split(';').map((s) => s.trim());
    if (status !== 'fully-qualified') continue;
    const named = line.slice(hash + 1).trim().match(/^\S+\s+E\d+(?:\.\d+)?\s+(.*)$/);
    if (!named) continue;
    if (!byGroup.has(group)) {
      byGroup.set(group, slug(shortLabel(group)));
      groups.push({ id: byGroup.get(group), label: shortLabel(group), group });
    }
    entries.push({
      char: codes.split(/\s+/).map((h) => String.fromCodePoint(parseInt(h, 16))).join(''),
      key: codeKey(codes),
      name: named[1].trim(),
      category: byGroup.get(group),
    });
  }
  return { groups, entries };
}

// The CLDR annotations: each sequence's short name (type="tts") and its keywords.
export function parseAnnotations(xml) {
  const out = new Map();
  const re = /<annotation\s+cp="([^"]*)"(?:\s+type="([^"]*)")?\s*>([\s\S]*?)<\/annotation>/g;
  let m;
  while ((m = re.exec(String(xml))) !== null) {
    const key = codeKey([...decodeEntities(m[1])].map((c) => c.codePointAt(0).toString(16)).join(' '));
    if (!key) continue;
    const value = decodeEntities(m[3]).trim();
    const rec = out.get(key) || { tts: '', keywords: [] };
    if (m[2] === 'tts') {
      if (!rec.tts && value) rec.tts = value;
    } else {
      for (const part of value.split('|')) {
        const word = part.trim();
        if (word && !rec.keywords.includes(word)) rec.keywords.push(word);
      }
    }
    out.set(key, rec);
  }
  return out;
}

// The catalogue: every sequence in the standard's order, each with the name and keywords a search reads. A
// name falls back to the Unicode short name, so a sequence CLDR has not annotated yet is still searchable.
export function deriveEmojiData({ emojiTest, annotations, derivedAnnotations }) {
  const { groups, entries } = parseEmojiTest(emojiTest);
  const primary = parseAnnotations(annotations);
  const derived = parseAnnotations(derivedAnnotations);
  const catalog = entries.map((e) => {
    const p = primary.get(e.key) || { tts: '', keywords: [] };
    const d = derived.get(e.key) || { tts: '', keywords: [] };
    const name = p.tts || d.tts || e.name;
    const lower = name.toLowerCase();
    const seen = new Set();
    const keywords = [];
    for (const word of [...p.keywords, ...d.keywords]) {
      const key = word.toLowerCase();
      // A word the name already carries adds nothing to a substring search; drop it so the file stays small.
      if (seen.has(key) || lower.includes(key)) continue;
      seen.add(key);
      keywords.push(word);
    }
    return { char: e.char, name, keywords: keywords.join(' '), category: e.category };
  });
  return { groups, entries: catalog };
}

// The generated module: the data, its provenance and the licence, and no clock, so --check is exact.
export function renderEmojiData({ groups, entries, meta }) {
  const lines = [
    '// Generated by scripts/gen-emoji.mjs from the pinned sources in core/spec/emoji/. Do not edit by hand:',
    '// run `pnpm run emoji` to regenerate, and `pnpm run build` fails while this file is stale.',
    '//',
    '//   Unicode emoji data: ' + meta.emojiVersion + ' - ' + meta.emojiSource,
    '//   CLDR annotations:   ' + meta.cldrVersion + ' - ' + meta.cldrSource,
    '//',
    '// Both are copyright Unicode, Inc. and used under the Unicode Terms of Use',
    '// (https://www.unicode.org/terms_of_use.html); SPDX-License-Identifier: Unicode-3.0.',
    '',
  ];
  return lines.join('\n')
    + 'export const EMOJI_CATEGORIES = ' + JSON.stringify(groups) + ';\n\n'
    + 'export const EMOJI = ' + JSON.stringify(entries) + ';\n';
}
