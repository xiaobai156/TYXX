import { evaluateCorrectness, isValidQuery } from './rules.js';

const modeStatsCache = new WeakMap();
const dailySummaryCache = new WeakMap();

function getDays(snapshot) {
  return snapshot?.days && typeof snapshot.days === 'object' ? snapshot.days : {};
}

function getEntries(record) {
  return Array.isArray(record?.entries) ? record.entries : [];
}

function findEntry(record, name) {
  return getEntries(record).find(entry => String(entry?.name ?? '') === name) || null;
}

function emptyStats(name = '') {
  return {
    name,
    birthday: '',
    stateHistory: [],
    stateDates: [],
    daysInSystem: 0,
    totalRight: 0,
    totalBroken: 0,
    currentState: null,
    currentStreak: 0,
    maxRightStreak: 0,
    maxWrongStreak: 0,
    recent7Rate: 0,
    recent10Rate: 0,
    recent30WrongCount: 0
  };
}

function summarizeStates(name, birthday, states, stateDates = []) {
  let currentState = null;
  let currentStreak = 0;
  let maxRightStreak = 0;
  let maxWrongStreak = 0;
  for (const state of states) {
    if (state == null) {
      currentState = null;
      currentStreak = 0;
      continue;
    }
    if (state === currentState) currentStreak += 1;
    else {
      currentState = state;
      currentStreak = 1;
    }
    if (state) maxRightStreak = Math.max(maxRightStreak, currentStreak);
    else maxWrongStreak = Math.max(maxWrongStreak, currentStreak);
  }
  const valid = states.filter(state => state != null);
  const rate = count => {
    const recent = valid.slice(-count);
    return recent.length ? recent.filter(Boolean).length / recent.length : 0;
  };
  return {
    name,
    birthday,
    stateHistory: states,
    stateDates,
    daysInSystem: valid.length,
    totalRight: valid.filter(Boolean).length,
    totalBroken: valid.filter(state => !state).length,
    currentState,
    currentStreak,
    maxRightStreak,
    maxWrongStreak,
    recent7Rate: rate(7),
    recent10Rate: rate(10),
    recent30WrongCount: valid.slice(-30).filter(state => !state).length
  };
}

function buildModeHistory({ projectId, modeId, snapshot, settledOnly = false, asOfDate = '' }) {
  const days = getDays(snapshot);
  const names = new Set();
  // 种类级起始日：个别种类的数据来源在某天整体变了（例如平特尾从 2026-09-17 起只剩十几个站在更新），
  // 之前的记录与新口径不可比，按用户裁定从该日起重新计算，更早的日期整段丢弃。
  // 种类级起始日只对「真实跨过该日」的快照生效：若快照整体早于该日，说明是历史测试数据或旧快照，
  // 起始日规则不适用，避免把整份数据过滤成空。
  const rawStart = modeStartDates[`${projectId}/${modeId}`] || '';
  const snapshotLastDate = Object.keys(days).sort().at(-1) || '';
  const startDate = rawStart && snapshotLastDate >= rawStart ? rawStart : '';
  let listedDates = Object.keys(days)
    .filter(date => (!asOfDate || date <= asOfDate) && (!startDate || date >= startDate))
    .sort();
  if (settledOnly && listedDates.length > 1) {
    const firstDay = Date.parse(listedDates[0]);
    const dayCount = Math.round((Date.parse(listedDates.at(-1)) - firstDay) / 86400000) + 1;
    listedDates = Array.from({ length: dayCount }, (_, index) => (
      new Date(firstDay + index * 86400000).toISOString().slice(0, 10)
    ));
  }
  // 抓取塌方日：当天入库站点数骤降到前一天的一半以下，说明是没抓到而不是杀错了。
  // 只和「前一天」比，不和累计值比——累计值会随时间只增不减，站点陆续接入的早期会被误判。
  // 连续塌方超过 COLLAPSE_MAX_RUN 天就不再判塌方：那说明是数据形态变了（比如只剩十几个站在更新），
  // 不是抓取故障，否则会永久锁死、整个榜清零。
  // 判定与建索引同轮完成，避免重复遍历条目。
  const collapsedDays = new Set();
  let previousCount = 0;
  let collapseRun = 0;
  const dates = listedDates.map(date => {
    const day = days[date] || {};
    const record = day[modeId];
    const entries = new Map();
    for (const entry of getEntries(record)) {
      const rawName = String(entry?.name ?? '');
      const name = rawName.trim();
      if (name) names.add(name);
      if (!entries.has(rawName)) entries.set(rawName, entry);
    }
    const query = String(record?.query ?? '');
    let presentCount = 0;
    for (const raw of entries.keys()) {
      if (raw.trim()) presentCount += 1;
    }
    const dropped = previousCount >= COLLAPSE_MIN_ACTIVE
      && presentCount / previousCount < COLLAPSE_RATIO;
    if (dropped && collapseRun < COLLAPSE_MAX_RUN) {
      collapsedDays.add(date);
      collapseRun += 1;
    } else if (dropped) {
      collapseRun += 1;
    } else {
      collapseRun = 0;
    }
    previousCount = presentCount;
    return {
      date,
      emptyDay: Object.keys(day).length === 0,
      collapsedDay: collapsedDays.has(date),
      query,
      queryIsValid: isValidQuery(projectId, modeId, query),
      entries
    };
  });
  return { projectId, modeId, dates, names, settledOnly };
}

