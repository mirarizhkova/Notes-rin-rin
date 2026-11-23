function newestByKey(localRows, remoteRows, getKey, getTime) {
  const merged = new Map();
  for (const item of remoteRows ?? []) {
    const key = getKey(item);
    if (typeof key === 'string' && key) merged.set(key, item);
  }
  for (const item of localRows ?? []) {
    const key = getKey(item);
    if (typeof key !== 'string' || !key) continue;
    const previous = merged.get(key);
    if (!previous || getTime(item) >= getTime(previous)) merged.set(key, item);
  }
  return [...merged.values()];
}

function documentTime(item) {
  return Number(item.updatedAt ?? item.savedAt ?? item.createdAt ?? 0) || 0;
}

function strokeTime(item) {
  return Number(item.savedAt ?? 0) || 0;
}

// Keeps documents that exist on only one device. For conflicting IDs,
// the last saved document or stroke wins; local wins when timestamps tie.
// Deletions are intentionally not propagated in this first version.
export function mergeLibraries(local, remote) {
  return {
    documents: newestByKey(
      local.documents, remote?.documents,
      item => item.id, documentTime,
    ),
    strokes: newestByKey(
      local.strokes, remote?.strokes,
      item => item.key, strokeTime,
    ),
  };
}
