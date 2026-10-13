// Read-only verification against the running local service. Writes only the audit report.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { PROJECTS } from '../assets/js/projects.js';
import { evaluateCorrectness, isValidQuery } from '../assets/js/domain/rules.js';
import { buildModeDirectoryStats } from '../assets/js/domain/stats.js';
import { buildLongTermRanking } from '../assets/js/domain/long-term-ranking.js';

const baseUrl = 'http://127.0.0.1:23962';
const reportDir = new URL('../tests/e2e/artifacts/long-term-ranking-20261002/', import.meta.url);

function referenceRows(projectId, modeId, snapshot, cutoff) {
  const histories = new Map();
  const listedDates = Object.keys(snapshot.days).filter(date => date <= cutoff).sort();
  const dates = [];
  if (listedDates.length > 1) {
    const cursor = new Date(`${listedDates[0]}T00:00:00Z`);
    const end = new Date(`${listedDates.at(-1)}T00:00:00Z`);
    while (cursor <= end) {
      dates.push(cursor.toISOString().slice(0, 10));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else dates.push(...listedDates);
  for (const date of dates) {
    const record = (snapshot.days[date] || {})[modeId];
    const entries = new Map((record?.entries || []).map(entry => [entry.name, entry]));
    for (const name of entries.keys()) if (!histories.has(name)) histories.set(name, []);
    for (const [name, history] of histories) {
      history.push(!isValidQuery(projectId, modeId, record?.query) ? null
        : entries.has(name) ? evaluateCorrectness({ projectId, modeId, date, name, query: record.query, content: entries.get(name).content }) : false);
    }
  }
  const rows = [...histories].map(([name, states]) => {
    const settledIndices = states.flatMap((state, index) => typeof state === 'boolean' ? [index] : []);
    const days = settledIndices.length;
    const right = states.filter(state => state === true).length;
    // Algebraically equivalent count-based formula, independent of production's proportion form.
    const score = days ? Math.round(1000 * (right + 3.8416 / 2
      - 1.96 * Math.sqrt(right * (days - right) / days + 3.8416 / 4)) / (days + 3.8416)) / 10 : 0;
    const window = states.slice(settledIndices[Math.max(0, days - 120)] ?? states.length);
    const maxWrong = Math.max(0, ...window.map(value => value === false ? 'F' : '|').join('').split('|').map(run => run.length));
    const recent = settledIndices.slice(-30).map(index => states[index]);
    return { name, days, right, score, maxWrong, recentRate: recent.length ? recent.filter(Boolean).length / recent.length : 0 };
  });
  const compare = (a, b) => b.score - a.score || a.maxWrong - b.maxWrong || b.recentRate - a.recentRate
    || b.days - a.days || a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
  return rows.sort((a, b) => Number(b.days >= 120) - Number(a.days >= 120)
    || (a.days < 120 ? b.days - a.days : 0) || compare(a, b));
}

const reports = [];
for (const project of PROJECTS) {
  const response = await fetch(`${baseUrl}/api/projects/${project.id}/snapshot`, { headers: { connection: 'close' } });
  assert.ok(response.ok, `GET snapshot: ${response.status}`);
  const { snapshot } = await response.json();
  const dates = Object.keys(snapshot.days).sort();
  assert.ok(dates.length, `${project.id}: empty snapshot`);
  const indices = [...new Set([Math.min(118, dates.length - 1), Math.min(119, dates.length - 1),
    Math.max(0, dates.length - 61), Math.max(0, dates.length - 31), dates.length - 2, dates.length - 1].filter(i => i >= 0))].sort((a, b) => a - b);
  for (const mode of project.modes) {
    const history = [];
    for (const index of indices) {
      const cutoff = dates[index];
      const input = { projectId: project.id, modeId: mode.id, snapshot, settledOnly: true, asOfDate: cutoff };
      const actual = buildLongTermRanking(buildModeDirectoryStats(input));
      const expected = referenceRows(project.id, mode.id, snapshot, cutoff);
      assert.deepEqual(actual.map(row => ({ name: row.name, days: row.daysInSystem, right: row.totalRight,
        score: row.longTermScore, maxWrong: row.recent120MaxWrong, recentRate: row.recent30Rate })), expected, `${project.id}/${mode.id}/${cutoff}`);
      const prefix = { ...snapshot, days: Object.fromEntries(Object.entries(snapshot.days).filter(([date]) => date <= cutoff)) };
      const prefixRows = buildLongTermRanking(buildModeDirectoryStats({ ...input, snapshot: prefix, asOfDate: '' }));
      assert.deepEqual(actual, prefixRows, `${mode.id}: future rows changed historical results`);
      const official = actual.filter(row => row.rankingEligible);
      assert.ok(official.every((row, rank) => row.daysInSystem >= 120 && row.officialRank === rank + 1));
      assert.ok(actual.filter(row => !row.rankingEligible).every(row => row.officialRank === null && row.daysInSystem < 120));
      history.push({ cutoff, officialCount: official.length, observationCount: actual.length - official.length,
        top5: official.slice(0, 5).map(row => ({ name: row.name, rank: row.officialRank, score: row.longTermScore,
          days: row.daysInSystem, right: row.totalRight, maxWrong120: row.recent120MaxWrong, recent30Rate: row.recent30Rate })) });
    }
    const latestInput = { projectId: project.id, modeId: mode.id, snapshot, settledOnly: true };
    const latest = buildLongTermRanking(buildModeDirectoryStats(latestInput)).filter(row => row.rankingEligible);
    const previous = buildLongTermRanking(buildModeDirectoryStats({ ...latestInput, asOfDate: dates.at(-2) })).filter(row => row.rankingEligible);
    const previousRanks = new Map(previous.map(row => [row.name, row.officialRank]));
    const shifts = latest.filter(row => previousRanks.has(row.name)).map(row => ({ name: row.name, before: previousRanks.get(row.name), after: row.officialRank }));
    const largestShift = shifts.sort((a, b) => Math.abs(b.after - b.before) - Math.abs(a.after - a.before))[0] || null;
    const previousTop20 = new Set(previous.slice(0, 20).map(row => row.name));
    reports.push({ projectId: project.id, modeId: mode.id, modeName: mode.name,
      snapshotHash: createHash('sha256').update(JSON.stringify(snapshot)).digest('hex'), history,
      latestDayChange: { largestShift, top20Retained: latest.slice(0, 20).filter(row => previousTop20.has(row.name)).length,
        newlyEligible: latest.filter(row => !previousRanks.has(row.name)).length } });
  }
}
mkdirSync(reportDir, { recursive: true });
writeFileSync(new URL('historical-verification.json', reportDir), JSON.stringify({ verifiedAt: new Date().toISOString(), reports }, null, 2));
for (const report of reports) {
  const latest = report.history.at(-1);
  console.log(`${report.projectId}/${report.modeId}: ${report.history.length} historical checks; official ${latest.officialCount}, observation ${latest.observationCount}; #1 ${latest.top5[0]?.name || 'none'}`);
}
console.log(`PASS: ${reports.length} modes, ${reports.reduce((sum, row) => sum + row.history.length, 0)} historical rankings independently reproduced; no future-data leakage.`);
