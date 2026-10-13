import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { openLotteryDatabase } from '../../server/database.js';
import { PROJECT_DEFINITIONS } from '../../server/projects.js';
import { createTestPaths } from './helpers.js';

const sampleEntries = [
  { name: '目录甲', content: '01 02', original: '目录甲: 01 02' },
  { name: '目录乙', content: '03 04' }
];

test('initializes the unified schema, SQLite safeguards, projects, and all 17 modes', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });

  assert.equal(store.connection.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
  assert.equal(store.connection.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(store.connection.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  assert.equal(store.connection.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');

  const projects = store.listProjects();
  assert.deepEqual(projects.map(({ id }) => id), ['pingte', 'dawei_shahao', 'jiuxiang']);
  assert.deepEqual(projects.map(({ modes }) => modes.length), [3, 4, 10]);
  assert.deepEqual(projects.map(({ name }) => name), ['平特分析', '大围+杀号分析', '九项综合分析']);
  assert.equal(projects[1].modes.find(({ id }) => id === 'shaxiao').name, '杀五码');
  assert.deepEqual(projects, PROJECT_DEFINITIONS);

  const tables = store.connection.prepare(`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name
  `).all().map(({ name }) => name);
  assert.deepEqual(tables, [
    'app_meta', 'daily_modes', 'data_entries', 'days',
    'modes', 'projects', 'schema_migrations'
  ]);
});

test('replaces one date and mode atomically without crossing project boundaries', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });

  store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    query: '07', entries: sampleEntries
  });
  store.replaceMode('dawei_shahao', '2026-07-27', 'dawei', {
    query: '12', entries: [{ name: '目录甲', content: '49' }]
  });
  store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    query: '08', entries: [{ name: '目录乙', content: '05' }]
  });

  assert.deepEqual(store.getSnapshot('pingte').days, {
    '2026-07-27': {
      pingteyixiao: {
        query: '08',
        entries: [{ name: '目录乙', content: '05', original: null }]
      }
    }
  });
  assert.equal(store.getSnapshot('dawei_shahao').days['2026-07-27'].dawei.entries[0].content, '49');

  assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    query: 'changed',
    entries: [{ name: '重复', content: '1' }, { name: '重复', content: '2' }]
  }), /目录名重复/);
  assert.equal(store.getSnapshot('pingte').days['2026-07-27'].pingteyixiao.query, '08');
});

test('validates projects, modes, dates, and entry shapes before writing', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });

  assert.throws(() => store.getSnapshot('missing'), /未知项目/);
  assert.throws(() => store.replaceMode('pingte', '2026-02-30', 'pingteyixiao', { entries: [] }), /日期格式/);
  assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'dawei', { entries: [] }), /不属于项目/);
  assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    entries: [{ name: '   ', content: '1' }]
  }), /目录名不能为空/);
  assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    entries: 'not-an-array'
  }), /entries 必须是数组/);
  assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', null), /请求数据必须是对象/);
  assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
    entries: [null]
  }), /目录记录必须是对象/);
  for (const reservedName of ['QUERY', '_query_', '__QUERY__']) {
    assert.throws(() => store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', {
      entries: [{ name: reservedName, content: '07' }]
    }), /系统查询名/);
  }
  assert.throws(
    () => store.upsertDirectoryBatch('pingte', 'pingteyixiao', null),
    /请求数据必须是对象/
  );
  assert.throws(() => store.upsertDirectoryBatch('pingte', 'pingteyixiao', {
    name: '批量目录', rows: [null]
  }), /批量行必须是对象/);
  assert.throws(() => openLotteryDatabase({}), /dbPath 不能为空/);
});

