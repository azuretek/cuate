import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EDGE, SLOP, SETTLE, isEdgeStart, isHorizontal, progressFor, settlesOpen } from '../app/rules/drawer.js';

const naming = JSON.parse(readFileSync(new URL('../spec/naming.json', import.meta.url), 'utf8'));

test('only the left edge opens the list', () => {
  assert.equal(EDGE, 24);
  assert.equal(isEdgeStart(0), true);
  assert.equal(isEdgeStart(EDGE), true);
  assert.equal(isEdgeStart(EDGE + 1), false);
  assert.equal(isEdgeStart(200), false);
});

test('the drawer follows the finger and clamps at both ends', () => {
  const width = 320;
  assert.equal(progressFor({ open: false, startX: 4, x: 4, width }), 0);
  assert.equal(progressFor({ open: false, startX: 4, x: 4 + width / 2, width }), 0.5);
  assert.equal(progressFor({ open: false, startX: 4, x: 4 + width, width }), 1);
  assert.equal(progressFor({ open: false, startX: 4, x: -100, width }), 0);        // a drag the wrong way stays put
  assert.equal(progressFor({ open: false, startX: 4, x: 4 + width * 3, width }), 1); // a drag past the far edge stops there
  assert.equal(progressFor({ open: true, startX: 300, x: 300 - width / 2, width }), 0.5);
  assert.equal(progressFor({ open: true, startX: 300, x: 300 - width, width }), 0);
  assert.equal(progressFor({ open: true, startX: 300, x: 900, width }), 1);
});

test('a drag settles by where it ended up, not by how it got there', () => {
  assert.equal(SETTLE, 0.5);
  assert.equal(settlesOpen(1), true);
  assert.equal(settlesOpen(0.5), true);
  assert.equal(settlesOpen(0.4999), false);
  assert.equal(settlesOpen(0), false);
});

test('a vertical move is a scroll, never the drawer', () => {
  assert.equal(SLOP, 6);
  assert.equal(isHorizontal(20, 3), true);
  assert.equal(isHorizontal(-20, 3), true);
  assert.equal(isHorizontal(3, 20), false);
  assert.equal(isHorizontal(5, 5), false);
});

test('the iOS shell leaves the left edge to the app', () => {
  // The system's edge-swipe back gesture would contest this drag. The shell is a single page with no back-forward
  // history, and it never turns WKWebView's own gesture on, so the left edge belongs to the drawer. Where that
  // changes, this fails and the two must be settled again rather than fought over silently.
  const shell = readFileSync(new URL('../../ios/' + naming.product + '/ShellView.swift', import.meta.url), 'utf8');
  assert.equal(/allowsBackForwardNavigationGestures\s*=\s*true/.test(shell), false);
});
