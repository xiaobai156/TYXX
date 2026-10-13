import { existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { backup, DatabaseSync } from 'node:sqlite';

import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { cloneProjectDefinitions, PROJECT_DEFINITIONS } from './projects.js';

const SCHEMA_VERSION = 1;

const MIGRATION_1 = `
  CREATE TABLE projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE modes (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    name TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (project_id, id),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) WITHOUT ROWID, STRICT;

  CREATE TABLE days (
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (project_id, date),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
  ) WITHOUT ROWID, STRICT;

  CREATE TABLE daily_modes (
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    mode_id TEXT NOT NULL,
    query TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (project_id, date, mode_id),
    FOREIGN KEY (project_id, date) REFERENCES days(project_id, date) ON DELETE CASCADE,
    FOREIGN KEY (project_id, mode_id) REFERENCES modes(project_id, id) ON DELETE RESTRICT
  ) WITHOUT ROWID, STRICT;

  CREATE TABLE data_entries (
    project_id TEXT NOT NULL,
    date TEXT NOT NULL,
    mode_id TEXT NOT NULL,
    name TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    original TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (project_id, date, mode_id, name),
    FOREIGN KEY (project_id, date, mode_id)
      REFERENCES daily_modes(project_id, date, mode_id)
      ON DELETE CASCADE
  ) WITHOUT ROWID, STRICT;

  CREATE INDEX data_entries_history
    ON data_entries(project_id, mode_id, name, date);

  CREATE TABLE app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ) STRICT;
`;

function runTransaction(connection, action) {
  connection.exec('BEGIN IMMEDIATE');
  try {
    const result = action();
    connection.exec('COMMIT');
    return result;
  } catch (error) {
    connection.exec('ROLLBACK');
    throw error;
  }
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === month - 1
    && parsed.getUTCDate() === day;
}

function cleanName(value, label = '目录名') {
  const name = typeof value === 'string' ? value.trim() : '';
  if (!name) throw new ValidationError(`${label}不能为空`);
  return name;
}

function cleanDirectoryName(value, label = '目录名') {
  const name = cleanName(value, label);
  if (/^_*QUERY_*$/i.test(name)) throw new ValidationError(`目录名 ${name} 是系统查询名`);
  return name;
}

function normalizeEntries(entries) {
  if (!Array.isArray(entries)) throw new ValidationError('entries 必须是数组');
  const names = new Set();
  return entries.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new ValidationError('目录记录必须是对象');
    }
    const name = cleanDirectoryName(item.name);
    if (names.has(name)) throw new ValidationError(`目录名重复：${name}`);
    names.add(name);
    return {
      name,
      content: item.content == null ? '' : String(item.content),
      original: item.original == null ? null : String(item.original)
    };
  });
}

function normalizeQuery(value) {
  return value == null ? '' : String(value);
}

function makeContentHash(content, original) {
  return createHash('sha256')
    .update(String(content ?? ''))
    .update('\u0000')
    .update(String(original ?? ''))
    .digest('hex');
}

