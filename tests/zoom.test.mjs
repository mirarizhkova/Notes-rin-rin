import test from 'node:test';
import assert from 'node:assert/strict';
import { clampZoom, shouldSuppressClick, touchDistance, touchMidpoint, zoomFromPinch } from '../zoom-core.js';

test('clampZoom keeps document zoom between 1x and 3x', () => {
  assert.equal(clampZoom(0.3), 1);
  assert.equal(clampZoom(2.25), 2.25);
  assert.equal(clampZoom(5), 3);
});

test('touch helpers measure a two-finger gesture', () => {
  const a = { clientX: 10, clientY: 20 };
  const b = { clientX: 40, clientY: 60 };
  assert.equal(touchDistance(a, b), 50);
  assert.deepEqual(touchMidpoint(a, b), { x: 25, y: 40 });
});

test('zoomFromPinch scales from the gesture starting distance', () => {
  assert.equal(zoomFromPinch(1, 100, 180), 1.8);
  assert.equal(zoomFromPinch(2, 100, 200), 3);
});

test('synthetic clicks are suppressed briefly after pinch', () => {
  assert.equal(shouldSuppressClick(1000, 1200), true);
  assert.equal(shouldSuppressClick(1000, 1499), true);
  assert.equal(shouldSuppressClick(1000, 1501), false);
});
