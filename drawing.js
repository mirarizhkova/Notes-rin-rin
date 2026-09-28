export function clientPointToCanvas(eventLike, rect, canvas) {
  return {
    x: ((eventLike.clientX - rect.left) / rect.width) * canvas.width,
    y: ((eventLike.clientY - rect.top) / rect.height) * canvas.height,
  };
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - a.x, point.y - a.y);

  const t = Math.max(0, Math.min(1,
    ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)
  ));
  const x = a.x + t * dx;
  const y = a.y + t * dy;
  return Math.hypot(point.x - x, point.y - y);
}

export function strokeHitsPoint(stroke, point, radius) {
  const points = stroke?.points ?? [];
  if (points.length === 0) return false;
  if (points.length === 1) {
    return Math.hypot(point.x - points[0].x, point.y - points[0].y) <= radius;
  }

  for (let i = 1; i < points.length; i += 1) {
    if (distanceToSegment(point, points[i - 1], points[i]) <= radius) return true;
  }
  return false;
}
