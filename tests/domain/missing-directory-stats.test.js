import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMissingDirectoryStats,
  buildModeMissingDirectoryStats
} from '../../assets/js/domain/missing-directory-stats.js';
import { getProject } from '../../assets/js/projects.js';

const names = Array.from({ length: 10 }, (_, index) => `目录${index + 1}`);

function rows(selected, content) {
  return selected.map(name => ({ name, content }));
}

function pingteSnapshot({ latestYiXiao = 9, latestWei = 9, latestSha = 8 } = {}) {
  return { days: {
    '2026-06-01': {
      pingteyixiao: { query: '鼠', entries: rows(names, '鼠') },
      pingtewei: { query: '1尾2尾', entries: rows(names, '1尾') },
      shaliangxiao: { query: '07', entries: rows(names, '鼠牛') }
    },
    '2026-06-02': {
      pingtewei: { query: '1尾2尾', entries: rows(names.slice(0, latestWei), '1尾') },
      shaliangxiao: { query: '07', entries: rows(names.slice(0, latestSha), '鼠牛') }
    },
    '2026-06-03': {
      pingteyixiao: { query: '鼠', entries: rows(names.slice(0, latestYiXiao), '鼠') }
    }
  } };
}

test('includes a mode when its latest issue covers exactly ninety percent of known directories', () => {
  const summary = buildModeMissingDirectoryStats({
    projectId: 'pingte',
    modeId: 'pingteyixiao',
    modeName: '平特一肖',
    snapshot: pingteSnapshot(),
    threshold: 0.9
  });

  assert.equal(summary.eligible, true);
  assert.equal(summary.latestDate, '2026-06-03');
  assert.equal(summary.totalDirectories, 10);
  assert.equal(summary.latestDirectoryCount, 9);
  assert.equal(summary.coverageRate, 0.9);
  assert.deepEqual(summary.rows.map(row => ({
    name: row.name,
    lastUpdateDate: row.lastUpdateDate,
    noUpdateDays: row.noUpdateDays
  })), [{ name: '目录10', lastUpdateDate: '2026-06-01', noUpdateDays: 2 }]);
});

test('hides a mode and all of its missing rows when latest coverage is below ninety percent', () => {
  const summary = buildModeMissingDirectoryStats({
    projectId: 'pingte',
    modeId: 'shaliangxiao',
    modeName: '杀两肖',
    snapshot: pingteSnapshot(),
    threshold: 0.9
  });

  assert.equal(summary.coverageRate, 0.8);
  assert.equal(summary.eligible, false);
  assert.deepEqual(summary.rows, []);
});

test('aggregates qualifying modes and sorts the longest missing duration first', () => {
  const project = getProject('pingte');
  const summary = buildMissingDirectoryStats({
    projects: [project],
    projectStates: { pingte: { snapshot: pingteSnapshot() } },
    threshold: 0.9
  });

  assert.deepEqual(summary.visibleModes.map(mode => mode.modeId), ['pingteyixiao', 'pingtewei']);
  assert.equal(summary.eligibleModeCount, 2);
  assert.equal(summary.hiddenModeCount, 1);
  assert.equal(summary.totalMissingDirectories, 2);
  assert.equal(summary.day1Count, 1);
  assert.equal(summary.day2PlusCount, 1);
});
