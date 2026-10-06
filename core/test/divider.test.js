// The divider between the chats list and the conversation (issue 215). The geometry is pure (rules/divider.js), so the
// width it may take, the two minimums it can never be dragged below, the width a reopen keeps and the keys that reset
// it are asserted without a browser; the stylesheet and the component are held to the same rule here, and the desktop
// smoke holds the drag, the anchors and the reopen against the running app (smoke:dividerResize).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CHATS_MIN, CHATS_DEFAULT, CONVERSATION_MIN, KEY_STEP,
  dividerBounds, clampChatsWidth, chatsWidthFrom, resizeChatsWidth, dividerKey, dragChatsWidth,
} from '../app/rules/divider.js';

const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
const spec = () => JSON.parse(read('../spec/tokens.json'));
// Comments carry prose that could name a rule, so the rules are read with them stripped.
const css = () => read('../app/styles/app.css').replace(/\/\*[\s\S]*?\*\//g, '');
const rule = (src, selector) => {
  const m = new RegExp('(?:^|[},\n])\\s*' + selector.replace(/[.*+?^\u0024{}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(src);
  assert.ok(m, 'the rule ' + selector + ' exists');
  return m[1];
};

test('the divider resets to the sidebar width token, so one value owns the default (issue 215)', () => {
  assert.equal(CHATS_DEFAULT + 'px', spec().size.sidebar, 'the default width is the sidebar token');
  assert.ok(CHATS_MIN < CHATS_DEFAULT, 'the chats minimum is below the default');
  assert.ok(CONVERSATION_MIN > 0 && KEY_STEP > 0, 'the conversation minimum and the key step are positive');
});

test('each pane keeps a minimum the divider can never be dragged below (issue 215)', () => {
  const viewport = 1100;
  assert.deepEqual(dividerBounds(viewport), { min: CHATS_MIN, max: viewport - CONVERSATION_MIN });
  assert.equal(clampChatsWidth(1, viewport), CHATS_MIN, 'a drag past the left edge stops at the chats minimum');
  assert.equal(clampChatsWidth(5000, viewport), viewport - CONVERSATION_MIN, 'a drag past the right edge stops where the conversation keeps its minimum');
  assert.equal(clampChatsWidth(480, viewport), 480, 'a width inside the bounds is kept');
  assert.equal(clampChatsWidth('480', viewport), 480, 'a stored width read as text is a number');
  assert.equal(clampChatsWidth('', viewport), CHATS_MIN, 'an unreadable width falls to the chats minimum');
});

test('a window narrower than both minimums still holds the chats minimum, never a negative pane (issue 215)', () => {
  const tight = CHATS_MIN + CONVERSATION_MIN;
  assert.deepEqual(dividerBounds(tight), { min: CHATS_MIN, max: CHATS_MIN });
  assert.equal(clampChatsWidth(9999, tight), CHATS_MIN, 'no width can take the conversation below its minimum');
  const smaller = tight - 120;
  assert.equal(dividerBounds(smaller).max, CHATS_MIN, 'the floor is the chats minimum, never below it');
  assert.equal(clampChatsWidth(0, smaller), CHATS_MIN);
});

test('a stored width is read back and clamped to the window it reopens in (issue 215)', () => {
  assert.equal(chatsWidthFrom(null, 1100), null, 'no stored width is no choice, so the token default stands');
  assert.equal(chatsWidthFrom(undefined, 1100), null);
  assert.equal(chatsWidthFrom(480, 1100), 480);
  assert.equal(chatsWidthFrom('480', 1100), 480);
  assert.equal(chatsWidthFrom(9999, 1100), 1100 - CONVERSATION_MIN);
  assert.equal(chatsWidthFrom(1, 1100), CHATS_MIN);
});

test('a key steps the width, and an explicit key resets it to the default (issue 215)', () => {
  assert.equal(resizeChatsWidth(480, KEY_STEP, 1100), 480 + KEY_STEP);
  assert.deepEqual(dividerKey('ArrowRight', 480, 1100), { width: 480 + KEY_STEP, reset: false });
  assert.deepEqual(dividerKey('ArrowLeft', 480, 1100), { width: 480 - KEY_STEP, reset: false });
  assert.deepEqual(dividerKey('Home', 480, 1100), { width: CHATS_DEFAULT, reset: true });
  assert.deepEqual(dividerKey('Enter', 480, 1100), { width: CHATS_DEFAULT, reset: true });
  assert.equal(dividerKey('ArrowRight', 1, 1100).width, CHATS_MIN, 'a key never steps past a minimum');
  assert.equal(dividerKey('ArrowLeft', 5000, 1100).width, 1100 - CONVERSATION_MIN, 'nor past the other');
  assert.equal(dividerKey('PageDown', 480, 1100), null, 'any other key is left to the page');
});

test('the shell column and the seam both follow the chosen width over the token default (issue 215)', () => {
  const src = css();
  assert.match(rule(src, '.shell'), /grid-template-columns:\s*var\(--chats-width,\s*var\(--size-sidebar\)\)/, 'the chats column is the chosen width or the token');
  const divider = rule(src, '.conv-divider');
  assert.match(divider, /left:\s*calc\(var\(--chats-width,\s*var\(--size-sidebar\)\)\s*-\s*var\(--size-grip-hit\)\s*\/\s*2\)/, 'the seam follows the chosen width');
  assert.match(divider, /cursor:\s*col-resize/, 'the divider carries the resize cursor');
  assert.match(divider, /touch-action:\s*none/, 'the divider takes the pointer, so a drag resizes rather than scrolls');
});

test('the divider is a focusable separator that resizes by pointer, key and double click (issue 215)', () => {
  const src = read('../app/components/app-root.js');
  const tag = /<div class="conv-divider"[^\n]*><\/div>/.exec(src);
  assert.ok(tag, 'app-root draws the divider');
  const t = tag[0];
  assert.match(t, /role="separator"/, 'the divider is a separator');
  assert.match(t, /aria-orientation="vertical"/, 'the separator is vertical');
  assert.match(t, /aria-label="Resize the conversation list"/, 'the separator is labelled');
  assert.match(t, /tabindex="0"/, 'the separator can take focus');
  assert.match(t, /@pointerdown=/, 'the divider resizes by pointer');
  assert.match(t, /@keydown=/, 'the divider resizes by keyboard');
  assert.match(t, /@dblclick=/, 'a double click resets the divider');
});

test('the seam tracks the pointer one to one through a drag, and never compounds (issue 288)', () => {
  const viewport = 1100;
  const base = 480;
  const startX = 500;
  // Every step reads the pointer's own travel from where it went down, so the same pointer answers the same width
  // whether it arrived in one move or many. A drag that added each step to the width it drew last would overshoot.
  assert.equal(dragChatsWidth({ baseWidth: base, startX, x: startX, viewport }), base, 'no travel is no move');
  assert.equal(dragChatsWidth({ baseWidth: base, startX, x: startX + 30, viewport }), base + 30);
  const steps = [30, 60, 90, 120].map((t) => dragChatsWidth({ baseWidth: base, startX, x: startX + t, viewport }));
  assert.deepEqual(steps, [base + 30, base + 60, base + 90, base + 120], 'a step never carries the last into the next');
  // The bounds clamp only what is drawn; the base and the origin stay fixed, so a drag past a minimum and back resumes
  // one to one rather than being left short.
  assert.equal(dragChatsWidth({ baseWidth: base, startX, x: startX + 5000, viewport }), viewport - CONVERSATION_MIN);
  assert.equal(dragChatsWidth({ baseWidth: base, startX, x: startX + 40, viewport }), base + 40, 'dragging back resumes from the origin, not from the clamped width');
  assert.equal(dragChatsWidth({ baseWidth: base, startX, x: startX - 5000, viewport }), CHATS_MIN);
  assert.equal(dragChatsWidth({ baseWidth: base, startX, x: startX - 20, viewport }), base - 20, 'and it resumes from the left minimum too');
});

test('the drag never feeds the width it drew back into the next step (issue 288)', () => {
  const src = read('../app/components/app-root.js');
  const move = /onDividerMove\(e\)\s*\{([\s\S]*?)\n {2}\}/.exec(src);
  assert.ok(move, 'the divider has a move handler');
  assert.match(move[1], /dragChatsWidth\(/, 'the move reads the width from the pointer origin');
  assert.equal(/this\.chatDrag\.width\s*=/.test(move[1]), false, 'the move never feeds its own drawn width into the next step');
});

test('the divider drag takes the pointer and stops the seam animating while it moves (issue 288)', () => {
  const src = read('../app/components/app-root.js');
  assert.match(src, /setPointerCapture\(e\.pointerId\)/, 'the drag takes the pointer for its whole length');
  assert.match(rule(css(), '.shell[data-drag="divider"]'), /transition:\s*none/, 'nothing animates the seam while the pointer is down');
});

test('the chosen width is held by the server and read back when the app opens (issue 215)', () => {
  const src = read('../app/components/app-root.js');
  assert.match(src, /from '\.\.\/rules\/divider\.js'/, 'the page uses the one divider rule');
  assert.match(src, /'chats\.width'/, 'the width is held under one settings key');
  assert.match(src, /setSettings\(\{ 'chats\.width'/, 'a change writes the width to the server');
});