const COLLAPSE_RATIO = 0.5;
const COLLAPSE_MIN_ACTIVE = 20;
const COLLAPSE_MAX_RUN = 3;

// 种类级起始日：该日之前的记录与新口径不可比，整段丢弃。
// 目前只有平特尾需要：2026-09-17 起数据源只剩 14~17 个站在更新，用户裁定从这天重新算。
// 用可注入的方式而不是直接读全局常量，避免历史测试数据的日期被误伤。
let modeStartDates = { 'pingte/pingtewei': '2026-09-17' };

export function setModeStartDates(next) {
  modeStartDates = { ...next };
}

function buildIndexedDirectoryStats(history, name) {
  const directoryName = String(name ?? '');
  const birthdayIndex = history.dates.findIndex(day => day.entries.has(directoryName));
  if (birthdayIndex < 0) return emptyStats(directoryName);
  const birthday = history.dates[birthdayIndex].date;
  const states = [];
  const stateDates = [];
  for (let index = birthdayIndex; index < history.dates.length; index += 1) {
    const day = history.dates[index];
    // 塌方日整天跳过：不记对错、不算天数，也不中断连对连错。
    // 必须放在最前面——抓取故障最常见的形态是当天连开奖号都没抓到，
    // 若放在下面「无开奖号就记 null」之后，这些日子会先被 push(null)，连段照样被打断。
    // 也不能 push(null)：summarizeStates 遇到 null 会把 currentStreak 归零。
    if (day.collapsedDay) continue;
    if (history.settledOnly && !day.queryIsValid) {
      states.push(null);
      stateDates.push(day.date);
      continue;
    }
    if (history.projectId === 'jiuxiang' && day.emptyDay) {
      states.push(null);
      stateDates.push(day.date);
      continue;
    }
    if (!day.queryIsValid && history.projectId !== 'jiuxiang') continue;
    const entry = day.entries.get(directoryName);
    if (!day.queryIsValid || !entry) {
      states.push(false);
      stateDates.push(day.date);
      continue;
    }
    states.push(evaluateCorrectness({
      projectId: history.projectId,
      modeId: history.modeId,
      date: day.date,
      name: directoryName,
      query: day.query,
      content: entry.content
    }));
    stateDates.push(day.date);
  }
  return summarizeStates(directoryName, birthday, states, stateDates);
}

export function buildDirectoryStats({ projectId, modeId, snapshot, name, settledOnly = false }) {
  return buildIndexedDirectoryStats(buildModeHistory({ projectId, modeId, snapshot, settledOnly }), name);
}

export function buildDirectoryStatsBatch({ projectId, modeId, snapshot, names, settledOnly = false }) {
  const history = buildModeHistory({ projectId, modeId, snapshot, settledOnly });
  const result = new Map();
  for (const name of names) {
    const key = String(name ?? '');
    if (!result.has(key)) result.set(key, buildIndexedDirectoryStats(history, key));
  }
  return result;
}

export function rankRightStreaksBeforeWrong(stateHistory) {
  const streaks = [];
  let currentRightStreak = 0;
  for (const state of Array.isArray(stateHistory) ? stateHistory : []) {
    if (state === true) {
      currentRightStreak += 1;
      continue;
    }
    if (state === false && currentRightStreak > 0) streaks.push(currentRightStreak);
    currentRightStreak = 0;
  }
  return streaks.sort((left, right) => right - left);
}

export function summarizeRightStreakBreaks(stateHistory) {
  const counts = new Map();
  for (const days of rankRightStreaksBeforeWrong(stateHistory)) {
    counts.set(days, (counts.get(days) || 0) + 1);
  }
  return [...counts.entries()]
    .map(([days, count]) => ({ days, count }))
    .sort((left, right) => right.count - left.count || right.days - left.days);
}

