import { createReadStream, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';

import { AppError, ValidationError } from './errors.js';
import { buildPlatformRankingResults } from './long-term-stats.js';

const MAX_JSON_BYTES = 128 * 1024 * 1024;
const SECURITY_HEADERS = {
  'content-security-policy': "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'",
  'cross-origin-resource-policy': 'same-origin',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY'
};
const MIME_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'],
  ['.woff2', 'font/woff2']
]);

const SNAPSHOT_SCHEMA_VERSION = 'local-snapshot-v2';

function sendJson(response, status, data, extraHeaders = {}) {
  const body = JSON.stringify(data);
  response.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    ...extraHeaders
  });
  response.end(body);
}

function sendSnapshot(request, response, store, projectId, searchParams) {
  const modes = (searchParams.get('modes') || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  const from = searchParams.get('from') || '';
  const to = searchParams.get('to') || '';
  const includeMetadata = searchParams.get('includeMetadata') === '1';
  // 先做参数校验再判 304：否则带 If-None-Match 的非法请求会返回 304 而不是约定的 400。
  store.validateSnapshotOptions(projectId, { from, to, modes });
  const dataVersion = store.getSnapshotDataVersion(projectId);
  const etagSource = [
    SNAPSHOT_SCHEMA_VERSION,
    projectId,
    dataVersion,
    from,
    to,
    [...modes].sort().join(','),
    includeMetadata ? 'meta' : 'plain'
  ].join('|');
  const etag = `"${createHash('sha256').update(etagSource).digest('hex')}"`;
  const headers = {
    ...SECURITY_HEADERS,
    etag,
    'cache-control': 'private, max-age=0, must-revalidate',
    vary: 'origin, if-none-match'
  };
  if (request.headers['if-none-match'] === etag) {
    response.writeHead(304, headers);
    response.end();
    return;
  }
  const snapshot = store.getSnapshot(projectId, { from, to, modes, includeMetadata });
  const payload = {
    ok: true,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    dataVersion,
    snapshot
  };
  sendJson(response, 200, payload, headers);
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ValidationError('URL 编码无效');
  }
}

function readJson(request, maxJsonBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let tooLarge = false;
    request.on('data', chunk => {
      if (tooLarge) return;
      bytes += chunk.length;
      if (bytes > maxJsonBytes) {
        tooLarge = true;
        chunks.length = 0;
        reject(new AppError('请求内容过大', 413, 'PAYLOAD_TOO_LARGE'));
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ValidationError('JSON 格式无效'));
      }
    });
    request.on('error', reject);
  });
}

function requireMethod(request, expected) {
  if (request.method !== expected) {
    throw new AppError(`此接口只允许 ${expected}`, 405, 'METHOD_NOT_ALLOWED');
  }
}

function isSameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  const expected = `http://127.0.0.1:${request.socket.localPort}`;
  return origin === expected || (origin === 'null' && request.method === 'GET');
}

function serveStatic(request, response, staticDir, pathname) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    throw new AppError('静态资源只允许 GET 或 HEAD', 405, 'METHOD_NOT_ALLOWED');
  }
  const relativeName = pathname === '/'
    ? '统一分析平台.html'
    : decode(pathname.replace(/^\/+/, ''));
  const filePath = path.resolve(staticDir, relativeName);
  const relative = path.relative(staticDir, filePath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep).some(part => part.startsWith('.'))) {
    throw new AppError('文件不存在', 404, 'NOT_FOUND');
  }
  let stat;
  try {
    stat = statSync(filePath);
  } catch {
    throw new AppError('文件不存在', 404, 'NOT_FOUND');
  }
  if (!stat.isFile()) throw new AppError('文件不存在', 404, 'NOT_FOUND');
  response.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME_TYPES.get(path.extname(filePath).toLowerCase()) || 'application/octet-stream',
    'content-length': stat.size,
    'cache-control': 'no-store'
  });
  if (request.method === 'HEAD') response.end();
  else createReadStream(filePath).pipe(response);
}

