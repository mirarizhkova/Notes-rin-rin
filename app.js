import * as pdfjsLib from 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.min.mjs';
import { clientPointToCanvas, strokeHitsPoint } from './drawing.js';
import {
  addNotebookPage,
  createNotebookRecord,
  deserializeBackup,
  normalizeDocumentRecord,
  serializeBackup,
} from './library.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs';

const DB_NAME = 'notes-rinrin';
const DB_VERSION = 1;
const PDF_RENDER_LIMIT = 2;

const homeToolbar = document.querySelector('#home-toolbar');
const documentToolbar = document.querySelector('#document-toolbar');
const homeView = document.querySelector('#home-view');
const viewer = document.querySelector('#viewer');
const pdfInput = document.querySelector('#pdf-input');
const backupInput = document.querySelector('#backup-input');
const documentName = document.querySelector('#document-name');
const status = document.querySelector('#status');
const libraryStatus = document.querySelector('#library-status');
const libraryGrid = document.querySelector('#library-grid');
const libraryEmpty = document.querySelector('#library-empty');
const pageTemplate = document.querySelector('#page-template');
const homeButton = document.querySelector('#home-button');
const addPageButton = document.querySelector('#add-page');
const readTool = document.querySelector('#read-tool');
const drawTool = document.querySelector('#draw-tool');
const eraserTool = document.querySelector('#eraser-tool');
const newNotebookButton = document.querySelector('#new-notebook');
const newNotebookEmptyButton = document.querySelector('#new-notebook-empty');
const exportLibraryButton = document.querySelector('#export-library');

let mode = 'read';
let currentDocument = null;
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

