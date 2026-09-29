import test from 'node:test';
import assert from 'node:assert/strict';
import { notebookPageMetrics, canvasRenderMetrics } from '../notebook-lazy-core.js';

test('notebook pages fit a phone viewport while keeping A-series ratio', () => {
  const { width, height } = notebookPageMetrics(390);
  assert.equal(width, 370);
  assert.ok(Math.abs(height - 523.254) < 0.01);
});

test('notebook page width is capped on wide screens', () => {
  const { width } = notebookPageMetrics(1400);
  assert.equal(width, 900);
});

test('canvas render metrics cap device pixel ratio to protect memory', () => {
  const metrics = canvasRenderMetrics(370, 523.254, 3, 2);
  assert.equal(metrics.outputScale, 2);
  assert.equal(metrics.pixelWidth, 740);
  assert.equal(metrics.pixelHeight, 1046);
});
