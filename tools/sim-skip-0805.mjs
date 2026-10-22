import { DatabaseSync } from 'node:sqlite';

const DB = 'C:/Users/Administrator/Desktop/每天工具/统一分析平台/data/lottery_tools.sqlite3';
const PROJECT = 'jiuxiang';
const MIN_DAYS = 120;

// Wilson 下限，与源码 long-term-ranking.js 完全一致
function longTermScore(right, n, z = 1.96) {
  if (!n) return 0;
  const p = right / n;
  const denominator = 1 + (z * z) / n;
  const centre = p + (z * z) / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return Number((((centre - margin) / denominator) * 100).toFixed(1));
}

const db = new DatabaseSync(DB, { readOnly: true });

function load(mode, skipDates) {
  const queries = new Map(
    db.prepare('SELECT date, query FROM daily_modes WHERE project_id=? AND mode_id=? ORDER BY date')
      .all(PROJECT, mode).map(r => [r.date, r.query])
  );
  const entries = db.prepare(
    'SELECT date, name, content FROM data_entries WHERE project_id=? AND mode_id=? ORDER BY date'
  ).all(PROJECT, mode);
  const byName = new Map();
  for (const row of entries) {
    if (!byName.has(row.name)) byName.set(row.name, new Map());
    byName.get(row.name).set(row.date, row.content);
  }
  const dates = [...queries.keys()];
  const result = [];
  for (const [name, contentByDate] of byName) {
    const states = [];
    for (const date of dates) {
      if (skipDates.has(date)) continue;      // 忽略该日：不计天数、不记错
      const content = contentByDate.get(date);
      states.push(content === undefined ? false : Boolean(content));
    }
    // 简化：content 非空即视为有记录，真实对错由开奖号比对，这里只做结构演示
    result.push({ name, states });
  }
  return { dates, byName, queries };
}

// 真实对错判定需要开奖号 -> 生肖映射，直接复用项目里的解析器更稳。
// 这里改用项目自身的 stats 逻辑重算，避免口径漂移。
const { buildModeDirectoryStats } = await import(
  'file:///C:/Users/Administrator/Desktop/每天工具/统一分析平台/assets/js/domain/stats.js'
);

function buildSnapshot(mode, skipDates) {
  const days = {};
  const queries = db.prepare('SELECT date, query FROM daily_modes WHERE project_id=? AND mode_id=?')
    .all(PROJECT, mode);
  for (const { date, query } of queries) {
    if (skipDates.has(date)) continue;
    days[date] = { [mode]: { query, entries: [] } };
  }
  const entries = db.prepare(
    'SELECT date, name, content FROM data_entries WHERE project_id=? AND mode_id=?'
  ).all(PROJECT, mode);
  for (const { date, name, content } of entries) {
    if (skipDates.has(date)) continue;
    if (!days[date]) continue;
    days[date][mode].entries.push({ name, content });
  }
  return { days };
}

const { buildLongTermRanking } = await import(
  'file:///C:/Users/Administrator/Desktop/每天工具/统一分析平台/assets/js/domain/long-term-ranking.js'
);

function rank(mode, skipDates) {
  const snapshot = buildSnapshot(mode, skipDates);
  const rows = buildLongTermRanking(
    buildModeDirectoryStats({ projectId: PROJECT, modeId: mode, snapshot, settledOnly: true })
  );
  const official = rows.filter(r => r.rankingEligible)
    .sort((a, b) => b.longTermScore - a.longTermScore || a.name.localeCompare(b.name));
  return { rows, official };
}

const EMPTY = new Set();
const SKIP_0805 = new Set(['2026-08-05']);

for (const mode of ['shayixiao', 'shayixiao2']) {
  const before = rank(mode, EMPTY);
  const after = rank(mode, SKIP_0805);
  const beforeRank = new Map(before.official.map((r, i) => [r.name, i + 1]));
  const afterRank = new Map(after.official.map((r, i) => [r.name, i + 1]));

  let changed = 0;
  let moved5 = 0;
  let maxMove = 0;
  let maxName = '';
  for (const [name, oldRank] of beforeRank) {
    const newRank = afterRank.get(name);
    if (newRank === undefined) continue;
    if (newRank !== oldRank) {
      changed += 1;
      const delta = Math.abs(newRank - oldRank);
      if (delta >= 5) moved5 += 1;
      if (delta > maxMove) { maxMove = delta; maxName = name; }
    }
  }

  const top = after.official.slice(0, 8).map((r, i) => `${i + 1}.${r.name}(${r.longTermScore.toFixed(1)})`);
  console.log(`\n=== ${mode} ===`);
  console.log(`正式榜: ${before.official.length} -> ${after.official.length}`);
  console.log(`名次变动: ${changed} 站，其中变动>=5名: ${moved5} 站，最大位移 ${maxMove} (${maxName})`);
  console.log(`忽略8/5后前8名: ${top.join('  ')}`);
  const sample = ['相濡以沫', '老奇人第一版', '关公又来了肖'];
  for (const name of sample) {
    const b = before.rows.find(r => r.name === name);
    const a = after.rows.find(r => r.name === name);
    if (b && a) {
      console.log(`  ${name}: ${b.longTermScore.toFixed(1)}(${b.longTermDays}天) -> ${a.longTermScore.toFixed(1)}(${a.longTermDays}天)`);
    }
  }
}
db.close();
