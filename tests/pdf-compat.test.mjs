import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFJS_VERSION, PDFJS_SCRIPT_URL, PDFJS_WORKER_URL } from '../pdf-compat.js';

test('legacy PDF.js build targets older Safari', () => {
  assert.equal(PDFJS_VERSION, '3.11.174');
  assert.match(PDFJS_SCRIPT_URL, /3\.11\.174\/legacy\/build\/pdf\.min\.js$/);
  assert.match(PDFJS_WORKER_URL, /3\.11\.174\/legacy\/build\/pdf\.worker\.min\.js$/);
});