export function countRecentSwitchMetric(projectId, states) {
  const recent = (states || []).filter(state => state != null).slice(-7);
  if (projectId === 'dawei_shahao') {
    return recent.reduce((total, state, index) => (
      index > 0 && state !== recent[index - 1] ? total + 1 : total
    ), 0);
  }
  if (!['pingte', 'jiuxiang'].includes(projectId)) throw new Error(`未知项目: ${projectId}`);
  return recent.reduce((total, state, index) => (
    state === false && (index === 0 || recent[index - 1] !== false) ? total + 1 : total
  ), 0);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function booleanRate(states) {
  return states.length ? states.filter(Boolean).length / states.length : 0;
}

function countAdjacentSwitches(values) {
  return values.reduce((total, value, index) => (
    index > 0 && value !== values[index - 1] ? total + 1 : total
  ), 0);
}

function hasAlternatingPattern(states, minimumLength = 4) {
  for (let start = 0; start <= states.length - minimumLength; start += 1) {
    let alternating = true;
    for (let index = start + 1; index < start + minimumLength; index += 1) {
      if (states[index] === states[index - 1]) {
        alternating = false;
        break;
      }
    }
    if (alternating) return true;
  }
  return false;
}

function currentStateScore(currentState, currentStreak) {
  if (currentState !== true) return 0;
  if (currentStreak >= 5) return 1;
  if (currentStreak === 4) return 0.96;
  if (currentStreak === 3) return 0.9;
  if (currentStreak === 2) return 0.76;
  return 0.35;
}

function historyStability(states) {
  if (states.length <= 1) return 0.5;
  const changeRate = countAdjacentSwitches(states) / (states.length - 1);
  let stability = 1 - changeRate;
  if (changeRate >= 0.8) stability *= 0.35;
  else if (changeRate >= 0.65) stability *= 0.5;
  else if (changeRate >= 0.5) stability *= 0.7;
  return clamp01(stability);
}

export function buildRecommendationScore({
  projectId,
  states,
  currentState,
  currentStreak,
  daysInSystem,
  coverageBaseDays = 30
}) {
  const history30 = (states || []).filter(state => state === true || state === false).slice(-30);
  const segmentWeights = [0.29, 0.25, 0.2, 0.14, 0.09, 0.03];
  const segmentRates = [];
  const segmentLengths = [];
  for (let index = 0; index < 6; index += 1) {
    const end = Math.max(history30.length - index * 5, 0);
    const segment = history30.slice(Math.max(end - 5, 0), end);
    segmentRates.push(booleanRate(segment));
    segmentLengths.push(segment.length);
  }

  const segmentScore = segmentRates.reduce((total, rate, index) => (
    total + rate * segmentWeights[index]
  ), 0);
  const front15 = average(segmentRates.slice(0, 3).filter((_, index) => segmentLengths[index] > 0));
  const back15 = average(segmentRates.slice(3).filter((_, index) => segmentLengths[index + 3] > 0));
  const trend = front15 - back15;
  const runStability = historyStability(history30);
  const validWeight = segmentWeights.reduce((total, weight, index) => (
    total + (segmentLengths[index] ? weight : 0)
  ), 0);
  const segmentMean = validWeight
    ? segmentRates.reduce((total, rate, index) => (
      total + (segmentLengths[index] ? rate * segmentWeights[index] : 0)
    ), 0) / validWeight
    : 0;
  const variance = validWeight
    ? segmentRates.reduce((total, rate, index) => (
      total + (segmentLengths[index] ? ((rate - segmentMean) ** 2) * segmentWeights[index] : 0)
    ), 0) / validWeight
    : 0;
  const validSegments = segmentLengths.filter(Boolean).length;
  const segmentStability = validSegments <= 1
    ? runStability
    : clamp01(1 - Math.sqrt(variance) / 0.5);
  const stability30 = clamp01(runStability * 0.55 + segmentStability * 0.45);
  const coverageBase = Math.max(1, Math.min(30, Number(coverageBaseDays) || 30));
  const coverage30 = clamp01(Math.min(Number(daysInSystem) || history30.length, coverageBase) / coverageBase);
  const recent7 = history30.slice(-7);
  const recent7Rate = booleanRate(recent7);
  const recent7Switches = countRecentSwitchMetric(projectId, recent7);
  const recent7Alternating = hasAlternatingPattern(recent7);
  const recent10Rate = booleanRate(history30.slice(-10));
  const stateScore = currentStateScore(currentState, currentStreak);

  const [s1 = 0, s2 = 0, s3 = 0] = segmentRates;
  const s2s3 = average([s2, s3].filter((_, index) => segmentLengths[index + 1] > 0));
  const choppyRates = segmentRates.filter((_, index) => index < 5 && segmentLengths[index] >= 3);
  const segmentSwing = choppyRates.length ? Math.max(...choppyRates) - Math.min(...choppyRates) : 0;
  const riskFlags = [];
  let riskPenalty = 0;
  const addRisk = (condition, penalty, flag) => {
    if (!condition) return;
    riskPenalty += penalty;
    riskFlags.push(flag);
  };
  addRisk(recent7.length >= 4 && recent7Rate < 0.43, 100, 'recent7-low');
  if (recent7Switches >= 5) addRisk(true, 100, 'recent7-switches-5');
  else addRisk(recent7Switches === 4, 18, 'recent7-switches-4');
  addRisk(recent7Alternating, 16, 'recent7-alternating');
  if (coverage30 < 0.4) addRisk(true, 100, 'coverage-low');
  else addRisk(coverage30 < 0.55, 10, 'coverage-thin');
  addRisk(s1 >= 0.8 && s2s3 < 0.55, 10, 's1-unconfirmed');
  addRisk(s1 + 0.12 < s2s3, 12, 's1-retreat');
  addRisk(
    segmentSwing >= 0.62
      || (choppyRates.length >= 4 && countAdjacentSwitches(choppyRates.map(rate => rate >= 0.5)) >= 4),
    12,
    'segment-choppy'
  );

  const recommendScore = Math.max(0,
    segmentScore * 60
      + stability30 * 12
      + Math.max(0, trend) * 10
      + coverage30 * 8
      + stateScore * 10
      + (recent7Rate >= 0.71 ? 3 : 0)
      - riskPenalty
  );
  return {
    history30,
    segmentRates,
    segmentScore,
    coverage30,
    stability30,
    trend,
    recent7Rate,
    recent10Rate,
    recent7Switches,
    riskPenalty,
    riskFlags,
    recommendScore
  };
}

export function buildModeDirectoryStats({ projectId, modeId, snapshot, settledOnly = false, asOfDate = '' }) {
  const cacheKey = `${projectId}|${modeId}|${settledOnly}|${asOfDate}`;
  const cache = snapshot && typeof snapshot === 'object'
    ? modeStatsCache.get(snapshot) || new Map()
    : null;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);
  if (cache && !modeStatsCache.has(snapshot)) modeStatsCache.set(snapshot, cache);
  const history = buildModeHistory({ projectId, modeId, snapshot, settledOnly, asOfDate });
  const coverageBaseDays = Math.max(1, Math.min(30, history.dates.length));
  const rows = [...history.names].map(name => {
    const stats = buildIndexedDirectoryStats(history, name);
    const score = buildRecommendationScore({
      projectId,
      states: stats.stateHistory,
      currentState: stats.currentState,
      currentStreak: stats.currentStreak,
      daysInSystem: stats.daysInSystem,
      coverageBaseDays
    });
    return { ...stats, ...score };
  }).sort((left, right) => (
    Number(right.currentState === true) - Number(left.currentState === true)
      || right.currentStreak - left.currentStreak
      || right.recommendScore - left.recommendScore
      || left.name.localeCompare(right.name, 'zh-CN')
  ));
  cache?.set(cacheKey, rows);
  return rows;
}

