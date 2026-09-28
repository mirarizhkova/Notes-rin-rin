import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createNotebookRecord,
  normalizeDocumentRecord,
  serializeBackup,
  deserializeBackup,
  addNotebookPage,
} from '../library.js';

test('legacy document records are treated as PDFs', () => {
  const record = normalizeDocumentRecord({ id: 'abc', name: 'book.pdf', data: new Uint8Array([1,2]).buffer });
  assert.equal(record.type, 'pdf');
  assert.equal(record.pageCount, null);
});

test('createNotebookRecord creates one blank page', () => {
  const record = createNotebookRecord('My notes', 'note-1', 123);
  assert.deepEqual(record, {
    id: 'note-1',
    name: 'My notes',
    type: 'notebook',
    pageCount: 1,
    createdAt: 123,
    updatedAt: 123,
  });
});

test('backup round-trip preserves PDF bytes, notebooks and strokes', () => {
  const docs = [
    { id: 'pdf-1', name: 'a.pdf', type: 'pdf', pageCount: 2, data: new Uint8Array([0, 1, 2, 255]).buffer },
    { id: 'note-1', name: 'Words', type: 'notebook', pageCount: 3 },
  ];
  const strokes = [{ key: 'note-1:1', documentId: 'note-1', pageNumber: 1, strokes: [{ points: [{x:.1,y:.2}] }] }];

  const text = serializeBackup(docs, strokes, 999);
  const restored = deserializeBackup(text);

  assert.equal(restored.version, 1);
  assert.equal(restored.exportedAt, 999);
  assert.equal(restored.documents.length, 2);
  assert.deepEqual(Array.from(new Uint8Array(restored.documents[0].data)), [0, 1, 2, 255]);
  assert.equal(restored.documents[1].type, 'notebook');
  assert.deepEqual(restored.strokes, strokes);
});

test('deserializeBackup rejects unsupported payloads', () => {
  assert.throws(() => deserializeBackup('{"version":9,"documents":[],"strokes":[]}'), /version/i);
});

test('addNotebookPage increments page count and updatedAt', () => {
  const next = addNotebookPage({ id: 'n', name: 'N', type: 'notebook', pageCount: 2, updatedAt: 10 }, 20);
  assert.equal(next.pageCount, 3);
  assert.equal(next.updatedAt, 20);
});
