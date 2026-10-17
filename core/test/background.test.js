import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Issue 417: a conversation's background is its backdrop, drawn behind the messages by the conversation itself and
// never as a picture in the timeline, and the native proof is a Debug seam only.
const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));

test('the conversation draws its background behind the messages, never in the timeline (issue 417)', () => {
  const conv = read('core/app/components/app-conversation.js');
  const body = /<div class="conv-body"[^>]*>([\s\S]*?)<div class=\$\{'messages'/.exec(conv);
  assert.ok(body, 'the conversation body opens before its message list');
  assert.match(body[0], /data-backdrop=\$\{this\.chat\?\.background/, 'the body is marked when the chat has a background');
  assert.match(body[1], /<app-backdrop class="conv-backdrop" aria-hidden="true" \.picture=\$\{this\.chat\.background\}/, 'and the backdrop is drawn in it, before the list, so the list sits above it');
  const bubble = /\n {2}bubble\([\s\S]*?\n {2}\}/.exec(conv);
  assert.ok(bubble && !/background/.test(bubble[0]), 'no message bubble draws the background');
  const css = read('core/app/styles/app.css');
  assert.match(css, /\.conv-backdrop \{ position: absolute; inset: 0; overflow: hidden; pointer-events: none; \}/, 'it fills the conversation and takes no press');
  assert.match(css, /\.conv-backdrop-picture \{[^}]*object-fit: cover;/);
  // The quiet words that sit straight on the picture take a background the tokens define, so they read over any picture.
  const words = /\.conv-body\[data-backdrop\] :is\(([^)]*)\) \{ background: var\((--[a-z-]+)\);/.exec(css);
  assert.ok(words, 'the words on the backdrop take a background');
  for (const part of ['.conv-event > span', '.separator', '.sender', '.delivery']) assert.ok(words[1].includes(part), 'and so does ' + part);
  assert.ok(read('core/app/styles/tokens.css').includes(words[2] + ':'), words[2] + ' is a token the page defines');
});

test('the background proof is a Debug seam, copied into test builds only (issue 417)', () => {
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--background-fixture[\s\S]*#endif/, 'the background fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/background-fixture\.js/, 'copied into test builds only');
  const uiTest = read('ios/' + naming.product + 'UITests/BackgroundTests.swift');
  for (const part of ['--background-fixture', 'hasPrefix("background:pass")', 'Sam Example changed the background', 'where:backdrop ']) assert.ok(uiTest.includes(part), 'the UI test reads the verdict and the screen: ' + part);
  assert.doesNotMatch(read('core/app/main.js'), /background-fixture/);
});
