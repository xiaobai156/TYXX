import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { test } from 'node:test';

import { createLocalServer } from '../../server/app.js';
import { openLotteryDatabase } from '../../server/database.js';
import { createTestPaths, jsonRequest } from './helpers.js';

async function startTestServer(t, serverOptions = {}) {
  const paths = createTestPaths(t);
  mkdirSync(paths.staticDir, { recursive: true });
  writeFileSync(`${paths.staticDir}/统一分析平台.html`, '<!doctype html><title>统一分析平台</title>');
  writeFileSync(`${paths.staticDir}/app.js`, 'window.ready = true;');
  mkdirSync(`${paths.staticDir}/assets`);
  const store = openLotteryDatabase(paths);
  const server = createLocalServer({ store, staticDir: paths.staticDir, ...serverOptions });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    paths.cleanup();
  });
  return { baseUrl, paths };
}

test('serves the unified HTML and static assets without exposing files outside the static root', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const index = await fetch(`${baseUrl}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  assert.match(index.headers.get('content-security-policy'), /default-src 'self'/);
  assert.equal(index.headers.get('x-frame-options'), 'DENY');
  assert.equal(index.headers.get('cache-control'), 'no-store');
  assert.match(await index.text(), /统一分析平台/);

  const script = await fetch(`${baseUrl}/app.js`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get('content-type'), /javascript/);
  assert.equal(script.headers.get('cache-control'), 'no-store');

  const traversal = await fetch(`${baseUrl}/%2e%2e/package.json`);
  assert.equal(traversal.status, 404);

  const hiddenPath = await fetch(`${baseUrl}/.hidden`);
  assert.equal(hiddenPath.status, 404);

  const head = await fetch(`${baseUrl}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const directory = await fetch(`${baseUrl}/assets`);
  assert.equal(directory.status, 404);

  const badMethod = await fetch(`${baseUrl}/app.js`, { method: 'POST' });
  assert.equal(badMethod.status, 405);

  const badEncoding = await fetch(`${baseUrl}/%ZZ`);
  assert.equal(badEncoding.status, 400);
});

test('provides health, project catalog, atomic save, and project snapshot APIs', async (t) => {
  const { baseUrl } = await startTestServer(t);
  let result = await jsonRequest(baseUrl, '/api/health');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true, database: 'ok' });

  result = await jsonRequest(baseUrl, '/api/projects');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.projects.map(project => project.modes.length), [3, 4, 10]);

  result = await jsonRequest(baseUrl, '/api/projects/pingte/dates/2026-07-27/modes/pingteyixiao', {
    method: 'PUT',
    headers: { origin: baseUrl },
    body: JSON.stringify({ query: '07', entries: [{ name: '目录甲', content: '01' }] })
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true, saved: 1 });

  result = await jsonRequest(baseUrl, '/api/projects/pingte/snapshot');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.snapshot.days['2026-07-27'].pingteyixiao.entries[0].content, '01');

  result = await jsonRequest(baseUrl, '/api/projects/pingte/modes/pingtewei/dates/2026-07-27', {
    method: 'PUT',
    headers: { origin: baseUrl },
    body: JSON.stringify({ query: '8', entries: [] })
  });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.saved, 0);
});

test('allows file pages to read local snapshots but never to write', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const read = await fetch(`${baseUrl}/api/projects/dawei_shahao/snapshot`, {
    headers: { origin: 'null' }
  });
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('access-control-allow-origin'), 'null');

  const write = await fetch(`${baseUrl}/api/projects/dawei_shahao/dates/2026-07-28/modes/dawei`, {
    method: 'PUT',
    headers: { origin: 'null', 'content-type': 'application/json' },
    body: JSON.stringify({ query: '01', entries: [] })
  });
  assert.equal(write.status, 403);
});

