import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

import { createApiClient } from '../../assets/js/api-client.js';
import { PAGES, PROJECTS, getProject } from '../../assets/js/projects.js';
import {
  renderAnalysis,
  renderCalendar,
  renderDailyStats,
  renderWorkspace
} from '../../assets/js/views.js';

const root = new URL('../../', import.meta.url);
const rootPath = fileURLToPath(root);

const source = relativePath => readFileSync(new URL(relativePath, root), 'utf8');
const htmlShell = source('统一分析平台.html');
const css = source('assets/css/app.css');
const app = source('assets/js/app.js');
const apiClient = source('assets/js/api-client.js');
const views = source('assets/js/views.js');

function visibleText(markup) {
  return markup
    .replace(/<[^>]*>/g, ' ')
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function rowCells(markup, rowLabel) {
  const row = (markup.match(/<tr\b[\s\S]*?<\/tr>/gi) || [])
    .find(candidate => visibleText(candidate).includes(rowLabel));
  assert.ok(row, `找不到包含“${rowLabel}”的表格行`);
  return [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
    .map(match => visibleText(match[1]));
}

function numericTokens(text) {
  return [...text.matchAll(/\d+(?:\.\d+)?%?/g)].map(match => match[0]);
}

const project = getProject('pingte');
const snapshot = {
  days: {
    '2026-06-01': {
      pingteyixiao: {
        query: '鼠',
        entries: [
          { name: '目录甲', content: '鼠', original: '鼠 目录甲' },
          { name: '目录乙', content: '牛', original: '牛 目录乙' }
        ]
      }
    },
    '2026-06-02': {
      pingteyixiao: {
        query: '牛',
        entries: [
          { name: '目录甲', content: '虎', original: '虎 目录甲' },
          { name: '目录乙', content: '牛', original: '牛 目录乙' }
        ]
      }
    }
  }
};

const projectState = {
  date: '2026-06-02',
  modeId: 'pingteyixiao',
  snapshot
};

test('keeps one local HTML entry without cloud runtime dependencies', () => {
  const entries = readdirSync(rootPath, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
    .map(entry => entry.name)
    .sort();

  assert.deepEqual(entries, ['统一分析平台.html']);
  assert.match(htmlShell, /<script type="module" src="\.\/assets\/js\/app\.js"><\/script>/);
  assert.match(htmlShell, /<link rel="stylesheet" href="\.\/assets\/css\/app\.css">/);
  assert.doesNotMatch(
    [htmlShell, css, app, apiClient, views].join('\n'),
    /supabase|sb_publishable_|__V2_CLOUD_ONLY__|https?:\/\//i
  );
});

test('restores the dark legacy status bar with project switching and top shortcuts', () => {
  const header = htmlShell.match(/<header\b[\s\S]*?<\/header>/i)?.[0] || '';
  const pages = Object.fromEntries(PAGES.map(page => [page.id, page.name]));

  assert.match(htmlShell, /<meta name="color-scheme" content="dark">/);
  assert.match(css, /color-scheme:\s*dark/);
  assert.match(header, /class="[^"]*\bstatus-bar\b[^"]*"/);
  assert.match(header, /id="project-switcher"/);
  assert.match(header, /id="main-nav"/);
  assert.deepEqual(PROJECTS.map(item => item.shortName), ['平特', '大围+杀号', '九项综合']);
  assert.equal(pages.analysis, '详细分析');
  assert.equal(pages['daily-stats'], '每日统计');
  assert.match(pages.manage, /批量数据/);
  assert.deepEqual(PAGES.slice(-2).map(page => [page.id, page.name, page.disabled]), [
    ['manage', '批量数据分发', undefined],
    ['missing-directory-stats', '缺少目录统计', undefined]
  ]);
  assert.match(app, /page\.disabled\s*\?\s*'disabled'/);
  assert.match(app, /case 'missing-directory-stats':/);
  assert.match(app, /const unloadedProjects = PROJECTS\.filter\(item => !store\.getProjectState\(item\.id\)\.snapshot\)/);
  assert.match(app, /if \(!unloadedProjects\.length\)\s*\{\s*store\.setPage\(pageId\)/);
  assert.match(app, /unloadedProjects\.map\(item => loadSnapshot\(item\.id\)\)/);
  assert.match(app, /projectSwitcher\.hidden\s*=\s*projectState\.pageId === 'missing-directory-stats'/);
  assert.match(app, /projectState\.pageId === 'missing-directory-stats' && ui\.busy/);
  assert.match(app, /data-action="select-project"/);
  assert.match(app, /data-action="select-page"/);
});

test('hides the workspace shortcut and orders project buttons without changing the default project', () => {
  const projectSwitcher = app.match(/function renderProjectSwitcher[\s\S]*?\n\}/)?.[0] || '';
  const navigation = app.match(/function renderNavigation[\s\S]*?\n\}/)?.[0] || '';

  assert.match(app, /PROJECT_SWITCH_ORDER\s*=\s*\['dawei_shahao',\s*'jiuxiang',\s*'pingte'\]/);
  assert.match(projectSwitcher, /PROJECT_SWITCH_ORDER\.map/);
  assert.match(navigation, /page\.id !== 'calendar' && page\.id !== 'workspace'/);
  assert.deepEqual(PROJECTS.map(item => item.id), ['pingte', 'dawei_shahao', 'jiuxiang']);
});

test('wires missing-directory rows to direct replenish and immediate scoped deletion', () => {
  const replenishCase = app.match(/case ['"]replenish-missing-directory['"]:[\s\S]*?\n\s*break;/)?.[0] || '';
  const deleteCase = app.match(/case ['"]delete-missing-directory['"]:[\s\S]*?\n\s*break;/)?.[0] || '';

  assert.match(replenishCase, /store\.selectProject\(button\.dataset\.project\)/);
  assert.match(replenishCase, /store\.setMode\(button\.dataset\.mode\)/);
  assert.match(replenishCase, /batchModes\.set\(button\.dataset\.project, button\.dataset\.mode\)/);
  assert.match(replenishCase, /name:\s*button\.dataset\.name/);
  assert.match(replenishCase, /store\.setPage\(['"]manage['"]\)/);

  assert.match(deleteCase, /api\.deleteDirectory\(button\.dataset\.project, button\.dataset\.mode, button\.dataset\.name\)/);
  assert.match(deleteCase, /removeDirectoryFromSnapshot\(snapshot, button\.dataset\.mode, button\.dataset\.name\)/);
  assert.doesNotMatch(deleteCase, /loadSnapshot\(button\.dataset\.project\)/);
  assert.doesNotMatch(deleteCase, /confirm\s*\(/);
});

test('does not rebuild unchanged navigation or page content during repeated status renders', () => {
  assert.match(app, /const renderedHtml = new WeakMap\(\)/);
  assert.match(app, /function setHtmlIfChanged\(element, html\)/);
  assert.match(app, /if \(renderedHtml\.get\(element\) === html\) return/);
  assert.match(app, /renderedHtml\.set\(element, html\)/);
  assert.match(app, /setHtmlIfChanged\(elements\.projectSwitcher,/);
  assert.match(app, /setHtmlIfChanged\(elements\.navigation,/);
  assert.match(app, /setHtmlIfChanged\(elements\.content, renderPage\(project, projectState\)\)/);
});

test('opens and closes the monthly first-place detail modal from eligible summary cards', () => {
  assert.match(app, /case 'show-daily-ranking':[\s\S]*showDailyRankingModal\(button\.dataset\.mode, button\.dataset\.month\)/);
  assert.match(app, /event\.target\.matches\('\.daily-ranking-modal-host'\)[\s\S]*closeLegacyModal\(\)/);
  assert.match(app, /event\.key === 'Escape'[\s\S]*daily-ranking-modal-host/);
  assert.match(app, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('keeps calendar dates as the route into the selected day workspace', () => {
  const calendar = renderCalendar({ project, projectState });
  const openDateCase = app.match(/case ['"]open-date['"]:[\s\S]*?\n\s*break;/)?.[0] || '';

  assert.match(
    calendar,
    /<button[\s\S]*?data-action="open-date"[\s\S]*?data-date="2026-06-02"/
  );
  assert.match(openDateCase, /store\.setDate\(button\.dataset\.date\)/);
  assert.match(openDateCase, /store\.setPage\(['"]workspace['"]\)/);
});

test('restores the legacy workspace interaction map around the current records', () => {
  const workspace = renderWorkspace({
    project,
    projectState,
    record: snapshot.days['2026-06-02'].pingteyixiao,
    busy: false,
    today: '2026-06-02',
    rawText: '虎 目录甲\n牛 目录乙'
  });
  const searchControl = (workspace.match(/<input\b[^>]*>/gi) || [])
    .find(control => /搜索/.test(control));
  const modeRule = css.match(/\.mode-switcher\s*\{([\s\S]*?)\}/)?.[1] || '';
  const layoutRule = css.match(/\.workspace-layout\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(workspace, /role="tablist"[^>]*aria-label="数据模式"/);
  project.modes.forEach(mode => {
    assert.match(workspace, new RegExp(`data-action="select-mode"[\\s\\S]*?data-mode="${mode.id}"`));
    assert.match(visibleText(workspace), new RegExp(mode.name));
  });
  assert.match(modeRule, /display:\s*flex/);
  assert.match(modeRule, /overflow-x:\s*auto/);

  assert.match(workspace, /class="[^"]*\bworkspace-layout\b[^"]*"/);
  assert.match(workspace, /class="[^"]*\bworkspace-sidebar\b[^"]*"/);
  assert.match(workspace, /class="[^"]*\bworkspace-content\b[^"]*"/);
  assert.match(layoutRule, /display:\s*(?:grid|flex)/);
  assert.match(layoutRule, /grid-template-columns|flex-direction/);

  assert.match(visibleText(workspace), /粘贴原始数据/);
  assert.match(workspace, /<textarea[^>]*name="raw-input"/);
  assert.match(workspace, /<input[^>]*name="query"/);
  assert.ok(searchControl, '工作台左侧缺少按目录名搜索的输入框');
  assert.match(workspace, /<button[^>]*type="submit"[^>]*>[\s\S]*?存至本地/);

  assert.match(visibleText(workspace), /资料正确区/);
  assert.match(visibleText(workspace), /资料错误区/);
  assert.match(workspace, /资料正确区[\s\S]*?目录乙[\s\S]*?资料错误区[\s\S]*?目录甲/);
});

test('keeps workspace save on the existing delegated action and atomic local API flow', async () => {
  const calls = [];
  const client = createApiClient({
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true, saved: 2 }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }
  });
  const payload = snapshot.days['2026-06-02'].pingteyixiao;

  await client.saveMode('pingte', '2026-06-02', 'pingteyixiao', payload);

  assert.match(app, /closest\(['"]button\[data-action\]['"]\)/);
  assert.match(app, /event\.target\.matches\(['"]#workspace-form['"]\)/);
  assert.match(
    app,
    /api\.saveMode\(project\.id,\s*projectState\.date,\s*projectState\.modeId,\s*payload\)/
  );
  assert.deepEqual(calls.map(({ url, options }) => [url, options.method]), [
    ['/api/projects/pingte/dates/2026-06-02/modes/pingteyixiao', 'PUT']
  ]);
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
});

test('does not change detailed-analysis or daily-stat numeric text while restyling', () => {
  const analysisCells = rowCells(renderAnalysis({ project, projectState }), '目录甲');
  const dailyCells = rowCells(
    renderDailyStats({
      project,
      projectState,
      minimumPriorRightStreak: 0,
      dailyState: { expandedMonths: ['2026-06'] }
    }),
    '2026-06-02'
  );

  assert.match(analysisCells[1], /^目录甲/);
  assert.equal(analysisCells[2], '✕ 连断中');
  // 2026-10-19 去掉近30有效日命中率、7天命中率、10天命中率三列显示后，列序号整体前移。
  assert.deepEqual([...analysisCells.slice(3, 8), ...analysisCells.slice(10)].flatMap(numericTokens), [
    '1',
    '1',
    '1',
    '1',
    '50.0%',
    '1',
    '0',
    '2'
  ]);
  assert.equal(dailyCells[0], '2026-06-02');
  assert.equal(dailyCells.length, project.modes.length + 2);
  assert.deepEqual(numericTokens(dailyCells[1]), [
    '2',
    '1',
    '1',
    '50.0%'
  ]);
});
