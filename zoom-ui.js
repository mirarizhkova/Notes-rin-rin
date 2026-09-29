import { clampZoom, shouldSuppressClick, touchDistance, touchMidpoint, zoomFromPinch } from './zoom-core.js';

const viewer = document.querySelector('#viewer');
const homeButton = document.querySelector('#home-button');

let zoom = 1;
let pinching = false;
let startDistance = 0;
let startZoom = 1;
let anchor = null;
let pinchEndedAt = 0;

function pageElements() {
  return [...viewer.querySelectorAll('.pdf-page')];
}

function rememberBaseSize(page) {
  if (!page.dataset.baseWidth) page.dataset.baseWidth = String(parseFloat(page.style.width) || page.getBoundingClientRect().width);
  if (!page.dataset.baseHeight) page.dataset.baseHeight = String(parseFloat(page.style.height) || page.getBoundingClientRect().height);

  const pdfCanvas = page.querySelector('.pdf-canvas');
  const inkCanvas = page.querySelector('.ink-canvas');
  for (const canvas of [pdfCanvas, inkCanvas]) {
    if (!canvas) continue;
    if (!canvas.dataset.baseWidth) canvas.dataset.baseWidth = String(parseFloat(canvas.style.width) || canvas.getBoundingClientRect().width);
    if (!canvas.dataset.baseHeight) canvas.dataset.baseHeight = String(parseFloat(canvas.style.height) || canvas.getBoundingClientRect().height);
  }
}

function applyZoom(nextZoom, keepAnchor = true) {
  const next = clampZoom(nextZoom);
  const rectBefore = viewer.getBoundingClientRect();
  const viewerTopDocument = rectBefore.top + window.scrollY;

  for (const page of pageElements()) {
    rememberBaseSize(page);
    const baseWidth = Number(page.dataset.baseWidth);
    const baseHeight = Number(page.dataset.baseHeight);
    page.style.width = `${baseWidth * next}px`;
    page.style.height = `${baseHeight * next}px`;

    for (const canvas of page.querySelectorAll('.pdf-canvas, .ink-canvas')) {
      const canvasBaseWidth = Number(canvas.dataset.baseWidth);
      const canvasBaseHeight = Number(canvas.dataset.baseHeight);
      canvas.style.width = `${canvasBaseWidth * next}px`;
      canvas.style.height = `${canvasBaseHeight * next}px`;
    }
  }

  zoom = next;

  if (keepAnchor && anchor) {
    viewer.scrollLeft = Math.max(0, anchor.contentX * zoom - anchor.localX);
    const targetY = viewerTopDocument + anchor.contentY * zoom - anchor.clientY;
    window.scrollTo({ top: Math.max(0, targetY), behavior: 'auto' });
  }
}

function resetZoom() {
  anchor = null;
  applyZoom(1, false);
  viewer.scrollLeft = 0;
}

function startPinch(event) {
  if (viewer.hidden || event.touches.length !== 2) return;
  const [a, b] = event.touches;
  const rect = viewer.getBoundingClientRect();
  const midpoint = touchMidpoint(a, b);

  startDistance = touchDistance(a, b);
  startZoom = zoom;
  pinching = startDistance > 0;
  if (!pinching) return;

  const localX = midpoint.x - rect.left;
  const viewerTopDocument = rect.top + window.scrollY;
  anchor = {
    localX,
    clientY: midpoint.y,
    contentX: (viewer.scrollLeft + localX) / zoom,
    contentY: (window.scrollY + midpoint.y - viewerTopDocument) / zoom,
  };
  event.preventDefault();
}

function movePinch(event) {
  if (!pinching || event.touches.length !== 2) return;
  const [a, b] = event.touches;
  event.preventDefault();
  applyZoom(zoomFromPinch(startZoom, startDistance, touchDistance(a, b)));
}

function finishPinch(event) {
  if (!pinching) return;
  if (event.touches.length >= 2) return;
  event.preventDefault();
  pinching = false;
  startDistance = 0;
  startZoom = zoom;
  anchor = null;
  pinchEndedAt = performance.now();
}

viewer.addEventListener('touchstart', startPinch, { passive: false });
viewer.addEventListener('touchmove', movePinch, { passive: false });
viewer.addEventListener('touchend', finishPinch, { passive: false });
viewer.addEventListener('touchcancel', finishPinch, { passive: false });

for (const eventName of ['gesturestart', 'gesturechange', 'gestureend']) {
  viewer.addEventListener(eventName, event => {
    if (!viewer.hidden) event.preventDefault();
  }, { passive: false });
}

document.addEventListener('click', event => {
  if (!shouldSuppressClick(pinchEndedAt, performance.now())) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}, true);

homeButton?.addEventListener('click', resetZoom);

const observer = new MutationObserver(mutations => {
  const documentReplaced = mutations.some(mutation => mutation.type === 'childList' && mutation.removedNodes.length > 0);
  if (documentReplaced && !pinching) {
    zoom = 1;
    anchor = null;
  }
});
observer.observe(viewer, { childList: true });