test('deletes dates and deletes or renames directories only inside the requested project and mode', (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  t.after(() => { store.close(); paths.cleanup(); });
  for (const date of ['2026-07-26', '2026-07-27']) {
    store.replaceMode('pingte', date, 'pingteyixiao', { query: date, entries: sampleEntries });
    store.replaceMode('pingte', date, 'pingtewei', { query: date, entries: sampleEntries });
    store.replaceMode('dawei_shahao', date, 'dawei', { query: date, entries: sampleEntries });
  }

  assert.equal(store.renameDirectory('pingte', 'pingteyixiao', '目录甲', '目录新').renamed, 2);
  assert.equal(store.deleteDirectory('pingte', 'pingteyixiao', '目录乙').deleted, 2);
  let snapshot = store.getSnapshot('pingte');
  assert.deepEqual(snapshot.days['2026-07-27'].pingteyixiao.entries.map(({ name }) => name), ['目录新']);
  assert.deepEqual(snapshot.days['2026-07-27'].pingtewei.entries.map(({ name }) => name), ['目录乙', '目录甲']);
  assert.deepEqual(store.getSnapshot('dawei_shahao').days['2026-07-27'].dawei.entries.map(({ name }) => name), ['目录乙', '目录甲']);

  assert.throws(() => store.renameDirectory('pingte', 'pingtewei', '目录甲', '目录乙'), /已经存在/);
  assert.deepEqual(store.getSnapshot('pingte').days['2026-07-27'].pingtewei.entries.map(({ name }) => name), ['目录乙', '目录甲']);
  assert.equal(store.renameDirectory('pingte', 'pingtewei', '目录甲', '目录甲').renamed, 2);

  assert.equal(store.deleteDate('pingte', '2026-07-26').deleted, true);
  assert.equal(store.getSnapshot('pingte').days['2026-07-26'], undefined);
  assert.ok(store.getSnapshot('dawei_shahao').days['2026-07-26']);
  snapshot = store.getSnapshot('pingte');
  assert.equal(Object.keys(snapshot.days).length, 1);
});

test('exports and imports normalized project data with merge and replace semantics', (t) => {
  const sourcePaths = createTestPaths(t);
  const source = openLotteryDatabase(sourcePaths);
  source.replaceMode('pingte', '2026-07-27', 'pingteyixiao', { query: '07', entries: sampleEntries });
  source.replaceMode('jiuxiang', '2026-07-28', 'shabantou', { query: '08', entries: [{ name: '九项目录', content: '11' }] });

  const exported = source.exportData();
  assert.equal(exported.schemaVersion, 1);
  assert.deepEqual(exported.projects.map(({ id }) => id), ['pingte', 'dawei_shahao', 'jiuxiang']);
  assert.equal(
    exported.projects[0].days[0].modes[0].entries.find(({ name }) => name === '目录甲').original,
    '目录甲: 01 02'
  );
  assert.deepEqual(source.exportData('jiuxiang').projects.map(({ id }) => id), ['jiuxiang']);

  const destination = openLotteryDatabase({
    ...sourcePaths,
    dbPath: sourcePaths.dbPath.replace('.sqlite3', '-destination.sqlite3')
  });
  t.after(() => { destination.close(); source.close(); sourcePaths.cleanup(); });
  destination.replaceMode('pingte', '2026-07-20', 'pingtewei', { query: 'old', entries: [] });
  assert.equal(destination.importData(exported, { strategy: 'merge' }).projects, 3);
  assert.ok(destination.getSnapshot('pingte').days['2026-07-20']);
  assert.equal(destination.getSnapshot('jiuxiang').days['2026-07-28'].shabantou.entries[0].name, '九项目录');

  assert.equal(destination.importData(source.exportData('pingte'), { strategy: 'replace' }).projects, 1);
  assert.equal(destination.getSnapshot('pingte').days['2026-07-20'], undefined);
  assert.equal(destination.getSnapshot('pingte').days['2026-07-27'].pingteyixiao.query, '07');

  const before = destination.exportData('pingte');
  assert.throws(() => destination.importData({ schemaVersion: 1, projects: [{ id: 'missing', days: [] }] }), /未知项目/);
  assert.throws(() => destination.importData(null), /导入内容必须是对象/);
  assert.throws(() => destination.importData({ schemaVersion: 2, projects: [] }), /schemaVersion/);
  assert.throws(() => destination.importData({ schemaVersion: 1, projects: {} }), /projects 必须是数组/);
  assert.throws(() => destination.importData({ schemaVersion: 1, projects: [null] }), /项目数据必须是对象/);
  assert.throws(() => destination.importData({ schemaVersion: 1, projects: [] }, { strategy: 'bad' }), /strategy/);
  assert.throws(() => destination.importData({
    schemaVersion: 1,
    projects: [{
      id: 'pingte',
      days: [{ date: '2026-07-27', modes: [null] }]
    }]
  }), /模式数据必须是对象/);
  assert.throws(() => destination.importData({
    schemaVersion: 1,
    projects: [{
      id: 'dawei_shahao',
      days: [{
        date: '2026-07-27',
        modes: [
          { id: 'shahao', query: '18', entries: [] },
          { id: 'shaxiao', query: '19', entries: [] }
        ]
      }]
    }]
  }), /共享查询值冲突/);
  assert.deepEqual(destination.exportData('pingte').projects[0].days, before.projects[0].days);
});

