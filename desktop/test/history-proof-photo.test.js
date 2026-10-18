// The history proof presses a photo it chose and brought into view, never one the scrollback happened to leave drawn
// (issue 465). A picture is fetched only while its row is on screen, so the pictures drawn after the walk depended on
// how long each row stayed in view on the runner; on macOS a walk that ended over a video and plain rows left none, and
// the proof timed out on 'synthetic photo decoded' with nothing in its log or its packaged artifact to say why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file)).toString();
const page = read('core/test/fixtures/history-proof.js');
const smoke = read('desktop/scripts/smoke.mjs');
const photoTarget = page.slice(page.indexOf('async photoTarget()'), page.indexOf('async media()'));

test('the history proof chooses its photo from the rows and brings it into view before waiting for it to decode (issue 465)', () => {
  assert.ok(photoTarget.length > 0, 'photoTarget is in the page script');
  assert.doesNotMatch(photoTarget, /querySelectorAll\('app-attachment img'\)\]\.find/, 'the photo is never the first picture already drawn');
  const placed = photoTarget.indexOf('place();');
  const decoded = photoTarget.indexOf("'synthetic photo decoded'");
  assert.ok(placed > 0 && decoded > placed, 'the chosen row is placed in view before its picture is waited for');
  assert.match(photoTarget, /'synthetic photo decoded', \(\) => \{/, 'the decode wait says what it measured when it runs out');
  for (const field of ['key', 'inView', 'src', 'img: mediaState(target())', 'drawn']) assert.ok(photoTarget.includes(field), 'the measure names ' + field);
});

test('a failed history proof leaves its capture where the packaged leg uploads it (issue 465)', () => {
  assert.match(smoke, /copyFileSync\(capture, path\.join\(out, 'history-window-failure\.png'\)\)/, 'the failure capture is copied to the top of the smoke folder');
  assert.match(read('.github/workflows/package.yml'), /packaged-smoke\/\*\.png/, 'the packaged leg uploads the top-level captures');
});
