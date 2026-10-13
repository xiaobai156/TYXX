import {
  listDirectories,
  snapshotSummary
} from './data-model.js';
import {
  buildDirectoryStats,
  buildDailyModeSummary,
  buildModeDirectoryStats,
  buildRecommendationScore
} from './domain/stats.js';
import { buildMissingDirectoryStats } from './domain/missing-directory-stats.js';
import { buildLongTermRanking, compareLongTermRows, LONG_TERM_MIN_DAYS } from './domain/long-term-ranking.js';
import { evaluateCorrectness, getActualZodiac, getQueryTypes, isValidQuery, normalizeFullWidthDigits } from './domain/rules.js';

export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function emptyState(title, body) {
  return `
    <div class="empty-state">
      <strong>${escapeHtml(title)}</strong>
      <span>${escapeHtml(body)}</span>
    </div>
  `;
}

function modeSwitcher(project, activeModeId) {
  return `
    <div class="mode-switcher">
      <div class="nav-tabs" role="tablist" aria-label="数据模式">
        ${project.modes.map(mode => modeSwitcherButton(mode, activeModeId)).join('')}
      </div>
    </div>
  `;
}

function pageHeading(title, description, actions = '') {
  return `
    <header class="page-heading">
      <div>
        <h2>${escapeHtml(title)}</h2>
        <p>${escapeHtml(description)}</p>
      </div>
      ${actions ? `<div class="page-actions">${actions}</div>` : ''}
    </header>
  `;
}

function dataTable(headers, rows, emptyTitle = '暂无数据') {
  if (!rows.length) return emptyState(emptyTitle, '当前项目和模式下没有可显示的记录。');
  return `
    <div class="table-wrap">
      <table>
        <thead><tr>${headers.map(header => `<th scope="col">${escapeHtml(header)}</th>`).join('')}</tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
    </div>
  `;
}

const MODE_SYMBOLS = Object.freeze({
  pingteyixiao: '◆', pingtewei: '◧', shaliangxiao: '✕',
  dawei: '◎', shahao: '⚔', shengxiao: '◇', shaxiao: '✕',
  shabantou: '◐', shayitou: '◉', shayibo: '●', shabanbo: '◒',
  shayihe: '⊕', shayixiao: '◇', shayixiao2: '◇', shayiduan: '□',
  shayihang: '≡', shayiwei: '◧'
});

const MODE_COLORS = Object.freeze([
  '#69c0ff', '#73d13d', '#ffd666', '#ff7875', '#b37feb',
  '#36cfc9', '#ff9c6e', '#95de64', '#91caff', '#d3adf7'
]);

function modeSymbol(modeId) {
  return MODE_SYMBOLS[modeId] || '◆';
}

function formatRate(value) {
  return `${((Number(value) || 0) * 100).toFixed(1)}%`;
}

function stateLabel(row, suffix = '') {
  if (row.currentState == null) return '待定';
  return `${row.currentState ? '连对' : '连断'}${suffix}`;
}

function dateDifference(fromDate, toDate) {
  const start = Date.parse(`${fromDate}T00:00:00Z`);
  const end = Date.parse(`${toDate}T00:00:00Z`);
  return Number.isFinite(start) && Number.isFinite(end)
    ? Math.max(0, Math.floor((end - start) / 86400000))
    : 0;
}

