import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ApiError, API_PATHS, createApiClient } from '../../assets/js/api-client.js';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

test('centralizes API routes and reads the project catalog and snapshot', async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/projects')) {
        return jsonResponse({ ok: true, projects: [{ id: 'pingte', modes: [] }] });
      }
      return jsonResponse({ ok: true, snapshot: { projectId: 'pingte', days: {} } });
    }
  });

  assert.equal(API_PATHS.projects(), '/api/projects');
  assert.equal(API_PATHS.snapshot('pingte'), '/api/projects/pingte/snapshot');
  assert.deepEqual(await client.getProjects(), [{ id: 'pingte', modes: [] }]);
  assert.deepEqual(await client.getSnapshot('pingte'), { projectId: 'pingte', days: {} });
  assert.deepEqual(calls.map(({ url }) => url), [
    '/api/projects',
    '/api/projects/pingte/snapshot'
  ]);
});

test('saves one project, date, and mode with the atomic replacement contract', async () => {
  let captured;
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      captured = { url, options };
      return jsonResponse({ ok: true, saved: 1 });
    }
  });
  const payload = {
    query: '07',
    entries: [{ name: '目录甲', content: '01 02', original: '目录甲: 01 02' }]
  };

  assert.deepEqual(
    await client.saveMode('pingte', '2026-07-27', 'pingteyixiao', payload),
    { ok: true, saved: 1 }
  );
  assert.equal(captured.url, '/api/projects/pingte/dates/2026-07-27/modes/pingteyixiao');
  assert.equal(captured.options.method, 'PUT');
  assert.equal(captured.options.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(captured.options.body), payload);
});

test('encodes directory paths and exposes server errors consistently', async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      if (options.method === 'PATCH') return jsonResponse({ ok: true, renamed: 2 });
      return jsonResponse({ ok: false, error: '目录已存在' }, 409);
    }
  });

  assert.deepEqual(
    await client.renameDirectory('pingte', 'pingteyixiao', '旧 名', '新名'),
    { ok: true, renamed: 2 }
  );
  assert.equal(calls[0].url, '/api/projects/pingte/directories/pingteyixiao/%E6%97%A7%20%E5%90%8D');
  assert.deepEqual(JSON.parse(calls[0].options.body), { newName: '新名' });

  await assert.rejects(
    () => client.deleteDirectory('pingte', 'pingteyixiao', '新名'),
    error => error instanceof ApiError && error.status === 409 && error.message === '目录已存在'
  );
});

test('covers health, date deletion, backup, export, and import management routes', async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true, database: 'ok' });
    }
  });

  await client.health();
  await client.deleteDate('jiuxiang', '2026-07-27');
  await client.createBackup();
  await client.exportData('jiuxiang');
  await client.exportData();
  await client.importData({ schemaVersion: 1, projects: [] }, 'replace');

  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['/api/health', 'GET'],
    ['/api/projects/jiuxiang/dates/2026-07-27', 'DELETE'],
    ['/api/backup', 'POST'],
    ['/api/projects/jiuxiang/export', 'GET'],
    ['/api/export', 'GET'],
    ['/api/import?strategy=replace', 'POST']
  ]);
});

test('maps connection failures, invalid JSON, and invalid response shapes', async () => {
  const disconnected = createApiClient({
    fetchImpl: async () => { throw new Error('offline'); }
  });
  await assert.rejects(
    () => disconnected.health(),
    error => error instanceof ApiError && error.status === 0 && error.message === '无法连接本地服务'
  );

  const invalidJson = createApiClient({
    fetchImpl: async () => new Response('not-json', { status: 200 })
  });
  await assert.rejects(() => invalidJson.health(), /无法识别的数据/);

  const invalidShape = createApiClient({
    fetchImpl: async () => jsonResponse({ ok: true })
  });
  await assert.rejects(() => invalidShape.getProjects(), /项目列表格式无效/);
  await assert.rejects(() => invalidShape.getSnapshot('pingte'), /项目数据格式无效/);
});

test('uses project-scoped batch and single-day directory routes', async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return jsonResponse({ ok: true });
    }
  });
  const payload = {
    name: '目录甲',
    rows: [{ date: '2026-07-27', query: '07', content: '鼠', original: null }]
  };
  await client.saveBatch('pingte', 'pingteyixiao', payload);
  await client.deleteEntry('pingte', '2026-07-27', 'pingteyixiao', '目录 甲');
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['/api/projects/pingte/modes/pingteyixiao/batch', 'POST'],
    ['/api/projects/pingte/dates/2026-07-27/modes/pingteyixiao/directories/%E7%9B%AE%E5%BD%95%20%E7%94%B2', 'DELETE']
  ]);
});