function showHomeView() {
  renderGeneration += 1;
  currentDocument = null;
  currentPdfBytes = null;
  documentToolbar.hidden = true;
  viewer.hidden = true;
  homeToolbar.hidden = false;
  homeView.hidden = false;
  document.body.classList.remove('is-loading');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function showDocumentView(record) {
  currentDocument = normalizeDocumentRecord(record);
  homeToolbar.hidden = true;
  homeView.hidden = true;
  documentToolbar.hidden = false;
  viewer.hidden = false;
  addPageButton.hidden = currentDocument.type !== 'notebook';
  documentName.textContent = currentDocument.name;
  setMode('read');
  window.scrollTo({ top: 0, behavior: 'auto' });
}

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

async function idbGetAll(storeName) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readonly');
    const request = tx.objectStore(storeName).getAll();
    request.onsuccess = () => resolve(request.result ?? []);
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

async function idbPutMany(storeName, values) {
  if (!values.length) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    values.forEach(value => store.put(value));
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

async function hashBytes(arrayBuffer) {
  const digest = await crypto.subtle.digest('SHA-256', arrayBuffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

function strokeKey(documentId, pageNumber) {
  return `${documentId}:${pageNumber}`;
}

async function loadStrokes(documentId, pageNumber) {
  const record = await idbGet('strokes', strokeKey(documentId, pageNumber));
  return Array.isArray(record?.strokes) ? record.strokes : [];
}

async function touchDocument(documentId) {
  const raw = await idbGet('documents', documentId);
  if (!raw) return;
  const next = { ...raw, updatedAt: Date.now() };
  await idbPut('documents', next);
  if (currentDocument?.id === documentId) currentDocument = normalizeDocumentRecord(next);
}

async function saveStrokes(documentId, pageNumber, strokes) {
  await idbPut('strokes', {
    key: strokeKey(documentId, pageNumber),
    documentId,
    pageNumber,
    strokes,
    savedAt: Date.now(),
  });
  await touchDocument(documentId);
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

function bindInkCanvas(canvas, pageNumber, strokes, documentId) {
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
      await saveStrokes(documentId, pageNumber, strokes);
      if (currentDocument?.id === documentId) setStatus(`Сохранено · ${pageNumber} стр.`);
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

function configurePageCanvases(fragment, cssWidth, cssHeight, outputScale, pageNumber) {
  const pageElement = fragment.querySelector('.pdf-page');
  const pdfCanvas = fragment.querySelector('.pdf-canvas');
  const inkCanvas = fragment.querySelector('.ink-canvas');
  const pageNumberElement = fragment.querySelector('.page-number');

  pageElement.style.width = `${cssWidth}px`;
  pageElement.style.height = `${cssHeight}px`;
  const pixelWidth = Math.max(1, Math.floor(cssWidth * outputScale));
  const pixelHeight = Math.max(1, Math.floor(cssHeight * outputScale));
  for (const canvas of [pdfCanvas, inkCanvas]) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${cssHeight}px`;
  }
  pageNumberElement.textContent = String(pageNumber);
  return { pageElement, pdfCanvas, inkCanvas };
}

async function renderPdfPage(pdf, pageNumber, generation, documentId) {
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
  const { pdfCanvas, inkCanvas } = configurePageCanvases(fragment, cssViewport.width, cssViewport.height, outputScale, pageNumber);
  viewer.appendChild(fragment);

  await page.render({ canvasContext: pdfCanvas.getContext('2d'), viewport: renderViewport }).promise;
  if (generation !== renderGeneration) return;
  const strokes = await loadStrokes(documentId, pageNumber);
  redrawInk(inkCanvas, strokes);
  bindInkCanvas(inkCanvas, pageNumber, strokes, documentId);
}

async function renderPdf(record) {
  const generation = ++renderGeneration;
  const documentId = record.id;
  const bytes = record.data;
  currentPdfBytes = bytes?.slice ? bytes.slice(0) : bytes;
  document.body.classList.add('is-loading');
  setStatus('Открываю PDF…');
  viewer.replaceChildren();

  try {
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(currentPdfBytes.slice(0)) });
    const pdf = await loadingTask.promise;
    if (generation !== renderGeneration) return;

    if (record.pageCount !== pdf.numPages || record.type !== 'pdf') {
      const next = {
        ...record,
        type: 'pdf',
        pageCount: pdf.numPages,
        updatedAt: record.updatedAt ?? record.savedAt ?? Date.now(),
      };
      await idbPut('documents', next);
      if (currentDocument?.id === record.id) currentDocument = normalizeDocumentRecord(next);
    }

    setStatus(`${pdf.numPages} стр. · загружаю…`);
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      await renderPdfPage(pdf, pageNumber, generation, documentId);
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

async function renderNotebookPage(record, pageNumber, generation) {
  if (generation !== renderGeneration) return;
  const maxCssWidth = Math.min(900, Math.max(280, window.innerWidth - 20));
  const cssWidth = maxCssWidth;
  const cssHeight = cssWidth * 1.4142;
  const outputScale = Math.min(window.devicePixelRatio || 1, PDF_RENDER_LIMIT);
  const fragment = pageTemplate.content.cloneNode(true);
  const { pdfCanvas, inkCanvas } = configurePageCanvases(fragment, cssWidth, cssHeight, outputScale, pageNumber);
  const context = pdfCanvas.getContext('2d');
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);
  viewer.appendChild(fragment);

  const strokes = await loadStrokes(record.id, pageNumber);
  redrawInk(inkCanvas, strokes);
  bindInkCanvas(inkCanvas, pageNumber, strokes, record.id);
}

async function renderNotebook(record) {
  const generation = ++renderGeneration;
  currentPdfBytes = null;
  viewer.replaceChildren();
  const pageCount = record.pageCount ?? 1;
  setStatus(`${pageCount} стр. · загружаю…`);
  for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
    await renderNotebookPage(record, pageNumber, generation);
    if (generation !== renderGeneration) return;
  }
  setStatus(`${pageCount} стр. · готово`);
}

async function openDocumentRecord(rawRecord) {
  const record = normalizeDocumentRecord(rawRecord);
  showDocumentView(record);
  if (record.type === 'notebook') {
    await renderNotebook(record);
    return;
  }
  if (!record.data) {
    viewer.innerHTML = `<section class="empty-state"><h1>PDF не найден</h1><p>В локальной записи нет самого файла.</p></section>`;
    setStatus('Нет файла');
    return;
  }
  await renderPdf(record);
}

async function openDocumentById(id) {
  const record = await idbGet('documents', id);
  if (record) await openDocumentRecord(record);
}

async function renderLibrary(message = '') {
  showHomeView();
  const rawDocuments = await idbGetAll('documents');
  const documents = rawDocuments
    .map(normalizeDocumentRecord)
    .sort((a, b) => (b.updatedAt ?? b.savedAt ?? b.createdAt ?? 0) - (a.updatedAt ?? a.savedAt ?? a.createdAt ?? 0));

  libraryGrid.replaceChildren();
  libraryEmpty.hidden = documents.length > 0;
  const countText = `${documents.length} ${documents.length === 1 ? 'документ' : 'документов'} · локально в этом браузере`;
  libraryStatus.textContent = message ? `${message} · ${countText}` : countText;

  for (const record of documents) {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'document-card';
    const icon = document.createElement('div');
    icon.className = 'doc-icon';
    icon.textContent = record.type === 'notebook' ? '▤' : 'PDF';
    const title = document.createElement('strong');
    title.textContent = record.name;
    const meta = document.createElement('span');
    const pageText = record.pageCount ? `${record.pageCount} стр.` : 'страницы ещё не посчитаны';
    meta.textContent = `${record.type === 'notebook' ? 'Блокнот' : 'PDF'} · ${pageText}`;
    card.append(icon, title, meta);
    card.addEventListener('click', () => openDocumentById(record.id));
    libraryGrid.appendChild(card);
  }
}

async function openSelectedPdf(file) {
  if (!file) return;
  const bytes = await file.arrayBuffer();
  const id = await hashBytes(bytes);
  const existing = await idbGet('documents', id);
  const now = Date.now();
  const record = {
    id,
    name: file.name,
    type: 'pdf',
    pageCount: existing?.pageCount ?? null,
    data: bytes.slice(0),
    createdAt: existing?.createdAt ?? existing?.savedAt ?? now,
    updatedAt: now,
  };
  await idbPut('documents', record);
  await openDocumentRecord(record);
}

function makeNotebookId() {
  if (crypto.randomUUID) return `notebook-${crypto.randomUUID()}`;
  return `notebook-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function createNotebook() {
  const name = window.prompt('Название блокнота', 'Новый блокнот');
  if (name === null) return;
  const cleanName = name.trim() || 'Новый блокнот';
  const record = createNotebookRecord(cleanName, makeNotebookId());
  await idbPut('documents', record);
  await openDocumentRecord(record);
}

async function addPageToCurrentNotebook() {
  if (!currentDocument || currentDocument.type !== 'notebook') return;
  const next = addNotebookPage(currentDocument);
  await idbPut('documents', next);
  currentDocument = next;
  await renderNotebook(next);
  requestAnimationFrame(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
}

async function exportLibrary() {
  try {
    exportLibraryButton.disabled = true;
    libraryStatus.textContent = 'Готовлю экспорт…';
    const documents = (await idbGetAll('documents')).map(normalizeDocumentRecord);
    const strokes = await idbGetAll('strokes');
    const text = serializeBackup(documents, strokes);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const day = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `notes-rinrin-backup-${day}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
    libraryStatus.textContent = 'Экспорт готов';
  } catch (error) {
    console.error(error);
    libraryStatus.textContent = 'Не удалось экспортировать';
  } finally {
    exportLibraryButton.disabled = false;
  }
}

async function importLibrary(file) {
  if (!file) return;
  libraryStatus.textContent = 'Импортирую…';
  const backup = deserializeBackup(await file.text());
  await idbPutMany('documents', backup.documents);
  await idbPutMany('strokes', backup.strokes);
  await renderLibrary('Импортировано');
}

readTool.addEventListener('click', () => setMode('read'));
drawTool.addEventListener('click', () => setMode('draw'));
eraserTool.addEventListener('click', () => setMode('erase'));
homeButton.addEventListener('click', () => renderLibrary());
addPageButton.addEventListener('click', addPageToCurrentNotebook);
newNotebookButton.addEventListener('click', createNotebook);
newNotebookEmptyButton.addEventListener('click', createNotebook);
exportLibraryButton.addEventListener('click', exportLibrary);

pdfInput.addEventListener('change', async () => {
  const [file] = pdfInput.files;
  try {
    await openSelectedPdf(file);
  } catch (error) {
    console.error(error);
    await renderLibrary('Не удалось открыть PDF');
  } finally {
    pdfInput.value = '';
  }
});

backupInput.addEventListener('change', async () => {
  const [file] = backupInput.files;
  try {
    await importLibrary(file);
  } catch (error) {
    console.error(error);
    libraryStatus.textContent = 'Не удалось импортировать копию';
  } finally {
    backupInput.value = '';
  }
});

window.addEventListener('resize', () => {
  if (!currentDocument) return;
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(async () => {
    const fresh = await idbGet('documents', currentDocument.id);
    if (!fresh) return;
    const record = normalizeDocumentRecord(fresh);
    currentDocument = record;
    if (record.type === 'notebook') await renderNotebook(record);
    else await renderPdf(record);
  }, 350);
});

setMode('read');
renderLibrary().catch(error => {
  console.error(error);
  libraryStatus.textContent = 'Не удалось открыть локальную библиотеку';
});
