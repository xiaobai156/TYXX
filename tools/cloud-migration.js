import { createHash } from 'node:crypto';

const QUERY_NAME_PATTERN = /^_*QUERY_*$/i;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidDate(value) {
  if (!ISO_DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function normalizeText(value) {
  return value == null ? '' : String(value);
}

function requireDate(value, projectId) {
  const date = normalizeText(value).trim();
  if (!isValidDate(date)) throw new Error(`${projectId} 日期格式无效: ${date || '(empty)'}`);
  return date;
}

function ensureDay(days, date) {
  if (!days.has(date)) days.set(date, new Map());
  return days.get(date);
}

function ensureMode(day, modeId) {
  if (!day.has(modeId)) day.set(modeId, { query: '', entries: new Map() });
  return day.get(modeId);
}

function setQuery(projectId, date, modeId, state, value) {
  const query = normalizeText(value);
  if (!query) return;
  if (state.query && state.query !== query) {
    throw new Error(`${projectId}/${date}/${modeId} 查询值冲突`);
  }
  state.query = query;
}

function normalizeProjectSource({ definition, dailyQueries = [], entries = [] }) {
  if (!definition?.id || !Array.isArray(definition.modes)) {
    throw new Error('项目定义无效');
  }
  const projectId = definition.id;
  const allowedModes = new Set(definition.modes);
  const days = new Map();

  for (const row of dailyQueries) {
    const date = requireDate(row?.date, projectId);
    const day = ensureDay(days, date);
    for (const [modeId, column] of Object.entries(definition.queryColumns || {})) {
      if (!allowedModes.has(modeId)) throw new Error(`${projectId} 未知模式: ${modeId}`);
      const query = normalizeText(row?.[column]);
      if (query) setQuery(projectId, date, modeId, ensureMode(day, modeId), query);
    }
  }

  for (const row of entries) {
    const date = requireDate(row?.date, projectId);
    const modeId = normalizeText(row?.mode).trim();
    if (!allowedModes.has(modeId)) throw new Error(`${projectId} 未知模式: ${modeId || '(empty)'}`);
    const day = ensureDay(days, date);
    const mode = ensureMode(day, modeId);
    const name = normalizeText(row?.name).trim();
    if (!name) throw new Error(`${projectId}/${date}/${modeId} 目录名不能为空`);
    if (QUERY_NAME_PATTERN.test(name)) {
      setQuery(projectId, date, modeId, mode, row?.content);
      continue;
    }
    const normalizedEntry = {
      name,
      content: normalizeText(row?.content),
      original: row?.original == null || row.original === '' ? null : String(row.original)
    };
    const existing = mode.entries.get(name);
    if (existing) {
      if (existing.content === normalizedEntry.content && existing.original === normalizedEntry.original) {
        continue;
      }
      throw new Error(`${projectId}/${date}/${modeId} 重复目录内容冲突: ${name}`);
    }
    mode.entries.set(name, normalizedEntry);
  }

  return {
    id: projectId,
    days: [...days.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, modes]) => ({
        date,
        modes: [...modes.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([id, value]) => ({
            id,
            query: value.query,
            entries: [...value.entries.values()]
              .sort((left, right) => left.name.localeCompare(right.name))
          }))
      }))
  };
}

export function buildMigrationBundle(sources) {
  if (!Array.isArray(sources) || sources.length === 0) throw new Error('迁移源不能为空');
  const seen = new Set();
  const projects = sources.map(source => {
    const project = normalizeProjectSource(source);
    if (seen.has(project.id)) throw new Error(`项目重复: ${project.id}`);
    seen.add(project.id);
    return project;
  });
  return { schemaVersion: 1, projects };
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort().map(key => [key, canonicalize(value[key])])
  );
}

function sourceDataProjection(bundle) {
  return {
    schemaVersion: bundle?.schemaVersion,
    projects: (bundle?.projects || []).map(project => ({
      id: normalizeText(project?.id),
      days: (project?.days || []).map(day => ({
        date: normalizeText(day?.date),
        modes: (day?.modes || []).map(mode => ({
          id: normalizeText(mode?.id),
          query: normalizeText(mode?.query),
          entries: (mode?.entries || []).map(entry => ({
            name: normalizeText(entry?.name),
            content: normalizeText(entry?.content),
            original: entry?.original == null || entry.original === '' ? null : String(entry.original)
          })).sort((left, right) => left.name.localeCompare(right.name))
        })).sort((left, right) => left.id.localeCompare(right.id))
      })).sort((left, right) => left.date.localeCompare(right.date))
    })).sort((left, right) => left.id.localeCompare(right.id))
  };
}

export function hashMigrationBundle(bundle) {
  return createHash('sha256')
    .update(JSON.stringify(canonicalize(sourceDataProjection(bundle))))
    .digest('hex');
}

export function summarizeMigrationBundle(bundle) {
  const summary = { projects: 0, days: 0, modes: 0, entries: 0 };
  for (const project of bundle?.projects || []) {
    summary.projects += 1;
    for (const day of project?.days || []) {
      summary.days += 1;
      for (const mode of day?.modes || []) {
        summary.modes += 1;
        summary.entries += Array.isArray(mode?.entries) ? mode.entries.length : 0;
      }
    }
  }
  return summary;
}

export async function fetchAllRows({ url, key, path, pageSize = 1000, fetchImpl = fetch }) {
  if (!url || !key || !path) throw new Error('Supabase 请求参数不完整');
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error('pageSize 必须是正整数');
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const response = await fetchImpl(`${url.replace(/\/$/, '')}/rest/v1/${path}`, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Range: `${offset}-${offset + pageSize - 1}`
      }
    });
    if (!response.ok) {
      throw new Error(`Supabase 读取失败 (${response.status}): ${await response.text()}`);
    }
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error('Supabase 返回格式无效');
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

export function readLegacySupabaseConfig(source) {
  const url = normalizeText(source).match(/https:\/\/[a-z]+\.supabase\.co/i)?.[0];
  const key = normalizeText(source).match(/sb_publishable_[A-Za-z0-9_-]+/)?.[0];
  if (!url || !key) throw new Error('无法读取旧版 Supabase 配置');
  return { url, key };
}
