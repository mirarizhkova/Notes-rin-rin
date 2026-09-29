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

export function createLazyPdfRenderer({
  pdf,
  viewer,
  pageTemplate,
  documentId,
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

  function makePlaceholder(pageNumber, baseWidth, baseHeight) {
    const element = document.createElement('section');
    element.className = 'pdf-page pdf-placeholder';
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
    const baseWidth = Number(element.dataset.baseWidth) || 1;
    const shownWidth = parseFloat(element.style.width) || baseWidth;
    return Math.max(1, shownWidth / baseWidth);
  }

  function dehydrate(element) {
    if (!element || element.dataset.renderState !== 'rendered') return;
    freeCanvas(element.querySelector('.pdf-canvas'));
    freeCanvas(element.querySelector('.ink-canvas'));
    const pageNumber = Number(element.dataset.pageNumber);
    element.replaceChildren(pageNumberBadge(pageNumber));
    element.classList.add('pdf-placeholder');
    element.dataset.renderState = 'idle';
  }

  async function hydrate(element) {
    if (destroyed || !generationIsCurrent()) return;
    if (!element || element.dataset.renderState !== 'idle') return;

    const pageNumber = Number(element.dataset.pageNumber);
    element.dataset.renderState = 'rendering';

    try {
      const page = await pdf.getPage(pageNumber);
      if (destroyed || !generationIsCurrent()) return;

      const baseViewport = page.getViewport({ scale: 1 });
      const maxCssWidth = Math.min(900, Math.max(280, window.innerWidth - 20));
      const cssScale = maxCssWidth / baseViewport.width;
      const cssViewport = page.getViewport({ scale: cssScale });
      const outputScale = Math.min(window.devicePixelRatio || 1, renderLimit);
      const renderViewport = page.getViewport({ scale: cssScale * outputScale });
      const zoom = currentZoomFor(element);

      element.dataset.baseWidth = String(cssViewport.width);
      element.dataset.baseHeight = String(cssViewport.height);
      element.style.width = `${cssViewport.width * zoom}px`;
      element.style.height = `${cssViewport.height * zoom}px`;

      const fragment = pageTemplate.content.cloneNode(true);
      const pdfCanvas = fragment.querySelector('.pdf-canvas');
      const inkCanvas = fragment.querySelector('.ink-canvas');
      const badge = fragment.querySelector('.page-number');

      const pixelWidth = Math.max(1, Math.floor(cssViewport.width * outputScale));
      const pixelHeight = Math.max(1, Math.floor(cssViewport.height * outputScale));
      for (const canvas of [pdfCanvas, inkCanvas]) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
        canvas.style.width = `${cssViewport.width * zoom}px`;
        canvas.style.height = `${cssViewport.height * zoom}px`;
      }
      badge.textContent = String(pageNumber);

      element.replaceChildren(...fragment.childNodes);
      element.classList.remove('pdf-placeholder');

      await page.render({
        canvasContext: pdfCanvas.getContext('2d'),
        viewport: renderViewport,
      }).promise;

      if (destroyed || !generationIsCurrent()) {
        freeCanvas(pdfCanvas);
        freeCanvas(inkCanvas);
        return;
      }

      const strokes = await loadStrokes(documentId, pageNumber);
      redrawInk(inkCanvas, strokes);
      bindInkCanvas(inkCanvas, pageNumber, strokes, documentId);
      element.dataset.renderState = 'rendered';
      page.cleanup?.();
    } catch (error) {
      console.error(`Не удалось отрисовать страницу ${pageNumber}`, error);
      element.dataset.renderState = 'idle';
      element.classList.add('pdf-placeholder');
      element.replaceChildren(pageNumberBadge(pageNumber));
    }
  }

  async function init() {
    if (destroyed || !generationIsCurrent()) return;

    const firstPage = await pdf.getPage(1);
    if (destroyed || !generationIsCurrent()) return;
    const firstViewport = firstPage.getViewport({ scale: 1 });
    const maxCssWidth = Math.min(900, Math.max(280, window.innerWidth - 20));
    const cssScale = maxCssWidth / firstViewport.width;
    const firstCssViewport = firstPage.getViewport({ scale: cssScale });
    firstPage.cleanup?.();

    const fragment = document.createDocumentFragment();
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const element = makePlaceholder(pageNumber, firstCssViewport.width, firstCssViewport.height);
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
    setStatus(`${pdf.numPages} стр. · подгружаются по мере прокрутки`);
  }

  function destroy() {
    destroyed = true;
    observer?.disconnect();
    observer = null;
    placeholders.forEach(element => {
      freeCanvas(element.querySelector('.pdf-canvas'));
      freeCanvas(element.querySelector('.ink-canvas'));
    });
    pdf.cleanup?.();
  }

  return { init, destroy };
}