function migrate(connection) {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ) STRICT;
  `);
  const applied = new Set(
    connection.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
  );
  if (!applied.has(1)) {
    runTransaction(connection, () => {
      connection.exec(MIGRATION_1);
      connection.prepare('INSERT INTO schema_migrations(version) VALUES (?)').run(1);
    });
  }
}

function catalogMatches(connection) {
  const storedProjects = connection.prepare(`
    SELECT id, name, sort_order
    FROM projects
    ORDER BY id
  `).all();
  const expectedProjects = PROJECT_DEFINITIONS
    .map(project => ({ id: project.id, name: project.name, sort_order: project.sortOrder }))
    .sort((left, right) => left.id.localeCompare(right.id));
  if (storedProjects.length !== expectedProjects.length) return false;
  if (storedProjects.some((row, index) => {
    const expected = expectedProjects[index];
    return row.id !== expected.id
      || row.name !== expected.name
      || row.sort_order !== expected.sort_order;
  })) return false;

  const storedModes = connection.prepare(`
    SELECT project_id, id, name, sort_order
    FROM modes
    ORDER BY project_id, id
  `).all();
  const expectedModes = PROJECT_DEFINITIONS
    .flatMap(project => project.modes.map(mode => ({
      project_id: project.id,
      id: mode.id,
      name: mode.name,
      sort_order: mode.sortOrder
    })))
    .sort((left, right) => `${left.project_id}/${left.id}`.localeCompare(`${right.project_id}/${right.id}`));
  if (storedModes.length !== expectedModes.length) return false;
  if (storedModes.some((row, index) => {
    const expected = expectedModes[index];
    return row.project_id !== expected.project_id
      || row.id !== expected.id
      || row.name !== expected.name
      || row.sort_order !== expected.sort_order;
  })) return false;

  const schemaMeta = connection.prepare(`
    SELECT value
    FROM app_meta
    WHERE key = 'schema_version'
  `).get();
  return schemaMeta?.value === String(SCHEMA_VERSION);
}

function seedCatalog(connection) {
  if (catalogMatches(connection)) return;
  runTransaction(connection, () => {
    const upsertProject = connection.prepare(`
      INSERT INTO projects(id, name, sort_order) VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET name = excluded.name, sort_order = excluded.sort_order
    `);
    const upsertMode = connection.prepare(`
      INSERT INTO modes(project_id, id, name, sort_order) VALUES (?, ?, ?, ?)
      ON CONFLICT(project_id, id) DO UPDATE SET
        name = excluded.name,
        sort_order = excluded.sort_order
    `);
    for (const project of PROJECT_DEFINITIONS) {
      upsertProject.run(project.id, project.name, project.sortOrder);
      for (const mode of project.modes) {
        upsertMode.run(project.id, mode.id, mode.name, mode.sortOrder);
      }
    }
    connection.prepare(`
      INSERT INTO app_meta(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `).run(String(SCHEMA_VERSION));
  });
}

function makeBackupFilename(backupDir) {
  const timestamp = new Date().toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '-')
    .replace('Z', '')
    .replace('.', '-');
  const base = `lottery_tools-${timestamp}`;
  let filename = `${base}.sqlite3`;
  let counter = 1;
  while (existsSync(path.join(backupDir, filename))) {
    filename = `${base}-${counter}.sqlite3`;
    counter += 1;
  }
  return filename;
}

export function openLotteryDatabase({ dbPath, backupDir }) {
  if (!dbPath) throw new ValidationError('dbPath 不能为空');
  const resolvedDbPath = path.resolve(dbPath);
  const resolvedBackupDir = path.resolve(backupDir || path.join(path.dirname(resolvedDbPath), 'backups'));
  mkdirSync(path.dirname(resolvedDbPath), { recursive: true });
  mkdirSync(resolvedBackupDir, { recursive: true });

  const connection = new DatabaseSync(resolvedDbPath);
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
  `);
  migrate(connection);
  seedCatalog(connection);

  let closed = false;

  function assertProject(projectId) {
    const project = PROJECT_DEFINITIONS.find(item => item.id === projectId);
    if (!project) throw new NotFoundError(`未知项目：${projectId}`);
    return project;
  }

  function assertMode(projectId, modeId) {
    const project = assertProject(projectId);
    const mode = project.modes.find(item => item.id === modeId);
    if (!mode) throw new ValidationError(`模式 ${modeId} 不属于项目 ${projectId}`);
    return mode;
  }

  function assertDate(date) {
    if (typeof date !== 'string' || !isValidDate(date)) {
      throw new ValidationError('日期格式必须是有效的 YYYY-MM-DD');
    }
  }

  const upsertDay = connection.prepare(`
    INSERT INTO days(project_id, date) VALUES (?, ?)
    ON CONFLICT(project_id, date) DO UPDATE SET
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);
  const upsertDailyMode = connection.prepare(`
    INSERT INTO daily_modes(project_id, date, mode_id, query) VALUES (?, ?, ?, ?)
    ON CONFLICT(project_id, date, mode_id) DO UPDATE SET
      query = excluded.query,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);
  const deleteModeEntries = connection.prepare(`
    DELETE FROM data_entries WHERE project_id = ? AND date = ? AND mode_id = ?
  `);
  const insertEntry = connection.prepare(`
    INSERT INTO data_entries(project_id, date, mode_id, name, content, original)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const upsertEntry = connection.prepare(`
    INSERT INTO data_entries(project_id, date, mode_id, name, content, original)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(project_id, date, mode_id, name) DO UPDATE SET
      content = excluded.content,
      original = excluded.original,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `);

  function writeModeQuery(projectId, date, modeId, query) {
    upsertDay.run(projectId, date);
    upsertDailyMode.run(projectId, date, modeId, query);
    if (projectId === 'dawei_shahao' && (modeId === 'shahao' || modeId === 'shaxiao')) {
      const pairedModeId = modeId === 'shahao' ? 'shaxiao' : 'shahao';
      upsertDailyMode.run(projectId, date, pairedModeId, query);
    }
  }

  function writeMode(projectId, date, modeId, query, entries) {
    writeModeQuery(projectId, date, modeId, query);
    deleteModeEntries.run(projectId, date, modeId);
    for (const entry of entries) {
      insertEntry.run(projectId, date, modeId, entry.name, entry.content, entry.original);
    }
  }

  function listProjects() {
    return cloneProjectDefinitions();
  }

  function normalizeSnapshotOptions(projectId, options = {}) {
    const from = options.from == null ? '' : String(options.from).trim();
    const to = options.to == null ? '' : String(options.to).trim();
    if (from) assertDate(from);
    if (to) assertDate(to);
    if (from && to && from > to) throw new ValidationError('from 不能晚于 to');
    const modes = Array.isArray(options.modes)
      ? [...new Set(options.modes.map(value => String(value).trim()).filter(Boolean))]
      : [];
    modes.forEach(modeId => assertMode(projectId, modeId));
    return {
      from,
      to,
      modes,
      includeMetadata: options.includeMetadata === true
    };
  }

  function buildSnapshotWhere(projectId, { from, to, modes }, { includeModes = false } = {}) {
    const clauses = ['project_id = ?'];
    const params = [projectId];
    if (from) {
      clauses.push('date >= ?');
      params.push(from);
    }
    if (to) {
      clauses.push('date <= ?');
      params.push(to);
    }
    if (includeModes && modes.length) {
      clauses.push(`mode_id IN (${modes.map(() => '?').join(', ')})`);
      params.push(...modes);
    }
    return { sql: clauses.join(' AND '), params };
  }

  function getSnapshot(projectId, options = {}) {
    const project = assertProject(projectId);
    const normalized = normalizeSnapshotOptions(projectId, options);
    const dayWhere = buildSnapshotWhere(projectId, normalized);
    const modeWhere = buildSnapshotWhere(projectId, normalized, { includeModes: true });
    const days = {};
    const projectDays = connection.prepare(`
      SELECT date FROM days
      WHERE ${dayWhere.sql}
      ORDER BY date
    `).all(...dayWhere.params);
    const modes = connection.prepare(`
      SELECT date, mode_id, query, created_at, updated_at
      FROM daily_modes
      WHERE ${modeWhere.sql}
      ORDER BY date, mode_id
    `).all(...modeWhere.params);
    const entries = connection.prepare(`
      SELECT date, mode_id, name, content, original, created_at, updated_at
      FROM data_entries
      WHERE ${modeWhere.sql}
      ORDER BY date, mode_id, name
    `).all(...modeWhere.params);

    for (const row of projectDays) days[row.date] = {};
    for (const row of modes) {
      days[row.date][row.mode_id] = normalized.includeMetadata
        ? {
            query: row.query,
            entries: [],
            created_at: row.created_at,
            updated_at: row.updated_at,
            version: row.updated_at
          }
        : { query: row.query, entries: [] };
    }
    for (const row of entries) {
      const mode = days[row.date]?.[row.mode_id];
      if (!mode) continue;
      const entry = { name: row.name, content: row.content, original: row.original };
      if (normalized.includeMetadata) {
        entry.created_at = row.created_at;
        entry.updated_at = row.updated_at;
        entry.content_hash = makeContentHash(row.content, row.original);
        entry.version = row.updated_at;
      }
      mode.entries.push(entry);
    }
    return {
      project: {
        ...project,
        modes: project.modes.map(mode => ({ ...mode }))
      },
      days
    };
  }

  function getSnapshotDataVersion(projectId) {
    assertProject(projectId);
    const row = connection.prepare(`
      SELECT
        (SELECT max(updated_at) FROM days WHERE project_id = ?) AS day_updated_at,
        (SELECT max(updated_at) FROM daily_modes WHERE project_id = ?) AS mode_updated_at,
        (SELECT max(updated_at) FROM data_entries WHERE project_id = ?) AS entry_updated_at,
        (SELECT count(*) FROM days WHERE project_id = ?) AS day_count,
        (SELECT count(*) FROM daily_modes WHERE project_id = ?) AS mode_count,
        (SELECT count(*) FROM data_entries WHERE project_id = ?) AS entry_count
    `).get(projectId, projectId, projectId, projectId, projectId, projectId);
    const latest = [row.day_updated_at, row.mode_updated_at, row.entry_updated_at]
      .filter(Boolean)
      .sort()
      .at(-1) || 'empty';
    return `db-v${SCHEMA_VERSION}:${latest}:${row.day_count}:${row.mode_count}:${row.entry_count}`;
  }

  function replaceMode(projectId, date, modeId, payload = {}) {
    assertMode(projectId, modeId);
    assertDate(date);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ValidationError('请求数据必须是对象');
    }
    const entries = normalizeEntries(payload.entries);
    const query = normalizeQuery(payload.query);
    runTransaction(connection, () => writeMode(projectId, date, modeId, query, entries));
    return { saved: entries.length };
  }

  function upsertDirectoryBatch(projectId, modeId, payload = {}) {
    assertMode(projectId, modeId);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new ValidationError('请求数据必须是对象');
    }
    const name = cleanDirectoryName(payload.name);
    if (!Array.isArray(payload.rows)) throw new ValidationError('rows 必须是数组');
    if (payload.rows.length < 1) throw new ValidationError('批量数据至少需要 1 行');
    if (payload.rows.length > 20) throw new ValidationError('批量数据最多 20 行');
    const dates = new Set();
    const rows = payload.rows.map(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        throw new ValidationError('批量行必须是对象');
      }
      assertDate(row.date);
      if (dates.has(row.date)) throw new ValidationError(`批量日期重复：${row.date}`);
      dates.add(row.date);
      const query = normalizeQuery(row.query);
      const content = row.content == null ? '' : String(row.content);
      if (!query.trim()) throw new ValidationError(`query 不能为空：${row.date}`);
      if (!content.trim()) throw new ValidationError(`content 不能为空：${row.date}`);
      return {
        date: row.date,
        query,
        content,
        original: row.original == null ? null : String(row.original)
      };
    });

    runTransaction(connection, () => {
      for (const row of rows) {
        writeModeQuery(projectId, row.date, modeId, row.query);
        upsertEntry.run(projectId, row.date, modeId, name, row.content, row.original);
      }
    });
    return { upserted: rows.length };
  }

  function deleteDate(projectId, date) {
    assertProject(projectId);
    assertDate(date);
    const result = runTransaction(connection, () => (
      connection.prepare('DELETE FROM days WHERE project_id = ? AND date = ?').run(projectId, date)
    ));
    return { deleted: result.changes > 0 };
  }

  function deleteDirectory(projectId, modeId, name) {
    assertMode(projectId, modeId);
    const directoryName = cleanName(name);
    const result = runTransaction(connection, () => connection.prepare(`
      DELETE FROM data_entries
      WHERE project_id = ? AND mode_id = ? AND name = ?
    `).run(projectId, modeId, directoryName));
    return { deleted: result.changes };
  }

  function deleteEntry(projectId, date, modeId, name) {
    assertMode(projectId, modeId);
    assertDate(date);
    const directoryName = cleanName(name);
    const result = runTransaction(connection, () => connection.prepare(`
      DELETE FROM data_entries
      WHERE project_id = ? AND date = ? AND mode_id = ? AND name = ?
    `).run(projectId, date, modeId, directoryName));
    return { deleted: result.changes > 0 };
  }

  function renameDirectory(projectId, modeId, oldName, newName) {
    assertMode(projectId, modeId);
    const sourceName = cleanName(oldName, '原目录名');
    const destinationName = cleanName(newName, '新目录名');
    return runTransaction(connection, () => {
      if (sourceName !== destinationName) {
        const conflict = connection.prepare(`
          SELECT 1 AS found FROM data_entries
          WHERE project_id = ? AND mode_id = ? AND name = ?
          LIMIT 1
        `).get(projectId, modeId, destinationName);
        if (conflict) throw new ConflictError(`目录 ${destinationName} 已经存在`);
      }
      const result = connection.prepare(`
        UPDATE data_entries
        SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE project_id = ? AND mode_id = ? AND name = ?
      `).run(destinationName, projectId, modeId, sourceName);
      return { renamed: result.changes };
    });
  }

  function exportData(projectId = null) {
    const projects = projectId ? [assertProject(projectId)] : PROJECT_DEFINITIONS;
    return {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      projects: projects.map(project => {
        const snapshot = getSnapshot(project.id);
        return {
          id: project.id,
          name: project.name,
          days: Object.entries(snapshot.days).map(([date, dayModes]) => ({
            date,
            modes: Object.entries(dayModes).map(([id, value]) => ({ id, ...value }))
          }))
        };
      })
    };
  }

  function normalizeImport(document) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) {
      throw new ValidationError('导入内容必须是对象');
    }
    if (document.schemaVersion !== SCHEMA_VERSION) {
      throw new ValidationError(`不支持的 schemaVersion：${document.schemaVersion}`);
    }
    if (!Array.isArray(document.projects)) throw new ValidationError('projects 必须是数组');
    const projectIds = new Set();
    return document.projects.map(projectData => {
      if (!projectData || typeof projectData !== 'object' || Array.isArray(projectData)) {
        throw new ValidationError('项目数据必须是对象');
      }
      const project = assertProject(projectData.id);
      if (projectIds.has(project.id)) throw new ValidationError(`项目重复：${project.id}`);
      projectIds.add(project.id);
      if (!Array.isArray(projectData.days)) throw new ValidationError(`项目 ${project.id} 的 days 必须是数组`);
      const dates = new Set();
      const days = projectData.days.map(day => {
        if (!day || typeof day !== 'object' || Array.isArray(day)) throw new ValidationError('日期数据必须是对象');
        assertDate(day.date);
        if (dates.has(day.date)) throw new ValidationError(`日期重复：${project.id}/${day.date}`);
        dates.add(day.date);
        if (!Array.isArray(day.modes)) throw new ValidationError(`日期 ${day.date} 的 modes 必须是数组`);
        const modeIds = new Set();
        const modes = day.modes.map(modeData => {
          if (!modeData || typeof modeData !== 'object' || Array.isArray(modeData)) {
            throw new ValidationError('模式数据必须是对象');
          }
          assertMode(project.id, modeData.id);
          if (modeIds.has(modeData.id)) throw new ValidationError(`模式重复：${project.id}/${day.date}/${modeData.id}`);
          modeIds.add(modeData.id);
          return {
            id: modeData.id,
            query: normalizeQuery(modeData.query),
            entries: normalizeEntries(modeData.entries)
          };
        });
        if (project.id === 'dawei_shahao') {
          const shahao = modes.find(mode => mode.id === 'shahao');
          const shaxiao = modes.find(mode => mode.id === 'shaxiao');
          if (shahao && shaxiao && shahao.query !== shaxiao.query) {
            throw new ValidationError(`共享查询值冲突：${project.id}/${day.date}/shahao+shaxiao`);
          }
        }
        return { date: day.date, modes };
      });
      return { id: project.id, days };
    });
  }

  function importData(document, { strategy = 'merge' } = {}) {
    if (!['merge', 'replace'].includes(strategy)) {
      throw new ValidationError('strategy 只能是 merge 或 replace');
    }
    const projects = normalizeImport(document);
    const counts = { projects: projects.length, days: 0, modes: 0, entries: 0 };
    runTransaction(connection, () => {
      for (const project of projects) {
        if (strategy === 'replace') {
          connection.prepare('DELETE FROM days WHERE project_id = ?').run(project.id);
        }
        for (const day of project.days) {
          counts.days += 1;
          if (day.modes.length === 0) upsertDay.run(project.id, day.date);
          for (const mode of day.modes) {
            writeMode(project.id, day.date, mode.id, mode.query, mode.entries);
            counts.modes += 1;
            counts.entries += mode.entries.length;
          }
        }
      }
    });
    return counts;
  }

  async function createBackup() {
    const filename = makeBackupFilename(resolvedBackupDir);
    const backupPath = path.join(resolvedBackupDir, filename);
    await backup(connection, backupPath);
    const verification = new DatabaseSync(backupPath, { readOnly: true });
    try {
      const result = verification.prepare('PRAGMA integrity_check').get().integrity_check;
      if (result !== 'ok') throw new Error(`备份完整性检查失败：${result}`);
    } finally {
      verification.close();
    }
    return { filename, path: backupPath };
  }

  function health() {
    return connection.prepare('PRAGMA quick_check').get().quick_check === 'ok';
  }

  function close() {
    if (closed) return;
    closed = true;
    connection.close();
  }

  return {
    connection,
    dbPath: resolvedDbPath,
    backupDir: resolvedBackupDir,
    listProjects,
    getSnapshot,
    getSnapshotDataVersion,
    replaceMode,
    upsertDirectoryBatch,
    deleteDate,
    deleteDirectory,
    deleteEntry,
    renameDirectory,
    exportData,
    importData,
    createBackup,
    health,
    close
  };
}
