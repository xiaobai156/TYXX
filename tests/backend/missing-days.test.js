import assert from 'node:assert/strict';
import { test } from 'node:test';

import { openLotteryDatabase } from '../../server/database.js';
import { createTestPaths } from './helpers.js';

test('preserves empty project days so jiuxiang missing-day gaps survive import and export', (t) => {
  const store = openLotteryDatabase(createTestPaths(t));
  t.after(() => store.close());
  const document = {
    schemaVersion: 1,
    projects: [{
      id: 'jiuxiang',
      days: [
        { date: '2026-06-01', modes: [{ id: 'shabantou', query: '49', entries: [] }] },
        { date: '2026-06-02', modes: [] },
        { date: '2026-06-03', modes: [{ id: 'shabantou', query: '48', entries: [] }] }
      ]
    }]
  };

  store.importData(document, { strategy: 'replace' });
  assert.deepEqual(store.getSnapshot('jiuxiang').days['2026-06-02'], {});
  assert.deepEqual(
    store.exportData('jiuxiang').projects[0].days.map(({ date, modes }) => ({ date, modes })),
    document.projects[0].days
  );
});
