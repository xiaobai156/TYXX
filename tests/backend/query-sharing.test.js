import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openLotteryDatabase } from '../../server/database.js';
import { createTestPaths } from './helpers.js';

test('keeps shahao and shaxiao queries synchronized while preserving independent entries', (t) => {
  const store = openLotteryDatabase(createTestPaths(t));
  t.after(() => store.close());

  store.replaceMode('dawei_shahao', '2026-07-27', 'shahao', {
    query: '18', entries: [{ name: '杀号目录', content: '01 02' }]
  });
  let day = store.getSnapshot('dawei_shahao').days['2026-07-27'];
  assert.equal(day.shahao.query, '18');
  assert.equal(day.shaxiao.query, '18');
  assert.deepEqual(day.shaxiao.entries, []);

  store.replaceMode('dawei_shahao', '2026-07-27', 'shaxiao', {
    query: '19', entries: [{ name: '杀码目录', content: '03 04 05 06 07' }]
  });
  day = store.getSnapshot('dawei_shahao').days['2026-07-27'];
  assert.equal(day.shahao.query, '19');
  assert.equal(day.shaxiao.query, '19');
  assert.equal(day.shahao.entries[0].name, '杀号目录');
  assert.equal(day.shaxiao.entries[0].name, '杀码目录');
});