function localDateString() {
  const date = new Date();
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function minimumRightStreak(states) {
  const runs = [];
  let count = 0;
  for (const value of states || []) {
    if (value === true) count += 1;
    else if (count) {
      runs.push(count);
      count = 0;
    }
  }
  if (count) runs.push(count);
  return runs.length ? Math.min(...runs) : 0;
}

function sparkline(states, dates = []) {
  const recentStates = (states || []).slice(-7);
  const recentDates = (dates || []).slice(-7);
  return `<span class="sparkline" aria-label="近7期走势">${recentStates.map((value, index) => `
    <i class="${value === true ? 'ok' : value === false ? 'bad' : 'miss'}"
      title="${escapeHtml(recentDates[index] || '')} ${value === true ? '正确' : value === false ? '错误' : '待定'}"></i>
  `).join('')}</span>`;
}

function modeSwitcherButton(mode, activeModeId) {
  return `
    <button
      type="button"
      role="tab"
      class="tab-item ${mode.id === activeModeId ? 'active' : ''}"
      aria-selected="${mode.id === activeModeId}"
      data-action="select-mode"
      data-mode="${escapeHtml(mode.id)}"
    >${modeSymbol(mode.id)} ${escapeHtml(mode.name)}</button>
  `;
}

export function renderCalendar({ project, projectState }) {
  const [year, month] = projectState.date.split('-').map(Number);
  const summary = snapshotSummary(projectState.snapshot);
  const allModeStats = Object.fromEntries(project.modes.map(mode => [
    mode.id,
    buildModeDirectoryStats({
      projectId: project.id,
      modeId: mode.id,
      snapshot: projectState.snapshot
    })
  ]));
  const maximum = (modeId, field) => Math.max(
    0,
    ...(allModeStats[modeId] || []).map(row => Number(row[field]) || 0)
  );
  const maximumAcrossModes = field => Math.max(
    0,
    ...Object.values(allModeStats).flat().map(row => Number(row[field]) || 0)
  );
  const dashboardCards = project.id === 'pingte'
    ? [
      ['全局最高连对 (平特一肖)', maximum('pingteyixiao', 'maxRightStreak'), 'success'],
      ['全局最高连对 (平特尾)', maximum('pingtewei', 'maxRightStreak'), 'warning']
    ]
    : project.id === 'dawei_shahao'
      ? [
        ['全局最高连对 (大围)', maximum('dawei', 'maxRightStreak'), 'success'],
        ['预警！最长连错 (杀号)', maximum('shahao', 'maxWrongStreak'), 'danger']
      ]
      : [
        ['全局最高连对', maximumAcrossModes('maxRightStreak'), 'success'],
        ['预警！最长连错', maximumAcrossModes('maxWrongStreak'), 'danger']
      ];
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const blankCells = Array.from({ length: firstWeekday }, () => '<span class="calendar-blank" aria-hidden="true"></span>');
  const dayCells = Array.from({ length: daysInMonth }, (_, index) => {
    const day = index + 1;
    const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayRecord = projectState.snapshot?.days?.[date] || null;
    const hasData = Boolean(dayRecord && Object.keys(dayRecord).length);
    const complete = hasData && project.modes.every(mode => {
      const record = dayRecord[mode.id];
      return record && Array.isArray(record.entries) && record.entries.length;
    });
    return `
      <button
        type="button"
        class="day-cell ${date === projectState.date ? 'today' : ''}"
        data-action="open-date"
        data-date="${date}"
        aria-label="${date}${hasData ? complete ? '，数据完整' : '，数据不完整' : '，无数据'}"
      >
        ${day}
        ${hasData ? `<span class="has-data-dot ${complete ? 'complete' : 'incomplete'}" aria-hidden="true"></span>` : ''}
      </button>
    `;
  });
  return `
    <section class="legacy-page legacy-calendar-page" aria-label="${escapeHtml(project.name)}日历主页">
    <div class="dashboard">
      ${dashboardCards.map(([label, value, tone]) => `
        <div class="dash-card dashboard-${tone}">
          <h3>${label.includes('预警') ? '❌' : '🎯'} ${escapeHtml(label)}</h3>
          <div class="big-num">${value || '-'}</div>
        </div>
      `).join('')}
      <div class="dash-card dashboard-warning">
        <h3>📅 活跃数据加载天数</h3>
        <div class="big-num">${summary.dayCount} 天</div>
      </div>
    </div>
    <div class="month-selector" aria-label="选择月份">
      ${Array.from({ length: 12 }, (_, index) => `
        <button
          class="month-btn ${month === index + 1 ? 'active' : ''}"
          type="button"
          data-action="select-month"
          data-month="${index + 1}"
        >${index + 1}月</button>
      `).join('')}
    </div>
    <div class="calendar-grid" aria-label="${year}年${month}月">
      ${['日', '一', '二', '三', '四', '五', '六'].map(day => `<span class="weekday">${day}</span>`).join('')}
      ${blankCells.join('')}
      ${dayCells.join('')}
    </div>
    </section>
  `;
}

export function renderWorkspace({
  project,
  projectState,
  record,
  busy,
  today,
  rawText = '',
  searchText = ''
}) {
  const rows = record.entries.map((entry, index) => ({ entry, index }));
  let queryIsValid = false;
  try {
    queryIsValid = isValidQuery(project.id, projectState.modeId, record.query);
  } catch {
    queryIsValid = false;
  }
  const priorSnapshot = {
    ...projectState.snapshot,
    days: Object.fromEntries(Object.entries(projectState.snapshot?.days || {})
      .filter(([date]) => date < projectState.date))
  };
  const previewRows = rows.map(({ entry, index }) => {
    const prior = buildDirectoryStats({
      projectId: project.id,
      modeId: projectState.modeId,
      snapshot: priorSnapshot,
      name: entry.name
    });
    const correct = queryIsValid && entry.name && entry.content
      ? evaluateCorrectness({
        projectId: project.id,
        modeId: projectState.modeId,
        date: projectState.date,
        name: entry.name,
        query: record.query,
        content: entry.content
      })
      : null;
    const currentState = correct == null ? prior.currentState : correct;
    const currentStreak = currentState == null
      ? 0
      : correct == null
        ? prior.currentStreak
        : prior.currentState === correct ? prior.currentStreak + 1 : 1;
    const recommendation = buildRecommendationScore({
      projectId: project.id,
      states: prior.stateHistory,
      currentState: prior.currentState,
      currentStreak: prior.currentStreak,
      daysInSystem: prior.daysInSystem,
      coverageBaseDays: Math.max(1, Math.min(30, Object.keys(priorSnapshot.days || {}).length))
    });
    return { entry, index, correct, currentState, currentStreak, prior: { ...prior, ...recommendation } };
  });
  const sorted = items => [...items].sort((left, right) => (
    right.currentStreak - left.currentStreak
      || left.entry.name.localeCompare(right.entry.name, 'zh-CN')
  ));
  const rightRows = sorted(previewRows.filter(row => !queryIsValid || row.correct === true));
  const wrongRows = sorted(previewRows.filter(row => queryIsValid && row.correct === false));
  const normalizedSearch = String(searchText).trim().toLocaleLowerCase('zh-CN');
  const entryMarkup = row => {
    const { entry, index, correct, currentState, currentStreak, prior } = row;
    const searchValue = `${entry.name}\n${entry.content}\n${entry.original || ''}`
      .toLocaleLowerCase('zh-CN');
    const hidden = normalizedSearch && !searchValue.includes(normalizedSearch);
    const recent7 = `${(prior.recent7Rate * 100).toFixed(1)}%`;
    const effectiveMaxRight = Math.max(prior.maxRightStreak || 0, currentState === true ? currentStreak : 0);
    const effectiveMaxWrong = Math.max(prior.maxWrongStreak || 0, currentState === false ? currentStreak : 0);
    const isExtremeRight = currentState === true
      && currentStreak >= 10
      && currentStreak >= effectiveMaxRight - 1
      && effectiveMaxRight >= 3;
    const isExtremeWrong = currentState === false
      && currentStreak >= effectiveMaxWrong - 1
      && effectiveMaxWrong >= 3;
    const tags = [
      prior.daysInSystem + (correct == null ? 0 : 1) <= 3
        ? '<span class="badge warning">⚠️新晋</span>'
        : '',
      isExtremeRight ? '<span class="badge extreme-right">🔗极限连对</span>' : '',
      isExtremeWrong ? '<span class="badge extreme-wrong">🔗极限连断</span>' : ''
    ].filter(Boolean).join(' ');
    const badge = currentState == null
      ? '<span class="badge break">待定</span>'
      : `<span class="badge ${currentState ? 'success' : 'danger'}">${currentState ? '连对' : '连错'} ${currentStreak}</span>`;
    return `
      <section
        class="data-row entry-row${hidden ? ' search-hidden' : ''}"
        data-entry-index="${index}"
        data-search="${escapeHtml(searchValue)}"
        data-action="show-trend"
        data-name="${escapeHtml(entry.name)}"
        data-mode="${escapeHtml(projectState.modeId)}"
        aria-label="目录 ${escapeHtml(entry.name)}"
        tabindex="0"
      >
        <input name="entry-name" type="hidden" value="${escapeHtml(entry.name)}">
        <input name="entry-content" type="hidden" value="${escapeHtml(entry.content)}">
        <input name="entry-original" type="hidden" value="${escapeHtml(entry.original ?? '')}">
        <div class="row-name">
          ${escapeHtml(entry.name)}${tags ? ` ${tags}` : ''}
          <small>近7天 ${recent7}｜稳定 ${formatRate(prior.stability30)}</small>
        </div>
        <div class="row-badges">${badge}</div>
        <div class="row-content">${escapeHtml(entry.content)}</div>
      </section>
    `;
  };
  const activeMode = project.modes.find(mode => mode.id === projectState.modeId);
  return `
    <section class="legacy-page legacy-workspace-page" aria-label="${escapeHtml(project.name)}数据工作台">
    <h2 class="visually-hidden">数据工作台</h2>
    ${modeSwitcher(project, projectState.modeId)}
    <form id="workspace-form" class="workspace-form">
      <input name="date" type="hidden" value="${escapeHtml(projectState.date)}">
      <div class="workspace-layout">
        <aside class="workspace-sidebar">
          <section class="panel paste-panel" aria-labelledby="paste-heading">
            <div class="panel-heading">
              <strong id="paste-heading">粘贴原始数据 (${escapeHtml(activeMode?.name || projectState.modeId)})</strong>
              <button class="btn btn-outline compact-button" type="button" data-action="clear-workspace">⚡ 一键清空并置顶</button>
            </div>
            <textarea name="raw-input" rows="14" placeholder="粘贴当前模式的原始资料">${escapeHtml(rawText)}</textarea>
          </section>

          <section class="panel control-panel">
            <div class="control-row query-field">
              <input name="query" type="text" value="${escapeHtml(record.query)}" autocomplete="off" placeholder="输入当日开奖结果..." aria-label="当日开奖结果">
            </div>
            <div class="control-row search-field">
              <span class="visually-hidden">搜索目录</span>
              <input name="directory-search" class="search-box" type="search" value="${escapeHtml(searchText)}" placeholder="🔍 搜索过滤资料名 (极速内存检索)..." aria-label="搜索过滤资料名">
            </div>
            <div class="control-row">
              <button class="btn btn-success save-button" type="submit" aria-label="保存当前模式" ${busy ? 'disabled' : ''}>💾 存至本地</button>
              <button class="btn btn-outline" type="button" data-action="clear-current-date">🗑 清空本日</button>
            </div>
            <label class="history-unlock">
              <input name="unlock-history" type="checkbox">
              <span>⚠ 允许自主修改历史 (跳过校验强覆写)</span>
            </label>
            <div class="workspace-counts" aria-label="当前目录统计">
              <span>资料总数: <b>${previewRows.length}</b></span>
              <span class="count-right">正确: <b>${queryIsValid ? rightRows.length : '-'}</b></span>
              <span class="count-wrong">错误: <b>${queryIsValid ? wrongRows.length : '-'}</b></span>
            </div>
          </section>
        </aside>

        <div class="workspace-content">
          <div class="section-title title-right"><span>✓ 资料正确区 (按连对排名)</span></div>
          <div id="list-right" class="data-list">
            ${rightRows.length ? rightRows.map(entryMarkup).join('') : emptyState('暂无正确资料', '输入查询值后自动判定。')}
          </div>

          <div class="section-title title-wrong"><span>✕ 资料错误区 (按连错排名)</span></div>
          <div id="list-wrong" class="data-list">
            ${wrongRows.length ? wrongRows.map(entryMarkup).join('') : emptyState('暂无错误资料', '当前没有判定为错误的目录。')}
          </div>
        </div>
      </div>
    </form>
    </section>
  `;
}

function analysisSortValue(row, key) {
  const days = Number(row.daysInSystem) || 0;
  const values = {
    count: row.currentStreak,
    total: row.totalBroken,
    maxRight: row.maxRightStreak,
    minRight: minimumRightStreak(row.stateHistory),
    maxWrong: row.maxWrongStreak,
    hitrate: days ? row.totalRight / days : 0,
    recent7: row.recent7Rate,
    recent10: row.recent10Rate,
    recent30Wrong: row.recent30WrongCount,
    monthWrong: currentMonthWrongCount(row),
    longTermScore: row.longTermScore,
    recent120MaxWrong: row.recent120MaxWrong,
    recent30Rate: row.recent30Rate,
    days
  };
  return Number(values[key]) || 0;
}

function sortAnalysisRows(rows, analysisState) {
  const key = analysisState?.sortKey || 'default';
  const cycle = Number(analysisState?.sortCycle) || 0;
  if (!cycle) return [...rows];
  return [...rows].sort((left, right) => {
    if (key === 'default') {
      const compared = left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
      return cycle === 1 ? -compared : compared;
    }
    if (key === 'status') {
      const leftRank = left.currentState === true ? 2 : left.currentState === false ? 1 : 0;
      const rightRank = right.currentState === true ? 2 : right.currentState === false ? 1 : 0;
      const compared = rightRank - leftRank
        || analysisSortValue(right, 'count') - analysisSortValue(left, 'count');
      return (cycle === 1 ? compared : -compared) || compareLongTermRows(left, right);
    }
    const compared = analysisSortValue(right, key) - analysisSortValue(left, key);
    if (compared) return cycle === 1 ? compared : -compared;
    return compareLongTermRows(left, right);
  });
}

function noUpdateRows(projectState, rows) {
  const days = projectState.snapshot?.days || {};
  const today = localDateString();
  return rows.map(row => {
    const lastUpdateDate = Object.keys(days).sort().reverse().find(date => (
      (days[date]?.[projectState.modeId]?.entries || []).some(entry => entry.name === row.name)
    )) || '';
    return { ...row, lastUpdateDate, noUpdateDays: dateDifference(lastUpdateDate, today) };
  }).filter(row => row.noUpdateDays > 0)
    .sort((left, right) => right.noUpdateDays - left.noUpdateDays || left.name.localeCompare(right.name, 'zh-CN'));
}

function currentMonthWrongCount(row, monthKey = localDateString().slice(0, 7)) {
  return (row.stateHistory || []).reduce((count, state, index) => (
    state === false && String(row.stateDates?.[index] || '').startsWith(`${monthKey}-`)
      ? count + 1
      : count
  ), 0);
}

function analysisHeader(label, key, analysisState) {
  const active = analysisState?.sortKey === key ? Number(analysisState.sortCycle) || 0 : 0;
  const suffix = active ? (key === 'status'
    ? active === 1 ? ' (连对优先)' : ' (连断优先)'
    : active === 1 ? ' ↓' : ' ↑') : '';
  const title = '按本列显示值排序；第三次点击恢复榜单顺序';
  return `<th><button type="button" class="analysis-sort-button" title="${title}" data-action="sort-analysis" data-key="${key}">${label}${suffix}</button></th>`;
}

export function renderAnalysis({ project, projectState, analysisState = {} }) {
  const sourceRows = buildLongTermRanking(buildModeDirectoryStats({
    projectId: project.id,
    modeId: projectState.modeId,
    snapshot: projectState.snapshot,
    settledOnly: true
  }));
  const officialRows = sortAnalysisRows(sourceRows.filter(row => row.rankingEligible), analysisState);
  const observationRows = sortAnalysisRows(sourceRows.filter(row => !row.rankingEligible), analysisState);
  const breakRankingNames = new Set(sortAnalysisRows(sourceRows, {
    sortKey: 'hitrate',
    sortCycle: 1
  }).slice(0, 20).map(row => row.name));
  const missing = noUpdateRows(projectState, sourceRows);
  const modeName = project.modes.find(mode => mode.id === projectState.modeId)?.name || projectState.modeId;
  const noUpdateExpanded = Boolean(analysisState.noUpdateExpanded);
  const day1 = missing.filter(row => row.noUpdateDays === 1).length;
  const day2 = missing.filter(row => row.noUpdateDays === 2).length;
  const day3 = missing.filter(row => row.noUpdateDays >= 3).length;
  const hasMinimum = project.id !== 'pingte';
  const columnCount = hasMinimum ? 17 : 16;
  const isCustomSort = Boolean(Number(analysisState.sortCycle));
  const renderRow = row => `
    <tr class="hover-row" data-action="manage-directory" data-name="${escapeHtml(row.name)}" data-mode="${escapeHtml(projectState.modeId)}" data-official-rank="${row.officialRank || ''}">
      <td>${row.rankingEligible ? `<span class="rank-num">${row.officialRank}</span>` : '<span class="ranking-observation-label">观察</span>'}</td>
      <th scope="row"><b>${escapeHtml(row.name)}</b>${row.daysInSystem <= 3 ? ' <span class="badge warning">新晋</span>' : ''}${row.currentState === false && row.currentStreak >= Math.max(3, row.maxWrongStreak - 1) ? ' <span class="badge purple">极限连断</span>' : ''}
        ${sparkline(row.stateHistory, row.stateDates)}
        <button class="btn btn-outline trend-button" type="button" data-action="show-trend" data-name="${escapeHtml(row.name)}" data-mode="${escapeHtml(projectState.modeId)}"${breakRankingNames.has(row.name) ? ' data-show-break-ranking="true"' : ''}>📈 走势</button>
      </th>
      <td class="status-right">${formatRate(row.recent30Rate)}</td>
      <td class="${row.currentState === true ? 'status-right' : row.currentState === false ? 'status-wrong' : 'status-missing'}">${row.currentState == null ? '待定' : row.currentState ? '✓ 连对中' : '✕ 连断中'}</td>
      <td><b>${row.currentStreak}</b> 天</td><td>${row.totalBroken} 次</td>
      <td class="status-right"><b>${row.maxRightStreak}</b> 天</td>
      ${hasMinimum ? `<td class="status-right"><b>${minimumRightStreak(row.stateHistory)}</b> 天</td>` : ''}
      <td class="status-wrong"><b>${row.maxWrongStreak}</b> 天</td>
      <td class="status-rate">${formatRate(row.daysInSystem ? row.totalRight / row.daysInSystem : 0)}</td>
      <td class="status-right">${formatRate(row.recent7Rate)}</td>
      <td class="status-right">${formatRate(row.recent10Rate)}</td>
      <td class="status-rate"><details class="ranking-score-details"><summary aria-label="${escapeHtml(row.name)}评分依据">${row.daysInSystem ? row.longTermScore.toFixed(1) : '—'}</summary>
        <div>有效 ${row.daysInSystem} 天，${row.totalRight} 对 / ${row.totalBroken} 错。<br>历史命中率 ${formatRate(row.daysInSystem ? row.totalRight / row.daysInSystem : 0)}，Wilson 长期可靠分 ${row.longTermScore.toFixed(1)}。<br>${row.rankingEligible ? `正式榜第 ${row.officialRank} 名` : `还需 ${LONG_TERM_MIN_DAYS - row.daysInSystem} 个有效统计日参榜`}。<br>同分先比较近120有效日最高连错，再比较近30有效日命中率，最后比较有效天数。</div>
      </details></td>
      <td class="status-wrong">${row.recent120MaxWrong} 天</td>
      <td class="status-wrong">${row.recent30WrongCount} 次</td>
      <td class="status-wrong">${currentMonthWrongCount(row)} 次</td>
      <td><b>${row.daysInSystem}</b> 天</td>
    </tr>`;
  const noUpdateList = missing.map((row, index) => `
    <div class="no-update-row">
      <span>${index + 1}</span><b>${escapeHtml(row.name)}</b>
      <strong class="${row.noUpdateDays >= 3 ? 'bad' : row.noUpdateDays === 2 ? 'warn' : 'ok'}">未更新 ${row.noUpdateDays} 天</strong>
      <span>最后更新：${escapeHtml(row.lastUpdateDate)}</span>
      <span>命中 ${formatRate(row.daysInSystem ? row.totalRight / row.daysInSystem : 0)}</span>
      <span>${stateLabel(row)}中</span>
      <span>${row.noUpdateDays >= 2 ? `<button class="btn btn-outline danger-action" type="button" data-action="delete-directory" data-name="${escapeHtml(row.name)}">删除</button>` : ''}</span>
    </div>
  `).join('');
  return `
    <section class="legacy-page legacy-analysis-page" aria-label="${escapeHtml(project.name)}详细分析">
      <h2 class="visually-hidden">详细分析</h2>
      <div id="analysis-mode-switcher" class="section-title analysis-mode-switcher" role="tablist" aria-label="分析模式">
        ${project.modes.map(mode => `
          <button class="btn btn-outline analysis-mode-btn ${mode.id === projectState.modeId ? 'active' : ''}" type="button"
            data-action="select-mode" data-mode="${escapeHtml(mode.id)}">${escapeHtml(mode.name)}</button>
        `).join('')}
      </div>

      <section id="no-update-panel" class="backtest-panel">
        <header class="no-update-head">
          <b>🕳 ${escapeHtml(modeName)}断更统计（按自然日）</b>
          <button class="btn btn-outline" type="button" data-action="toggle-no-update">${noUpdateExpanded ? '折叠' : '展开'}</button>
        </header>
        ${noUpdateExpanded ? `
          <div class="recommend-summary">
            <div class="recommend-card warn"><h4>断更总数</h4><div class="big">${missing.length}</div><div class="sub">今天未出现的目录</div></div>
            <div class="recommend-card ok"><h4>未更新 1 天</h4><div class="big">${day1}</div><div class="sub">最后更新昨天</div></div>
            <div class="recommend-card warn"><h4>未更新 2 天</h4><div class="big">${day2}</div><div class="sub">需要重点留意</div></div>
            <div class="recommend-card bad"><h4>未更新 3 天以上</h4><div class="big">${day3}</div><div class="sub">最长 ${missing[0]?.noUpdateDays || 0} 天</div></div>
          </div>
          <div class="no-update-table">
            <div class="no-update-columns"><span>排序</span><span>目录</span><span>断更天数</span><span>最后更新</span><span>命中率</span><span>状态</span><span>操作</span></div>
            ${noUpdateList || '<div class="no-update-empty">当前没有断更目录</div>'}
          </div>
        ` : ''}
      </section>

      <div class="ranking-toolbar">
        <b>${escapeHtml(modeName)} · 长期稳定榜</b>
        <button class="btn btn-outline" type="button" data-action="reset-analysis-ranking"${isCustomSort ? '' : ' disabled'}>${isCustomSort ? '恢复榜单顺序' : '当前为榜单顺序'}</button>
      </div>
      <details class="ranking-rules"><summary>排名规则 · 满120个有效统计日参榜</summary>
        <p>长期可靠分（保留一位小数）从高到低；同分按近120有效日最高连错从少到多、近30有效日命中率从高到低、有效天数从多到少依次比较，最后按资料名称排序。</p>
        <p>仅有效开奖计入天数。已开奖但目录缺失按错；待开奖不计天数，并中断连续段。窗口不足120或30个有效日时，使用已有记录。</p>
        <p>长期可靠分采用 Wilson 下限 × 100，z = 1.96，n = 有效天数，p = 正确次数 ÷ n：<br>(p + z²/(2n) − z × √(p(1−p)/n + z²/(4n²))) ÷ (1 + z²/n) × 100。零个有效日不评分。此分数用于评价历史记录，不是预测命中率。</p>
      </details>
      <div class="analysis-pager">共 ${sourceRows.length} 条，正式榜 ${officialRows.length} 条，观察区 ${observationRows.length} 条
        <span class="analysis-sort-note">${analysisState.sortCycle ? '当前按表头字段查看；正式榜名次保留' : '长期可靠分优先 · 近期表现辅助'}</span>
      </div>
      <div class="analysis-table-wrap">
        <table class="analysis-table" id="table-all">
          <thead><tr>
            <th># 榜单名次</th>
            ${analysisHeader('资料名称', 'default', analysisState)}
            ${analysisHeader('近30有效日命中率', 'recent30Rate', analysisState)}
            ${analysisHeader('目前状态', 'status', analysisState)}
            ${analysisHeader('持续天数', 'count', analysisState)}
            ${analysisHeader('总连断', 'total', analysisState)}
            ${analysisHeader('最高连对天数', 'maxRight', analysisState)}
            ${hasMinimum ? analysisHeader('最低连对天数', 'minRight', analysisState) : ''}
            ${analysisHeader('最高连错天数', 'maxWrong', analysisState)}
            ${analysisHeader('命中率', 'hitrate', analysisState)}
            ${analysisHeader('7天命中率', 'recent7', analysisState)}
            ${analysisHeader('10天命中率', 'recent10', analysisState)}
            ${analysisHeader('长期可靠分', 'longTermScore', analysisState)}
            ${analysisHeader('近120有效日最高连错', 'recent120MaxWrong', analysisState)}
            ${analysisHeader('近30错次', 'recent30Wrong', analysisState)}
            ${analysisHeader('本月错次', 'monthWrong', analysisState)}
            ${analysisHeader('有效入库天数', 'days', analysisState)}
          </tr></thead>
          <tbody data-ranking-group="official" aria-label="正式榜">${officialRows.map(renderRow).join('') || `<tr><td colspan="${columnCount}" class="no-update-empty">暂无满120个有效统计日的资料</td></tr>`}</tbody>
          <tbody data-ranking-group="observation" aria-label="观察区">
            <tr class="ranking-group-heading"><th colspan="${columnCount}" scope="rowgroup">观察区 · ${observationRows.length} 条 · 未满120个有效统计日，不占正式榜名次</th></tr>
            ${observationRows.map(renderRow).join('') || `<tr><td colspan="${columnCount}" class="no-update-empty">暂无观察资料</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

export function renderMissingDirectoryStats({ projects, projectStates, threshold = 0.9 }) {
  const summary = buildMissingDirectoryStats({ projects, projectStates, threshold });
  const thresholdPercent = Math.round(threshold * 100);
  const modePanels = summary.visibleModes.map(mode => `
    <section class="missing-summary-mode">
      <header class="missing-summary-mode-head">
        <div>
          <span class="missing-summary-project">${escapeHtml(mode.projectName)}</span>
          <h3>${modeSymbol(mode.modeId)} ${escapeHtml(mode.modeName)}</h3>
        </div>
        <div class="missing-summary-meta">
          <span>最新期 ${escapeHtml(mode.latestDate)}</span>
          <b>覆盖率 ${formatRate(mode.coverageRate)}</b>
          <strong>缺少 ${mode.rows.length} 个目录</strong>
        </div>
      </header>
      <div class="missing-summary-table">
        <div class="missing-summary-columns"><span>排序</span><span>目录</span><span>断更天数</span><span>最后更新</span><span>命中率</span><span>当前状态</span><span>操作</span></div>
        ${mode.rows.map((row, index) => `
          <div class="missing-summary-row">
            <span>${index + 1}</span>
            <b>${escapeHtml(row.name)}</b>
            <strong class="${row.noUpdateDays >= 3 ? 'bad' : row.noUpdateDays === 2 ? 'warn' : 'ok'}">未更新 ${row.noUpdateDays} 天</strong>
            <span>${escapeHtml(row.lastUpdateDate)}</span>
            <span class="status-rate">${formatRate(row.daysInSystem ? row.totalRight / row.daysInSystem : 0)}</span>
            <span class="${row.currentState === true ? 'status-right' : row.currentState === false ? 'status-wrong' : 'status-missing'}">${stateLabel(row, '中')}</span>
            <span class="missing-summary-actions">
              <button class="text-button" type="button" data-action="replenish-missing-directory" data-project="${escapeHtml(mode.projectId)}" data-mode="${escapeHtml(mode.modeId)}" data-name="${escapeHtml(row.name)}">补录</button>
              <button class="text-button danger-text" type="button" data-action="delete-missing-directory" data-project="${escapeHtml(mode.projectId)}" data-mode="${escapeHtml(mode.modeId)}" data-name="${escapeHtml(row.name)}">删除</button>
            </span>
          </div>
        `).join('')}
      </div>
    </section>
  `).join('');

  return `
    <section class="legacy-page missing-directory-summary-page" aria-label="缺少目录统计">
      <div class="section-title missing-summary-title">
        <div><b>🕳 缺少目录统计（全部种类汇总）</b><small>仅展示最新期覆盖率达到 ${thresholdPercent}% 的种类</small></div>
      </div>
      <div class="recommend-summary missing-summary-cards">
        <div class="recommend-card ok"><h4>符合展示条件</h4><div class="big">${summary.eligibleModeCount}</div><div class="sub">共 ${summary.modes.length} 个种类</div></div>
        <div class="recommend-card warn"><h4>缺少目录总数</h4><div class="big">${summary.totalMissingDirectories}</div><div class="sub">按种类分别计算</div></div>
        <div class="recommend-card ok"><h4>未更新 1 天</h4><div class="big">${summary.day1Count}</div><div class="sub">最后更新为上一期日期</div></div>
        <div class="recommend-card bad"><h4>未更新 2 天以上</h4><div class="big">${summary.day2PlusCount}</div><div class="sub">最长 ${summary.maxNoUpdateDays} 天</div></div>
      </div>
      <p class="missing-summary-note">最新期覆盖率低于 ${thresholdPercent}% 的 ${summary.hiddenModeCount} 个种类已隐藏，避免数据尚未录完造成误报。</p>
      <div class="missing-summary-list">
        ${modePanels || '<div class="no-update-empty">符合条件的种类当前没有缺少目录</div>'}
      </div>
    </section>
  `;
}

function dailyEmptyStat() {
  return { total: 0, right: 0, wrong: 0 };
}

function addDailyStat(target, source) {
  target.total += source.total || 0;
  target.right += source.right || 0;
  target.wrong += source.wrong || 0;
  return target;
}

function dailyFilterFor(dailyState, modeId, activeModeId, legacyMinimum) {
  const saved = dailyState?.filters?.[modeId];
  if (saved) return { enabled: Boolean(saved.enabled), days: Math.max(1, Number(saved.days) || 2) };
  if (modeId === activeModeId && Number(legacyMinimum) > 0) {
    return { enabled: true, days: Number(legacyMinimum) };
  }
  return { enabled: false, days: 2 };
}

function buildDailyComparison(raw, current, filter) {
  const rawRate = raw.total ? raw.right / raw.total * 100 : 0;
  const currentRate = current.total ? current.right / current.total * 100 : 0;
  return {
    enabled: filter.enabled,
    days: filter.days,
    current,
    rateDelta: currentRate - rawRate,
    wrongDelta: current.wrong - raw.wrong,
    totalDelta: current.total - raw.total
  };
}

const DAILY_ZODIACS = [...'鼠牛虎兔龙蛇马羊猴鸡狗猪'];

function dailyZodiacTokens(value) {
  return String(value ?? '')
    .replace(/[龍馬雞豬]/g, token => ({ '龍': '龙', '馬': '马', '雞': '鸡', '豬': '猪' })[token])
    .match(/[鼠牛虎兔龙蛇马羊猴鸡狗猪]/g) || [];
}

function dailyDirectoryEntries(record) {
  return (record?.entries || []).filter(entry => !/^_*QUERY_*$/i.test(String(entry?.name || '').trim()));
}

function dailyNumberTokens(value) {
  return (normalizeFullWidthDigits(value).match(/\d{1,2}/g) || [])
    .map(Number)
    .filter(number => number >= 1 && number <= 49)
    .map(number => String(number).padStart(2, '0'));
}

function dailyBelowRateExtra(stat) {
  if (!stat?.total) return {};
  const rate = stat.right / stat.total;
  return { monthlyRanking: { kind: 'belowRate', qualifies: rate < 0.68, rate } };
}

function dailyNumberTierExtra(record, maxTier) {
  const actual = dailyNumberTokens(record?.query)[0] || '';
  const counts = new Map();
  for (const entry of dailyDirectoryEntries(record)) {
    for (const number of dailyNumberTokens(entry.content)) {
      counts.set(number, (counts.get(number) || 0) + 1);
    }
  }
  const actualCount = counts.get(actual) || 0;
  if (!actual || !actualCount) return {};
  const countTiers = [...new Set(counts.values())].sort((left, right) => right - left);
  const tier = countTiers.indexOf(actualCount) + 1;
  return {
    monthlyRanking: {
      kind: 'numberTier',
      qualifies: tier > 0 && tier <= maxTier,
      actual,
      actualCount,
      tier,
      maxTier
    }
  };
}

function dailyShengxiaoExtra(record) {
  const counts = new Map(DAILY_ZODIACS.map(zodiac => [zodiac, 0]));
  for (const entry of dailyDirectoryEntries(record)) {
    for (const zodiac of dailyZodiacTokens(entry.content)) counts.set(zodiac, counts.get(zodiac) + 1);
  }
  const grouped = new Map();
  for (const zodiac of DAILY_ZODIACS) {
    const count = counts.get(zodiac);
    if (!count) continue;
    if (!grouped.has(count)) grouped.set(count, []);
    grouped.get(count).push(zodiac);
  }
  const ranking = [...grouped.keys()].sort((left, right) => right - left).slice(0, 3)
    .map((count, index) => ({ rank: index + 1, names: grouped.get(count), count }));
  if (!ranking.length) return {};

  const actual = dailyZodiacTokens(record.query)[0] || '';
  const firstPlaceHit = actual ? ranking[0].names.includes(actual) : null;
  const secondPlaceHit = actual && ranking[1] ? ranking[1].names.includes(actual) : null;
  const thirdPlaceHit = actual && ranking[2] ? ranking[2].names.includes(actual) : null;
  const queryHitCount = actual ? counts.get(actual) || 0 : null;
  const drawLine = actual
    ? `<div class="daily-stats-zodiac-draw">当日开奖：${escapeHtml(actual)}，共出现 ${queryHitCount} 次</div>`
    : '';
  const rankLines = ranking.map(item => {
    const hit = actual && item.names.includes(actual);
    const status = actual ? (hit ? '命中' : '未命中') : '未录入';
    const statusClass = actual ? (hit ? 'daily-stats-zodiac-hit' : 'daily-stats-zodiac-miss') : 'daily-stats-zodiac-pending';
    const label = ['第一名', '第二名', '第三名'][item.rank - 1];
    return `<div class="daily-stats-zodiac-rank">${label}：${escapeHtml(item.names.join('、'))} ${item.count}次（<span class="${statusClass}">${status}</span>）</div>`;
  }).join('');
  return {
    monthlyRanking: actual ? {
      firstPlaceHit, firstPlaceCount: ranking[0].count,
      secondPlaceHit, secondPlaceCount: ranking[1]?.count ?? null,
      thirdPlaceHit, thirdPlaceCount: ranking[2]?.count ?? null, queryHitCount
    } : null,
    markup: `<div class="daily-stats-zodiac-ranking">${drawLine}${rankLines}</div>`
  };
}

function dailyKillTwoExtra(record) {
  const query = String(record.query || '');
  const zodiacTokens = [...new Set(query.match(/[鼠牛虎兔龙蛇马羊猴鸡狗猪]/g) || [])];
  let actual = '';
  if (zodiacTokens.length === 1) {
    [actual] = zodiacTokens;
  } else if (zodiacTokens.length === 0) {
    const numberTokens = (query.match(/\d{1,2}/g) || []).map(number => String(Number(number)).padStart(2, '0'));
    if (numberTokens.length === 1) actual = getActualZodiac(numberTokens[0]);
  }
  const counts = new Map();
  for (const entry of dailyDirectoryEntries(record)) {
    const firstField = String(entry?.content || '').trim().split(/\s+/)[0] || '';
    const tokens = dailyZodiacTokens(firstField);
    if (tokens.length !== 2 || new Set(tokens).size !== 2 || tokens.join('') !== firstField) continue;
    for (const zodiac of tokens) counts.set(zodiac, (counts.get(zodiac) || 0) + 1);
  }
  if (!actual || !counts.size) return {};

  const rankCounts = [...new Set(counts.values())].sort((left, right) => right - left).slice(0, 2);
  const firstPlaceLeaders = [...counts].filter(([, value]) => value === rankCounts[0]).map(([zodiac]) => zodiac);
  const queryHitCount = counts.get(actual) || 0;
  const rankMarkup = rankCounts.map((count, index) => {
    const leaders = [...counts].filter(([, value]) => value === count).map(([zodiac]) => zodiac);
    const hit = leaders.includes(actual);
    const result = hit ? (leaders.length > 1 ? `命中${leaders.length}个` : '命中') : '不命中';
    const rank = index === 0 ? 'first' : 'second';
    const label = index === 0 ? '第一名' : '第二名';
    return `<div class="daily-stats-kill-two-result is-${rank}${hit ? '' : ' is-miss'}">${label}：${result}</div>`;
  }).join('');
  return {
    monthlyRanking: {
      firstPlaceHit: firstPlaceLeaders.includes(actual), firstPlaceCount: rankCounts[0],
      secondPlaceHit: rankCounts[1] ? queryHitCount === rankCounts[1] : null,
      secondPlaceCount: rankCounts[1] ?? null, queryHitCount
    },
    markup: `<div class="daily-stats-kill-two-draw-count">开奖生肖：${escapeHtml(actual)}，共${counts.get(actual) || 0}次</div>${rankMarkup}`
  };
}

function dailyModeExtra(project, modeId, record, stat = null) {
  if (!record) return {};
  if (project.id === 'dawei_shahao') {
    if (modeId === 'dawei') return dailyBelowRateExtra(stat);
    if (modeId === 'shahao') return dailyNumberTierExtra(record, 5);
    if (modeId === 'shaxiao') return dailyNumberTierExtra(record, 4);
    if (modeId === 'shengxiao') return dailyShengxiaoExtra(record);
  }
  if (project.id === 'pingte' && modeId === 'shaliangxiao') return dailyKillTwoExtra(record);
  if (project.id !== 'jiuxiang') return {};
  const counts = new Map();
  for (const entry of record.entries || []) {
    for (const type of getQueryTypes(modeId, entry.content)) {
      counts.set(type, (counts.get(type) || 0) + 1);
    }
  }
  const actualTypes = getQueryTypes(modeId, record.query);
  const [max = 0, second = 0] = [...new Set(counts.values())].sort((left, right) => right - left);
  const leaders = new Set([...counts].filter(([, count]) => count === max).map(([type]) => type));
  const runnersUp = new Set([...counts].filter(([, count]) => count === second).map(([type]) => type));
  const queryHitCount = actualTypes.length ? counts.get(actualTypes[0]) || 0 : null;
  const firstPlaceHit = actualTypes.length && max ? actualTypes.some(type => leaders.has(type)) : null;
  const secondPlaceHit = actualTypes.length && second ? actualTypes.some(type => runnersUp.has(type)) : null;
  return {
    firstPlaceHit,
    firstPlaceCount: max || null,
    secondPlaceHit,
    secondPlaceCount: second || null,
    queryHitCount,
    monthlyRanking: firstPlaceHit == null ? null : {
      firstPlaceHit, firstPlaceCount: max, secondPlaceHit, secondPlaceCount: second || null, queryHitCount
    }
  };
}

function buildDailyMonthRanking(dates, rows, modeId) {
  let kind = '';
  let maxTier = 0;
  let firstPlaceHits = 0;
  let secondPlaceHits = 0;
  let thirdPlaceHits = 0;
  let highestQueryHitCount = null;
  const hitDates = [];
  for (const date of dates) {
    const ranking = rows[date].modes[modeId].extra.monthlyRanking;
    if (!ranking) continue;
    kind ||= ranking.kind || 'firstPlace';
    if (kind === 'belowRate') {
      if (ranking.qualifies) hitDates.push({ date, rate: ranking.rate });
      continue;
    }
    if (kind === 'numberTier') {
      maxTier ||= ranking.maxTier;
      if (ranking.qualifies) hitDates.push({
        date,
        actual: ranking.actual,
        actualCount: ranking.actualCount,
        tier: ranking.tier,
        maxTier: ranking.maxTier
      });
      continue;
    }
    if (ranking.firstPlaceHit) firstPlaceHits += 1;
    if (ranking.secondPlaceHit) secondPlaceHits += 1;
    if (ranking.thirdPlaceHit) thirdPlaceHits += 1;
    if (ranking.firstPlaceHit || ranking.secondPlaceHit) {
      hitDates.push({ date, ...ranking });
    }
    highestQueryHitCount = highestQueryHitCount == null
      ? ranking.queryHitCount
      : Math.max(highestQueryHitCount, ranking.queryHitCount);
  }
  if (kind === 'belowRate') return { kind, qualifyingDays: hitDates.length, hitDates };
  if (kind === 'numberTier') return {
    kind,
    qualifyingDays: hitDates.length,
    hitDates,
    maxTier
  };
  return highestQueryHitCount == null ? null : { firstPlaceHits, secondPlaceHits, thirdPlaceHits, highestQueryHitCount, hitDates };
}

export function renderDailyRankingModal({ project, snapshot, monthKey, modeId }) {
  const mode = project.modes.find(item => item.id === modeId);
  if (!mode) return '';
  const dates = Object.keys(snapshot?.days || {})
    .filter(date => date.startsWith(`${monthKey}-`) && snapshot.days[date]?.[modeId])
    .sort()
    .reverse();
  const hitDates = [];
  let hasRanking = false;
  let rankingKind = '';
  let maxTier = 0;
  for (const date of dates) {
    const record = snapshot.days[date][modeId];
    const stat = modeId === 'dawei'
      ? buildDailyModeSummary({ projectId: project.id, modeId, snapshot, date })
      : null;
    const ranking = dailyModeExtra(project, modeId, record, stat).monthlyRanking;
    if (!ranking) continue;
    hasRanking = true;
    rankingKind ||= ranking.kind || 'firstPlace';
    maxTier ||= ranking.maxTier || 0;
    if (rankingKind === 'belowRate' && ranking.qualifies) {
      hitDates.push({ date, directoryCount: dailyDirectoryEntries(record).length, rate: ranking.rate });
    } else if (rankingKind === 'numberTier' && ranking.qualifies) {
      hitDates.push({
        date,
        directoryCount: dailyDirectoryEntries(record).length,
        actual: ranking.actual,
        actualCount: ranking.actualCount,
        tier: ranking.tier
      });
    } else if (rankingKind === 'firstPlace' && (ranking.firstPlaceHit || ranking.secondPlaceHit || ranking.thirdPlaceHit)) {
      hitDates.push({
        date,
        directoryCount: dailyDirectoryEntries(record).length,
        ...ranking
      });
    }
  }
  if (!hasRanking) return '';
  const [year, month] = monthKey.split('-');
  const title = `${year}年${month}月 · ${mode.name}`;
  const tierName = maxTier === 5 ? '五' : '四';
  const heading = rankingKind === 'belowRate'
    ? `本月低于68%：<b>${hitDates.length}天</b>`
    : rankingKind === 'numberTier'
      ? `开奖号进入前${tierName}档：<b>${hitDates.length}天</b>`
      : `<span>第一名本月命中：<b>${hitDates.filter(item => item.firstPlaceHit).length}次</b></span><span>第二名本月命中：<b>${hitDates.filter(item => item.secondPlaceHit).length}次</b></span>${modeId === 'shengxiao' ? `<span>第三名本月命中：<b>${hitDates.filter(item => item.thirdPlaceHit).length}次</b></span>` : ''}`;
  const emptyText = rankingKind === 'belowRate'
    ? '本月没有低于68%的日期'
    : rankingKind === 'numberTier'
      ? `本月没有开奖号进入前${tierName}档的日期`
      : '本月没有第一名或第二名命中日期';
  const rows = hitDates.length ? hitDates.map(item => {
    const metrics = rankingKind === 'belowRate'
      ? `<span>当日总目录：<b>${item.directoryCount}条</b></span><span>当日胜率：<b>${(item.rate * 100).toFixed(2)}%</b></span>`
      : rankingKind === 'numberTier'
        ? `<span>当日总目录：<b>${item.directoryCount}条</b></span><span>开奖号：<b>${escapeHtml(item.actual)}</b></span><span>所在档位：<b>第${item.tier}档</b></span><span>出现次数：<b>${item.actualCount}次</b></span>`
        : `<span>当日总目录：<b>${item.directoryCount}条</b></span>${item.firstPlaceHit ? `<span>当日第一名最高：<b>${item.firstPlaceCount}次</b></span>` : ''}${item.secondPlaceHit ? `<span>当日第二名次数：<b>${item.secondPlaceCount}次</b></span>` : ''}${modeId === 'shengxiao' && item.thirdPlaceHit ? `<span>当日第三名次数：<b>${item.thirdPlaceCount}次</b></span>` : ''}`;
    return `<div class="daily-ranking-row"><time datetime="${escapeHtml(item.date)}">${escapeHtml(item.date)}</time><div class="daily-ranking-metrics">${metrics}</div></div>`;
  }).join('') : `<div class="daily-ranking-empty">${emptyText}</div>`;
  const dialogLabel = rankingKind === 'firstPlace' ? '第一名和第二名命中日期' : '统计日期明细';
  return `
    <div class="legacy-modal-host daily-ranking-modal-host" role="dialog" aria-modal="true" aria-label="${escapeHtml(title)}${dialogLabel}">
      <section class="daily-ranking-dialog">
        <button class="chart-close" type="button" data-action="close-modal" aria-label="关闭${dialogLabel}">✕</button>
        <header class="daily-ranking-head"><h3>${escapeHtml(title)}</h3><p>${heading}</p></header>
        <div class="daily-ranking-list">${rows}</div>
      </section>
    </div>
  `;
}

function dailyMonthRanking(summary) {
  if (!summary) return '';
  if (summary.kind === 'belowRate') return `<div class="daily-stats-month-ranking"><span>本月低于68%：<b>${summary.qualifyingDays}天</b></span></div>`;
  if (summary.kind === 'numberTier') {
    const tierName = summary.maxTier === 5 ? '五' : '四';
    return `<div class="daily-stats-month-ranking"><span>开奖号进入前${tierName}档：<b>${summary.qualifyingDays}天</b></span></div>`;
  }
  return `<div class="daily-stats-month-ranking"><span>第一名本月命中：<b>${summary.firstPlaceHits}次</b></span><span>第二名本月命中：<b>${summary.secondPlaceHits}次</b></span>${summary.thirdPlaceHits == null ? '' : `<span>第三名本月命中：<b>${summary.thirdPlaceHits}次</b></span>`}<span>本月开奖号最高：<b>${summary.highestQueryHitCount}次</b></span></div>`;
}

function dailyCell(stat, comparison = null, extra = {}) {
  const current = comparison?.enabled ? comparison.current : stat;
  const rate = current.total ? current.right / current.total : 0;
  const firstPlace = extra.firstPlaceHit == null ? '' : `
    <div class="daily-stats-first-place ${extra.firstPlaceHit ? 'hit' : 'miss'}">第一名：${extra.firstPlaceHit ? '命中' : '未中'}${extra.firstPlaceCount ? `（${extra.firstPlaceCount}次）` : ''}</div>`;
  const secondPlace = extra.secondPlaceHit == null ? '' : `
    <div class="daily-stats-second-place ${extra.secondPlaceHit ? 'hit' : 'miss'}">第二名：${extra.secondPlaceHit ? '命中' : '未中'}（${extra.secondPlaceCount}次）</div>`;
  const thirdPlace = extra.thirdPlaceHit == null ? '' : `
    <div class="daily-stats-third-place ${extra.thirdPlaceHit ? 'hit' : 'miss'}">第三名：${extra.thirdPlaceHit ? '命中' : '未中'}（${extra.thirdPlaceCount}次）</div>`;
  const queryCount = extra.queryHitCount == null ? '' : `<div class="daily-stats-query-hit-count">开奖号：${extra.queryHitCount}次</div>`;
  const compare = comparison?.enabled ? `
    <div class="daily-stats-compare-note">
      <span>比原始</span>
      <b class="${comparison.rateDelta >= 0 ? 'daily-stats-delta-up' : 'daily-stats-delta-down'}">${comparison.rateDelta >= 0 ? '+' : ''}${comparison.rateDelta.toFixed(1)}%</b>
      <b class="${comparison.wrongDelta <= 0 ? 'daily-stats-delta-good' : 'daily-stats-delta-warn'}">${comparison.wrongDelta <= 0 ? `少错 ${Math.abs(comparison.wrongDelta)}` : `多错 ${comparison.wrongDelta}`}</b>
      <b class="daily-stats-delta-flat">组数 ${comparison.totalDelta >= 0 ? '+' : ''}${comparison.totalDelta}</b>
    </div>` : '';
  return `
    <div class="daily-stats-total-line">总 ${current.total}</div>
    <div class="daily-stats-cell-main"><span class="daily-stats-right">对 ${current.right}</span><span class="daily-stats-split">/</span><span class="daily-stats-wrong">错 ${current.wrong}</span></div>
    <div class="daily-stats-rate">胜率 ${formatRate(rate)}</div>${firstPlace}${secondPlace}${thirdPlace}${queryCount}${compare}${extra.markup || ''}
  `;
}

function dailyModeControl(mode, filter, colorIndex) {
  return `
    <div class="daily-stats-th-title daily-mode-color-${colorIndex}">${escapeHtml(mode.name)}</div>
    <label class="daily-stats-streak-control">
      <input type="checkbox" data-action="set-daily-filter" data-mode="${escapeHtml(mode.id)}" name="enabled" ${filter.enabled ? 'checked' : ''}>
      <span>连对</span>
      <input type="number" data-action="set-daily-filter" data-mode="${escapeHtml(mode.id)}" name="days" min="1" max="30" step="1" value="${filter.days}">
      <span>天</span>
    </label>
  `;
}

function dailyDayCard(mode, stat, comparison, extra, colorIndex) {
  const current = comparison.enabled ? comparison.current : stat;
  const firstPlace = extra.firstPlaceHit == null ? '<span>第一名：-</span>' : `<span class="${extra.firstPlaceHit ? 'hit' : 'miss'}">第一名：${extra.firstPlaceHit ? '命中' : '未中'}${extra.firstPlaceCount ? `（${extra.firstPlaceCount}次）` : ''}</span>`;
  const secondPlace = extra.secondPlaceHit == null ? '<span>第二名：-</span>' : `<span class="${extra.secondPlaceHit ? 'hit' : 'miss'}">第二名：${extra.secondPlaceHit ? '命中' : '未中'}（${extra.secondPlaceCount}次）</span>`;
  const thirdPlace = extra.thirdPlaceHit == null ? '<span>第三名：-</span>' : `<span class="${extra.thirdPlaceHit ? 'hit' : 'miss'}">第三名：${extra.thirdPlaceHit ? '命中' : '未中'}（${extra.thirdPlaceCount}次）</span>`;
  return `
    <article class="daily-stats-day-card daily-mode-color-${colorIndex}">
      <div class="daily-stats-day-card-head"><strong>${escapeHtml(mode.name)}</strong><span>${comparison.enabled ? `连对${comparison.days} ` : ''}总 ${current.total}</span></div>
      <div class="daily-stats-day-card-main"><b>${formatRate(current.total ? current.right / current.total : 0)}</b><span><i class="daily-stats-right">${current.right} 对</i><em> / </em><i class="daily-stats-wrong">${current.wrong} 错</i></span></div>
      <div class="daily-stats-day-card-foot"><div class="daily-stats-card-ranks">${firstPlace}${secondPlace}${thirdPlace}</div><span class="daily-stats-card-query">开奖号：${extra.queryHitCount == null ? '-' : `${extra.queryHitCount}次`}</span></div>
      ${comparison.enabled ? `<div class="daily-stats-card-compare">比原始 ${comparison.rateDelta >= 0 ? '+' : ''}${comparison.rateDelta.toFixed(1)}%，${comparison.wrongDelta <= 0 ? `少错 ${Math.abs(comparison.wrongDelta)}` : `多错 ${comparison.wrongDelta}`}</div>` : ''}
    </article>
  `;
}

export function renderDailyStats({
  project,
  projectState,
  minimumPriorRightStreak = 0,
  dailyState = {}
}) {
  const days = projectState.snapshot?.days || {};
  const filters = Object.fromEntries(project.modes.map(mode => [
    mode.id,
    dailyFilterFor(dailyState, mode.id, projectState.modeId, minimumPriorRightStreak)
  ]));
  const groups = new Map();
  Object.keys(days).sort().reverse().forEach(date => {
    const monthKey = date.slice(0, 7);
    if (!groups.has(monthKey)) groups.set(monthKey, []);
    groups.get(monthKey).push(date);
  });
  const expandedMonths = new Set(dailyState.expandedMonths || []);
  const hasExplicitExpanded = Array.isArray(dailyState.expandedMonths);
  const defaultMonth = projectState.date?.slice(0, 7) || localDateString().slice(0, 7);
  const months = [...groups].map(([monthKey, dates]) => {
    const rows = Object.fromEntries(dates.map(date => {
      const modes = {};
      const total = dailyEmptyStat();
      const rawTotal = dailyEmptyStat();
      project.modes.forEach((mode, modeIndex) => {
        const raw = buildDailyModeSummary({ projectId: project.id, modeId: mode.id, snapshot: projectState.snapshot, date });
        const filtered = filters[mode.id].enabled
          ? buildDailyModeSummary({ projectId: project.id, modeId: mode.id, snapshot: projectState.snapshot, date, minimumPriorRightStreak: filters[mode.id].days })
          : raw;
        modes[mode.id] = {
          raw,
          current: filtered,
          comparison: buildDailyComparison(raw, filtered, filters[mode.id]),
          extra: dailyModeExtra(project, mode.id, days[date]?.[mode.id], raw),
          color: MODE_COLORS[modeIndex % MODE_COLORS.length]
        };
        addDailyStat(rawTotal, raw);
        addDailyStat(total, filtered);
      });
      return [date, { modes, total, rawTotal }];
    }));
    const summaryModes = Object.fromEntries(project.modes.map(mode => [mode.id, dailyEmptyStat()]));
    const summaryRawModes = Object.fromEntries(project.modes.map(mode => [mode.id, dailyEmptyStat()]));
    const summaryTotal = dailyEmptyStat();
    const summaryRawTotal = dailyEmptyStat();
    dates.forEach(date => {
      project.modes.forEach(mode => {
        addDailyStat(summaryModes[mode.id], rows[date].modes[mode.id].current);
        addDailyStat(summaryRawModes[mode.id], rows[date].modes[mode.id].raw);
      });
      addDailyStat(summaryTotal, rows[date].total);
      addDailyStat(summaryRawTotal, rows[date].rawTotal);
    });
    const monthlyRankings = Object.fromEntries(project.modes.map(mode => [
      mode.id,
      buildDailyMonthRanking(dates, rows, mode.id)
    ]));
    return { monthKey, dates, rows, summaryModes, summaryRawModes, summaryTotal, summaryRawTotal, monthlyRankings };
  });
  const renderSummary = month => `
    <div class="daily-stats-summary">
      ${project.modes.map((mode, index) => {
        const ranking = month.monthlyRankings[mode.id];
        const action = ranking ? ` daily-stats-summary-card-action" data-action="show-daily-ranking" data-mode="${escapeHtml(mode.id)}" data-month="${escapeHtml(month.monthKey)}" role="button" tabindex="0` : '';
        return `<div class="daily-stats-summary-card${action}"><div class="daily-stats-summary-label daily-mode-color-${index % MODE_COLORS.length}">${escapeHtml(mode.name)}</div>${dailyCell(month.summaryModes[mode.id], buildDailyComparison(month.summaryRawModes[mode.id], month.summaryModes[mode.id], filters[mode.id]))}${dailyMonthRanking(ranking)}</div>`;
      }).join('')}
      <div class="daily-stats-summary-card daily-stats-total-card"><div class="daily-stats-summary-label">合计</div>${dailyCell(month.summaryTotal, buildDailyComparison(month.summaryRawTotal, month.summaryTotal, { enabled: project.modes.some(mode => filters[mode.id].enabled), days: 0 }))}</div>
    </div>`;
  const renderTableMonth = month => `
    <div class="daily-stats-table-wrap"><table class="daily-stats-table"><thead><tr><th>日期</th>
      ${project.modes.map((mode, index) => `<th>${dailyModeControl(mode, filters[mode.id], index % MODE_COLORS.length)}</th>`).join('')}<th>合计</th>
    </tr></thead><tbody>${month.dates.map(date => `<tr><th scope="row" class="daily-stats-date"><button type="button" data-action="open-date" data-date="${date}">${date}</button></th>
      ${project.modes.map(mode => `<td>${dailyCell(month.rows[date].modes[mode.id].current, month.rows[date].modes[mode.id].comparison, month.rows[date].modes[mode.id].extra)}</td>`).join('')}
      <td>${dailyCell(month.rows[date].total, buildDailyComparison(month.rows[date].rawTotal, month.rows[date].total, { enabled: project.modes.some(mode => filters[mode.id].enabled), days: 0 }))}</td></tr>`).join('')}
    </tbody></table></div>`;
  const renderNineMonth = month => `
    <div class="daily-stats-day-list">${month.dates.map(date => `<section class="daily-stats-day">
      <div class="daily-stats-day-head">
        <div class="daily-stats-day-date"><button type="button" data-action="open-date" data-date="${date}">${date}</button></div>
        <div class="daily-stats-day-total"><div><span>有效资料</span><b>${month.rows[date].total.total}</b></div><div><span>当日对</span><b class="daily-stats-right">${month.rows[date].total.right}</b></div><div><span>当日错</span><b class="daily-stats-wrong">${month.rows[date].total.wrong}</b></div><div><span>整体胜率</span><b>${formatRate(month.rows[date].total.total ? month.rows[date].total.right / month.rows[date].total.total : 0)}</b></div></div>
      </div>
      <div class="daily-stats-day-cards">${project.modes.map((mode, index) => dailyDayCard(mode, month.rows[date].modes[mode.id].current, month.rows[date].modes[mode.id].comparison, month.rows[date].modes[mode.id].extra, index % MODE_COLORS.length)).join('')}</div>
    </section>`).join('')}</div>`;
  const enabledFilterCount = project.modes.filter(mode => filters[mode.id].enabled).length;
  const filterPanel = project.id === 'jiuxiang' ? `<details class="daily-stats-filter-panel"><summary>连对筛选 <span>${enabledFilterCount ? `已启用 ${enabledFilterCount} 项` : '未启用'}</span></summary><div class="daily-stats-filter-grid">${project.modes.map((mode, index) => {
    const filter = filters[mode.id];
    return `<label class="daily-stats-filter-item daily-mode-color-${index % MODE_COLORS.length}"><span class="daily-stats-filter-name">${escapeHtml(mode.name)}</span><span class="daily-stats-streak-control"><input type="checkbox" data-action="set-daily-filter" data-mode="${escapeHtml(mode.id)}" name="enabled" ${filter.enabled ? 'checked' : ''}><span>连对</span><input type="number" data-action="set-daily-filter" data-mode="${escapeHtml(mode.id)}" name="days" min="1" max="30" step="1" value="${filter.days}"></span></label>`;
  }).join('')}</div></details>` : '';
  return `
    <section class="legacy-page legacy-daily-page" aria-label="${escapeHtml(project.name)}每日统计">
      <h2 class="visually-hidden">每日统计</h2>
      <div class="section-title daily-stats-title"><span>📅 每日对错统计（按月）</span><span class="daily-stats-title-note">按自然日统计，全部分类显示</span></div>
      ${filterPanel}
      <div id="daily-stats-root">${months.length ? months.map(month => {
        const expanded = hasExplicitExpanded ? expandedMonths.has(month.monthKey) : month.monthKey === defaultMonth;
        return `<section class="daily-stats-month ${expanded ? 'expanded' : 'collapsed'}"><div class="daily-stats-month-head"><div><h2>${escapeHtml(month.monthKey.replace('-', '年'))}月</h2><span>${month.dates.length} 天</span></div><button class="btn btn-outline daily-stats-month-toggle" type="button" data-action="toggle-daily-month" data-month="${month.monthKey}">${expanded ? '收起' : '展开'}</button></div>
          ${project.id === 'jiuxiang' ? `<details class="daily-stats-month-summary"><summary>查看本月合计</summary>${renderSummary(month)}</details>` : renderSummary(month)}
          ${expanded ? project.id === 'jiuxiang' ? renderNineMonth(month) : renderTableMonth(month) : ''}</section>`;
      }).join('') : emptyState('暂无历史数据', '当前项目没有可统计的日期。')}</div>
    </section>
  `;
}

export function renderManage({
  project,
  projectState,
  batchModeId = projectState.modeId,
  batchState = { name: '', modeId: batchModeId, rows: [] }
}) {
  const summary = snapshotSummary(projectState.snapshot);
  const activeBatchMode = project.modes.some(mode => mode.id === batchModeId) ? batchModeId : project.modes[0].id;
  const directories = listDirectories(projectState.snapshot, activeBatchMode);
  const dates = Object.keys(projectState.snapshot?.days || {}).sort((left, right) => right.localeCompare(left));
  const batchRows = Array.from({ length: 20 }, (_, index) => {
    const row = batchState.rows?.[index] || {};
    const existingQuery = row.date ? projectState.snapshot?.days?.[row.date]?.[activeBatchMode]?.query || '' : '';
    const query = batchState.modeId === activeBatchMode ? row.query || existingQuery : existingQuery;
    return `
    <div class="batch-row">
      <div class="batch-row-number">${index + 1}</div>
      <textarea name="content" rows="2" placeholder="粘贴该日独立数据内容..." aria-label="第${index + 1}行独立数据内容">${escapeHtml(row.content || '')}</textarea>
      <input name="date" class="batch-date-input" data-index="${index}" type="date" value="${escapeHtml(row.date || '')}" aria-label="第${index + 1}行锁定注入日期">
      <input name="query" type="text" value="${escapeHtml(query)}" placeholder="该日开奖号(必填)" aria-label="第${index + 1}行对应开奖结果">
    </div>
  `;
  }).join('');
  return `
    <section class="legacy-page legacy-manage-page" aria-label="${escapeHtml(project.name)}批量数据分发">
      <h2 class="visually-hidden">批量数据分发</h2>
      <div class="batch-center">
        <header class="batch-center-head"><h2>🚀 批量数据分发中心 (全维度对称串行注入)</h2></header>
        <form id="batch-form">
          <div class="batch-identity-panel">
            <div class="batch-mode-controls"><span>指定全局注入模式:</span>${project.modes.map(mode => `
              <button class="btn btn-outline ${mode.id === activeBatchMode ? 'active' : ''}" type="button" data-action="select-batch-mode" data-mode="${escapeHtml(mode.id)}">${modeSymbol(mode.id)} ${escapeHtml(mode.name)}</button>
            `).join('')}</div>
            <input name="name" type="text" autocomplete="off" value="${escapeHtml(batchState.name || '')}" placeholder="资料名称 (只需填一次，如：龙王)" required>
            <input name="mode" type="hidden" value="${escapeHtml(activeBatchMode)}">
          </div>
          <div class="batch-column-head"><span>独立数据内容区 (支持正则全符号兼容)</span><span>锁定注入日期</span><span>对应开奖结果</span></div>
          <div id="batch-rows-container" class="batch-rows-container">${batchRows}</div>
          <button id="btn-execute-batch" class="btn btn-primary batch-execute" type="submit">🚀 执行逐行安全分发 (防丢包事务模式)</button>
        </form>
      </div>

      <details class="local-maintenance">
        <summary>本地数据备份、导入与目录维护</summary>
        <div class="local-maintenance-body">
          <dl class="summary-strip">
            <div><dt>数据天数</dt><dd>${summary.dayCount}</dd></div><div><dt>模式记录</dt><dd>${summary.modeRecordCount}</dd></div>
            <div><dt>目录记录</dt><dd>${summary.entryCount}</dd></div><div><dt>日期范围</dt><dd>${summary.firstDate ? `${summary.firstDate}<br>${summary.latestDate}` : '无数据'}</dd></div>
          </dl>
          <section class="manage-tools" aria-labelledby="backup-heading"><div><h3 id="backup-heading">备份与迁移</h3><div class="button-row">
            <button class="button primary" type="button" data-action="backup">创建备份</button><button class="button secondary" type="button" data-action="export-project">导出当前项目</button><button class="button secondary" type="button" data-action="export-all">导出全部</button>
          </div></div><form id="import-form" class="import-form"><label><span>导入 JSON</span><input name="file" type="file" accept="application/json,.json" required></label><label><span>合并方式</span><select name="strategy"><option value="merge">合并到现有数据</option><option value="replace">替换导入项目</option></select></label><button class="button secondary" type="submit">导入</button></form></section>
          <div class="manage-columns">
            <section aria-labelledby="dates-heading"><h3 id="dates-heading">日期</h3>${dataTable(['日期', '模式数', '操作'], dates.map(date => `<tr><th scope="row">${escapeHtml(date)}</th><td class="numeric">${Object.keys(projectState.snapshot.days[date] || {}).length}</td><td class="table-actions"><button class="text-button" type="button" data-action="open-date" data-date="${date}">打开</button><button class="text-button danger-text" type="button" data-action="delete-date" data-date="${date}">删除</button></td></tr>`), '暂无日期数据')}</section>
            <section aria-labelledby="directories-heading"><h3 id="directories-heading">${escapeHtml(project.modes.find(mode => mode.id === activeBatchMode)?.name || activeBatchMode)}目录</h3>${dataTable(['目录名', '记录数', '操作'], directories.map(directory => `<tr><th scope="row">${escapeHtml(directory.name)}</th><td class="numeric">${directory.recordCount}</td><td class="table-actions"><button class="text-button" type="button" data-action="rename-directory" data-mode="${escapeHtml(activeBatchMode)}" data-name="${escapeHtml(directory.name)}">重命名</button><button class="text-button danger-text" type="button" data-action="delete-directory" data-mode="${escapeHtml(activeBatchMode)}" data-name="${escapeHtml(directory.name)}">删除</button></td></tr>`), '暂无目录数据')}</section>
          </div>
        </div>
      </details>
    </section>
  `;
}
