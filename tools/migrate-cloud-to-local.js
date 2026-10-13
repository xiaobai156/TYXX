import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { openLotteryDatabase } from '../server/database.js';
import {
  buildMigrationBundle,
  fetchAllRows,
  hashMigrationBundle,
  readLegacySupabaseConfig,
  summarizeMigrationBundle
} from './cloud-migration.js';

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LEGACY_ROOT = path.resolve(APP_ROOT, '..');
const DATA_DIR = path.resolve(
  process.env.LOTTERY_DATA_DIR || path.join(homedir(), 'Documents', '每天工具数据')
);
const DATABASE_PATH = path.join(DATA_DIR, 'lottery_tools.sqlite3');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MIGRATION_DIR = path.join(DATA_DIR, 'migration_backups');

const SOURCES = [
  {
    definition: {
      id: 'pingte',
      modes: ['pingteyixiao', 'pingtewei', 'shaliangxiao'],
      queryColumns: {}
    },
    configPath: path.join(LEGACY_ROOT, '平特云端', 'GPTV3_assets', 'js', '00-state-config.js'),
    dailySelect: 'date'
  },
  {
    definition: {
      id: 'dawei_shahao',
      modes: ['dawei', 'shahao', 'shengxiao', 'shaxiao'],
      queryColumns: {
        dawei: 'dawei_query',
        shahao: 'shahao_query',
        shengxiao: 'shengxiao_query',
        shaxiao: 'shahao_query'
      }
    },
    configPath: path.join(LEGACY_ROOT, '大围+杀号云端', 'GPTV3_assets', 'js', '00-state-config.js'),
    dailySelect: 'date,dawei_query,shahao_query,shengxiao_query'
  },
  {
    definition: {
      id: 'jiuxiang',
      modes: [
        'shabantou', 'shayitou', 'shayibo', 'shabanbo', 'shayihe',
        'shayixiao', 'shayixiao2', 'shayiduan', 'shayihang', 'shayiwei'
      ],
      queryColumns: {}
    },
    configPath: path.join(
      LEGACY_ROOT,
      '段-合-行-肖-半波-半头-尾云端',
      'GPTV3_assets', 'js', '00-state-config.js'
    ),
    dailySelect: 'date'
  }
];

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('Z', '').replace('.', '-');
}

function buildSourceAudit(sources) {
  const records = [];
  for (const source of sources) {
    const projectId = source.definition.id;
    source.dailyQueries.forEach((row, index) => {
      records.push({
        sourceProject: projectId,
        sourceTable: 'daily_queries',
        sourceKey: `${row.date}|${index}`,
        targetKey: `${projectId}|${row.date}`,
        status: 'project-day'
      });
    });
    source.entries.forEach((row, index) => {
      const isQuery = /^_*QUERY_*$/i.test(String(row.name ?? '').trim());
      records.push({
        sourceProject: projectId,
        sourceTable: 'data_entries',
        sourceKey: `${row.date}|${row.mode}|${row.name}|${index}`,
        targetKey: isQuery
          ? `${projectId}|${row.date}|${row.mode}|query`
          : `${projectId}|${row.date}|${row.mode}|${row.name}`,
        status: isQuery ? 'normalized-query' : 'business-entry'
      });
    });
  }
  return { schemaVersion: 1, records };
}

async function fetchSource(source) {
  const configText = await readFile(source.configPath, 'utf8');
  const config = readLegacySupabaseConfig(configText);
  const [dailyQueries, entries] = await Promise.all([
    fetchAllRows({
      ...config,
      path: `daily_queries?select=${source.dailySelect}&order=date.asc`
    }),
    fetchAllRows({
      ...config,
      path: 'data_entries?select=date,mode,name,content&order=date.asc,mode.asc,name.asc'
    })
  ]);
  return {
    definition: source.definition,
    dailyQueries,
    entries,
    sourceCounts: {
      projectId: source.definition.id,
      dailyQueries: dailyQueries.length,
      dataEntries: entries.length
    }
  };
}

async function removeSidecars(databasePath) {
  await Promise.all([
    rm(`${databasePath}-wal`, { force: true }),
    rm(`${databasePath}-shm`, { force: true })
  ]);
}

function checkpointAndClose(store) {
  try {
    store.connection.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  } finally {
    store.close();
  }
}

