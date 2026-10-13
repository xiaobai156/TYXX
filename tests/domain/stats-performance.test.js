import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildModeDirectoryStats } from '../../assets/js/domain/stats.js';

test('indexes every day once and reuses the cached mode result', () => {
  const directoryCount = 120;
  const dayCount = 40;
  let entryReads = 0;
  const entries = new Proxy(Array.from({ length: directoryCount }, (_, index) => ({
    name: `目录${index}`,
    content: '鼠'
  })), {
    get(target, property, receiver) {
      if (/^\d+$/.test(String(property))) entryReads += 1;
      return Reflect.get(target, property, receiver);
    }
  });
  const days = {};
  for (let offset = 0; offset < dayCount; offset += 1) {
    const date = new Date(Date.UTC(2026, 0, offset + 1)).toISOString().slice(0, 10);
    days[date] = { pingteyixiao: { query: '鼠', entries } };
  }

  const snapshot = { days };
  const request = {
    projectId: 'pingte',
    modeId: 'pingteyixiao',
    snapshot
  };
  const rows = buildModeDirectoryStats(request);
  const firstBuildReads = entryReads;
  const repeated = buildModeDirectoryStats(request);

  assert.equal(rows.length, directoryCount);
  assert.equal(firstBuildReads, directoryCount * dayCount);
  assert.equal(entryReads, firstBuildReads);
  assert.strictEqual(repeated, rows);
});
