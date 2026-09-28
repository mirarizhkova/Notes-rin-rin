import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPointToCanvas, strokeHitsPoint } from '../drawing.js';

test('clientPointToCanvas maps CSS coordinates into canvas coordinates', () => {
  const point = clientPointToCanvas(
    { clientX: 60, clientY: 45 },
    { left: 10, top: 5, width: 100, height: 80 },
    { width: 200, height: 160 }
  );
  assert.deepEqual(point, { x: 100, y: 80 });
});

test('strokeHitsPoint detects an eraser hit near a line segment', () => {
  const stroke = { points: [{ x: 10, y: 10 }, { x: 30, y: 10 }] };
  assert.equal(strokeHitsPoint(stroke, { x: 20, y: 13 }, 4), true);
  assert.equal(strokeHitsPoint(stroke, { x: 20, y: 20 }, 4), false);
});