export async function installVerifiedDatabase({
  stagingPath,
  destinationPath,
  backupDir = BACKUP_DIR,
  stamp
}) {
  const stagingStore = openLotteryDatabase({ dbPath: stagingPath, backupDir });
  try {
    const integrity = stagingStore.connection.prepare('PRAGMA integrity_check').get().integrity_check;
    if (integrity !== 'ok') throw new Error(`待安装数据库完整性检查失败: ${integrity}`);
  } finally {
    checkpointAndClose(stagingStore);
  }
  await removeSidecars(stagingPath);

  let retiredPath = null;
  if (existsSync(destinationPath)) {
    const oldStore = openLotteryDatabase({ dbPath: destinationPath, backupDir });
    try {
      await oldStore.createBackup();
    } finally {
      checkpointAndClose(oldStore);
    }
    await removeSidecars(destinationPath);
    retiredPath = path.join(backupDir, `pre-migration-${stamp}.sqlite3`);
    await rename(destinationPath, retiredPath);
  }
  try {
    await rename(stagingPath, destinationPath);
  } catch (error) {
    if (retiredPath && !existsSync(destinationPath) && existsSync(retiredPath)) {
      await rename(retiredPath, destinationPath);
    }
    throw error;
  } finally {
    await removeSidecars(stagingPath);
  }
  await removeSidecars(destinationPath);
  return { retiredPath };
}

async function main() {
  await Promise.all([
    mkdir(DATA_DIR, { recursive: true }),
    mkdir(BACKUP_DIR, { recursive: true }),
    mkdir(MIGRATION_DIR, { recursive: true })
  ]);
  const stamp = timestamp();
  const stagingPath = path.join(DATA_DIR, `lottery_tools.migrating-${stamp}.sqlite3`);
  try {
    const fetched = await Promise.all(SOURCES.map(fetchSource));
    const exportedAt = new Date().toISOString();
    const rawPath = path.join(MIGRATION_DIR, `cloud-raw-${stamp}.json`);
    const normalizedPath = path.join(MIGRATION_DIR, `cloud-normalized-${stamp}.json`);
    const auditPath = path.join(MIGRATION_DIR, `cloud-audit-${stamp}.json`);
    const manifestPath = path.join(MIGRATION_DIR, `cloud-source-${stamp}.manifest.json`);
    await writeFile(rawPath, JSON.stringify({
      schemaVersion: 1,
      exportedAt,
      sources: fetched.map(source => ({
        projectId: source.definition.id,
        definition: source.definition,
        dailyQueries: source.dailyQueries,
        entries: source.entries
      }))
    }), 'utf8');

    const bundle = buildMigrationBundle(fetched);
    bundle.exportedAt = exportedAt;
    const expectedHash = hashMigrationBundle(bundle);
    const summary = summarizeMigrationBundle(bundle);
    await Promise.all([
      writeFile(normalizedPath, JSON.stringify(bundle), 'utf8'),
      writeFile(auditPath, JSON.stringify(buildSourceAudit(fetched)), 'utf8')
    ]);

    const store = openLotteryDatabase({ dbPath: stagingPath, backupDir: BACKUP_DIR });
    let importCounts;
    let actualHash;
    let finalBackup;
    try {
      importCounts = store.importData(bundle, { strategy: 'replace' });
      actualHash = hashMigrationBundle(store.exportData());
      if (actualHash !== expectedHash) throw new Error('迁移后数据哈希不一致');
      finalBackup = await store.createBackup();
    } finally {
      checkpointAndClose(store);
    }

    const installed = await installVerifiedDatabase({
      stagingPath,
      destinationPath: DATABASE_PATH,
      backupDir: BACKUP_DIR,
      stamp
    });
    await writeFile(manifestPath, JSON.stringify({
      schemaVersion: 1,
      exportedAt,
      expectedHash,
      actualHash,
      summary,
      importCounts,
      sourceCounts: fetched.map(source => source.sourceCounts),
      files: { rawPath, normalizedPath, auditPath, finalBackup },
      installed
    }), 'utf8');
    console.log(`迁移完成：${DATABASE_PATH}`);
  } catch (error) {
    await removeSidecars(stagingPath);
    await rm(stagingPath, { force: true });
    throw error;
  }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (invokedPath === import.meta.url) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}
