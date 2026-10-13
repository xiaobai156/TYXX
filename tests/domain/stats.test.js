import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildDailyModeSummary,
  buildDirectoryStats,
  buildModeDirectoryStats,
  buildRecommendationScore,
  countRecentSwitchMetric
} from '../../assets/js/domain/stats.js';

function mode(query, entries) {
  return { query, entries };
}

test('counts a missing pingte directory in detail history but not in uploaded-only daily statistics', () => {
  const snapshot = { days: {
    '2026-06-01': { pingteyixiao: mode('鼠', [{ name: 'A', content: '鼠' }]) },
    '2026-06-02': { pingteyixiao: mode('牛', []) },
    '2026-06-03': { pingteyixiao: mode('虎', [{ name: 'A', content: '虎' }]) }
  } };
  const stats = buildDirectoryStats({ projectId: 'pingte', modeId: 'pingteyixiao', snapshot, name: 'A' });
  assert.deepEqual(stats.stateHistory, [true, false, true]);
  assert.deepEqual(stats.stateDates, ['2026-06-01', '2026-06-02', '2026-06-03']);
  assert.equal(stats.daysInSystem, 3);
  assert.equal(stats.totalBroken, 1);
  assert.equal(stats.maxRightStreak, 1);
  assert.equal(stats.maxWrongStreak, 1);

  const day = buildDailyModeSummary({
    projectId: 'pingte', modeId: 'pingteyixiao', snapshot, date: '2026-06-02'
  });
  assert.deepEqual(day, { total: 0, right: 0, wrong: 0, entries: [] });
});

test('uses uploaded-only rows for dawei daily totals while detail still counts a missing row wrong', () => {
  const snapshot = { days: {
    '2026-06-01': { dawei: mode('01', [{ name: 'A', content: '01' }]) },
    '2026-06-02': { dawei: mode('02', []) }
  } };
  assert.deepEqual(
    buildDirectoryStats({ projectId: 'dawei_shahao', modeId: 'dawei', snapshot, name: 'A' }).stateHistory,
    [true, false]
  );
  assert.deepEqual(buildDailyModeSummary({
    projectId: 'dawei_shahao', modeId: 'dawei', snapshot, date: '2026-06-02'
  }), { total: 0, right: 0, wrong: 0, entries: [] });
});

test('applies the permanent 前八后一 zodiac exception in detail and daily statistics only', () => {
  const snapshot = { days: {
    '2026-04-30': { shengxiao: mode('猪', [
      { name: '前八后一', content: '猪' },
      { name: '其他目录', content: '猪' }
    ]) },
    '2026-05-01': { shengxiao: mode('猪', [
      { name: '前八后一', content: '牛鼠兔' },
      { name: '其他目录', content: '牛鼠兔' }
    ]) },
    '2026-05-02': { shengxiao: mode('猪', [
      { name: '前八后一', content: '牛鼠兔猪' },
      { name: '其他目录', content: '牛鼠兔猪' }
    ]) }
  } };

  assert.deepEqual(buildDirectoryStats({
    projectId: 'dawei_shahao', modeId: 'shengxiao', snapshot, name: '前八后一'
  }).stateHistory, [true, true, false]);
  assert.deepEqual(buildDirectoryStats({
    projectId: 'dawei_shahao', modeId: 'shengxiao', snapshot, name: '其他目录'
  }).stateHistory, [true, false, true]);
  const dailyEntries = buildDailyModeSummary({
    projectId: 'dawei_shahao', modeId: 'shengxiao', snapshot, date: '2026-05-01'
  }).entries;
  assert.deepEqual(Object.fromEntries(dailyEntries.map(entry => [entry.name, entry.correct])), {
    '前八后一': true,
    '其他目录': false
  });
});

