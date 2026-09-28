import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
import { clientPointToCanvas, strokeHitsPoint } from './drawing.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';

const DB_NAME = 'notes-rinrin';
const DB_VERSION = 1;
const PDF_RENDER_LIMIT = 2;

const viewer = document.querySelector('#viewer');
const pdfInput = document.querySelector('#pdf-input');
const documentName = document.querySelector('#document-name');
const status = document.querySelector('#status');
const pageTemplate = document.querySelector('#page-template');
const readTool = document.querySelector('#read-tool');
const drawTool = document.querySelector('#draw-tool');
const eraserTool = document.querySelector('#eraser-tool');

let mode = 'read';
let currentDocumentId = null;
let renderGeneration = 0;
let resizeTimer = null;
let currentPdfBytes = null;

function setStatus(text) {
  status.textContent = text;
}

function setMode(nextMode) {
  mode = nextMode;
  viewer.classList.toggle('draw-mode', mode === 'draw');
  viewer.classList.toggle('erase-mode', mode === 'erase');

  for (const [button, buttonMode] of [
    [readTool, 'read'], [drawTool, 'draw'], [eraserTool, 'erase'],
  ]) {
    const active = buttonMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

readTool.addEventListener('click', () => setMode('read'));
drawTool.addEventListener('click', () => setMode('draw'));
eraserTool.addEventListener('click', () => setMode('erase'));

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('documents')) {
        db.createObjectStore('documents', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('strokes')) {
        db.createObjectStore('strokes', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function idbGet(storeName, key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut(storeName, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    tx.objectStore(storeName).put(value);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function hashBytes(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function saveLocalDocument(id, name, bytes) {
  await idbPut('documents', { id, name, data: bytes.slice(0), savedAt: Date.now() });
  await idbPut('meta', { key: 'lastDocumentId', value: id });
}

async function getLastLocalDocument() {
  const meta = await idbGet('meta', 'lastDocumentId');
  if (!meta?.value) return null;
  return idbGet('documents', meta.value);
}

function strokeKey(documentId, pageNumber) {
  return `${documentId}:${pageNumber}`;
}

async function loadStrokes(documentId, pageNumber) {
  const record = await idbGet('strokes', strokeKey(documentId, pageNumber));
  return Array.isArray(record?.strokes) ? record.strokes : [];
}

async function saveStrokes(documentId, pageNumber, strokes) {
  await idbPut('strokes', {
    key: strokeKey(documentId, pageNumber),
    documentId,
    pageNumber,
    strokes,
    savedAt: Date.now(),
  });
}

function normalizedPoint(event, canvas) {
  const raw = clientPointToCanvas(event, canvas.getBoundingClientRect(), canvas);
  return { x: raw.x / canvas.width, y: raw.y / canvas.height };
}

function drawStroke(context, canvas, stroke) {
  const points = stroke.points ?? [];
  if (!points.length) return;

  const cssScale = canvas.width / Math.max(1, canvas.getBoundingClientRect().width);
  context.save();
  context.strokeStyle = '#111111';
  context.fillStyle = '#111111';
  context.lineWidth = 2.4 * cssScale;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (points.length === 1) {
    const p = points[0];
    context.beginPath();
    context.arc(p.x * canvas.width, p.y * canvas.height, context.lineWidth / 2, 0, Math.PI * 2);
    context.fill();
  } else {
    context.beginPath();
    context.moveTo(points[0].x * canvas.width, points[0].y * canvas.height);
    for (let i = 1; i < points.length; i += 1) {
      context.lineTo(points[i].x * canvas.width, points[i].y * canvas.height);
    }
    context.stroke();
  }
  context.restore();
}

function redrawInk(canvas, strokes) {
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, canvas.width, canvas.height);
  strokes.forEach(stroke => drawStroke(context, canvas, stroke));
}

function bindInkCanvas(canvas, pageNumber, strokes) {
  let activePointerId = null;
  let currentStroke = null;
  let changedByEraser = false;

  const eraseAt = event => {
    const point = normalizedPoint(event, canvas);
    const radius = 18 / Math.max(1, canvas.getBoundingClientRect().width);
    const before = strokes.length;
    for (let i = strokes.length - 1; i >= 0; i -= 1) {
      if (strokeHitsPoint(strokes[i], point, radius)) strokes.splice(i, 1);
    }
    if (strokes.length !== before) {
      changedByEraser = true;
      redrawInk(canvas, strokes);
    }
  };

  canvas.addEventListener('pointerdown', event => {
    if (mode === 'read') return;

    if (activePointerId !== null && event.pointerType === 'touch') {
      activePointerId = null;
      currentStroke = null;
      return;
    }

    activePointerId = event.pointerId;
    if (event.pointerType !== 'touch') {
      try { canvas.setPointerCapture(event.pointerId); } catch {}
    }

    if (mode === 'erase') {
      changedByEraser = false;
      eraseAt(event);
      return;
    }

    currentStroke = { points: [normalizedPoint(event, canvas)] };
    strokes.push(currentStroke);
    redrawInk(canvas, strokes);
  });

  canvas.addEventListener('pointermove', event => {
    if (event.pointerId !== activePointerId || mode === 'read') return;
    if (mode === 'erase') {
      eraseAt(event);
      return;
    }
    if (!currentStroke) return;
    currentStroke.points.push(normalizedPoint(event, canvas));
    redrawInk(canvas, strokes);
  });

  const finish = async event => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    const hadStroke = Boolean(currentStroke);
    currentStroke = null;
    if (hadStroke || changedByEraser) {
      changedByEraser = false;
      await saveStrokes(currentDocumentId, pageNumber, strokes);
      setStatus(`Сохранено · ${pageNumber} стр.`);
    }
  };

  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', event => {
    if (event.pointerId !== activePointerId) return;
    activePointerId = null;
    currentStroke = null;
    redrawInk(canvas, strokes);
  });
}

async function renderPage(pdf, pageNumber, generation) {
  if (generation !== renderGeneration) return;
  const page = await pdf.getPage(pageNumber);
  if (generation !== renderGeneration) return;

  const baseViewport = page.getViewport({ scale: 1 });
  const maxCssWidth = Math.min(900, Math.max(280, window.innerWidth - 20));
  const cssScale = maxCssWidth / baseViewport.width;
  const outputScale = Math.min(window.devicePixelRatio || 1, PDF_RENDER_LIMIT);
  const renderViewport = page.getViewport({ scale: cssScale * outputScale });
  const cssViewport = page.getViewport({ scale: cssScale });

  const fragment = pageTemplate.content.cloneNode(true);
  const pageElement = fragment.querySelector('.pdf-page');
  const pdfCanvas = fragment.querySelector('.pdf-canvas');
  const inkCanvas = fragment.querySelector('.ink-canvas');
  const pageNumberElement = fragment.querySelector('.page-number');

  pageElement.style.width = `${cssViewport.width}px`;
  pageElement.style.height = `${cssViewport.height}px`;
  pdfCanvas.width = Math.floor(renderViewport.width);
  pdfCanvas.height = Math.floor(renderViewport.height);
  pdfCanvas.style.width = `${cssViewport.width}px`;
  pdfCanvas.style.height = `${cssViewport.height}px`;
  inkCanvas.width = pdfCanvas.width;
  inkCanvas.height = pdfCanvas.height;
  inkCanvas.style.width = `${cssViewport.width}px`;
  inkCanvas.style.height = `${cssViewport.height}px`;
  pageNumberElement.textContent = String(pageNumber);

  viewer.appendChild(fragment);

  await page.render({
    canvasContext: pdfCanvas.getContext('2d'),
    viewport: renderViewport,
  }).promise;

  if (generation !== renderGeneration) return;
  const strokes = await loadStrokes(currentDocumentId, pageNumber);
  redrawInk(inkCanvas, strokes);
  bindInkCanvas(inkCanvas, pageNumber, strokes);
}

async function renderPdf(bytes, id, name) {
  const generation = ++renderGeneration;
  currentDocumentId = id;
  currentPdfBytes = bytes.slice(0);
  documentName.textContent = name;
  document.body.classList.add('is-loading');
  setStatus('Открываю PDF…');

  viewer.replaceChildren();
  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const pdf = await loadingTask.promise;
    if (generation !== renderGeneration) return;

    setStatus(`${pdf.numPages} стр. · загружаю…`);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      await renderPage(pdf, pageNumber, generation);
      if (generation !== renderGeneration) return;
      setStatus(`${pageNumber}/${pdf.numPages} стр.`);
    }
    setStatus(`${pdf.numPages} стр. · готово`);
  } catch (error) {
    console.error(error);
    viewer.innerHTML = `<section class="empty-state"><h1>PDF не открылся</h1><p>Попробуй другой файл. Если повторится — будем разбирать конкретный PDF.</p></section>`;
    setStatus('Ошибка открытия');
  } finally {
    document.body.classList.remove('is-loading');
  }
}

async function openSelectedFile(file) {
  if (!file) return;
  setStatus('Сохраняю локально…');
  const bytes = await file.arrayBuffer();
  const id = await hashBytes(bytes);
  await saveLocalDocument(id, file.name, bytes);
  await renderPdf(bytes, id, file.name);
}

pdfInput.addEventListener('change', async () => {
  const [file] = pdfInput.files;
  try {
    await openSelectedFile(file);
  } catch (error) {
    console.error(error);
    setStatus('Не удалось открыть');
  } finally {
    pdfInput.value = '';
  }
});

window.addEventListener('resize', () => {
  if (!currentPdfBytes || !currentDocumentId) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const lastDocument = await idbGet('documents', currentDocumentId);
    if (lastDocument) await renderPdf(lastDocument.data, lastDocument.id, lastDocument.name);
  }, 350);
});

async function restoreLastDocument() {
  try {
    const saved = await getLastLocalDocument();
    if (!saved) return;
    setStatus('Восстанавливаю последний PDF…');
    await renderPdf(saved.data, saved.id, saved.name);
  } catch (error) {
    console.error(error);
    setStatus('Открой PDF');
  }
}

setMode('read');
restoreLastDocument();
