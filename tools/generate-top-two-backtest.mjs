import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

import { buildModeDirectoryStats } from '../assets/js/domain/stats.js';
import { evaluateCorrectness, isValidQuery } from '../assets/js/domain/rules.js';

const START_DATE = '2026-07-15';
const END_DATE = '2026-09-18';
const MIN_DAYS_EXCLUSIVE = 80;
const MAX_WRONG = 10;
const PROJECT_ID = 'jiuxiang';
const MODES = [
  { id: 'shabantou', name: '杀半头' },
  { id: 'shayixiao', name: '杀一肖' },
  { id: 'shayixiao2', name: '杀肖第二版' },
  { id: 'shayihe', name: '杀一合' }
];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const database = new DatabaseSync(path.join(root, 'data', 'lottery_tools.sqlite3'), { readOnly: true });
database.exec('PRAGMA query_only = ON');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function loadSnapshot() {
  const days = Object.fromEntries(database.prepare(`
    SELECT date FROM days
    WHERE project_id = ? AND date <= ?
    ORDER BY date
  `).all(PROJECT_ID, END_DATE).map(({ date }) => [date, {}]));
  const modes = database.prepare(`
    SELECT date, mode_id, query FROM daily_modes
    WHERE project_id = ? AND date <= ?
    ORDER BY date, mode_id
  `).all(PROJECT_ID, END_DATE);
  for (const row of modes) days[row.date][row.mode_id] = { query: row.query, entries: [] };
  const entries = database.prepare(`
    SELECT date, mode_id, name, content FROM data_entries
    WHERE project_id = ? AND date <= ?
    ORDER BY date, mode_id, name
  `).all(PROJECT_ID, END_DATE);
  for (const row of entries) {
    days[row.date][row.mode_id]?.entries.push({ name: row.name, content: row.content });
  }
  return { days };
}

function priorSnapshot(snapshot, date) {
  return { days: Object.fromEntries(Object.entries(snapshot.days).filter(([day]) => day < date)) };
}

