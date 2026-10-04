// Derives core/app/rules/emoji-data.js from the pinned sources in core/spec/emoji/; --check fails when the
// committed file is stale, the way every other generator in scripts/ does, so a hand edit (or a source
// refresh that was not regenerated) fails the build and CI.
//
// ★ A refresh is the two version constants below. Bump them, re-download the three files named in
// core/spec/emoji/README.md, and regenerate: the diff is the version constants, the sources and the data
// they derive, and nothing is typed by hand.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { deriveEmojiData, renderEmojiData } from './lib/emoji-source.mjs';

export const EMOJI_VERSION = '18.0';
export const CLDR_VERSION = 'release-48';
export const EMOJI_SOURCE = 'https://unicode.org/Public/18.0.0/emoji/emoji-test.txt';
export const CLDR_SOURCE = 'https://github.com/unicode-org/cldr/blob/' + CLDR_VERSION + '/common/annotations/en.xml';
const CLDR_DERIVED_SOURCE = 'https://github.com/unicode-org/cldr/blob/' + CLDR_VERSION + '/common/annotationsDerived/en.xml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = path.join(ROOT, 'core/app/rules/emoji-data.js');
const SPEC = (name) => path.join(ROOT, 'core/spec/emoji/' + name);

// The text the committed file must hold, and the data behind it. Exported so a test holds the same freshness
// the build's --check holds, rather than trusting the command ran.
export function emojiDataText() {
  const emojiTest = readFileSync(SPEC('emoji-test.txt'), 'utf8');
  // The vendored file carries its own version; a mismatch means it was swapped without bumping the pin.
  if (!emojiTest.includes('# Version: ' + EMOJI_VERSION)) {
    throw new Error('core/spec/emoji/emoji-test.txt is not Emoji ' + EMOJI_VERSION + ': bump the pin and re-download the source');
  }
  const data = deriveEmojiData({
    emojiTest,
    annotations: readFileSync(SPEC('cldr-annotations-en.xml'), 'utf8'),
    derivedAnnotations: readFileSync(SPEC('cldr-annotations-derived-en.xml'), 'utf8'),
  });
  const text = renderEmojiData({
    ...data,
    meta: {
      emojiVersion: 'Emoji ' + EMOJI_VERSION,
      cldrVersion: 'CLDR ' + CLDR_VERSION,
      emojiSource: EMOJI_SOURCE,
      cldrSource: CLDR_SOURCE + ' and ' + CLDR_DERIVED_SOURCE,
    },
  });
  return { text, groups: data.groups, entries: data.entries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { text, groups, entries } = emojiDataText();
  if (process.argv.includes('--check')) {
    if (readFileSync(OUT, 'utf8') !== text) {
      console.error('core/app/rules/emoji-data.js is stale: run pnpm run emoji');
      process.exit(1);
    }
    console.log('emoji-data.js is fresh');
  } else {
    writeFileSync(OUT, text);
    console.log('wrote core/app/rules/emoji-data.js (' + entries.length + ' emoji in ' + groups.length + ' groups)');
  }
}
