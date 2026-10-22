import { createApiClient } from './api-client.js';
import { scrollAnalysisToTop } from './analysis-scroll.js';
import { getModeRecord, removeDirectoryFromSnapshot } from './data-model.js';
import { parsePastedEntries, validateModePayload } from './domain/parser.js';
import { buildDirectoryStats, buildModeDirectoryStats, summarizeRightStreakBreaks } from './domain/stats.js';
import { formatHistoricalContent } from './domain/display.js';
import { PAGES, PROJECTS, getProject } from './projects.js';
import { createAppState } from './state.js';
import {
  escapeHtml,
  renderAnalysis,
  renderCalendar,
  renderDailyRankingModal,
  renderDailyStats,
  renderManage,
  renderMissingDirectoryStats,
  renderWorkspace
} from './views.js';

const store = createAppState({ today: localToday() });
const api = createApiClient();
const loadVersions = new Map();
const analysisStates = new Map();
const dailyStates = new Map();
const batchModes = new Map();
const batchDrafts = new Map();
const workspaceRawInputs = new Map();
const workspaceSearches = new Map();
const renderedHtml = new WeakMap();
const PROJECT_SWITCH_ORDER = ['dawei_shahao', 'jiuxiang', 'pingte'];
let workspaceParseTimer = null;
let workspaceQueryTimer = null;
let renderScheduled = false;
let renderRevision = 0;
let renderedRevision = 0;

const ui = {
  busy: '',
  error: '',
  notice: '',
  connected: false
};

const elements = {
  projectSwitcher: document.querySelector('#project-switcher'),
  navigation: document.querySelector('#main-nav'),
  status: document.querySelector('#app-status'),
  content: document.querySelector('#page-content'),
  projectLabel: document.querySelector('#active-project-label'),
  topDate: document.querySelector('#top-date-display'),
  backCalendar: document.querySelector('#btn-back-calendar'),
  connectionPanel: document.querySelector('.connection-panel'),
  connectionLabel: document.querySelector('#connection-label')
};

function localToday() {
  const today = new Date();
  return [
    today.getFullYear(),
    String(today.getMonth() + 1).padStart(2, '0'),
    String(today.getDate()).padStart(2, '0')
  ].join('-');
}

function activeContext() {
  const state = store.get();
  return {
    state,
    project: getProject(state.activeProjectId),
    projectState: store.getProjectState()
  };
}

function filterKey(projectId, modeId) {
  return `${projectId}|${modeId}`;
}

function workspaceKey(projectId, date, modeId) {
  return `${projectId}|${date}|${modeId}`;
}

function getAnalysisState(projectId, modeId) {
  const key = filterKey(projectId, modeId);
  if (!analysisStates.has(key)) {
    analysisStates.set(key, {
      sortKey: 'default',
      sortCycle: 0,
      noUpdateExpanded: false
    });
  }
  return analysisStates.get(key);
}

function getDailyState(projectId) {
  if (!dailyStates.has(projectId)) dailyStates.set(projectId, { filters: {} });
  return dailyStates.get(projectId);
}

function getBatchMode(project, fallbackModeId = project.modes[0].id) {
  const modeId = batchModes.get(project.id);
  if (project.modes.some(mode => mode.id === modeId)) return modeId;
  return project.modes.some(mode => mode.id === fallbackModeId) ? fallbackModeId : project.modes[0].id;
}

function captureBatchDraft() {
  const form = document.querySelector('#batch-form');
  if (!form) return null;
  const { project } = activeContext();
  const modeId = form.elements.mode.value;
  const rows = Array.from(form.querySelectorAll('.batch-row')).map(row => ({
    content: row.querySelector('[name="content"]').value,
    date: row.querySelector('[name="date"]').value,
    query: row.querySelector('[name="query"]').value
  }));
  const draft = { modeId, name: form.elements.name.value, rows };
  batchDrafts.set(project.id, draft);
  return draft;
}


function setHtmlIfChanged(element, html) {
  if (renderedHtml.get(element) === html) return;
  renderedHtml.set(element, html);
  element.innerHTML = html;
}

function renderProjectSwitcher(projectId) {
  setHtmlIfChanged(elements.projectSwitcher, PROJECT_SWITCH_ORDER.map(item => getProject(item)).map(project => `
    <button
      type="button"
      role="tab"
      class="project-tab ${project.id === projectId ? 'active' : ''}"
      aria-selected="${project.id === projectId}"
      data-action="select-project"
      data-project="${escapeHtml(project.id)}"
      title="${escapeHtml(project.name)}"
    >${escapeHtml(project.shortName)}</button>
  `).join(''));
}

function renderNavigation(pageId) {
  const icons = {
    workspace: '◆',
    analysis: '▦',
    'daily-stats': '▣',
    manage: '⚙',
    'missing-directory-stats': '▤'
  };
  setHtmlIfChanged(elements.navigation, PAGES.filter(page => page.id !== 'calendar' && page.id !== 'workspace').map(page => `
    <button
      type="button"
      role="tab"
      class="btn btn-outline nav-tab ${page.id === pageId ? 'active' : ''}"
      aria-selected="${page.id === pageId}"
      aria-disabled="${Boolean(page.disabled)}"
      ${page.disabled ? 'disabled' : ''}
      data-action="select-page"
      data-page="${escapeHtml(page.id)}"
    ><span aria-hidden="true">${icons[page.id] || ''}</span> ${escapeHtml(page.name)}</button>
  `).join(''));
}

