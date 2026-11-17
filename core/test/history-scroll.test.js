// History loads ahead of the reader both ways (issue 535): the conversation asks for the next page in either
// direction while the reader is still about a page from that edge of the window, one page at most on its way in each
// direction, and its own placing of the view asks for nothing. Every platform runs the same walk to prove it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const defined = {};
globalThis.HTMLElement = class { addEventListener() {} removeAttribute() {} setAttribute() {} hasAttribute() { return false; } getAttribute() { return null; } dispatchEvent() {} };
globalThis.customElements = { define(name, cls) { defined[name] = cls; }, get() { return undefined; } };
globalThis.document = { createTreeWalker() { return {}; }, createComment() { return {}; }, importNode() { return {}; }, createElement() { return { content: {} }; } };
await import('../app/components/app-root.js');
const conversation = defined['app-conversation'].prototype;
const root = defined['app-root'].prototype;

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const turn = () => new Promise((resolve) => setImmediate(resolve));

function pane({ rowsAbove, rowsBelow, visibleRows = 12, hasOlder = true, hasNewer = true }) {
  const el = { isConnected: true, scrollTop: 100 };
  const answers = {};
  const host = {
    historyWindow: { hasOlder, hasNewer }, hasMore: hasOlder, messages: [{ id: 'm100' }, { id: 'm249' }],
    keep: { written: 100, recorded: 0, record() { this.recorded += 1; } },
    reachNow: { rowsAbove, rowsBelow, visibleRows },
    historyReach() { return this.reachNow; },
    historyMeasurements: () => ({ heights: [], estimate: 40 }),
    updateComplete: Promise.resolve(),
    asked: [],
    fire(direction) { this.asked.push(direction); return new Promise((resolve) => { answers[direction] = resolve; }); },
    querySelector: () => el,
    nearTop: conversation.nearTop, prefetchHistory: conversation.prefetchHistory, askHistory: conversation.askHistory,
  };
  return { host, el, answers };
}

test('the page the reader is nearing is asked for once, about a page ahead, and the view\'s own placing asks nothing', async () => {
  const { host, el, answers } = pane({ rowsAbove: 30, rowsBelow: 108 });
  // The keep putting the view back (its own write) is not the reader: nothing is asked.
  host.nearTop({ currentTarget: el });
  assert.deepEqual(host.asked, []);
  // The reader scrolls: thirty loaded messages above is inside the lead, so the older page is asked for now, long before
  // the top is reached, and what the page saw is reported.
  el.scrollTop = 60;
  host.nearTop({ currentTarget: el });
  assert.deepEqual(host.asked, ['older']);
  assert.equal(host.keep.recorded, 1, 'the scroll is heard first, so the reach counts from where the reader is now');
  assert.deepEqual(host.lastAsk, { direction: 'older', ahead: 30, lead: host.reach.lead });
  assert.ok(host.reach.lead > 30 && host.reach.lead <= 50);
  // More scrolling while it is on its way asks for no second older page.
  el.scrollTop = 40;
  host.reachNow = { rowsAbove: 20, rowsBelow: 118, visibleRows: 12 };
  host.nearTop({ currentTarget: el });
  assert.deepEqual(host.asked, ['older']);
  assert.equal(host.olderPending, true);
  // The page lands and the reader is still short: the next one is asked for at once, without waiting for a scroll.
  host.messages = [{ id: 'm50' }, { id: 'm199' }];
  host.reachNow = { rowsAbove: 10, rowsBelow: 78, visibleRows: 12 };
  answers.older(true);
  await turn();
  assert.deepEqual(host.asked, ['older', 'older']);
  // That one lands with a page's lead restored: nothing more is asked, and nothing is on its way.
  host.messages = [{ id: 'm0' }, { id: 'm149' }];
  host.reachNow = { rowsAbove: 60, rowsBelow: 78, visibleRows: 12 };
  answers.older(true);
  await turn();
  assert.deepEqual(host.asked, ['older', 'older']);
  assert.equal(host.olderPending, false);
});

test('scrolling back down asks for the evicted newer pages the same way, beside an older page already on its way', async () => {
  const { host, el, answers } = pane({ rowsAbove: 5, rowsBelow: 8 });
  el.scrollTop = 60;
  host.nearTop({ currentTarget: el });
  assert.deepEqual(host.asked, ['older', 'newer'], 'the nearer edge first, then the other, each once');
  host.nearTop({ currentTarget: el });
  assert.deepEqual(host.asked, ['older', 'newer']);
  // An answer that did not move the window (another writer moved it) asks nothing more from it.
  answers.newer(false);
  await turn();
  assert.deepEqual(host.asked, ['older', 'newer']);
});

