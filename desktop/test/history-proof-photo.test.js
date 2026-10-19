// The history proof presses a photo whose row it brought into view, never one the scrollback happened to leave drawn
// (issue 465). A picture is fetched only once its row is on screen or within a screen of it (issue 425), so the
// pictures drawn after the walk depended on how long each row stayed in view on the runner; on macOS a walk that left
// none timed out on 'synthetic photo decoded', with nothing in its log or its packaged artifact to say why.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file) => readFileSync(path.join(root, file)).toString();
const page = read('core/test/fixtures/history-proof.js');
const photoTarget = page.slice(page.indexOf('async photoTarget()'), page.indexOf('async media()'));

test('the history proof chooses its photo from the rows and brings it into view before waiting for it to decode (issue 465)', () => {
  assert.ok(photoTarget.length > 0, 'photoTarget is in the page script');
  assert.doesNotMatch(photoTarget, /querySelectorAll\('app-attachment img'\)\]\.find/, 'the photo is never the first picture already drawn');
  const placed = photoTarget.indexOf('place();');
  const decoded = photoTarget.indexOf("'synthetic photo decoded'");
  assert.ok(placed > 0 && decoded > placed, 'the chosen row is placed in view before its picture is waited for');
  assert.match(photoTarget, /'synthetic photo decoded', \(\) => \(\{ key, /, 'the decode wait names the row it measured when it runs out');
  assert.ok(photoTarget.includes('mediaState(target())'), 'and the state of that row\'s picture');
});

test('the packaged leg uploads the history proof\'s own folder, its failure capture and report included (issue 465)', () => {
  const smoke = read('desktop/scripts/smoke.mjs');
  assert.match(smoke, /HISTORY_PROOF_OUT: path\.join\(out, 'history-window'\)/, 'the proof writes beside the smoke captures');
  assert.match(read('desktop/scripts/prove-history-window.mjs'), /'failure\.png'/, 'a failed proof captures its window');
  assert.match(read('.github/workflows/package.yml'), /packaged-smoke\/history-window\//, 'the packaged leg uploads that folder');
});