test('keeps jiuxiang global missing days as null and breaks streaks without increasing days in system', () => {
  const snapshot = { days: {
    '2026-06-01': { shayiduan: mode('49', [{ name: 'A', content: '6段' }]) },
    '2026-06-02': {},
    '2026-06-03': { shayiduan: mode('48', [{ name: 'A', content: '6段' }]) }
  } };
  const stats = buildDirectoryStats({ projectId: 'jiuxiang', modeId: 'shayiduan', snapshot, name: 'A' });
  assert.deepEqual(stats.stateHistory, [true, null, true]);
  assert.deepEqual(stats.stateDates, ['2026-06-01', '2026-06-02', '2026-06-03']);
  assert.equal(stats.daysInSystem, 2);
  assert.equal(stats.maxRightStreak, 1);
  assert.equal(stats.currentStreak, 1);
  assert.deepEqual(buildDailyModeSummary({
    projectId: 'jiuxiang', modeId: 'shayiduan', snapshot, date: '2026-06-02'
  }), { total: 0, right: 0, wrong: 0, entries: [] });
});

test('keeps the two legacy recent-seven switch definitions separate', () => {
  const states = [true, false, false, true, false];
  assert.equal(countRecentSwitchMetric('dawei_shahao', states), 3);
  assert.equal(countRecentSwitchMetric('pingte', states), 2);
  assert.equal(countRecentSwitchMetric('jiuxiang', states), 2);
});

test('applies minimum prior right streak without leaking the target-day result', () => {
  const snapshot = { days: {
    '2026-06-01': { pingteyixiao: mode('鼠', [{ name: 'A', content: '鼠' }, { name: 'B', content: '牛' }]) },
    '2026-06-02': { pingteyixiao: mode('牛', [{ name: 'A', content: '牛' }, { name: 'B', content: '虎' }]) },
    '2026-06-03': { pingteyixiao: mode('虎', [{ name: 'A', content: '牛' }, { name: 'B', content: '虎' }]) }
  } };
  const summary = buildDailyModeSummary({
    projectId: 'pingte', modeId: 'pingteyixiao', snapshot,
    date: '2026-06-03', minimumPriorRightStreak: 2
  });
  assert.deepEqual(summary.entries, [{ name: 'A', correct: false }]);
  assert.deepEqual({ total: summary.total, right: summary.right, wrong: summary.wrong }, {
    total: 1, right: 0, wrong: 1
  });
});

test('builds all directory statistics in one project and mode without crossing data', () => {
  const snapshot = { days: {
    '2026-06-01': { pingteyixiao: mode('鼠', [
      { name: 'A', content: '鼠' },
      { name: 'B', content: '牛' }
    ]) },
    '2026-06-02': { pingteyixiao: mode('牛', [
      { name: 'A', content: '虎' },
      { name: 'B', content: '牛' }
    ]) }
  } };
  const rows = buildModeDirectoryStats({
    projectId: 'pingte', modeId: 'pingteyixiao', snapshot
  });
  assert.deepEqual(rows.map(row => ({
    name: row.name,
    stateHistory: row.stateHistory,
    totalBroken: row.totalBroken,
    currentState: row.currentState,
    currentStreak: row.currentStreak
  })), [
    { name: 'B', stateHistory: [false, true], totalBroken: 1, currentState: true, currentStreak: 1 },
    { name: 'A', stateHistory: [true, false], totalBroken: 1, currentState: false, currentStreak: 1 }
  ]);
});

test('keeps legacy recommendation switch strategies parameterized by project', () => {
  const states = [true, false, false, true, false];
  const common = {
    states,
    currentState: false,
    currentStreak: 1,
    daysInSystem: states.length,
    coverageBaseDays: states.length
  };
  const dawei = buildRecommendationScore({ projectId: 'dawei_shahao', ...common });
  const pingte = buildRecommendationScore({ projectId: 'pingte', ...common });
  assert.equal(dawei.recent7Switches, 3);
  assert.equal(pingte.recent7Switches, 2);
  assert.equal(Number.isFinite(dawei.recommendScore), true);
  assert.equal(Number.isFinite(pingte.recommendScore), true);
});