async function routeApi(request, response, store, pathname, searchParams, maxJsonBytes) {
  if (!isSameOrigin(request)) throw new AppError('只允许同源访问', 403, 'FORBIDDEN_ORIGIN');
  if (request.headers.origin === 'null' && request.method === 'GET') {
    response.setHeader('access-control-allow-origin', 'null');
    response.setHeader('vary', 'origin');
  }

  if (pathname === '/api/health') {
    requireMethod(request, 'GET');
    const healthy = store.health();
    return sendJson(response, healthy ? 200 : 503, { ok: healthy, database: healthy ? 'ok' : 'error' });
  }
  if (pathname === '/api/projects') {
    requireMethod(request, 'GET');
    return sendJson(response, 200, { ok: true, projects: store.listProjects() });
  }
  if (pathname === '/api/long-term-stats') {
    requireMethod(request, 'GET');
    return sendJson(response, 200, { ok: true, ...buildPlatformRankingResults(store) });
  }
  if (pathname === '/api/export') {
    requireMethod(request, 'GET');
    return sendJson(response, 200, store.exportData());
  }
  if (pathname === '/api/import') {
    requireMethod(request, 'POST');
    const payload = await readJson(request, maxJsonBytes);
    const result = store.importData(payload, { strategy: searchParams.get('strategy') || 'merge' });
    return sendJson(response, 200, { ok: true, ...result });
  }
  if (pathname === '/api/backup') {
    requireMethod(request, 'POST');
    await readJson(request, maxJsonBytes);
    const result = await store.createBackup();
    return sendJson(response, 201, { ok: true, ...result });
  }

  let match = pathname.match(/^\/api\/projects\/([^/]+)\/snapshot$/);
  if (match) {
    requireMethod(request, 'GET');
    return sendSnapshot(request, response, store, decode(match[1]), searchParams);
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/export$/);
  if (match) {
    requireMethod(request, 'GET');
    return sendJson(response, 200, store.exportData(decode(match[1])));
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/dates\/([^/]+)\/modes\/([^/]+)$/);
  if (match) {
    requireMethod(request, 'PUT');
    const payload = await readJson(request, maxJsonBytes);
    const result = store.replaceMode(decode(match[1]), decode(match[2]), decode(match[3]), payload);
    return sendJson(response, 200, { ok: true, ...result });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/modes\/([^/]+)\/dates\/([^/]+)$/);
  if (match) {
    requireMethod(request, 'PUT');
    const payload = await readJson(request, maxJsonBytes);
    const result = store.replaceMode(decode(match[1]), decode(match[3]), decode(match[2]), payload);
    return sendJson(response, 200, { ok: true, ...result });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/modes\/([^/]+)\/batch$/);
  if (match) {
    requireMethod(request, 'POST');
    const payload = await readJson(request, maxJsonBytes);
    const result = store.upsertDirectoryBatch(decode(match[1]), decode(match[2]), payload);
    return sendJson(response, 200, { ok: true, ...result });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/dates\/([^/]+)\/modes\/([^/]+)\/directories\/([^/]+)$/);
  if (match) {
    requireMethod(request, 'DELETE');
    const result = store.deleteEntry(decode(match[1]), decode(match[2]), decode(match[3]), decode(match[4]));
    return sendJson(response, 200, { ok: true, ...result });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/modes\/([^/]+)\/dates\/([^/]+)\/directories\/([^/]+)$/);
  if (match) {
    requireMethod(request, 'DELETE');
    const result = store.deleteEntry(decode(match[1]), decode(match[3]), decode(match[2]), decode(match[4]));
    return sendJson(response, 200, { ok: true, ...result });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/dates\/([^/]+)$/);
  if (match) {
    requireMethod(request, 'DELETE');
    const result = store.deleteDate(decode(match[1]), decode(match[2]));
    return sendJson(response, 200, { ok: true, ...result });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/directories\/([^/]+)\/([^/]+)$/);
  if (match) {
    const projectId = decode(match[1]);
    const modeId = decode(match[2]);
    const name = decode(match[3]);
    if (request.method === 'DELETE') {
      return sendJson(response, 200, { ok: true, ...store.deleteDirectory(projectId, modeId, name) });
    }
    requireMethod(request, 'PATCH');
    const payload = await readJson(request, maxJsonBytes);
    return sendJson(response, 200, {
      ok: true,
      ...store.renameDirectory(projectId, modeId, name, payload.newName)
    });
  }
  match = pathname.match(/^\/api\/projects\/([^/]+)\/modes\/([^/]+)\/directories\/([^/]+)$/);
  if (match) {
    const projectId = decode(match[1]);
    const modeId = decode(match[2]);
    const name = decode(match[3]);
    if (request.method === 'DELETE') {
      return sendJson(response, 200, { ok: true, ...store.deleteDirectory(projectId, modeId, name) });
    }
    requireMethod(request, 'PATCH');
    const payload = await readJson(request, maxJsonBytes);
    return sendJson(response, 200, {
      ok: true,
      ...store.renameDirectory(projectId, modeId, name, payload.newName)
    });
  }
  throw new AppError('接口不存在', 404, 'NOT_FOUND');
}

export function createLocalServer({ store, staticDir, maxJsonBytes = MAX_JSON_BYTES }) {
  if (!store) throw new ValidationError('store 不能为空');
  if (!staticDir) throw new ValidationError('staticDir 不能为空');
  if (!Number.isSafeInteger(maxJsonBytes) || maxJsonBytes < 1) {
    throw new ValidationError('maxJsonBytes 必须是正整数');
  }
  const resolvedStaticDir = path.resolve(staticDir);
  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname.startsWith('/api/')) {
        await routeApi(request, response, store, url.pathname, url.searchParams, maxJsonBytes);
      } else {
        serveStatic(request, response, resolvedStaticDir, url.pathname);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      const status = Number.isInteger(error?.status) ? error.status : 500;
      const message = status >= 500 ? '本地服务内部错误' : (error?.message || '请求失败');
      sendJson(response, status, {
        ok: false,
        error: message,
        code: error?.code || 'INTERNAL_ERROR'
      });
    }
  });
}