function dateRange(start, end) {
  const dates = [];
  for (const day = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`); day <= last; day.setUTCDate(day.getUTCDate() + 1)) {
    dates.push(day.toISOString().slice(0, 10));
  }
  return dates;
}

function rankDay(snapshot, date, mode) {
  const today = snapshot.days[date]?.[mode.id];
  if (!today || !isValidQuery(PROJECT_ID, mode.id, today.query)) {
    return { date, query: today?.query || '', eligible: 0, ranks: [] };
  }
  const todayEntries = new Map(today.entries
    .filter(entry => String(entry.content).trim())
    .map(entry => [entry.name, entry]));
  const eligible = buildModeDirectoryStats({
    projectId: PROJECT_ID,
    modeId: mode.id,
    snapshot: priorSnapshot(snapshot, date)
  }).filter(row => (
    row.daysInSystem > MIN_DAYS_EXCLUSIVE
    && row.totalBroken <= MAX_WRONG
    && todayEntries.has(row.name)
  ));
  const grouped = new Map();
  for (const row of eligible) {
    const entry = todayEntries.get(row.name);
    const content = String(entry.content).trim();
    const group = grouped.get(content) || { content, names: [] };
    group.names.push(row.name);
    grouped.set(content, group);
  }
  const ranks = [...grouped.values()]
    .sort((left, right) => right.names.length - left.names.length
      || left.content.localeCompare(right.content, 'zh-CN', { numeric: true }))
    .slice(0, 2).map((group, index) => {
    const row = eligible.find(candidate => todayEntries.get(candidate.name).content.trim() === group.content);
    return {
      rank: index + 1,
      content: group.content,
      count: group.names.length,
      names: group.names,
      hit: evaluateCorrectness({
        projectId: PROJECT_ID,
        modeId: mode.id,
        date,
        name: row.name,
        query: today.query,
        content: group.content
      })
    };
  });
  return { date, query: today.query, eligible: eligible.length, ranks };
}

function summarize(mode, days) {
  const rank = number => {
    const rows = days.map(day => day.ranks[number - 1]).filter(Boolean);
    const hits = rows.filter(row => row.hit).length;
    return { appearances: rows.length, hits, rate: rows.length ? hits / rows.length : 0 };
  };
  return { mode, days, first: rank(1), second: rank(2) };
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function summaryCard(result) {
  return `<article class="summary-card">
    <h2>${escapeHtml(result.mode.name)}</h2>
    <div class="rank-summary"><b>第1名</b><strong>${result.first.hits}次</strong><span>${result.first.appearances}次出场 · ${percent(result.first.rate)}</span></div>
    <div class="rank-summary"><b>第2名</b><strong>${result.second.hits}次</strong><span>${result.second.appearances}次出场 · ${percent(result.second.rate)}</span></div>
  </article>`;
}

function detailSection(result) {
  const rows = result.days.map(day => {
    const rankCell = number => {
      const row = day.ranks[number - 1];
      if (!row) return '<td class="muted">无符合目录</td><td class="muted">—</td>';
      return `<td><b>${escapeHtml(row.content)}</b><small>出现 ${row.count} 次 · ${escapeHtml(row.names.join('、'))}</small></td><td class="${row.hit ? 'hit' : 'miss'}">${row.hit ? '命中' : '未中'}</td>`;
    };
    return `<tr><td>${day.date}</td><td>${escapeHtml(day.query)}</td><td>${day.eligible}</td>${rankCell(1)}${rankCell(2)}</tr>`;
  }).join('');
  return `<section class="details"><h2>${escapeHtml(result.mode.name)}每日明细</h2><div class="table-wrap"><table><thead><tr><th>日期</th><th>开奖号</th><th>符合目录</th><th>第1名</th><th>结果</th><th>第2名</th><th>结果</th></tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

const snapshot = loadSnapshot();
const dates = dateRange(START_DATE, END_DATE);
const results = MODES.map(mode => summarize(mode, dates.map(date => rankDay(snapshot, date, mode))));

assert.equal(dates.length, 66, '回测区间应包含66个自然日');
assert.equal(results.length, 4);
assert.ok(results.every(result => result.days.every(day => day.ranks.length <= 2)));
assert.ok(results.every(result => result.days.every(day => day.ranks.every(row => row.count > 0))));

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>四种类排行榜前二命中回测</title>
<style>
:root{color-scheme:dark;--bg:#0b0e12;--panel:#141922;--line:#2a3342;--text:#edf2f7;--muted:#96a3b5;--blue:#54a3ff;--green:#4ade80;--red:#fb7185}*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:15px/1.55 system-ui,"Microsoft YaHei",sans-serif}main{width:min(1500px,calc(100% - 32px));margin:28px auto 60px}header{padding:24px;background:linear-gradient(135deg,#172033,#111722);border:1px solid var(--line);border-radius:12px}h1{margin:0 0 8px;font-size:28px}header p{margin:4px 0;color:var(--muted)}.rules{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px}.rules span{padding:6px 10px;background:#0d1420;border:1px solid #2d405b;border-radius:6px;color:#c9d7e8}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}.summary-card,.details{background:var(--panel);border:1px solid var(--line);border-radius:10px}.summary-card{padding:18px}.summary-card h2,.details h2{margin:0 0 14px;font-size:19px}.rank-summary{display:grid;grid-template-columns:auto 1fr;align-items:center;padding:11px 0;border-top:1px solid var(--line)}.rank-summary b{color:var(--blue)}.rank-summary strong{justify-self:end;font-size:23px;color:var(--green)}.rank-summary span{grid-column:1/-1;color:var(--muted);font-size:13px}.details{margin-top:18px;padding:18px}.table-wrap{overflow:auto;max-height:620px;border:1px solid var(--line);border-radius:7px}table{width:100%;border-collapse:collapse;min-width:1050px}th{position:sticky;top:0;z-index:1;background:#1b2330;color:#cbd5e1;text-align:left}th,td{padding:10px 12px;border-bottom:1px solid #252e3b;white-space:nowrap}tbody tr:hover{background:#19212c}td small{display:block;color:var(--muted)}.hit{color:var(--green);font-weight:800}.miss{color:var(--red);font-weight:800}.muted{color:var(--muted)}footer{margin-top:20px;color:var(--muted);font-size:13px}@media(max-width:900px){.summary{grid-template-columns:repeat(2,1fr)}}@media(max-width:560px){main{width:min(100% - 18px,1500px)}.summary{grid-template-columns:1fr}h1{font-size:22px}}
</style></head><body><main>
<header><h1>四种类排行榜前二命中回测</h1><p>回测区间：${START_DATE} 至 ${END_DATE}，共 ${dates.length} 天</p><p>每天使用当日之前的历史成绩筛选目录；再把当天各目录内容按出现次数排行，用当天真实开奖号验证前两名。</p><div class="rules"><span>入库天数 &gt; ${MIN_DAYS_EXCLUSIVE}</span><span>总连错 ≤ ${MAX_WRONG}</span><span>两个条件同时生效</span><span>按内容出现次数降序</span></div></header>
<div class="summary">${results.map(summaryCard).join('')}</div>
${results.map(detailSection).join('')}
<footer>每天按符合条件的目录内容出现次数降序排行；同次数按内容名称排序。数据库只读，报告生成时间：${new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}。</footer>
</main></body></html>`;

const output = path.join(root, '导出数据', `排行榜前二命中回测_${START_DATE}_至_${END_DATE}.html`);
writeFileSync(output, html, 'utf8');
database.close();
console.log(JSON.stringify({ output, results: results.map(({ mode, first, second }) => ({ mode: mode.name, first, second })) }, null, 2));
