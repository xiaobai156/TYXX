import { buildModeDirectoryStats } from './stats.js';

function dateDifference(fromDate, toDate) {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.floor((end - start) / 86400000))
    : 0;
}

function compareMissingRows(left, right) {
  return right.noUpdateDays - left.noUpdateDays
    || left.lastUpdateDate.localeCompare(right.lastUpdateDate)
    || left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
}

function compareModeSummaries(left, right) {
  return right.maxNoUpdateDays - left.maxNoUpdateDays
    || right.rows.length - left.rows.length
    || left.coverageRate - right.coverageRate
    || left.order - right.order;
}

export function buildModeMissingDirectoryStats({
  projectId,
  projectName = projectId,
  modeId,
  modeName = modeId,
  snapshot,
  threshold = 0.9,
  order = 0
}) {
  const days = snapshot?.days || {};
  const modeDates = Object.keys(days)
    .filter(date => Object.prototype.hasOwnProperty.call(days[date] || {}, modeId))
    .sort();
  const latestDate = modeDates.at(-1) || '';
  const directoryStats = buildModeDirectoryStats({ projectId, modeId, snapshot });
  const latestEntries = latestDate && Array.isArray(days[latestDate]?.[modeId]?.entries)
    ? days[latestDate][modeId].entries
    : [];
  const latestNames = new Set(latestEntries.map(entry => String(entry?.name ?? '')).filter(Boolean));
  const totalDirectories = directoryStats.length;
  const latestDirectoryCount = latestNames.size;
  const coverageRate = totalDirectories ? latestDirectoryCount / totalDirectories : 0;
  const eligible = Boolean(latestDate) && totalDirectories > 0 && coverageRate >= threshold;
  const lastUpdateDates = new Map();
  if (eligible) {
    modeDates.forEach(date => {
      (days[date]?.[modeId]?.entries || []).forEach(entry => {
        const name = String(entry?.name ?? '');
        if (name) lastUpdateDates.set(name, date);
      });
    });
  }

  const rows = eligible ? directoryStats
    .filter(row => !latestNames.has(row.name))
    .map(row => {
      const lastUpdateDate = lastUpdateDates.get(row.name) || '';
      return {
        ...row,
        projectId,
        projectName,
        modeId,
        modeName,
        latestDate,
        lastUpdateDate,
        noUpdateDays: dateDifference(lastUpdateDate, latestDate)
      };
    })
    .filter(row => row.noUpdateDays > 0)
    .sort(compareMissingRows) : [];

  return {
    projectId,
    projectName,
    modeId,
    modeName,
    order,
    latestDate,
    totalDirectories,
    latestDirectoryCount,
    coverageRate,
    threshold,
    eligible,
    rows,
    maxNoUpdateDays: rows[0]?.noUpdateDays || 0
  };
}

export function buildMissingDirectoryStats({ projects = [], projectStates = {}, threshold = 0.9 }) {
  let order = 0;
  const modes = projects.flatMap(project => project.modes.map(mode => buildModeMissingDirectoryStats({
    projectId: project.id,
    projectName: project.name,
    modeId: mode.id,
    modeName: mode.name,
    snapshot: projectStates[project.id]?.snapshot,
    threshold,
    order: order++
  })));
  const visibleModes = modes.filter(mode => mode.eligible && mode.rows.length).sort(compareModeSummaries);
  const visibleRows = visibleModes.flatMap(mode => mode.rows);

  return {
    threshold,
    modes,
    visibleModes,
    eligibleModeCount: modes.filter(mode => mode.eligible).length,
    hiddenModeCount: modes.filter(mode => !mode.eligible).length,
    totalMissingDirectories: visibleRows.length,
    day1Count: visibleRows.filter(row => row.noUpdateDays === 1).length,
    day2PlusCount: visibleRows.filter(row => row.noUpdateDays >= 2).length,
    maxNoUpdateDays: visibleRows.reduce((maximum, row) => Math.max(maximum, row.noUpdateDays), 0)
  };
}
