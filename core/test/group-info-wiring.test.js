import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 393 (and 326): the conversation header's Group details button fires groupinfo on app-conversation, and
// emit() does not bubble, so the page must listen on the conversation itself. Since #328 the listener sat on
// app-about, which never fires it, and the button opened nothing; the desktop smoke's contacts check found it.
const root = readFileSync(new URL('../app/components/app-root.js', import.meta.url), 'utf8');
const element = (name) => {
  const start = root.indexOf('<' + name + ' ');
  assert.ok(start >= 0, name + ' is drawn by the page');
  return root.slice(start, root.indexOf('</' + name + '>', start));
};

test('Group details is heard on the conversation that fires it, not on the About page (issue 393)', () => {
  assert.match(element('app-conversation'), /@groupinfo=\$\{\(\) => this\.openGroupInfo\(\)\}/);
  assert.doesNotMatch(element('app-about'), /@groupinfo=/);
  const conv = readFileSync(new URL('../app/components/app-conversation.js', import.meta.url), 'utf8');
  assert.match(conv, /this\.fire\('groupinfo'\)/, 'the header button fires groupinfo');
});
