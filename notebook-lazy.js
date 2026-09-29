import { canvasRenderMetrics, notebookPageMetrics } from './notebook-lazy-core.js';

function pageNumberBadge(pageNumber) {
  const badge = document.createElement('div');
  badge.className = 'page-number';
  badge.textContent = String(pageNumber);
  return badge;
}

function freeCanvas(canvas) {
  if (!canvas) return;
  canvas.width = 1;
  canvas.height = 1;
}

export function createLazyNotebookRenderer({
  viewer,
  pageTemplate,
  documentId,
  pageCount,
  generationIsCurrent,
  loadStrokes,
  redrawInk,
  bindInkCanvas,
  setStatus,
  renderLimit = 2,
}) {
  let observer = null;
  let destroyed = false;
  const placeholders = [];

  const { width: baseWidth, height: baseHeight } = notebookPageMetrics(window.innerWidth);

  function makePlaceholder(pageNumber) {
    const element = document.createElement('section');
    element.className = 'pdf-page notebook-placeholder';
    element.dataset.pageNumber = String(pageNumber);
    element.dataset.baseWidth = String(baseWidth);
    element.dataset.baseHeight = String(baseHeight);
    element.dataset.renderState = 'idle';
    element.style.width = `${baseWidth}px`;
    element.style.height = `${baseHeight}px`;
    element.appendChild(pageNumberBadge(pageNumber));
    return element;
  }

  function currentZoomFor(element) {
    const shownWidth = parseFloat(element.style.width) || baseWidth;
    return Math.max(1, shownWidth / baseWidth);
  }

  function dehydrate(element) {
    if (!element || element.dataset.renderState !== 'rendered') return;
    freeCanvas(element.querySelector('.pdf-canvas'));
    freeCanvas(element.querySelector('.ink-canvas'));
    const pageNumber = Number(element.dataset.pageNumber);
    element.replaceChildren(pageNumberBadge(pageNumber));
    element.classList.add('notebook-placeholder');
    element.dataset.renderState = 'idle';
  }

  async function hydrate(element) {
    if (destroyed || !generationIsCurrent()) return;
    if (!element || element.dataset.renderState !== 'idle') return;

    const pageNumber = Number(element.dataset.pageNumber);
    const zoom = currentZoomFor(element);
    element.dataset.renderState = 'rendering';

    try {
      const fragment = pageTemplate.content.cloneNode(true);
      const pdfCanvas = fragment.querySelector('.pdf-canvas');
      const inkCanvas = fragment.querySelector('.ink-canvas');
      const badge = fragment.querySelector('.page-number');
      const { pixelWidth, pixelHeight } = canvasRenderMetrics(
        baseWidth,
        baseHeight,
        window.devicePixelRatio || 1,
        renderLimit,
      );

      for (const canvas of [pdfCanvas, inkCanvas]) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.dataset.baseWidth = String(baseWidth);
        canvas.dataset.baseHeight = String(baseHeight);
        canvas.style.width = `${baseWidth * zoom}px`;
        canvas.style.height = `${baseHeight * zoom}px`;
      }
      badge.textContent = String(pageNumber);

      element.replaceChildren(...fragment.childNodes);
      element.classList.remove('notebook-placeholder');

      const context = pdfCanvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, pdfCanvas.width, pdfCanvas.height);

      const strokes = await loadStrokes(documentId, pageNumber);
      if (destroyed || !generationIsCurrent()) {
        freeCanvas(pdfCanvas);
        freeCanvas(inkCanvas);
        return;
      }

      redrawInk(inkCanvas, strokes);
      bindInkCanvas(inkCanvas, pageNumber, strokes, documentId);
      element.dataset.renderState = 'rendered';
    } catch (error) {
      console.error(`Не удалось отрисовать страницу блокнота ${pageNumber}`, error);
      element.dataset.renderState = 'idle';
      element.classList.add('notebook-placeholder');
      element.replaceChildren(pageNumberBadge(pageNumber));
    }
  }

  async function init() {
    if (destroyed || !generationIsCurrent()) return;

    const fragment = document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      const element = makePlaceholder(pageNumber);
      placeholders.push(element);
      fragment.appendChild(element);
    }
    viewer.replaceChildren(fragment);

    observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const element = entry.target;
        if (entry.isIntersecting) {
          hydrate(element);
        } else if (element.dataset.renderState === 'rendered') {
          dehydrate(element);
        }
      }
    }, {
      root: null,
      rootMargin: '900px 0px',
      threshold: 0,
    });

    placeholders.forEach(element => observer.observe(element));
    setStatus(`${pageCount} стр. · подгружаются по мере прокрутки`);
  }

  function destroy() {
    destroyed = true;
    observer?.disconnect();
    observer = null;
    placeholders.forEach(element => {
      freeCanvas(element.querySelector('.pdf-canvas'));
      freeCanvas(element.querySelector('.ink-canvas'));
    });
  }

  return { init, destroy };
}
