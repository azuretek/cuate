import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { openContact } from '../src/contacts.js';

// Synthetic cards only. The adapter exposes the writable selection property from Contacts.sdef, not a made-up
// show command. Running the generated JXA here sends no Apple event and cannot ask for a privacy grant.
const card = (phones = [], emails = []) => ({
  phones: () => phones.map((value) => ({ value: () => value })),
  emails: () => emails.map((value) => ({ value: () => value })),
});
const ada = card(['+1 (555) 010-1234'], ['Ada@Example.com']);
const grace = card(['+44 5550 101234'], ['grace@example.com']);

async function select(handle, people, expected) {
  const actions = [];
  const app = {
    people: () => people,
    set selection(value) { actions.push(['selection', value]); },
    activate: () => actions.push(['activate']),
  };
  const result = await openContact(handle, {
    platform: 'darwin',
    run: (command, args, options, done) => {
      assert.equal(command, 'osascript');
      assert.deepEqual(args.slice(0, 3), ['-l', 'JavaScript', '-e']);
      assert.equal(options.timeout, 20000);
      try {
        const output = vm.runInNewContext(args[3], {
          ObjC: { import: (name) => assert.equal(name, 'Contacts') },
          Application: (name) => { assert.equal(name, 'Contacts'); return app; },
        });
        done(null, output);
      } catch (error) { done(error, ''); }
    },
  });
  assert.equal(result, Boolean(expected));
  assert.equal(actions.length, expected ? 2 : 0);
  if (expected) {
    assert.equal(actions[0][0], 'selection');
    assert.equal(actions[0][1].length, 1);
    assert.equal(actions[0][1][0], expected);
    assert.deepEqual(actions[1], ['activate']);
  }
}

test('the Mac editor selects the exact person before activating Contacts (issue 393)', async () => {
  await select('+15550101234', [grace, ada], ada);
  await select(' ADA@example.COM ', [grace, ada], ada);
  await select('+445550101234', [ada, grace], grace);
});

test('the Mac editor never selects an ambiguous, foreign or missing card (issue 393)', async () => {
  await select('+15550101234', [ada, card(['+15550101234'])], null);
  await select('ada@example.com', [ada, card([], ['ADA@example.com'])], null);
  await select('5550101234', [ada, grace], null);
  await select('nobody@example.com', [ada, grace], null);
  await select('15550101234@example.com', [ada], null);
  await select('"; throw new Error("injected"); //', [ada], null);
});

test('an unsupported shell or empty handle never invokes the native editor (issue 393)', async () => {
  let calls = 0;
  const run = () => { calls += 1; };
  for (const platform of ['win32', 'linux']) {
    assert.equal(await openContact('+15550101234', { platform, run }), false);
  }
  assert.equal(await openContact(' ', { platform: 'darwin', run }), false);
  assert.equal(calls, 0);
});

test('a native refusal never claims the card opened (issue 393)', async () => {
  for (const stdout of ['true', 'false', '']) {
    const run = (...args) => args.at(-1)(new Error('refused'), stdout);
    assert.equal(await openContact('ada@example.com', { platform: 'darwin', run }), false);
  }
});

test('the installed Mac dictionary declares writable person selection (issue 393)', { skip: process.platform !== 'darwin' }, () => {
  const dictionary = readFileSync('/System/Applications/Contacts.app/Contents/Resources/Contacts.sdef', 'utf8');
  const selection = dictionary.match(/<property\b[^>]*name="selection"[^>]*>[\s\S]*?<\/property>/)?.[0];
  assert.ok(selection);
  assert.doesNotMatch(selection, /access="r"/);
  assert.match(selection, /<type\s+type="person"\s+list="yes"/);
});
