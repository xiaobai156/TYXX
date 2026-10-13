import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openLotteryDatabase } from '../../server/database.js';
import { installVerifiedDatabase } from '../../tools/migrate-cloud-to-local.js';

const TEST_DIR = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = path.resolve(TEST_DIR, '../../tools/migrate-cloud-to-local.js');

test('can be imported without starting a cloud migration', () => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'migration-import-'));
  rmSync(dataDir, { recursive: true, force: true });
  const probe = `
    globalThis.fetch = () => { throw new Error('unexpected cloud request'); };
    await import(${JSON.stringify(pathToFileURL(SCRIPT_PATH).href)});
    await new Promise(resolve => setTimeout(resolve, 100));
    if (process.exitCode) process.exit(process.exitCode);
  `;

  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], {
    encoding: 'utf8',
    env: { ...process.env, LOTTERY_DATA_DIR: dataDir }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(dataDir), false);
});

test('installs a checkpointed staging database and retires the previous database', async t => {
  const root = mkdtempSync(path.join(tmpdir(), 'migration-install-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const backupDir = path.join(root, 'backups');
  const destinationPath = path.join(root, 'lottery_tools.sqlite3');
  const stagingPath = path.join(root, 'staging.sqlite3');

  const oldStore = openLotteryDatabase({ dbPath: destinationPath, backupDir });
  oldStore.replaceMode('pingte', '2026-06-01', 'pingteyixiao', {
    query: '鼠', entries: [{ name: '旧数据', content: '鼠' }]
  });
  oldStore.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  oldStore.close();

  const newStore = openLotteryDatabase({ dbPath: stagingPath, backupDir });
  newStore.replaceMode('pingte', '2026-06-02', 'pingteyixiao', {
    query: '牛', entries: [{ name: '新数据', content: '牛' }]
  });
  newStore.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  newStore.close();

  const installed = await installVerifiedDatabase({
    stagingPath,
    destinationPath,
    backupDir,
    stamp: 'test-stamp'
  });
  assert.equal(installed.retiredPath, path.join(backupDir, 'pre-migration-test-stamp.sqlite3'));
  assert.equal(existsSync(stagingPath), false);
  assert.equal(existsSync(`${destinationPath}-wal`), false);
  assert.equal(existsSync(`${destinationPath}-shm`), false);

  const current = openLotteryDatabase({ dbPath: destinationPath, backupDir });
  assert.equal(current.getSnapshot('pingte').days['2026-06-02'].pingteyixiao.entries[0].name, '新数据');
  current.close();
  const retired = openLotteryDatabase({ dbPath: installed.retiredPath, backupDir });
  assert.equal(retired.getSnapshot('pingte').days['2026-06-01'].pingteyixiao.entries[0].name, '旧数据');
  retired.close();
});
