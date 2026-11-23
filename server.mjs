import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes, createHmac, createHash, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';

const root = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 8080);
const LIMIT = 100 * 1024 * 1024; // Backups include PDFs encoded as base64.
const KEY = 'backups/library-v1.json';
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const COOKIE = 'rinrin_session';
const configured = Boolean(
  process.env.S3_BUCKET &&
  process.env.S3_ACCESS_KEY_ID &&
  process.env.S3_SECRET_ACCESS_KEY &&
  process.env.NOTES_PASSWORD &&
  process.env.SESSION_SECRET &&
  process.env.SESSION_SECRET.length >= 32
);

const s3 = configured ? new S3Client({
  endpoint: process.env.S3_ENDPOINT || 'https://s3.cloud.ru',
  region: process.env.S3_REGION || 'ru-central-1',
  forcePathStyle: true,
  credentials: {
    accessKeyId: process.env.S3_ACCESS_KEY_ID,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
  },
}) : null;

const publicFiles = new Set([
  'index.html', 'app.js', 'library.js', 'cloud-sync.js',
  'drawing.js', 'pdf-compat.js', 'pdf-lazy.js',
  'notebook-lazy.js', 'notebook-lazy-core.js',
  'zoom-core.js', 'zoom-ui.js',
  'styles.css', 'zoom.css', 'manifest.webmanifest',
  'icon-180.png', 'icon-192.png',
  '86F107EC-293E-4C5C-B552-6B02D8828A98.jpeg',
]);

function sendJSON(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}

function getCookie(req, name) {
  const entries = (req.headers.cookie || '').split(';');
  const pair = entries.map(item => item.trim()).find(item => item.startsWith(name + '='));
  return pair ? pair.slice(name.length + 1) : '';
}

function sign(value) {
  return createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('base64url');
}

function authenticated(req) {
  if (!configured) return false;
  const [exp, signature, extra] = getCookie(req, COOKIE).split('.');
  if (!exp || !signature || extra || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const expected = Buffer.from(sign(exp), 'utf8');
  const actual = Buffer.from(signature, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function samePassword(candidate) {
  const digest = value => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(candidate), digest(process.env.NOTES_PASSWORD));
}

function sessionCookie(value, maxAge) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Strict' +
    secure + '; Max-Age=' + maxAge;
}

async function readBody(req, limit) {
  const length = Number(req.headers['content-length'] ?? 0);
  if (length > limit) throw Object.assign(new Error('Размер превышает ограничение'), { status: 413 });
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Размер превышает ограничение'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // Non-browser clients have no Origin header.
  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

function errorIsMissing(error) {
  return error?.name === 'NoSuchKey' ||
    error?.name === 'NotFound' ||
    error?.$metadata?.httpStatusCode === 404;
}

const loginAttempts = new Map();
const WINDOW = 15 * 60 * 1000;

async function api(req, res, path) {
  if (req.method !== 'GET' && !sameOrigin(req)) {
    return sendJSON(res, 403, { error: 'Недопустимый источник запроса' });
  }

  if (path === '/api/cloud/status' && req.method === 'GET') {
    return sendJSON(res, 200, { configured, authenticated: authenticated(req) });
  }

  if (!configured) return sendJSON(res, 503, { error: 'Облачное хранилище ещё не настроено' });

  if (path === '/api/cloud/login' && req.method === 'POST') {
    const address = req.socket.remoteAddress || 'unknown';
    const state = loginAttempts.get(address) || { count: 0, until: Date.now() + WINDOW };
    if (Date.now() > state.until) { state.count = 0; state.until = Date.now() + WINDOW; }
    if (state.count >= 10) return sendJSON(res, 429, { error: 'Слишком много попыток. Попробуй позже' });

    const content = await readBody(req, 4096);
    let password;
    try { password = JSON.parse(content.toString('utf8')).password; } catch { password = null; }
    if (typeof password !== 'string' || !samePassword(password)) {
      state.count += 1;
      loginAttempts.set(address, state);
      return sendJSON(res, 401, { error: 'Неверный пароль' });
    }
    loginAttempts.delete(address);
    const exp = String(Date.now() + SESSION_TTL);
    res.setHeader('Set-Cookie', sessionCookie(exp + '.' + sign(exp), SESSION_TTL / 1000));
    return sendJSON(res, 200, { ok: true });
  }

  if (path === '/api/cloud/logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', sessionCookie('', 0));
    return sendJSON(res, 200, { ok: true });
  }

  if (!authenticated(req)) return sendJSON(res, 401, { error: 'Нужно войти в облачное хранилище' });

  if (path === '/api/cloud/backup' && req.method === 'GET') {
    try {
      const result = await s3.send(new GetObjectCommand({
        Bucket: process.env.S3_BUCKET,
        Key: KEY,
      }));
      if (result.ContentLength > LIMIT) return sendJSON(res, 413, { error: 'Облачная копия слишком большая' });
      const bytes = Buffer.from(await result.Body.transformToByteArray());
      if (bytes.length > LIMIT) return sendJSON(res, 413, { error: 'Облачная копия слишком большая' });
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      });
      return res.end(bytes);
    } catch (error) {
      if (errorIsMissing(error)) return sendJSON(res, 404, { error: 'Облачная копия ещё не создана' });
      throw error;
    }
  }

  if (path === '/api/cloud/backup' && req.method === 'PUT') {
    const bytes = await readBody(req, LIMIT);
    let backup;
    try { backup = JSON.parse(bytes.toString('utf8')); } catch {
      return sendJSON(res, 400, { error: 'Неверный формат JSON' });
    }
    if (backup?.version !== 1 ||
        !Array.isArray(backup.documents) ||
        !Array.isArray(backup.strokes)) {
      return sendJSON(res, 400, { error: 'Неверный формат резервной копии' });
    }
    await s3.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET,
      Key: KEY,
      Body: bytes,
      ContentType: 'application/json; charset=utf-8',
    }));
    return sendJSON(res, 200, { ok: true });
  }

  return sendJSON(res, 404, { error: 'Неизвестный запрос' });
}

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
};

async function staticFile(req, res, path) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { error: 'Метод не поддерживается' });
  }
  const name = path === '/' ? 'index.html' : path.slice(1);
  if (!publicFiles.has(name)) return sendJSON(res, 404, { error: 'Файл не найден' });
  const fullPath = join(root, name);
  const info = await stat(fullPath);
  const extension = name.slice(name.lastIndexOf('.'));
  res.writeHead(200, {
    'Content-Type': mime[extension] || 'application/octet-stream',
    'Content-Length': info.size,
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-cache',
  });
  if (req.method === 'HEAD') return res.end();
  createReadStream(fullPath).pipe(res);
}

const server = http.createServer(async (req, res) => {
  try {
    const path = new URL(req.url, 'http://localhost').pathname;
    if (path.startsWith('/api/')) await api(req, res, path);
    else await staticFile(req, res, path);
  } catch (error) {
    console.error('Request failed:', error?.message);
    if (!res.headersSent) {
      sendJSON(res, error?.status || 500, { error: error?.status ? error.message : 'Ошибка сервера' });
    } else res.destroy();
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('Notes RinRin listening on port ' + PORT +
    (configured ? ' with Cloud.ru storage' : ' in local-only mode'));
});
