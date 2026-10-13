import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openLotteryDatabase } from '../../server/database.js';
import { createTestPaths, jsonRequest } from './helpers.js';
import { createLocalServer } from '../../server/app.js';

test('upserts one directory across at most 20 dates in one transaction and preserves other entries', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });
  store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    query: 'old', entries: [{ name: '保留目录', content: '旧内容' }]
  });

  const result = store.upsertDirectoryBatch('pingte', 'pingteyixiao', {
    name: '批量目录',
    rows: [
      { date: '2026-07-26', query: '06', content: '马', original: '马 批量目录' },
      { date: '2026-07-27', query: '07', content: '蛇' }
    ]
  });
  assert.deepEqual(result, { upserted: 2 });
  const days = store.getSnapshot('pingte').days;
  assert.equal(days['2026-07-26'].pingteyixiao.entries[0].name, '批量目录');
  assert.equal(days['2026-07-27'].pingteyixiao.query, '07');
  assert.deepEqual(
    days['2026-07-27'].pingteyixiao.entries.map(({ name }) => name),
    ['保留目录', '批量目录']
  );

  const before = store.exportData('pingte').projects[0].days;
  assert.throws(() => store.upsertDirectoryBatch('pingte', 'pingteyixiao', {
    name: '失败目录',
    rows: [
      { date: '2026-07-28', query: '08', content: '牛' },
      { date: 'bad-date', query: '09', content: '虎' }
    ]
  }), /日期格式/);
  assert.deepEqual(store.exportData('pingte').projects[0].days, before);
  assert.equal(store.getSnapshot('pingte').days['2026-07-28'], undefined);

  assert.throws(() => store.upsertDirectoryBatch('pingte', 'pingteyixiao', {
    name: '太多',
    rows: Array.from({ length: 21 }, (_, index) => ({
      date: `2026-08-${String(index + 1).padStart(2, '0')}`,
      query: '1', content: '鼠'
    }))
  }), /最多 20/);
  assert.throws(() => store.upsertDirectoryBatch('pingte', 'pingteyixiao', {
    name: '重复日期',
    rows: [
      { date: '2026-07-29', query: '1', content: '鼠' },
      { date: '2026-07-29', query: '2', content: '牛' }
    ]
  }), /日期重复/);
  assert.throws(() => store.upsertDirectoryBatch('pingte', 'pingteyixiao', {
    name: '空值', rows: [{ date: '2026-07-29', query: '', content: '鼠' }]
  }), /query 不能为空/);
});

test('batch updates keep shahao and shaxiao query sharing without crossing their entries', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });
  store.replaceMode('dawei_shahao', '2026-07-27', 'shaxiao', {
    query: 'old', entries: [{ name: '杀五码目录', content: '01 02 03 04 05' }]
  });

  store.upsertDirectoryBatch('dawei_shahao', 'shahao', {
    name: '杀号目录',
    rows: [{ date: '2026-07-27', query: '18', content: '01 02' }]
  });
  const day = store.getSnapshot('dawei_shahao').days['2026-07-27'];
  assert.equal(day.shahao.query, '18');
  assert.equal(day.shaxiao.query, '18');
  assert.equal(day.shahao.entries[0].name, '杀号目录');
  assert.equal(day.shaxiao.entries[0].name, '杀五码目录');
});

test('deletes exactly one project, date, mode, and directory entry', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });
  for (const date of ['2026-07-26', '2026-07-27']) {
    store.replaceMode('pingte', date, 'pingteyixiao', {
      query: date, entries: [{ name: '同名目录', content: date }]
    });
    store.replaceMode('pingte', date, 'pingtewei', {
      query: date, entries: [{ name: '同名目录', content: date }]
    });
    store.replaceMode('dawei_shahao', date, 'dawei', {
      query: date, entries: [{ name: '同名目录', content: date }]
    });
  }

  assert.deepEqual(
    store.deleteEntry('pingte', '2026-07-27', 'pingteyixiao', '同名目录'),
    { deleted: true }
  );
  assert.equal(store.getSnapshot('pingte').days['2026-07-27'].pingteyixiao.entries.length, 0);
  assert.equal(store.getSnapshot('pingte').days['2026-07-26'].pingteyixiao.entries.length, 1);
  assert.equal(store.getSnapshot('pingte').days['2026-07-27'].pingtewei.entries.length, 1);
  assert.equal(store.getSnapshot('dawei_shahao').days['2026-07-27'].dawei.entries.length, 1);
  assert.deepEqual(
    store.deleteEntry('pingte', '2026-07-27', 'pingteyixiao', '同名目录'),
    { deleted: false }
  );
});

test('exposes transactional batch and single-day directory deletion over HTTP', async (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  const server = createLocalServer({ store, staticDir: paths.root });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    store.close();
    paths.cleanup();
  });

  let result = await jsonRequest(baseUrl, '/api/projects/pingte/modes/pingteyixiao/batch', {
    method: 'POST', headers: { origin: baseUrl },
    body: JSON.stringify({
      name: '批量目录',
      rows: [{ date: '2026-07-27', query: '07', content: '鼠' }]
    })
  });
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true, upserted: 1 });

  result = await jsonRequest(
    baseUrl,
    '/api/projects/pingte/dates/2026-07-27/modes/pingteyixiao/directories/%E6%89%B9%E9%87%8F%E7%9B%AE%E5%BD%95',
    { method: 'DELETE', headers: { origin: baseUrl } }
  );
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, { ok: true, deleted: true });
});