function renderConnection() {
  elements.connectionPanel.classList.toggle('connected', ui.connected);
  elements.connectionPanel.classList.toggle('failed', !ui.connected && Boolean(ui.error));
  elements.connectionLabel.textContent = ui.connected ? '本地服务已连接' : (ui.error ? '本地服务异常' : '正在连接');
}

function renderStatus() {
  if (ui.error) {
    setHtmlIfChanged(elements.status, `
      <div class="status-message error" role="alert">
        <span>${escapeHtml(ui.error)}</span>
        <button class="button secondary" type="button" data-action="retry">重试</button>
      </div>
    `);
    return;
  }
  const message = ui.busy || ui.notice;
  setHtmlIfChanged(elements.status, message
    ? `<div class="status-message"><span>${escapeHtml(message)}</span></div>`
    : '');
}

function currentWorkspaceRecord(projectState) {
  const draft = projectState.drafts?.[projectState.date]?.[projectState.modeId];
  return draft || getModeRecord(projectState.snapshot, projectState.date, projectState.modeId);
}

function loadingPanel() {
  // The top banner already prints the progress text, so the body shows a skeleton (P0-5).
  return `<div class="loading-panel" aria-busy="true" aria-label="${escapeHtml(ui.busy)}">
    <div class="loading-skeleton" aria-hidden="true">${'<span></span>'.repeat(6)}</div>
  </div>`;
}

function renderPage(project, projectState) {
  if (projectState.pageId === 'missing-directory-stats' && ui.busy) {
    return loadingPanel();
  }
  if (!projectState.snapshot && ui.busy) {
    return loadingPanel();
  }
  const shared = { project, projectState, busy: Boolean(ui.busy) };
  switch (projectState.pageId) {
    case 'calendar':
      return renderCalendar(shared);
    case 'workspace':
      return renderWorkspace({
        ...shared,
        record: currentWorkspaceRecord(projectState),
        today: localToday(),
        rawText: workspaceRawInputs.get(workspaceKey(project.id, projectState.date, projectState.modeId)) || '',
        searchText: workspaceSearches.get(filterKey(project.id, projectState.modeId)) || ''
      });
    case 'analysis':
      return renderAnalysis({
        ...shared,
        analysisState: getAnalysisState(project.id, projectState.modeId)
      });
    case 'daily-stats':
      return renderDailyStats({
        ...shared,
        dailyState: getDailyState(project.id)
      });
    case 'manage':
      return renderManage({
        ...shared,
        batchModeId: getBatchMode(project, projectState.modeId),
        batchState: batchDrafts.get(project.id) || { name: '', modeId: getBatchMode(project, projectState.modeId), rows: [] }
      });
    case 'missing-directory-stats':
      return renderMissingDirectoryStats({
        projects: PROJECTS,
        projectStates: store.get().projects
      });
    default:
      return '';
  }
}

function render() {
  renderedRevision = renderRevision;
  const { project, projectState } = activeContext();
  const isMissingDirectorySummary = projectState.pageId === 'missing-directory-stats';
  document.documentElement.style.setProperty('--project-accent', project.accent);
  elements.projectLabel.textContent = isMissingDirectorySummary ? '全部种类' : project.name;
  elements.topDate.textContent = isMissingDirectorySummary
    ? '17种汇总'
    : projectState.pageId === 'calendar' ? '日历主页' : projectState.date;
  elements.backCalendar.hidden = projectState.pageId === 'calendar';
  elements.projectSwitcher.hidden = projectState.pageId === 'missing-directory-stats';
  renderProjectSwitcher(project.id);
  renderNavigation(projectState.pageId);
  renderConnection();
  renderStatus();
  setHtmlIfChanged(elements.content, renderPage(project, projectState));
}

function scheduleRender() {
  renderRevision += 1;
  if (renderScheduled) return;
  renderScheduled = true;
  queueMicrotask(() => {
    renderScheduled = false;
    if (renderedRevision !== renderRevision) render();
  });
}

