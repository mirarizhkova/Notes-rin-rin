export const NOTEBOOK_PAGE_RATIO = 1.4142;

export function notebookPageMetrics(viewportWidth, { minWidth = 280, maxWidth = 900, sidePadding = 20 } = {}) {
  const width = Math.min(maxWidth, Math.max(minWidth, viewportWidth - sidePadding));
  return { width, height: width * NOTEBOOK_PAGE_RATIO };
}

export function canvasRenderMetrics(cssWidth, cssHeight, devicePixelRatio = 1, renderLimit = 2) {
  const outputScale = Math.min(devicePixelRatio || 1, renderLimit);
  return {
    outputScale,
    pixelWidth: Math.max(1, Math.floor(cssWidth * outputScale)),
    pixelHeight: Math.max(1, Math.floor(cssHeight * outputScale)),
  };
}