test('the page holds one page on its way in each direction: an older and a newer together, never two of either', async () => {
  const message = (n) => ({ id: 'SYNTHETIC-' + n, chatId: '1', text: 'Synthetic ' + n, sentAt: '2026-01-01T00:00:00.000Z', fromMe: false, attachments: [], historyCursor: '800000000000000000:' + n });
  const messages = Array.from({ length: 150 }, (_, i) => message(351 + i));
  const answers = [];
  const host = {
    openChatId: '1', openSeq: 1, pendingHistory: false, messages, hasMore: true, chats: [{ id: '1', unread: 0 }], cache: null,
    historyWindow: { messages, beforeCount: 350, afterCount: 500, beforeHeight: 350, afterHeight: 500, estimate: 1, hasOlder: true, hasNewer: true },
    client: { messages: (chatId, options) => new Promise((resolve) => { answers.push({ options, resolve }); }) },
    describe: root.describe, applyWindow: root.applyWindow,
  };
  const older = root.loadHistory.call(host, 'older');
  const newer = root.loadHistory.call(host, 'newer');
  assert.equal(answers.length, 2, 'an older and a newer page are asked for together');
  assert.equal(await root.loadHistory.call(host, 'older'), false, 'a second older page is not asked for');
  assert.equal(await root.loadHistory.call(host, 'newer'), false, 'nor a second newer one');
  assert.equal(answers.length, 2);
  assert.equal(host.pendingHistory, true);
  assert.equal(answers[0].options.beforeCursor, messages[0].historyCursor, 'each from its own edge of the window');
  assert.equal(answers[1].options.afterCursor, messages.at(-1).historyCursor);
  answers[0].resolve({ messages: Array.from({ length: 50 }, (_, i) => message(301 + i)), hasMore: true });
  assert.equal(await older, true);
  assert.equal(host.pendingHistory, true, 'the newer page is still on its way');
  answers[1].resolve({ messages: Array.from({ length: 50 }, (_, i) => message(501 + i)), hasMore: true });
  assert.equal(await newer, false, 'the older page evicted the newest messages, so a newer page no longer meets the window and is not merged');
  assert.equal(host.pendingHistory, false);
  assert.equal(host.messages.length, 150);
  assert.equal(host.messages[0].id, 'SYNTHETIC-301');
  assert.equal(host.messages.at(-1).id, 'SYNTHETIC-450');
});

test('every platform runs the same history scroll walk (issue 535)', () => {
  const fixture = read('core/test/history-scroll-fixture.js');
  assert.match(fixture, /globalThis\.historyWalk = /);
  assert.match(fixture, /window\.historyScrollProof = /);
  const shell = read('ios/' + naming.product + '/ShellView.swift');
  assert.match(shell, /#if DEBUG[\s\S]*--history-scroll-fixture[\s\S]*#endif/, 'the iOS fixture is a Debug seam');
  assert.match(read('ios/project.yml'), /CONFIGURATION.*Debug[\s\S]*core\/test\/history-scroll-fixture\.js/, 'copied into test builds only');
  assert.match(read('ios/' + naming.product + 'UITests/HistoryScrollTests.swift'), /--history-scroll-fixture[\s\S]*hasPrefix\("scroll:pass"\)/);
  const pkg = 'com/azuretek/' + naming.product.toLowerCase();
  assert.match(read('android/app/src/androidTest/kotlin/' + pkg + '/HistoryScrollTest.kt'), /PageFixture\.run\(scenario, "history-scroll-fixture\.js", "historyScrollProof"/);
  assert.match(read('.github/workflows/android.yml'), /history-scroll\.png/);
  const proof = read('desktop/scripts/prove-history-window.mjs');
  assert.match(proof, /history-scroll-fixture\.js/, 'the packaged desktop proof loads the same walk');
  assert.match(proof, /historyProof\.walk\(\)/);
  assert.match(read('desktop/scripts/smoke.mjs'), /prove-history-window\.mjs/, 'which the desktop smoke runs on every desktop platform');
  assert.doesNotMatch(read('core/app/main.js'), /history-scroll-fixture/);
});
