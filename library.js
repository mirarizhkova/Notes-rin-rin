const BACKUP_VERSION = 1;

export function normalizeDocumentRecord(record) {
  return {
    ...record,
    type: record?.type === 'notebook' ? 'notebook' : 'pdf',
    pageCount: Number.isInteger(record?.pageCount) && record.pageCount > 0 ? record.pageCount : null,
  };
}

export function createNotebookRecord(name, id, now = Date.now()) {
  return {
    id,
    name,
    type: 'notebook',
    pageCount: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export function addNotebookPage(record, now = Date.now()) {
  const normalized = normalizeDocumentRecord(record);
  if (normalized.type !== 'notebook') throw new Error('Document is not a notebook');
  return {
    ...normalized,
    pageCount: (normalized.pageCount ?? 1) + 1,
    updatedAt: now,
  };
}

function arrayBufferToBase64(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export function serializeBackup(documents, strokes, exportedAt = Date.now()) {
  const payload = {
    version: BACKUP_VERSION,
    exportedAt,
    documents: documents.map(raw => {
      const record = normalizeDocumentRecord(raw);
      if (record.type !== 'pdf') return { ...record };
      const { data, ...rest } = record;
      return {
        ...rest,
        dataBase64: data ? arrayBufferToBase64(data) : '',
      };
    }),
    strokes,
  };
  return JSON.stringify(payload);
}

export function deserializeBackup(text) {
  const payload = JSON.parse(text);
  if (payload?.version !== BACKUP_VERSION) throw new Error('Unsupported backup version');
  if (!Array.isArray(payload.documents) || !Array.isArray(payload.strokes)) {
    throw new Error('Invalid backup structure');
  }

  return {
    version: payload.version,
    exportedAt: payload.exportedAt ?? null,
    documents: payload.documents.map(raw => {
      const record = normalizeDocumentRecord(raw);
      if (record.type !== 'pdf') {
        const { dataBase64, ...rest } = record;
        return rest;
      }
      const { dataBase64, ...rest } = record;
      return {
        ...rest,
        data: base64ToArrayBuffer(dataBase64 || ''),
      };
    }),
    strokes: payload.strokes,
  };
}