test('reopens an existing database without reapplying its schema migration', (t) => {
  const paths = createTestPaths(t);
  const first = openLotteryDatabase(paths);
  first.replaceMode('pingte', '2026-07-27', 'pingtewei', { query: 7, entries: [] });
  first.close();
  const reopened = openLotteryDatabase({ dbPath: paths.dbPath });
  t.after(() => { reopened.close(); paths.cleanup(); });

  assert.equal(reopened.getSnapshot('pingte').days['2026-07-27'].pingtewei.query, '7');
  assert.equal(reopened.connection.prepare('SELECT count(*) AS count FROM schema_migrations').get().count, 1);
});

test('does not rewrite an already-correct catalog on a second open', (t) => {
  const paths = createTestPaths(t);
  const first = openLotteryDatabase(paths);
  first.replaceMode('pingte', '2026-07-27', 'pingtewei', {
    query: '7', entries: [{ name: '目录甲', content: '01', original: '原始' }]
  });
  const sentinel = '2000-01-01T00:00:00.000Z';
  first.connection.prepare(`
    UPDATE app_meta
    SET updated_at = ?
    WHERE key = 'schema_version'
  `).run(sentinel);
  const readLogicalRows = connection => ({
    projects: connection.prepare('SELECT id, name, sort_order FROM projects ORDER BY id').all(),
    modes: connection.prepare('SELECT project_id, id, name, sort_order FROM modes ORDER BY project_id, id').all(),
    days: connection.prepare('SELECT project_id, date, created_at, updated_at FROM days ORDER BY project_id, date').all(),
    dailyModes: connection.prepare('SELECT project_id, date, mode_id, query, created_at, updated_at FROM daily_modes ORDER BY project_id, date, mode_id').all(),
    entries: connection.prepare('SELECT project_id, date, mode_id, name, content, original, created_at, updated_at FROM data_entries ORDER BY project_id, date, mode_id, name').all(),
    appMeta: connection.prepare('SELECT key, value, updated_at FROM app_meta ORDER BY key').all()
  });
  const before = readLogicalRows(first.connection);
  first.close();

  const reopened = openLotteryDatabase(paths);
  t.after(() => { reopened.close(); paths.cleanup(); });
  const after = readLogicalRows(reopened.connection);
  assert.deepEqual(after, before);
  assert.equal(
    reopened.connection.prepare("SELECT updated_at FROM app_meta WHERE key = 'schema_version'").get().updated_at,
    sentinel
  );
});

test('creates a consistent SQLite backup that opens independently', async (t) => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  store.replaceMode('pingte', '2026-07-27', 'pingteyixiao', { query: '07', entries: sampleEntries });

  t.mock.timers.enable({
    apis: ['Date'],
    now: new Date('2026-07-27T12:34:56.789Z')
  });

  const result = await store.createBackup();
  const collision = await store.createBackup();
  assert.ok(existsSync(result.path));
  assert.ok(existsSync(collision.path));
  assert.equal(collision.filename, result.filename.replace(/\.sqlite3$/, '-1.sqlite3'));
  const backup = new DatabaseSync(result.path, { readOnly: true });
  t.after(() => { backup.close(); store.close(); paths.cleanup(); });
  assert.equal(backup.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.equal(backup.prepare('SELECT count(*) AS count FROM data_entries').get().count, 2);
});
