import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildMigrationBundle,
  fetchAllRows,
  hashMigrationBundle,
  readLegacySupabaseConfig,
  summarizeMigrationBundle
} from '../../tools/cloud-migration.js';

const projects = [
  {
    id: 'pingte',
    modes: ['pingteyixiao', 'pingtewei', 'shaliangxiao'],
    queryColumns: {}
  },
  {
    id: 'dawei_shahao',
    modes: ['dawei', 'shahao', 'shengxiao', 'shaxiao'],
    queryColumns: {
      dawei: 'dawei_query',
      shahao: 'shahao_query',
      shengxiao: 'shengxiao_query',
      shaxiao: 'shahao_query'
    }
  }
];

test('normalizes legacy query columns and query sentinel rows into daily modes', () => {
  const bundle = buildMigrationBundle([
    {
      definition: projects[0],
      dailyQueries: [{ date: '2026-07-26' }],
      entries: [
        { date: '2026-07-26', mode: 'pingteyixiao', name: '__QUERY__', content: '07' },
        { date: '2026-07-26', mode: 'pingteyixiao', name: '目录甲', content: '鼠', original: '原文甲' },
        { date: '2026-07-26', mode: 'pingtewei', name: 'QUERY', content: '08' }
      ]
    },
    {
      definition: projects[1],
      dailyQueries: [{
        date: '2026-07-27',
        dawei_query: '12',
        shahao_query: '13',
        shengxiao_query: '马'
      }],
      entries: [
        { date: '2026-07-27', mode: 'dawei', name: '目录乙', content: '01 02' },
        { date: '2026-07-27', mode: 'shaxiao', name: '_QUERY_', content: '13' },
        { date: '2026-07-27', mode: 'shaxiao', name: '目录丙', content: '03 04' }
      ]
    }
  ]);

  assert.equal(bundle.schemaVersion, 1);
  assert.deepEqual(bundle.projects.map(({ id }) => id), ['pingte', 'dawei_shahao']);
  assert.deepEqual(bundle.projects[0].days, [{
    date: '2026-07-26',
    modes: [
      {
        id: 'pingtewei', query: '08', entries: []
      },
      {
        id: 'pingteyixiao', query: '07',
        entries: [{ name: '目录甲', content: '鼠', original: '原文甲' }]
      }
    ]
  }]);
  assert.deepEqual(bundle.projects[1].days[0].modes.map(({ id, query }) => ({ id, query })), [
    { id: 'dawei', query: '12' },
    { id: 'shahao', query: '13' },
    { id: 'shaxiao', query: '13' },
    { id: 'shengxiao', query: '马' }
  ]);
  assert.equal(bundle.projects[1].days[0].modes[2].entries[0].name, '目录丙');
  assert.deepEqual(summarizeMigrationBundle(bundle), {
    projects: 2,
    days: 2,
    modes: 6,
    entries: 3
  });
});

test('preserves empty cloud dates and rejects unknown modes, duplicate entries, and query conflicts', () => {
  const empty = buildMigrationBundle([{
    definition: projects[0], dailyQueries: [{ date: '2026-07-26' }], entries: []
  }]);
  assert.deepEqual(empty.projects[0].days, [{ date: '2026-07-26', modes: [] }]);

  const identicalDuplicate = buildMigrationBundle([{
    definition: projects[0], dailyQueries: [], entries: [
      { date: '2026-07-26', mode: 'pingtewei', name: '重复', content: '1' },
      { date: '2026-07-26', mode: 'pingtewei', name: '重复', content: '1' }
    ]
  }]);
  assert.equal(identicalDuplicate.projects[0].days[0].modes[0].entries.length, 1);

  assert.throws(() => buildMigrationBundle([{
    definition: projects[0], dailyQueries: [],
    entries: [{ date: '2026-07-26', mode: 'unknown', name: '目录', content: '1' }]
  }]), /未知模式/);
  assert.throws(() => buildMigrationBundle([{
    definition: projects[0], dailyQueries: [], entries: [
      { date: '2026-07-26', mode: 'pingtewei', name: '重复', content: '1' },
      { date: '2026-07-26', mode: 'pingtewei', name: '重复', content: '2' }
    ]
  }]), /重复目录/);
  assert.throws(() => buildMigrationBundle([{
    definition: projects[1],
    dailyQueries: [{ date: '2026-07-27', dawei_query: '12' }],
    entries: [{ date: '2026-07-27', mode: 'dawei', name: '__QUERY__', content: '13' }]
  }]), /查询值冲突/);
});

test('hashes normalized data deterministically regardless of source row order', () => {
  const source = {
    definition: projects[0],
    dailyQueries: [{ date: '2026-07-26' }],
    entries: [
      { date: '2026-07-26', mode: 'pingtewei', name: '乙', content: '2' },
      { date: '2026-07-26', mode: 'pingtewei', name: '甲', content: '1' }
    ]
  };
  const first = buildMigrationBundle([source]);
  const second = buildMigrationBundle([{ ...source, entries: [...source.entries].reverse() }]);
  second.exportedAt = '2026-07-27T00:00:00.000Z';
  second.projects[0].name = 'display metadata is not source data';
  assert.equal(hashMigrationBundle(first), hashMigrationBundle(second));
  second.projects[0].days[0].modes[0].entries[0].content = 'changed';
  assert.notEqual(hashMigrationBundle(first), hashMigrationBundle(second));
});

test('fetches every PostgREST page with explicit ranges', async () => {
  const calls = [];
  const pages = [
    [{ date: '2026-07-01' }, { date: '2026-07-02' }],
    [{ date: '2026-07-03' }]
  ];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(pages.shift()), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  };
  const rows = await fetchAllRows({
    url: 'https://example.supabase.co', key: 'public-key', path: 'daily_queries?select=date',
    pageSize: 2, fetchImpl
  });
  assert.deepEqual(rows.map(({ date }) => date), ['2026-07-01', '2026-07-02', '2026-07-03']);
  assert.deepEqual(calls.map(call => call.options.headers.Range), ['0-1', '2-3']);
  assert.equal(calls[0].options.headers.apikey, 'public-key');
});

test('reads the URL and publishable key without returning unrelated source text', () => {
  const config = readLegacySupabaseConfig(`
    const client = createClient(
      'https://abcxyz.supabase.co',
      'sb_publishable_example_123'
    );
  `);
  assert.deepEqual(config, {
    url: 'https://abcxyz.supabase.co',
    key: 'sb_publishable_example_123'
  });
  assert.throws(() => readLegacySupabaseConfig('const noCredentials = true;'), /无法读取/);
});
