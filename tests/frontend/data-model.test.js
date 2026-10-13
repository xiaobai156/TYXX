import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCalendarMonth,
  buildDailyRows,
  buildDirectoryHistory,
  getModeRecord,
  listDirectories,
  removeDirectoryFromSnapshot,
  searchEntries,
  snapshotSummary
} from '../../assets/js/data-model.js';

const snapshot = {
  projectId: 'pingte',
  days: {
    '2026-07-02': {
      pingteyixiao: {
        query: '08',
        entries: [
          { name: '目录甲', content: '01 02', original: '原始甲' },
          { name: '目录乙', content: '03', original: null }
        ]
      }
    },
    '2026-07-03': {
      pingteyixiao: {
        query: '09',
        entries: [{ name: '目录甲', content: '04 05', original: '原始乙' }]
      },
      pingtewei: { query: '9', entries: [] }
    }
  }
};

test('returns a normalized empty record when a date or mode is absent', () => {
  assert.deepEqual(getModeRecord(snapshot, '2026-07-02', 'pingteyixiao'), {
    query: '08',
    entries: snapshot.days['2026-07-02'].pingteyixiao.entries
  });
  assert.deepEqual(getModeRecord(snapshot, '2026-07-01', 'pingteyixiao'), {
    query: '', entries: []
  });
});

test('builds a Monday-first calendar with project data markers', () => {
  const cells = buildCalendarMonth(2026, 7, snapshot);
  assert.equal(cells.length, 42);
  assert.equal(cells[0].date, '2026-06-29');
  assert.equal(cells[3].date, '2026-07-02');
  assert.equal(cells[3].modeCount, 1);
  assert.equal(cells[4].modeCount, 2);
  assert.equal(cells[3].entryCount, 2);
});

test('derives directory history and daily totals without crossing modes', () => {
  assert.deepEqual(buildDirectoryHistory(snapshot, 'pingteyixiao'), [
    {
      name: '目录甲',
      recordCount: 2,
      firstDate: '2026-07-02',
      latestDate: '2026-07-03',
      latestContent: '04 05'
    },
    {
      name: '目录乙',
      recordCount: 1,
      firstDate: '2026-07-02',
      latestDate: '2026-07-02',
      latestContent: '03'
    }
  ]);
  assert.deepEqual(buildDailyRows(snapshot, 'pingteyixiao').map(row => [
    row.date, row.query, row.directoryCount, row.contentCount
  ]), [
    ['2026-07-03', '09', 1, 1],
    ['2026-07-02', '08', 2, 2]
  ]);
});

test('searches names, content, and original text and lists directory totals', () => {
  assert.deepEqual(searchEntries(snapshot, 'pingteyixiao', '原始乙'), [
    {
      date: '2026-07-03',
      query: '09',
      name: '目录甲',
      content: '04 05',
      original: '原始乙'
    }
  ]);
  assert.deepEqual(listDirectories(snapshot, 'pingteyixiao'), [
    { name: '目录甲', recordCount: 2 },
    { name: '目录乙', recordCount: 1 }
  ]);
  assert.deepEqual(searchEntries(snapshot, 'pingteyixiao', '  '), []);
});

test('summarizes a complete project snapshot and handles an empty snapshot', () => {
  assert.deepEqual(snapshotSummary(snapshot), {
    dayCount: 2,
    modeRecordCount: 3,
    entryCount: 3,
    firstDate: '2026-07-02',
    latestDate: '2026-07-03'
  });
  assert.deepEqual(snapshotSummary(null), {
    dayCount: 0,
    modeRecordCount: 0,
    entryCount: 0,
    firstDate: '',
    latestDate: ''
  });
});

test('removes one directory locally without changing other modes or the source snapshot', () => {
  const updated = removeDirectoryFromSnapshot(snapshot, 'pingteyixiao', '目录甲');

  assert.deepEqual(updated.days['2026-07-02'].pingteyixiao.entries, [
    { name: '目录乙', content: '03', original: null }
  ]);
  assert.deepEqual(updated.days['2026-07-03'].pingteyixiao.entries, []);
  assert.strictEqual(updated.days['2026-07-03'].pingtewei, snapshot.days['2026-07-03'].pingtewei);
  assert.equal(snapshot.days['2026-07-02'].pingteyixiao.entries.length, 2);
});
