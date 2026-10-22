import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = 'C:/Users/Administrator/Desktop/每天工具';
const HISTORY = path.join(ROOT, '爬虫合集/历史数据');
const DB = path.join(ROOT, '统一分析平台/data/lottery_tools.sqlite3');

const PROJECT_ID = 'jiuxiang';
// 294 期 = 2026-10-21，每往前一期减一天。
const BASE_PERIOD = 294;
const BASE_DATE = '2026-10-21';

// 用户指定的分组：8 站进杀一肖，鞠躬尽瘁进杀肖第二版。
const PLAN = [
  { mode: 'shayixiao', sites: ['忠不可兼', '鳞次栉比', '流年浅唱', '山穷水尽', '数奇命蹇', '万川境身', '相濡以沫', '雁过留声'] },
  { mode: 'shayixiao2', sites: ['鞠躬尽瘁'] }
];

// 用户补充的缺期值：流年浅唱 283 期 = 牛。
const FILLED = { '流年浅唱': { 283: '牛' } };

const ZODIAC = new Set(['鼠', '牛', '虎', '兔', '龙', '蛇', '马', '羊', '猴', '鸡', '狗', '猪']);

function periodToDate(period) {
  const date = new Date(`${BASE_DATE}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - (BASE_PERIOD - period));
  return date.toISOString().slice(0, 10);
}

function parseSite(name) {
  const raw = readFileSync(path.join(HISTORY, name, `${name}.txt`), 'utf8');
  const map = new Map();
  for (const line of raw.split(/\r?\n/)) {
    const match = line.trim().match(/^(\d{1,4})期\s*(\S+)$/);
    if (!match) continue;
    map.set(Number(match[1]), match[2]);
  }
  for (const [period, zodiac] of Object.entries(FILLED[name] || {})) {
    map.set(Number(period), zodiac);
  }
  return map;
}

const db = new DatabaseSync(DB);
db.exec('PRAGMA busy_timeout = 30000');
const upsertDay = db.prepare(`
  INSERT INTO days(project_id, date) VALUES (?, ?)
  ON CONFLICT(project_id, date) DO UPDATE SET
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);
const upsertEntry = db.prepare(`
  INSERT INTO data_entries(project_id, date, mode_id, name, content, original)
  VALUES (?, ?, ?, ?, ?, NULL)
  ON CONFLICT(project_id, date, mode_id, name) DO UPDATE SET
    content = excluded.content,
    original = excluded.original,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
`);

// 先确认每一期在 daily_modes 里都有开奖号，缺号直接报错，不静默写入半截数据。
const queries = new Map(
  db.prepare('SELECT date, query FROM daily_modes WHERE project_id = ? AND mode_id = ?')
    .all(PROJECT_ID, 'shayixiao')
    .map(row => [row.date, row.query])
);

const report = [];
db.exec('BEGIN');
try {
  for (const { mode, sites } of PLAN) {
    for (const site of sites) {
      const periods = parseSite(site);
      let written = 0;
      const missing = [];
      for (const [period, zodiac] of [...periods].sort((a, b) => a[0] - b[0])) {
        if (!ZODIAC.has(zodiac)) throw new Error(`${site} ${period}期 生肖非法: ${zodiac}`);
        const date = periodToDate(period);
        if (!queries.has(date)) {
          missing.push(`${period}期(${date})`);
          continue;
        }
        upsertDay.run(PROJECT_ID, date);
        upsertEntry.run(PROJECT_ID, date, mode, site, zodiac);
        written += 1;
      }
      report.push({ mode, site, periods: periods.size, written, missing });
    }
  }
  db.exec('COMMIT');
} catch (error) {
  db.exec('ROLLBACK');
  console.error('已回滚:', error.message);
  process.exit(1);
}

for (const row of report) {
  const flag = row.missing.length ? `  缺开奖号: ${row.missing.slice(0, 5).join(', ')}` : '';
  console.log(`${row.mode.padEnd(11)} ${row.site.padEnd(6)} 期数 ${String(row.periods).padStart(3)}  写入 ${String(row.written).padStart(3)}${flag}`);
}
console.log('合计写入', report.reduce((sum, row) => sum + row.written, 0), '条');
db.close();
