// Issue 530: the message cache proofs on iOS, Android and the desktop hold a warm launch by what it had read when it
// drew (issue 478), and those counts decide. No time from one launch is compared with another's, because the four
// launches run one after another on a shared simulator, emulator or runner, and a busy moment during one moves its
// times by more than the store saves: a strict "sooner" failed #526 at 765 ms against 757 ms with every count right.
// The one timing check left is a generous bound on the warm launch with the store alone, which the fixture states and
// measures on the page's own clock from sign-in, so a native test's launch and waiting are never inside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL('../../' + p, import.meta.url), 'utf8');
const naming = JSON.parse(read('core/spec/naming.json'));
const proofs = {
  ios: 'ios/' + naming.product + 'UITests/MessageCacheTests.swift',
  android: 'android/app/src/androidTest/kotlin/' + naming.ids.android.replace(/\./g, '/') + '/MessageCacheTest.kt',
  desktop: 'desktop/scripts/prove-message-cache.mjs',
};
const FIXTURE = 'core/test/message-cache-fixture.js';

// The launches a line reads, however the platform names them ("on-warm" in Swift, onWarm in Kotlin and JavaScript),
// and the times it reads: every measured field ending in Ms but the bound itself and the emulated link's round trip.
const launchesIn = (text) => new Set([...text.matchAll(/\b(on|off)-?([Cc]old|[Ww]arm)\b/g)].map((m) => m[1] + '-' + m[2].toLowerCase()));
const timesIn = (text) => [...text.matchAll(/\b([a-z][A-Za-z]*Ms)\b/g)].map((m) => m[1]).filter((f) => f !== 'backstopMs' && f !== 'rttMs');
const assertions = (source) => source.split('\n')
  .map((text, i) => ({ number: i + 1, text: text.replace(/^\s*\/\/.*$/, '').trim() }))
  .filter(({ text }) => /assert/i.test(text));
const crossLaunchTimes = (source) => assertions(source)
  .filter(({ text }) => timesIn(text).length && launchesIn(text).size > 1)
  .map(({ number, text }) => number + ' ' + text);
const backstops = (source) => assertions(source)
  .filter(({ text }) => text.includes('backstopMs'))
  .map(({ text }) => ({ times: timesIn(text), launches: [...launchesIn(text)] }));

test('the cross-launch finder sees a time race on every platform and nothing else', () => {
  const races = [
    'XCTAssertLessThan(number("on-warm", "themedMs"), number("off-warm", "themedMs"), "and sooner")',
    'assertTrue("and sooner: $onWarm against $offWarm", onWarm.getLong("firstVisibleMs") < offWarm.getLong("firstVisibleMs"))',
    "assert.ok(onWarm.themedMs < offWarm.themedMs, 'and sooner');",
    'XCTAssertLessThan(number("on-warm", "themedMs"), number("off-warm", "themedMs") / 2)',
  ];
  const fine = [
    'XCTAssertLessThan(number("on-warm", "themedMs"), number("on-warm", "backstopMs"), "and within the backstop of sign-in")',
    'assertTrue("and within the backstop of sign-in: $onWarm", onWarm.getLong("firstVisibleMs") < onWarm.getLong("backstopMs"))',
    'XCTAssertLessThan(number("on-warm", "bytes"), number("off-warm", "bytes") / 4, "a warm open costs a fraction of the bytes it did")',
    '// XCTAssertLessThan(number("on-warm", "themedMs"), number("off-warm", "themedMs")) in a comment is not an assertion',
    'let ratio = number("on-warm", "themedMs") / number("off-warm", "themedMs")',
  ];
  assert.deepEqual(crossLaunchTimes(races.join('\n')).map((l) => Number(l.split(' ')[0])), [1, 2, 3, 4]);
  assert.deepEqual(crossLaunchTimes(fine.join('\n')), []);
});

// Each check runs over all three proofs, and names the file that breaks it.
test('no time from one launch decides against another launch', () => {
  for (const file of Object.values(proofs)) {
    assert.deepEqual(crossLaunchTimes(read(file)), [], file + ' holds a warm launch by what it read before it drew, never by a race between two launches (issue 530)');
  }
});

test('every proof holds the counts that say where a warm launch drew from (issues 478, 530)', () => {
  for (const file of Object.values(proofs)) {
    const held = assertions(read(file)).map(({ text }) => text).join('\n');
    for (const field of ['pageReads', 'pictureReads', 'photoReads', 'answersBeforeThemed', 'settingsBeforeThemed', 'pagesBeforeFirstVisible', 'shownEdit', 'bytes']) {
      assert.match(held, new RegExp('\\b' + field + '\\b'), file + ' asserts ' + field);
    }
  }
});

test('the only timing check in a proof is the fixture\'s backstop, on the warm launch with the store alone (issue 530)', () => {
  for (const file of Object.values(proofs)) {
    const source = read(file);
    const found = backstops(source);
    assert.deepEqual(found.map((b) => b.times).sort(), [['firstVisibleMs'], ['themedMs']], file + ' bounds the warm scheme and first message by backstopMs');
    for (const b of found) assert.deepEqual(b.launches, ['on-warm'], file + ' bounds a launch by its own backstop, never another launch');
    const timed = assertions(source).filter(({ text }) => timesIn(text).length && !text.includes('backstopMs'));
    for (const { number, text } of timed) assert.ok(/,\s*0\s*,|!==\s*null/.test(text), file + ':' + number + ' reads a time outside the backstop for more than whether it was taken: ' + text);
    assert.match(source, /issue 530/, file + ' says in the test why no time is compared across launches');
  }
});

test('the fixture states the backstop, generous and inside its own waits, on the page clock from sign-in (issue 530)', () => {
  const fixture = read(FIXTURE);
  const bound = Number((/const BACKSTOP_MS = (\d+);/.exec(fixture) || [])[1]);
  const waits = [...fixture.matchAll(/'the (?:first|newest) message', (\d+)\)/g)].map((m) => Number(m[1]));
  assert.ok(bound >= 5000, 'the backstop allows several times the slowest warm launch CI has seen (1295 ms), not a speed race');
  assert.ok(waits.length === 2 && waits.every((w) => bound < w), 'and stays inside the waits for the states it bounds, so a hang reports as the bound');
  assert.match(fixture, /backstopMs: BACKSTOP_MS/, 'the fixture reports it beside the times, so every platform reads the one value');
  const signIn = fixture.indexOf('const t0 = performance.now();');
  assert.ok(signIn > 0 && signIn < fixture.indexOf('root.start(SERVER'), 'the clock starts at sign-in, inside the page, after the native test has launched it');
  assert.match(fixture, /themedMs = performance\.now\(\) - t0;/, 'the scheme is timed on the page clock the moment it is written');
  assert.match(fixture, /const firstVisibleMs = performance\.now\(\) - t0;/, 'and the first message the moment the page draws it');
});
