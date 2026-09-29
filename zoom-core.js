export const MIN_ZOOM = 1;
export const MAX_ZOOM = 3;

export function clampZoom(value, min = MIN_ZOOM, max = MAX_ZOOM) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function touchDistance(a, b) {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

export function touchMidpoint(a, b) {
  return {
    x: (a.clientX + b.clientX) / 2,
    y: (a.clientY + b.clientY) / 2,
  };
}

export function zoomFromPinch(startZoom, startDistance, currentDistance) {
  if (!(startDistance > 0)) return clampZoom(startZoom);
  return clampZoom(startZoom * (currentDistance / startDistance));
}
