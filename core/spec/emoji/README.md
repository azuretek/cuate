# Emoji sources (vendored)

These three files are the pinned, authoritative sources the emoji catalogue is derived from. They are NOT
edited by hand: scripts/gen-emoji.mjs reads them and writes core/app/rules/emoji-data.js. `pnpm run build`
fails while that file is stale.

| file | source | version |
|---|---|---|
| `emoji-test.txt` | https://unicode.org/Public/18.0.0/emoji/emoji-test.txt | Unicode Emoji 18.0 |
| `cldr-annotations-en.xml` | https://github.com/unicode-org/cldr/blob/release-48/common/annotations/en.xml | CLDR release-48 |
| `cldr-annotations-derived-en.xml` | https://github.com/unicode-org/cldr/blob/release-48/common/annotationsDerived/en.xml | CLDR release-48 |

## Refreshing

1. Bump `EMOJI_VERSION` and `CLDR_VERSION` in scripts/gen-emoji.mjs and update the URLs above.
2. Re-download the three files here (the `emoji-test.txt` header carries its own `# Version:`, and the
   generator refuses a mismatch).
3. Run `pnpm run emoji` and commit the regenerated `core/app/rules/emoji-data.js`.

## Licence

Unicode data files are copyright © Unicode, Inc., used under the Unicode Terms of Use
(https://www.unicode.org/terms_of_use.html); SPDX-License-Identifier: Unicode-3.0. CLDR data files are
likewise © Unicode, Inc., under the same licence.