function snapshotBefore(snapshot, date) {
  return {
    ...snapshot,
    days: Object.fromEntries(Object.entries(getDays(snapshot)).filter(([dayDate]) => dayDate < date))
  };
}

export function buildDailyModeSummary({
  projectId,
  modeId,
  snapshot,
  date,
  minimumPriorRightStreak = 0
}) {
  const cache = snapshot && typeof snapshot === 'object'
    ? dailySummaryCache.get(snapshot) || new Map()
    : null;
  const cacheKey = `${projectId}|${modeId}|${date}|${minimumPriorRightStreak}`;
  if (cache?.has(cacheKey)) return cache.get(cacheKey);
  if (cache && !dailySummaryCache.has(snapshot)) dailySummaryCache.set(snapshot, cache);
  const days = getDays(snapshot);
  const record = days[date]?.[modeId];
  const query = String(record?.query ?? '');
  if (!record || !isValidQuery(projectId, modeId, query)) {
    const empty = { total: 0, right: 0, wrong: 0, entries: [] };
    cache?.set(cacheKey, empty);
    return empty;
  }
  const targetNames = getEntries(record).map(entry => String(entry?.name ?? '')).filter(Boolean);
  const priorSnapshot = snapshotBefore(snapshot, date);
  const uniqueNames = [...new Set(targetNames)]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
  const priorStats = minimumPriorRightStreak <= 0
    ? null
    : buildDirectoryStatsBatch({ projectId, modeId, snapshot: priorSnapshot, names: uniqueNames });
  const entries = uniqueNames
    .filter(name => {
      if (!priorStats) return true;
      const prior = priorStats.get(name);
      return Boolean(prior) && prior.currentState === true && prior.currentStreak >= minimumPriorRightStreak;
    })
    .map(name => {
      const entry = findEntry(record, name);
      const correct = entry ? evaluateCorrectness({
        projectId, modeId, date, name, query, content: entry.content
      }) : false;
      return { name, correct };
    });
  const summary = {
    total: entries.length,
    right: entries.filter(entry => entry.correct).length,
    wrong: entries.filter(entry => !entry.correct).length,
    entries
  };
  cache?.set(cacheKey, summary);
  return summary;
}
