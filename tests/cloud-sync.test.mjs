import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeLibraries } from '../cloud-sync.js';

test('sync preserves distinct PDFs and notebooks from both devices', () => {
  const local = {
    documents: [{ id: 'pdf', type: 'pdf', updatedAt: 5 }],
    strokes: [{ key: 'pdf:1', savedAt: 3, strokes: ['local'] }],
  };
  const remote = {
    documents: [{ id: 'notebook', type: 'notebook', updatedAt: 7 }],
    strokes: [{ key: 'notebook:1', savedAt: 6, strokes: ['remote'] }],
  };
  const merged = mergeLibraries(local, remote);
  assert.deepEqual(merged.documents.map(x => x.id).sort(), ['notebook', 'pdf']);
  assert.deepEqual(merged.strokes.map(x => x.key).sort(), ['notebook:1', 'pdf:1']);
});

test('sync keeps latest document and page annotations', () => {
  const local = {
    documents: [{ id: 'one', updatedAt: 10, name: 'latest' }],
    strokes: [{ key: 'one:1', savedAt: 2, strokes: ['older'] }],
  };
  const remote = {
    documents: [{ id: 'one', updatedAt: 5, name: 'older' }],
    strokes: [{ key: 'one:1', savedAt: 8, strokes: ['latest'] }],
  };
  const merged = mergeLibraries(local, remote);
  assert.equal(merged.documents[0].name, 'latest');
  assert.deepEqual(merged.strokes[0].strokes, ['latest']);
});

test('empty cloud leaves local library intact', () => {
  const local = { documents: [{ id: 'one' }], strokes: [] };
  assert.deepEqual(mergeLibraries(local, null), local);
});
