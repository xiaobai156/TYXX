import { DatabaseSync } from 'node:sqlite';

const P = 'jiuxiang';
const DB = 'C:/Users/Administrator/Desktop/每天工具/统一分析平台/data/lottery_tools.sqlite3';
const SKIP = new Set(['2026-08-05']);

const { buildModeDirectoryStats } = await import(
  'file:///C:/Users/Administrator/Desktop/每天工具/统一分析平台/assets/js/domain/stats.js'
);

const db = new DatabaseSync(DB, { readOnly: true });
const modes = db.prepare('SELECT DISTINCT mode_id FROM daily_modes WHERE project_id=? ORDER BY mode_id')
  .all(P).map(r => r.mode_id);

function buildStats(mode, skipDates) {
  const days = {};
  const qs = db.prepare('SELECT date, query FROM daily_modes WHERE project_id=? AND mode_id=?').all(P, mode);
  for (const { date, query } of qs) {
    if (skipDates.has(date)) continue;
    days[date] = { [mode]: { query, entries: [] } };
  }
  const entries = db.prepare('SELECT date, name, content FROM data_entries WHERE project_id=? AND mode_id=?')
    .all(P, mode);
  for (const { date, name, content } of entries) {
    if (skipDates.has(date)) continue;
    if (!days[date]) continue;
    days[date][mode].entries.push({ name, content });
  }
  return buildModeDirectoryStats({ projectId: P, modeId: mode, snapshot: { days }, settledOnly: true });
}

console.log('种类'.padEnd(13), '正式榜', '|', '恰好120天', '121天', '122天', '|', '跳过8.5后正式榜', '掉榜数');
for (const mode of modes) {
  const hasDay = db.prepare('SELECT COUNT(*) c FROM daily_modes WHERE project_id=? AND mode_id=? AND date=?')
    .get(P, mode, '2026-08-05').c > 0;
  if (!hasDay) { console.log(mode.padEnd(13), '  无8.5数据'); continue; }

  const before = buildStats(mode, new Set());
  const after = buildStats(mode, SKIP);

  const officialBefore = before.filter(r => r.daysInSystem >= 120).length;
  const officialAfter = after.filter(r => r.daysInSystem >= 120).length;
  const at120 = before.filter(r => r.daysInSystem === 120).length;
  const at121 = before.filter(r => r.daysInSystem === 121).length;
  const at122 = before.filter(r => r.daysInSystem === 122).length;

  const afterNames = new Set(after.filter(r => r.daysInSystem >= 120).map(r => r.name));
  const dropped = before.filter(r => r.daysInSystem >= 120 && !afterNames.has(r.name)).length;

  console.log(
    mode.padEnd(13),
    String(officialBefore).padStart(5), '|',
    String(at120).padStart(7),
    String(at121).padStart(6),
    String(at122).padStart(6), '|',
    String(officialAfter).padStart(14),
    String(dropped).padStart(6)
  );
}
db.close();
