import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderAnalysis, renderCalendar, renderDailyStats, renderManage } from '../../assets/js/views.js';

const css = readFileSync(new URL('../../assets/css/app.css', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`)) || [])[1] || '';
}

const project = {
  id: 'pingte',
  name: '平特分析',
  modes: [
    { id: 'pingteyixiao', name: '平特一肖' },
    { id: 'pingtewei', name: '平特尾' },
    { id: 'shaliangxiao', name: '杀两肖' }
  ]
};

const day = (first, second) => Object.fromEntries(project.modes.map((mode, index) => [
  mode.id,
  {
    query: '鼠',
    entries: [
      { name: '目录甲', content: first },
      { name: '目录乙', content: index ? '鼠' : second }
    ]
  }
]));

const projectState = {
  date: '2026-10-18',
  modeId: 'pingteyixiao',
  snapshot: { days: { '2026-10-17': day('鼠', '鼠'), '2026-10-18': day('牛', '鼠') } }
};

test('P0: analysis table is denser, right-aligns numbers and signals hidden columns', () => {
  const wrap = cssRule('.analysis-table-wrap');
  assert.match(wrap, /max-height:\s*calc\(100vh\s*-\s*150px\)/);
  assert.match(wrap, /overflow:\s*auto/);
  assert.match(wrap, /box-shadow:\s*inset/);

  const table = cssRule('.analysis-table');
  assert.match(table, /font-size:\s*var\(--fs-body\)/);
  assert.match(table, /line-height:\s*1\.35/);

  const metric = cssRule('.analysis-table .analysis-metric');
  // 2026-10-19 用户要求数值列文字居中（原先右对齐）。
  assert.match(metric, /text-align:\s*center/);
  assert.match(metric, /font-variant-numeric:\s*tabular-nums/);

  assert.match(cssRule('.analysis-table thead th'), /position:\s*sticky/);
  assert.match(cssRule('.analysis-table thead th'), /top:\s*0/);
  assert.match(css, /\.analysis-table thead th:nth-child\(2\)\s*\{\s*z-index:\s*5;\s*left:\s*0/);
  assert.match(cssRule('.analysis-table .analysis-name-cell'), /position:\s*sticky/);
  assert.match(cssRule('.analysis-table .analysis-name-cell'), /left:\s*0/);
  // The rank column must stay fluid, otherwise a hard-coded sticky offset drifts on wide screens.
  assert.doesNotMatch(cssRule('.analysis-table tbody td:first-child'), /position:\s*sticky/);
});

test('P0/P2: analysis surface carries one heading, an idle sort marker and two semantic colours', () => {
  const html = renderAnalysis({ project, projectState });

  assert.match(html, /class="page-heading"[\s\S]*?<h2>详细分析<\/h2>/);
  assert.doesNotMatch(html, /class="visually-hidden">详细分析/);
  assert.match(html, /class="sort-idle"[^>]*>⇅</);
  assert.match(html, /class="analysis-scroll-hint"/);

  const metricRule = cssRule('.analysis-table .analysis-metric');
  assert.doesNotMatch(metricRule, /color:/);
  // 低命中率改黄色，和「前两档」的红色区分开。
  assert.match(cssRule('.analysis-table .analysis-metric-low'), /color:\s*#ffd666/);

  // 三列命中率已按用户要求隐藏；剩下的「命中率」列仍用统一阈值规则。
  // 注意：评分说明文字里仍会提到「近30有效日命中率」，因为同分排序还在用它，所以只断言表头。
  for (const key of ['recent30Rate', 'recent7', 'recent10']) {
    assert.doesNotMatch(html, new RegExp(`data-key="${key}"`));
  }
  assert.match(html, /analysis-metric analysis-metric-low">50\.0%/);
  assert.match(html, /analysis-metric">100\.0%/);
  assert.match(html, /class="status-wrong">✕ 连断中|class="status-right">✓ 连对中/);
  assert.doesNotMatch(html, /class="status-wrong">\d+ 次/);
});

test('P0: the trend button keeps its 24px box against the later .btn rule', () => {
  // `.btn { min-height: 34px; padding: 7px 14px }` is declared after these rules, so the icon
  // button must out-specify it instead of relying on declaration order.
  const rule = cssRule('.btn.trend-button');
  assert.match(rule, /width:\s*24px/);
  assert.match(rule, /height:\s*24px/);
  assert.match(rule, /min-height:\s*24px/);
  assert.match(rule, /padding:\s*0/);
  assert.ok(css.indexOf('.btn.trend-button') < css.indexOf('.btn,\n.button {'), 'specificity, not order, must win');
  assert.match(css, /\.btn\.batch-execute\s*\{[^}]*background:\s*var\(--primary\)/);
});

test('P0: the ranking popup floats instead of widening the table', () => {
  assert.match(cssRule('.ranking-score-details'), /position:\s*relative/);
  const popup = cssRule('.ranking-score-details div');
  assert.match(popup, /position:\s*absolute/);
  assert.match(popup, /right:\s*0/);
  assert.match(popup, /background:/);
});

test('the two highest long-term score tiers are marked red per mode', () => {
  // 三个满 120 天的目录，正确率分别约 90% / 80% / 73%。
  // 最高两个不同分值 = 前两名，所以标记 2 行；第三名不标。
  const days = {};
  for (let index = 0; index < 130; index += 1) {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    const entries = [{ name: '甲', content: index < 13 ? '牛' : '鼠' }];
    entries.push({ name: '乙', content: index < 26 ? '牛' : '鼠' });
    entries.push({ name: '丙', content: index < 35 ? '牛' : '鼠' });
    days[date] = { pingteyixiao: { query: '鼠', entries } };
  }
  const html = renderAnalysis({
    project,
    projectState: { modeId: 'pingteyixiao', snapshot: { days } }
  });

  assert.equal((html.match(/class="hover-row top-tier-row"/g) || []).length, 2);
  assert.match(cssRule('.analysis-table .top-tier-row .ranking-score-details summary'), /color:\s*#ff7875/);
});

test('P0: the loading body is a skeleton while the banner keeps the progress text', () => {
  assert.match(appJs, /class="loading-skeleton"/);
  assert.match(appJs, /function loadingPanel\(\)/);
  assert.doesNotMatch(appJs, /<div class="loading-panel" aria-busy="true">\$\{escapeHtml\(ui\.busy\)\}/);
  assert.match(cssRule('.loading-skeleton span'), /animation:\s*loading-sweep/);
});

test('P1: daily summary fills its row when the project has fewer than five cards', () => {
  const html = renderDailyStats({
    project,
    projectState,
    dailyState: { expandedMonths: ['2026-10'] }
  });
  assert.match(html, /class="daily-stats-summary summary-fit"/);
  assert.match(cssRule('.daily-stats-summary.summary-fit'), /repeat\(auto-fit,\s*minmax\(220px,\s*1fr\)\)/);
  // The five-column rule stays for the ten-card project.
  assert.match(cssRule('.daily-stats-summary'), /repeat\(5,\s*minmax\(150px,\s*1fr\)\)/);

  const card = cssRule('.daily-stats-summary-card');
  assert.match(card, /display:\s*flex/);
  assert.match(card, /flex-direction:\s*column/);
  assert.match(cssRule('.daily-stats-month-ranking'), /margin-top:\s*auto/);

  const tableCells = cssRule('.daily-stats-table td');
  assert.match(tableCells, /padding:\s*10px 12px/);
  assert.match(cssRule('.daily-stats-date'), /font-size:\s*var\(--fs-body\)/);
  assert.match(cssRule('.daily-stats-total-line'), /font-size:\s*var\(--fs-body\)/);
  assert.match(cssRule('.daily-stats-cell-main'), /font-size:\s*var\(--fs-body\)/);
});

test('P1: batch page drops the nested scroller and the off-brand purple', () => {
  const manage = renderManage({ project, projectState });
  assert.equal((manage.match(/class="batch-row"/g) || []).length, 20);

  assert.match(cssRule('.batch-rows-container'), /max-height:\s*none/);
  assert.match(cssRule('.batch-center'), /max-width:\s*none/);
  assert.match(cssRule('.local-maintenance'), /max-width:\s*none/);
  // The submit action rides in an opaque sticky bar; a bare sticky button paints over the rows.
  assert.match(cssRule('.batch-actions'), /position:\s*sticky/);
  assert.match(cssRule('.batch-actions'), /background:\s*var\(--surface\)/);
  assert.match(manage, /<div class="batch-actions">\s*<button[^>]*class="btn btn-primary batch-execute"/);
  assert.match(cssRule('.batch-center-head h2'), /color:\s*var\(--text\)/);
  // `.btn` flips the background to transparent further down the file, so the CTA needs `.btn.batch-execute`.
  assert.match(css, /\.btn\.batch-execute\s*\{[^}]*background:\s*var\(--primary\)/);
  assert.doesNotMatch(cssRule('.analysis-table'), /purple/);
});

test('P1: calendar keeps every week cell visible and explains its colours', () => {
  const html = renderCalendar({ project, projectState });
  assert.match(html, /class="calendar-legend"/);
  assert.match(html, /数据完整[\s\S]*?数据不完整[\s\S]*?无数据[\s\S]*?今天/);

  const dayCell = cssRule('.day-cell');
  assert.match(dayCell, /min-height:\s*96px/);
  assert.doesNotMatch(dayCell, /aspect-ratio/);
  assert.match(cssRule('.calendar-blank'), /border:\s*1px dashed/);
  assert.match(cssRule('.calendar-legend'), /display:\s*flex/);
});

test('P2: header colours and page edges follow the revised contract', () => {
  assert.match(cssRule('.top-date-display'), /color:\s*var\(--info\)/);
  assert.match(cssRule('.top-project-label'), /color:\s*var\(--text-muted\)/);
  assert.doesNotMatch(cssRule('.top-project-label'), /#ff7875/);

  assert.match(css, /\.page-content\s*\{\s*width:\s*100%;\s*max-width:\s*none;[\s\S]*?padding:\s*18px 18px 60px/);
  assert.match(css, /\.app-status\s*\{\s*max-width:\s*none;\s*padding:\s*0 18px/);

  assert.match(css, /--text-soft:\s*#8b95a1/);
  assert.match(cssRule('.weekday'), /color:\s*var\(--text-soft\)/);
  assert.match(cssRule('.batch-row-number'), /color:\s*var\(--text-soft\)/);

  // 2026-10-19 用户三轮微调：原始字号先 +2、再 +2、最后 -1（净 +3px），故 page 21 / body 17 / auxiliary 15。
  assert.match(css, /--fs-page:\s*21px/);
  assert.match(css, /--fs-body:\s*17px/);
  assert.match(css, /--fs-aux:\s*15px/);
  assert.match(css, /--fs-table-head:\s*15px/);
  // Every token must be used, otherwise the "scale" is decoration.
  for (const token of ['--fs-page', '--fs-body', '--fs-aux', '--fs-table-head']) {
    assert.equal((css.match(new RegExp(`var\\(${token}\\)`, 'g')) || []).length > 0, true, `${token} is unused`);
  }
  assert.match(cssRule('.analysis-table'), /font-size:\s*var\(--fs-body\)/);
});