function validateCatalog(catalog) {
  PROJECTS.forEach(expected => {
    const actual = catalog.find(project => project.id === expected.id);
    if (!actual) throw new Error(`本地服务缺少项目: ${expected.name}`);
    const actualModes = new Set((actual.modes || []).map(mode => mode.id));
    expected.modes.forEach(mode => {
      if (!actualModes.has(mode.id)) throw new Error(`本地服务缺少模式: ${mode.name}`);
    });
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error || '未知错误');
}

async function loadSnapshot(projectId) {
  const version = (loadVersions.get(projectId) || 0) + 1;
  loadVersions.set(projectId, version);
  const snapshot = await api.getSnapshot(projectId);
  if (loadVersions.get(projectId) === version) {
    store.setProjectSnapshot(projectId, snapshot);
  }
  return snapshot;
}

async function runOperation(label, operation, successMessage = '') {
  ui.busy = label;
  ui.error = '';
  ui.notice = '';
  render();
  try {
    const result = await operation();
    ui.notice = successMessage;
    ui.connected = true;
    return result;
  } catch (error) {
    ui.error = errorMessage(error);
    if (!error?.status) ui.connected = false;
    return null;
  } finally {
    ui.busy = '';
    scheduleRender();
  }
}

function readWorkspaceForm({ validate = false } = {}) {
  const form = document.querySelector('#workspace-form');
  if (!form) return null;
  const entries = Array.from(form.querySelectorAll('.entry-row')).map(row => {
    const original = row.querySelector('[name="entry-original"]').value.trim();
    return {
      name: row.querySelector('[name="entry-name"]').value.trim(),
      content: row.querySelector('[name="entry-content"]').value.trim(),
      ...(original ? { original } : {})
    };
  }).filter(entry => entry.name || entry.content || entry.original);

  if (validate) {
    const { project, projectState } = activeContext();
    if (projectState.date < localToday() && !form.elements['unlock-history']?.checked) {
      throw new Error('修改历史日期前必须勾选允许修改历史日期');
    }
    return validateModePayload({
      projectId: project.id,
      modeId: projectState.modeId,
      query: form.elements.query.value,
      entries
    });
  }
  return {
    query: form.elements.query.value.trim(),
    entries
  };
}

function captureWorkspaceDraft() {
  const payload = readWorkspaceForm();
  if (!payload) return;
  const { projectState } = activeContext();
  store.setDraft(projectState.modeId, projectState.date, payload);
}

function shiftMonth(delta) {
  const { projectState } = activeContext();
  const [year, month, day] = projectState.date.split('-').map(Number);
  const firstTarget = new Date(Date.UTC(year, month - 1 + delta, 1));
  const lastDay = new Date(Date.UTC(
    firstTarget.getUTCFullYear(),
    firstTarget.getUTCMonth() + 1,
    0
  )).getUTCDate();
  const nextDate = [
    firstTarget.getUTCFullYear(),
    String(firstTarget.getUTCMonth() + 1).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0')
  ].join('-');
  store.setDate(nextDate);
}

function selectMonth(targetMonth) {
  const { projectState } = activeContext();
  const [currentYear, , day] = projectState.date.split('-').map(Number);
  const year = resolveYearForMonth(projectState, currentYear, targetMonth);
  const lastDay = new Date(Date.UTC(year, targetMonth, 0)).getUTCDate();
  store.setDate([
    year,
    String(targetMonth).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0')
  ].join('-'));
}

// After a year rollover the current year may be empty, so fall back to the closest year
// that actually holds data for the chosen month (the data itself is always keyed by full date).
function resolveYearForMonth(projectState, currentYear, targetMonth) {
  const years = [...new Set(Object.keys(projectState.snapshot?.days || {})
    .map(date => Number(date.slice(0, 4)))
    .filter(Number.isFinite))].sort((left, right) => left - right);
  if (!years.length || years.includes(currentYear)) return currentYear;
  const monthKey = String(targetMonth).padStart(2, '0');
  const withMonth = years.filter(candidate => Object.keys(projectState.snapshot.days)
    .some(date => date.startsWith(`${candidate}-${monthKey}-`)));
  const pool = withMonth.length ? withMonth : years;
  return pool.reduce((best, candidate) => (
    Math.abs(candidate - currentYear) < Math.abs(best - currentYear) ? candidate : best
  ), pool[0]);
}

function selectYear(targetYear) {
  const { projectState } = activeContext();
  if (!Number.isFinite(targetYear)) return;
  const [, month, day] = projectState.date.split('-').map(Number);
  const lastDay = new Date(Date.UTC(targetYear, month, 0)).getUTCDate();
  store.setDate([
    targetYear,
    String(month).padStart(2, '0'),
    String(Math.min(day, lastDay)).padStart(2, '0')
  ].join('-'));
}

function parseWorkspaceInput({ announce = true, refocus = false } = {}) {
  const form = document.querySelector('#workspace-form');
  if (!form) return;
  const { project, projectState } = activeContext();
  const rawInput = form.elements['raw-input'];
  const text = rawInput.value;
  try {
    const entries = parsePastedEntries({
      projectId: project.id,
      modeId: projectState.modeId,
      text
    });
    if (!entries.length) throw new Error('没有识别到有效资料');
    const payload = { query: form.elements.query.value.trim(), entries };
    workspaceRawInputs.set(workspaceKey(project.id, projectState.date, projectState.modeId), text);
    ui.error = '';
    if (announce) ui.notice = `已解析 ${entries.length} 条目录资料`;
    store.setDraft(projectState.modeId, projectState.date, payload);
    if (refocus) {
      requestAnimationFrame(() => {
        const nextInput = document.querySelector('#workspace-form [name="raw-input"]');
        if (!nextInput) return;
        nextInput.focus();
        nextInput.setSelectionRange(nextInput.value.length, nextInput.value.length);
      });
    }
  } catch (error) {
    if (announce) {
      ui.error = errorMessage(error);
      render();
    }
  }
}

function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function closeLegacyModal() {
  document.querySelector('.legacy-modal-host')?.remove();
}

function jumpToTrendBreak(button) {
  const modal = button.closest('.legacy-modal-host');
  const scroller = modal?.querySelector('.chart-scroll-wrap');
  const targets = modal?.querySelectorAll(`.trend-chart-point[data-break-days="${button.dataset.days}"]`) || [];
  if (!scroller || !targets.length) return;
  const index = Number(button.dataset.jumpIndex || 0) % targets.length;
  const target = targets[index];
  modal.querySelector('.trend-chart-point.trend-break-target')?.classList.remove('trend-break-target');
  target.classList.add('trend-break-target');
  scroller.scrollTo({
    left: Math.max(0, target.offsetLeft - (scroller.clientWidth - target.offsetWidth) / 2),
    behavior: 'smooth'
  });
  button.dataset.jumpIndex = String((index + 1) % targets.length);
}

function showTrendModal(name, modeId, showBreakRanking = false) {
  const { project, projectState } = activeContext();
  const stats = buildDirectoryStats({
    projectId: project.id,
    modeId,
    snapshot: projectState.snapshot,
    name,
    settledOnly: projectState.pageId === 'analysis'
  });
  closeLegacyModal();
  let rightStreak = 0;
  const points = stats.stateHistory.map((value, index) => {
    const breakDays = value === false ? rightStreak : 0;
    rightStreak = value === true ? rightStreak + 1 : 0;
    const date = stats.stateDates[index] || '';
    const record = getModeRecord(projectState.snapshot, date, modeId);
    const entry = record.entries.find(item => item.name === name);
    const query = record.query.trim() || '未开奖';
    const content = entry
      ? formatHistoricalContent({
        projectId: project.id,
        modeId,
        name,
        content: entry.content
      })
      : '当天无此目录';
    const displayContent = content.length > 20 ? `${content.slice(0, 20)}...` : content;
    const performance = value === true
      ? '<span class="trend-performance right">✓ 对 (连对中)</span>'
      : value === false
        ? `<span class="trend-performance wrong">✕ 错${entry ? ' (连断中)' : '（空缺资料）'}</span>`
        : '<span class="trend-performance missing">- 待开奖</span>';
    return `
      <div class="trend-chart-point ${value === true ? 'right' : value === false ? 'wrong' : 'missing'}"${breakDays ? ` data-break-days="${breakDays}"` : ''}>
        <span>${value === true ? '✓' : value === false ? '✕' : '-'}</span>
        <small>${escapeHtml(date.slice(5))}</small>
        <div class="trend-point-tooltip" role="tooltip">
          <div class="trend-tooltip-date"><b>日期：</b>${escapeHtml(date)}</div>
          <div><b>开奖结果：</b><em>${escapeHtml(query)}</em></div>
          <div><b>当日内容：</b>${escapeHtml(displayContent)}</div>
          <div><b>当日表现：</b>${performance}</div>
        </div>
      </div>
    `;
  }).join('');
  const breakSummary = showBreakRanking ? summarizeRightStreakBreaks(stats.stateHistory) : [];
  const matchingBreak = stats.currentState === true
    ? breakSummary.find(({ days }) => days === stats.currentStreak)
    : null;
  const currentStatus = stats.currentState == null
    ? '当前：待定'
    : `当前：连${stats.currentState ? '对' : '错'} ${stats.currentStreak} 天`;
  const breakWarning = matchingBreak
    ? `<div class="trend-break-warning">⚠ 预警：当前连对 ${stats.currentStreak} 天，历史上有 ${matchingBreak.count} 次在连对 ${stats.currentStreak} 天后出错</div>`
    : '';
  const rankingItems = breakSummary
    .map(({ days, count }) => `<button class="trend-break-ranking-item" type="button" data-action="jump-trend-break" data-days="${days}">连对 ${days} 天后错 · ${count} 次</button>`)
    .join('');
  document.body.insertAdjacentHTML('beforeend', `
    <div class="legacy-modal-host" role="dialog" aria-modal="true" aria-label="${escapeHtml(name)}走势">
      <div class="chart-box">
        <button class="chart-close" type="button" data-action="close-modal" aria-label="关闭走势">✕</button>
        <div class="chart-fixed-title"><strong>${escapeHtml(name)} - 历史走势</strong><small>✓ 正确 ｜ ✕ 错误 ｜ - 待定</small></div>
        ${showBreakRanking
          ? `<div class="trend-chart-shell"><div class="trend-break-summary"><div class="trend-break-current">${currentStatus}</div>${breakWarning}</div><div class="trend-break-ranking">${rankingItems || '<div class="trend-break-ranking-empty">暂无历史连对后错记录</div>'}</div><div class="chart-scroll-wrap"><div class="trend-chart">${points || '<div class="empty-state">暂无走势数据</div>'}</div></div></div>`
          : `<div class="chart-scroll-wrap"><div class="trend-chart">${points || '<div class="empty-state">暂无走势数据</div>'}</div></div>`}
      </div>
    </div>
  `);
  const trendScroller = document.querySelector('.legacy-modal-host .chart-scroll-wrap');
  trendScroller.scrollLeft = trendScroller.scrollWidth;
}

function showDailyRankingModal(modeId, monthKey) {
  const { project, projectState } = activeContext();
  const markup = renderDailyRankingModal({
    project,
    snapshot: projectState.snapshot,
    monthKey,
    modeId
  });
  if (!markup) return;
  closeLegacyModal();
  document.body.insertAdjacentHTML('beforeend', markup);
}

function showManageModal(name, modeId) {
  closeLegacyModal();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="legacy-modal-host" role="dialog" aria-modal="true" aria-label="目录管理中心">
      <div class="manage-dialog">
        <button class="chart-close" type="button" data-action="close-modal" aria-label="关闭目录管理">✕</button>
        <h3>⚙ 目录管理中心</h3>
        <div class="manage-target-name">${escapeHtml(name)}</div>
        <section class="manage-dialog-section rename"><b>✎ 修正资料名称 (全局全库更新)</b><div><input name="manage-rename" type="text" value="${escapeHtml(name)}"><button class="btn btn-primary" type="button" data-action="confirm-managed-rename" data-name="${escapeHtml(name)}" data-mode="${escapeHtml(modeId)}">确认全局改名</button></div><p>修改后，此资料的历史记录会自动继承给新名字。</p></section>
        <section class="manage-dialog-section"><b>🗑 删除指定日期的数据</b><div><input name="manage-date" type="date" value="${localToday()}"><button class="btn btn-outline danger-action" type="button" data-action="delete-managed-entry" data-name="${escapeHtml(name)}" data-mode="${escapeHtml(modeId)}">删除单日</button></div></section>
        <section class="manage-dialog-section danger-zone"><b>⚠ 危险操作：彻底移除该目录</b><p>将从所有历史记录中永久删除此资料，不可恢复。</p><button class="btn btn-danger" type="button" data-action="delete-managed-directory" data-name="${escapeHtml(name)}" data-mode="${escapeHtml(modeId)}">彻底删除所有历史</button></section>
      </div>
    </div>
  `);
}

function addLocalDays(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-');
}

function fillBatchDatesFrom(input) {
  const form = input.closest('#batch-form');
  if (!form || !input.value) return;
  const { projectState } = activeContext();
  const modeId = form.elements.mode.value;
  const rows = [...form.querySelectorAll('.batch-row')];
  const startIndex = Number(input.dataset.index);
  const today = localToday();
  let lastFilledIndex = startIndex - 1;
  for (let index = startIndex; index < rows.length; index += 1) {
    const date = addLocalDays(input.value, index - startIndex);
    if (date > today && index > startIndex) break;
    const dateInput = rows[index].querySelector('[name="date"]');
    const queryInput = rows[index].querySelector('[name="query"]');
    dateInput.value = date;
    const savedQuery = projectState.snapshot?.days?.[date]?.[modeId]?.query;
    queryInput.value = savedQuery == null ? '' : String(savedQuery);
    lastFilledIndex = index;
  }
  for (let index = lastFilledIndex + 1; index < rows.length; index += 1) {
    rows[index].querySelector('[name="date"]').value = '';
    rows[index].querySelector('[name="query"]').value = '';
  }
  captureBatchDraft();
}

function fillBatchDateFromPrevious(input) {
  if (input.value) return;
  const form = input.closest('#batch-form');
  const index = Number(input.dataset.index);
  if (!form || !Number.isInteger(index) || index < 1) return;
  const previous = form.querySelector(`.batch-date-input[data-index="${index - 1}"]`)?.value;
  if (!previous) return;
  input.value = addLocalDays(previous, 1);
  fillBatchDatesFrom(input);
}

async function refreshCurrentProject() {
  const { state, projectState } = activeContext();
  const operation = projectState.pageId === 'missing-directory-stats'
    ? () => Promise.all(PROJECTS.map(item => loadSnapshot(item.id)))
    : () => loadSnapshot(state.activeProjectId);
  await runOperation('正在读取本地数据…', operation, '数据已刷新');
}

async function bootstrap() {
  await runOperation('正在连接本地服务…', async () => {
    await api.health();
    const catalog = await api.getProjects();
    validateCatalog(catalog);
    await loadSnapshot(store.get().activeProjectId);
  });
}

async function handleClick(button) {
  const action = button.dataset.action;
  const { state, project, projectState } = activeContext();

  switch (action) {
    case 'select-project': {
      captureWorkspaceDraft();
      const projectId = button.dataset.project;
      store.selectProject(projectId);
      ui.error = '';
      ui.notice = '';
      if (!store.getProjectState(projectId).snapshot) {
        await runOperation('正在读取项目数据…', () => loadSnapshot(projectId));
      }
      break;
    }
    case 'select-page': {
      captureWorkspaceDraft();
      captureBatchDraft();
      ui.error = '';
      ui.notice = '';
      const pageId = button.dataset.page;
      if (pageId === 'missing-directory-stats') {
        const unloadedProjects = PROJECTS.filter(item => !store.getProjectState(item.id).snapshot);
        if (!unloadedProjects.length) {
          store.setPage(pageId);
          break;
        }
        await runOperation(
          '正在汇总 17 个种类…',
          async () => {
            store.setPage(pageId);
            await Promise.all(unloadedProjects.map(item => loadSnapshot(item.id)));
          }
        );
      } else {
        store.setPage(pageId);
      }
      break;
    }
    case 'select-mode':
      captureWorkspaceDraft();
      ui.error = '';
      ui.notice = '';
      store.setMode(button.dataset.mode);
      break;
    case 'toggle-no-update': {
      const current = getAnalysisState(project.id, projectState.modeId);
      current.noUpdateExpanded = !current.noUpdateExpanded;
      render();
      break;
    }
    case 'sort-analysis': {
      const current = getAnalysisState(project.id, projectState.modeId);
      ui.notice = '';
      const key = button.dataset.key;
      if (current.sortKey !== key) {
        current.sortKey = key;
        current.sortCycle = 1;
      } else current.sortCycle = (current.sortCycle + 1) % 3;
      render();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => scrollAnalysisToTop());
      });
      break;
    }
    case 'show-trend':
      showTrendModal(
        button.dataset.name,
        button.dataset.mode || projectState.modeId,
        button.dataset.showBreakRanking === 'true'
      );
      break;
    case 'jump-trend-break':
      jumpToTrendBreak(button);
      break;
    case 'show-daily-ranking':
      showDailyRankingModal(button.dataset.mode, button.dataset.month);
      break;
    case 'manage-directory':
      showManageModal(button.dataset.name, button.dataset.mode || projectState.modeId);
      break;
    case 'close-modal':
      closeLegacyModal();
      break;
    case 'toggle-daily-month': {
      const current = getDailyState(project.id);
      const expanded = new Set(Array.isArray(current.expandedMonths)
        ? current.expandedMonths
        : [projectState.date.slice(0, 7)]);
      if (expanded.has(button.dataset.month)) expanded.delete(button.dataset.month);
      else expanded.add(button.dataset.month);
      current.expandedMonths = [...expanded];
      render();
      break;
    }
    case 'select-batch-mode': {
      captureBatchDraft();
      batchModes.set(project.id, button.dataset.mode);
      render();
      break;
    }
    case 'replenish-missing-directory': {
      const targetProject = getProject(button.dataset.project);
      if (!targetProject.modes.some(mode => mode.id === button.dataset.mode)) {
        throw new Error(`未知模式: ${button.dataset.mode}`);
      }
      batchModes.set(button.dataset.project, button.dataset.mode);
      batchDrafts.set(button.dataset.project, {
        modeId: button.dataset.mode,
        name: button.dataset.name,
        rows: []
      });
      store.selectProject(button.dataset.project);
      store.setMode(button.dataset.mode);
      store.setPage('manage');
      ui.error = '';
      ui.notice = `已加载“${button.dataset.name}”，请填写补录数据`;
      render();
      requestAnimationFrame(() => document.querySelector('#batch-form [name="name"]')?.focus());
      break;
    }
    case 'delete-missing-directory':
      await runOperation('正在删除目录…', async () => {
        await api.deleteDirectory(button.dataset.project, button.dataset.mode, button.dataset.name);
        const snapshot = store.getProjectState(button.dataset.project).snapshot;
        store.setProjectSnapshot(
          button.dataset.project,
          removeDirectoryFromSnapshot(snapshot, button.dataset.mode, button.dataset.name)
        );
      }, '目录已删除');
      break;
    case 'refresh':
    case 'retry':
      await refreshCurrentProject();
      break;
    case 'previous-month':
      shiftMonth(-1);
      break;
    case 'next-month':
      shiftMonth(1);
      break;
    case 'select-month':
      selectMonth(Number(button.dataset.month));
      break;
    case 'select-year':
      selectYear(Number(button.dataset.year));
      break;
    case 'today':
      store.setDate(localToday());
      break;
    case 'open-date':
      captureWorkspaceDraft();
      store.setDate(button.dataset.date);
      store.setPage('workspace');
      break;
    case 'add-entry': {
      const payload = readWorkspaceForm() || { query: '', entries: [] };
      payload.entries.push({ name: '', content: '', original: '' });
      store.setDraft(projectState.modeId, projectState.date, payload);
      break;
    }
    case 'parse-input': {
      clearTimeout(workspaceParseTimer);
      parseWorkspaceInput();
      break;
    }
    case 'clear-workspace': {
      const key = workspaceKey(project.id, projectState.date, projectState.modeId);
      workspaceRawInputs.delete(key);
      workspaceSearches.delete(filterKey(project.id, projectState.modeId));
      store.setDraft(projectState.modeId, projectState.date, { query: '', entries: [] });
      ui.error = '';
      ui.notice = '已清空当前工作区';
      requestAnimationFrame(() => {
        const input = document.querySelector('#workspace-form [name="raw-input"]');
        input?.focus();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      });
      break;
    }
    case 'clear-current-date': {
      const date = projectState.date;
      if (!window.confirm(`确定清空 ${project.name} 的 ${date} 全部模式数据？`)) break;
      await runOperation('正在清空本日…', async () => {
        await api.deleteDate(project.id, date);
        project.modes.forEach(mode => {
          store.clearDraft(mode.id, date, project.id);
          workspaceRawInputs.delete(workspaceKey(project.id, date, mode.id));
        });
        await loadSnapshot(project.id);
      }, '本日数据已清空');
      break;
    }
    case 'remove-entry': {
      const payload = readWorkspaceForm() || { query: '', entries: [] };
      payload.entries.splice(Number(button.dataset.index), 1);
      store.setDraft(projectState.modeId, projectState.date, payload);
      break;
    }
    case 'delete-date': {
      const date = button.dataset.date;
      if (!window.confirm(`确定删除 ${project.name} 的 ${date} 全部数据？`)) break;
      await runOperation('正在删除日期…', async () => {
        await api.deleteDate(project.id, date);
        project.modes.forEach(mode => store.clearDraft(mode.id, date, project.id));
        await loadSnapshot(project.id);
      }, '日期已删除');
      break;
    }
    case 'rename-directory': {
      const oldName = button.dataset.name;
      const newName = window.prompt('请输入新目录名', oldName)?.trim();
      if (!newName || newName === oldName) break;
      const modeId = button.dataset.mode || projectState.modeId;
      await runOperation('正在重命名目录…', async () => {
        await api.renameDirectory(project.id, modeId, oldName, newName);
        await loadSnapshot(project.id);
      }, '目录已重命名');
      break;
    }
    case 'delete-directory': {
      const name = button.dataset.name;
      if (!window.confirm(`确定删除当前模式中所有“${name}”目录记录？`)) break;
      const modeId = button.dataset.mode || projectState.modeId;
      await runOperation('正在删除目录…', async () => {
        await api.deleteDirectory(project.id, modeId, name);
        await loadSnapshot(project.id);
      }, '目录已删除');
      break;
    }
    case 'confirm-managed-rename': {
      const oldName = button.dataset.name;
      const newName = document.querySelector('[name="manage-rename"]')?.value.trim();
      if (!newName || newName === oldName) break;
      if (!window.confirm(`确定把“${oldName}”全局改名为“${newName}”？`)) break;
      const renamed = await runOperation('正在重命名目录…', async () => {
        await api.renameDirectory(project.id, button.dataset.mode, oldName, newName);
        await loadSnapshot(project.id);
        return true;
      }, '目录已重命名');
      if (renamed) closeLegacyModal();
      break;
    }
    case 'delete-managed-entry': {
      const date = document.querySelector('[name="manage-date"]')?.value;
      if (!date || !window.confirm(`确定删除 ${date} 的“${button.dataset.name}”记录？`)) break;
      const deleted = await runOperation('正在删除单日目录…', async () => {
        await api.deleteEntry(project.id, date, button.dataset.mode, button.dataset.name);
        await loadSnapshot(project.id);
        return true;
      }, '单日目录已删除');
      if (deleted) closeLegacyModal();
      break;
    }
    case 'delete-managed-directory':
      if (!window.confirm(`确定彻底删除“${button.dataset.name}”的全部历史？此操作不可恢复。`)) break;
      {
        const deleted = await runOperation('正在删除目录…', async () => {
        await api.deleteDirectory(project.id, button.dataset.mode, button.dataset.name);
        await loadSnapshot(project.id);
          return true;
        }, '目录全部历史已删除');
        if (deleted) closeLegacyModal();
      }
      break;
    case 'backup':
      await runOperation('正在创建数据库备份…', () => api.createBackup(), '备份已创建');
      break;
    case 'export-project': {
      await runOperation('正在导出当前项目…', async () => {
        const data = await api.exportData(project.id);
        downloadJson(data, `${project.id}-${localToday()}.json`);
      }, '当前项目已导出');
      break;
    }
    case 'export-all':
      await runOperation('正在导出全部数据…', async () => {
        const data = await api.exportData();
        downloadJson(data, `lottery-tools-${localToday()}.json`);
      }, '全部数据已导出');
      break;
    default:
      break;
  }
}

document.addEventListener('click', event => {
  if (event.target.closest('.ranking-score-details')) return;
  if (event.target.matches('.daily-ranking-modal-host')) closeLegacyModal();
  const batchDateInput = event.target.closest('#batch-form .batch-date-input');
  if (batchDateInput) fillBatchDateFromPrevious(batchDateInput);
  const button = event.target.closest('button[data-action]') || event.target.closest('[data-action]');
  if (button) void handleClick(button);
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && document.querySelector('.daily-ranking-modal-host')) {
    closeLegacyModal();
    return;
  }
  if ((event.key === 'Enter' || event.key === ' ') && event.target.matches('[data-action="show-daily-ranking"]')) {
    event.preventDefault();
    void handleClick(event.target);
  }
});

document.addEventListener('change', event => {
  const { project, projectState } = activeContext();
  if (event.target.matches('#workspace-form [name="date"]')) {
    const nextDate = event.target.value;
    if (!nextDate) return;
    captureWorkspaceDraft();
    store.setDate(nextDate);
    return;
  }
  if (event.target.matches('#batch-form .batch-date-input')) {
    fillBatchDatesFrom(event.target);
    return;
  }
  if (event.target.matches('[data-action="set-daily-filter"]')) {
    const modeId = event.target.dataset.mode;
    const container = event.target.closest('.daily-stats-streak-control');
    const current = getDailyState(project.id);
    current.filters[modeId] = {
      enabled: container.querySelector('[name="enabled"]').checked,
      days: Math.max(1, Math.min(30, Number.parseInt(container.querySelector('[name="days"]').value, 10) || 2))
    };
    render();
    return;
  }
});

document.addEventListener('input', event => {
  const { project, projectState } = activeContext();
  if (event.target.matches('#workspace-form [name="raw-input"]')) {
    const expectedKey = workspaceKey(project.id, projectState.date, projectState.modeId);
    workspaceRawInputs.set(
      expectedKey,
      event.target.value
    );
    clearTimeout(workspaceParseTimer);
    if (event.target.value.trim()) {
      workspaceParseTimer = setTimeout(() => {
        const current = activeContext();
        if (workspaceKey(current.project.id, current.projectState.date, current.projectState.modeId) !== expectedKey) return;
        parseWorkspaceInput({ announce: false, refocus: true });
      }, 400);
    }
    return;
  }
  if (event.target.matches('#workspace-form [name="query"]')) {
    const expectedKey = workspaceKey(project.id, projectState.date, projectState.modeId);
    clearTimeout(workspaceQueryTimer);
    workspaceQueryTimer = setTimeout(() => {
      const current = activeContext();
      if (workspaceKey(current.project.id, current.projectState.date, current.projectState.modeId) !== expectedKey) return;
      captureWorkspaceDraft();
      requestAnimationFrame(() => {
        const query = document.querySelector('#workspace-form [name="query"]');
        query?.focus();
        query?.setSelectionRange(query.value.length, query.value.length);
      });
    }, 120);
    return;
  }
  if (event.target.matches('#workspace-form [name="directory-search"]')) {
    const value = event.target.value.toLocaleLowerCase('zh-CN');
    workspaceSearches.set(filterKey(project.id, projectState.modeId), event.target.value);
    document.querySelectorAll('#workspace-form .entry-row').forEach(row => {
      row.classList.toggle('search-hidden', !row.dataset.search.includes(value));
    });
    return;
  }
  if (event.target.matches('#batch-form input, #batch-form textarea')) {
    captureBatchDraft();
  }
});

document.addEventListener('submit', event => {
  if (event.target.matches('#workspace-form')) {
    event.preventDefault();
    const { project, projectState } = activeContext();
    let payload;
    try {
      payload = readWorkspaceForm({ validate: true });
    } catch (error) {
      ui.error = errorMessage(error);
      render();
      return;
    }
    store.setDraft(projectState.modeId, projectState.date, payload);
    void runOperation('正在保存当前模式…', async () => {
      await api.saveMode(project.id, projectState.date, projectState.modeId, payload);
      await loadSnapshot(project.id);
      store.clearDraft(projectState.modeId, projectState.date, project.id);
      workspaceRawInputs.delete(workspaceKey(project.id, projectState.date, projectState.modeId));
    }, '当前模式已保存');
    return;
  }

  if (event.target.matches('#batch-form')) {
    event.preventDefault();
    const { project } = activeContext();
    let payload;
    try {
      const name = event.target.elements.name.value.trim();
      if (!name) throw new Error('资料名称不能为空');
      const modeId = event.target.elements.mode.value;
      const rows = [...event.target.querySelectorAll('.batch-row')].map(row => ({
        date: row.querySelector('[name="date"]').value.trim(),
        query: row.querySelector('[name="query"]').value.trim(),
        content: row.querySelector('[name="content"]').value.trim()
      })).filter(row => row.date || row.query || row.content);
      if (!rows.length) throw new Error('至少填写一行批量数据');
      const incomplete = rows.find(row => !row.date || !row.query || !row.content);
      if (incomplete) throw new Error('每个使用行的内容、日期和开奖结果都必须填写完整');
      rows.forEach(row => validateModePayload({
        projectId: project.id,
        modeId,
        query: row.query,
        entries: [{ name, content: row.content }]
      }));
      payload = { modeId, name, rows };
      if (rows.some(row => row.date < localToday())
        && !window.confirm('批量内容包含历史日期，确定允许修改这些历史数据？')) return;
    } catch (error) {
      ui.error = errorMessage(error);
      render();
      return;
    }
    void runOperation('正在批量分发…', async () => {
      await api.saveBatch(project.id, payload.modeId, { name: payload.name, rows: payload.rows });
      await loadSnapshot(project.id);
      batchDrafts.delete(project.id);
    }, `已批量写入 ${payload.rows.length} 天`);
    return;
  }

  if (event.target.matches('#import-form')) {
    event.preventDefault();
    const file = event.target.elements.file.files[0];
    const strategy = event.target.elements.strategy.value;
    if (!file) return;
    if (strategy === 'replace' && !window.confirm('替换导入会删除文件中所含项目的原数据，确定继续？')) return;
    void runOperation('正在导入数据…', async () => {
      let payload;
      try {
        payload = JSON.parse(await file.text());
      } catch {
        throw new Error('导入文件不是有效的 JSON');
      }
      await api.importData(payload, strategy);
      PROJECTS.forEach(item => store.setProjectSnapshot(item.id, null));
      await loadSnapshot(store.get().activeProjectId);
    }, '数据已导入');
  }
});

store.subscribe(scheduleRender);
render();
void bootstrap();