test('filters snapshots by date and mode, exposes versions, and honors ETag', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const origin = { origin: baseUrl };
  for (const date of ['2026-07-25', '2026-07-26', '2026-07-27']) {
    await jsonRequest(baseUrl, `/api/projects/dawei_shahao/dates/${date}/modes/dawei`, {
      method: 'PUT', headers: origin,
      body: JSON.stringify({ query: date, entries: [{ name: '目录甲', content: date }] })
    });
    await jsonRequest(baseUrl, `/api/projects/dawei_shahao/dates/${date}/modes/shengxiao`, {
      method: 'PUT', headers: origin,
      body: JSON.stringify({ query: date, entries: [{ name: '目录乙', content: '鼠' }] })
    });
  }

  const url = `${baseUrl}/api/projects/dawei_shahao/snapshot?from=2026-07-26&to=2026-07-27&modes=dawei`;
  const response = await fetch(url);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, max-age=0, must-revalidate');
  const etag = response.headers.get('etag');
  assert.match(etag, /^"[a-f0-9]{64}"$/);
  const body = await response.json();
  assert.equal(body.schemaVersion, 'local-snapshot-v2');
  assert.match(body.dataVersion, /^db-v1:/);
  assert.deepEqual(Object.keys(body.snapshot.days), ['2026-07-26', '2026-07-27']);
  assert.deepEqual(Object.keys(body.snapshot.days['2026-07-26']), ['dawei']);
  const entry = body.snapshot.days['2026-07-26'].dawei.entries[0];
  assert.equal(typeof entry.content, 'string');
  assert.equal(entry.created_at, undefined);
  assert.equal(entry.content_hash, undefined);

  const withMetadata = await fetch(`${url}&includeMetadata=1`);
  assert.equal(withMetadata.status, 200);
  const metaEntry = (await withMetadata.json()).snapshot.days['2026-07-26'].dawei.entries[0];
  assert.match(metaEntry.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(metaEntry.updated_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.match(metaEntry.content_hash, /^[a-f0-9]{64}$/);
  assert.equal(metaEntry.version, metaEntry.updated_at);

  const notModified = await fetch(url, { headers: { 'if-none-match': etag } });
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), '');

  assert.equal((await fetch(`${baseUrl}/api/projects/dawei_shahao/snapshot?from=bad`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/projects/dawei_shahao/snapshot?from=2026-07-27&to=2026-07-26`)).status, 400);
  assert.equal((await fetch(`${baseUrl}/api/projects/dawei_shahao/snapshot?modes=missing`)).status, 400);

  // 非法参数即便带着匹配的 If-None-Match 也必须返回 400，不能被 304 短路。
  for (const badQuery of ['from=bad', 'from=2026-07-27&to=2026-07-26', 'modes=missing']) {
    const badUrl = `${baseUrl}/api/projects/dawei_shahao/snapshot?${badQuery}`;
    const guarded = await fetch(badUrl, { headers: { 'if-none-match': etag } });
    assert.equal(guarded.status, 400, `${badQuery} 带 If-None-Match 时应仍为 400`);
  }
});

test('bumps the snapshot version on every write so stale ETags never win', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const origin = { origin: baseUrl };
  const date = '2026-07-28';
  const url = `${baseUrl}/api/projects/pingte/snapshot`;
  const save = content => jsonRequest(baseUrl, `/api/projects/pingte/dates/${date}/modes/pingteyixiao`, {
    method: 'PUT', headers: origin,
    body: JSON.stringify({ query: '鼠', entries: [{ name: '目录甲', content }] })
  });

  const versions = new Set();
  let previousEtag = null;
  for (const content of ['鼠', '牛', '虎', '兔']) {
    await save(content);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    const etag = response.headers.get('etag');
    assert.notEqual(etag, previousEtag, '内容变化后 ETag 必须变化');
    // 用上一轮 ETag 请求必须拿到 200 和新内容，不能是 304。
    if (previousEtag) {
      const stale = await fetch(url, { headers: { 'if-none-match': previousEtag } });
      assert.equal(stale.status, 200);
      const body = await stale.json();
      assert.equal(body.snapshot.days[date].pingteyixiao.entries[0].content, content);
    }
    versions.add((await response.json()).dataVersion);
    previousEtag = etag;
  }
  assert.equal(versions.size, 4, '每次写入都必须产生新的 dataVersion');
});

test('gives different projects different ETags for identical-looking snapshots', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const etagOf = async projectId => (
    await fetch(`${baseUrl}/api/projects/${projectId}/snapshot`)
  ).headers.get('etag');
  const etags = new Set([await etagOf('pingte'), await etagOf('dawei_shahao'), await etagOf('jiuxiang')]);
  assert.equal(etags.size, 3, '不同项目不能共用 ETag');
});

test('provides directory rename/delete and date deletion APIs', async (t) => {
  const { baseUrl } = await startTestServer(t);
  const origin = { origin: baseUrl };
  for (const date of ['2026-07-26', '2026-07-27']) {
    const saved = await jsonRequest(baseUrl, `/api/projects/pingte/dates/${date}/modes/pingteyixiao`, {
      method: 'PUT', headers: origin,
      body: JSON.stringify({ entries: [{ name: '旧名', content: date }] })
    });
    assert.equal(saved.response.status, 200);
  }

  let result = await jsonRequest(baseUrl, '/api/projects/pingte/directories/pingteyixiao/%E6%97%A7%E5%90%8D', {
    method: 'PATCH', headers: origin, body: JSON.stringify({ newName: '新名' })
  });
  assert.equal(result.body.renamed, 2);

  result = await jsonRequest(baseUrl, '/api/projects/pingte/directories/pingteyixiao/%E6%96%B0%E5%90%8D', {
    method: 'DELETE', headers: origin
  });
  assert.equal(result.body.deleted, 2);

  result = await jsonRequest(baseUrl, '/api/projects/pingte/modes/pingteyixiao/directories/%E4%B8%8D%E5%AD%98%E5%9C%A8', {
    method: 'DELETE', headers: origin
  });
  assert.equal(result.body.deleted, 0);

  result = await jsonRequest(
    baseUrl,
    '/api/projects/pingte/modes/pingteyixiao/dates/2026-07-27/directories/%E4%B8%8D%E5%AD%98%E5%9C%A8',
    { method: 'DELETE', headers: origin }
  );
  assert.deepEqual(result.body, { ok: true, deleted: false });

  result = await jsonRequest(baseUrl, '/api/projects/pingte/modes/pingteyixiao/directories/%E4%B8%8D%E5%AD%98%E5%9C%A8', {
    method: 'PATCH', headers: origin, body: JSON.stringify({ newName: '仍不存在' })
  });
  assert.deepEqual(result.body, { ok: true, renamed: 0 });

  result = await jsonRequest(baseUrl, '/api/projects/pingte/dates/2026-07-26', {
    method: 'DELETE', headers: origin
  });
  assert.equal(result.body.deleted, true);
});

test('round-trips export/import and creates backups through the API', async (t) => {
  const { baseUrl, paths } = await startTestServer(t);
  const origin = { origin: baseUrl };
  await jsonRequest(baseUrl, '/api/projects/jiuxiang/dates/2026-07-27/modes/shabantou', {
    method: 'PUT', headers: origin,
    body: JSON.stringify({ query: '09', entries: [{ name: '目录九', content: '49' }] })
  });

  let result = await jsonRequest(baseUrl, '/api/projects/jiuxiang/export');
  assert.equal(result.response.status, 200);
  const exported = result.body;
  result = await jsonRequest(baseUrl, '/api/import?strategy=replace', {
    method: 'POST', headers: origin, body: JSON.stringify(exported)
  });
  assert.deepEqual(result.body, { ok: true, projects: 1, days: 1, modes: 1, entries: 1 });

  result = await jsonRequest(baseUrl, '/api/backup', {
    method: 'POST', headers: origin, body: '{}'
  });
  assert.equal(result.response.status, 201);
  assert.equal(result.body.ok, true);
  assert.match(result.body.filename, /^lottery_tools-.*\.sqlite3$/);
  assert.equal(result.body.path.startsWith(paths.backupDir), true);

  result = await jsonRequest(baseUrl, '/api/export');
  assert.equal(result.body.projects.length, 3);
});

test('rejects cross-origin writes and maps validation, conflicts, methods, and missing routes to JSON errors', async (t) => {
  const { baseUrl } = await startTestServer(t);
  let result = await jsonRequest(baseUrl, '/api/projects/pingte/dates/2026-07-27/modes/pingteyixiao', {
    method: 'PUT', headers: { origin: 'https://attacker.example' }, body: JSON.stringify({ entries: [] })
  });
  assert.equal(result.response.status, 403);
  assert.match(result.body.error, /同源/);

  result = await jsonRequest(baseUrl, '/api/projects/pingte/dates/not-a-date/modes/pingteyixiao', {
    method: 'PUT', headers: { origin: baseUrl }, body: JSON.stringify({ entries: [] })
  });
  assert.equal(result.response.status, 400);

  await jsonRequest(baseUrl, '/api/projects/pingte/dates/2026-07-27/modes/pingteyixiao', {
    method: 'PUT', headers: { origin: baseUrl },
    body: JSON.stringify({ entries: [{ name: '甲', content: '1' }, { name: '乙', content: '2' }] })
  });
  result = await jsonRequest(baseUrl, '/api/projects/pingte/directories/pingteyixiao/%E7%94%B2', {
    method: 'PATCH', headers: { origin: baseUrl }, body: JSON.stringify({ newName: '乙' })
  });
  assert.equal(result.response.status, 409);

  result = await jsonRequest(baseUrl, '/api/projects/missing/snapshot');
  assert.equal(result.response.status, 404);

  result = await jsonRequest(baseUrl, '/api/projects', { method: 'POST', headers: { origin: baseUrl }, body: '{}' });
  assert.equal(result.response.status, 405);

  result = await jsonRequest(baseUrl, '/api/not-found');
  assert.equal(result.response.status, 404);

  const malformed = await fetch(`${baseUrl}/api/import`, {
    method: 'POST', headers: { origin: baseUrl, 'content-type': 'application/json' }, body: '{broken'
  });
  assert.equal(malformed.status, 400);
});

test('returns a bounded JSON error without dropping the connection for oversized input', async (t) => {
  const { baseUrl } = await startTestServer(t, { maxJsonBytes: 32 });
  const result = await jsonRequest(baseUrl, '/api/import', {
    method: 'POST',
    headers: { origin: baseUrl },
    body: JSON.stringify({ value: 'x'.repeat(100) })
  });
  assert.equal(result.response.status, 413);
  assert.equal(result.body.code, 'PAYLOAD_TOO_LARGE');
});

test('rejects non-positive and non-integer JSON body limits before starting the server', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });

  for (const maxJsonBytes of [0, 1.5]) {
    assert.throws(
      () => createLocalServer({ store, staticDir: paths.staticDir, maxJsonBytes }),
      /maxJsonBytes 必须是正整数/
    );
  }
});
