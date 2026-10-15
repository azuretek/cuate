import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { parseWindowsTextScale, parseGnomeTextScale, readTextScale, watchTextScale } from '../src/text-scale.js';

test('the Windows Text size slider and the GNOME text scaling factor read as percentages (issue 369)', () => {
  assert.equal(parseWindowsTextScale('\r\nHKEY_CURRENT_USER\\Software\\Microsoft\\Accessibility\r\n    TextScaleFactor    REG_DWORD    0x7d\r\n'), 125);
  assert.equal(parseWindowsTextScale(''), 100, 'a slider never moved is 100');
  assert.equal(parseGnomeTextScale('1.25\n'), 125);
  assert.equal(parseGnomeTextScale('text-scaling-factor: 1.5'), 150, 'a monitor line');
  assert.equal(parseGnomeTextScale('nothing'), null);
});

test('each desktop reads its own system, and macOS has none (issue 369)', async () => {
  const calls = [];
  const exec = async (file, args) => { calls.push([file, ...args].join(' ')); return file === 'reg' ? '    TextScaleFactor    REG_DWORD    0x96' : '1.1'; };
  assert.equal(await readTextScale('win32', exec), 150);
  assert.equal(await readTextScale('linux', exec), 110);
  assert.equal(await readTextScale('darwin', exec), null);
  assert.equal(await readTextScale('win32', async () => null), 100, 'no stored value is the slider at 100');
  assert.ok(calls.some((c) => c.startsWith('gsettings get org.gnome.desktop.interface text-scaling-factor')));
});

test('a change is told as an event: GNOME through its own stream, Windows when the window is focused (issue 369)', async () => {
  const seen = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.kill = () => { child.killed = true; };
  const stop = watchTextScale({ platform: 'linux', onChange: (p) => seen.push(p), spawnImpl: () => child });
  child.stdout.emit('data', 'text-scaling-factor: 1.25\n');
  child.stdout.emit('data', 'text-scaling-factor: 1.25\n');
  child.stdout.emit('data', 'text-scaling-factor: 1.5\n');
  assert.deepEqual(seen, [125, 150], 'each change once');
  stop();
  assert.equal(child.killed, true, 'the stream ends with the window');
  let focus;
  const winSeen = [];
  watchTextScale({ platform: 'win32', onChange: (p) => winSeen.push(p), onFocus: (fn) => { focus = fn; return () => {}; }, read: async () => 125 });
  focus();
  await new Promise((r) => setTimeout(r, 0));
  assert.deepEqual(winSeen, [125]);
});
