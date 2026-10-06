import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EDGE, SLOP, SETTLE, FLING, FLING_TRAVEL,
  isEdgeStart, isHorizontal, progressFor, settlesOpen, settlesOpenAt, velocityFor,
} from '../app/rules/drawer.js';

const naming = JSON.parse(readFileSync(new URL('../spec/naming.json', import.meta.url), 'utf8'));
const spec = () => JSON.parse(readFileSync(new URL('../spec/tokens.json', import.meta.url), 'utf8'));
// Comments carry prose that could name a rule, so the stylesheet is read with them stripped.
const css = () => readFileSync(new URL('../app/styles/app.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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

test('a flick settles the drawer in the direction the finger moved (issue 288)', () => {
  const width = 320;
  // Slow, or barely moved: settles by where the finger ended, past the half-way threshold.
  assert.equal(settlesOpenAt({ progress: 0.4, travel: 0.4, velocity: 40, width }), false);
  assert.equal(settlesOpenAt({ progress: 0.6, travel: 0.6, velocity: -40, width }), true);
  assert.equal(settlesOpenAt({ progress: 0.2, travel: 0.1, velocity: 4000, width }), false, 'a flick that barely carried the panel is no flick');
  assert.equal(settlesOpenAt({ progress: 0.9, travel: 0.1, velocity: -4000, width }), true);
  // Fast, past a third of the panel: decides by the direction it moved, whichever side of half it stopped on.
  assert.equal(settlesOpenAt({ progress: 0.4, travel: 0.4, velocity: 4000, width }), true, 'a fast push right opens below half');
  assert.equal(settlesOpenAt({ progress: 0.6, travel: 0.6, velocity: -4000, width }), false, 'a fast push left closes above half');
  assert.equal(FLING, 1.5);
  assert.equal(FLING_TRAVEL, 1 / 3);
});

test('the finger\'s speed is read from its own samples, and nothing else (issue 288)', () => {
  assert.equal(velocityFor([]), 0);
  assert.equal(velocityFor([{ x: 10, time: 100 }]), 0, 'one sample is no measurable movement');
  assert.equal(velocityFor([{ x: 10, time: 100 }, { x: 20, time: 100 }]), 0, 'no interval is no movement');
  assert.equal(velocityFor([{ x: 0, time: 1000 }, { x: 32, time: 1010 }]), 3200, '32px in 10ms is 3200px a second');
  assert.equal(velocityFor([{ x: 0, time: 1000 }, { x: -32, time: 1020 }]), -1600, 'and leftward is negative');
});

test('the drawer\'s edge handle is the width the rule opens it from, and takes the whole gesture (issue 288)', () => {
  assert.equal(EDGE + 'px', spec().size['drawer-edge'], 'the edge handle is the width the drawer opens from');
  const edge = /\.drawer-edge\s*\{([^}]*touch-action:\s*none[^}]*)\}/.exec(css());
  assert.ok(edge, 'the edge handle is styled with touch-action: none, so the browser never claims the drag');
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
