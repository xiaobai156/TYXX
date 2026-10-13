import assert from 'node:assert/strict';
import { test } from 'node:test';

import { getProject, PROJECTS } from '../../assets/js/projects.js';
import {
  renderAnalysis,
  renderCalendar,
  renderDailyStats,
  renderManage,
  renderMissingDirectoryStats,
  renderWorkspace
} from '../../assets/js/views.js';

import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../../assets/css/app.css', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');


const FIXTURES = {
  pingte: {
    pingteyixiao: ['鼠牛', '鼠'],
    pingtewei: ['1尾2尾', '1尾'],
    shaliangxiao: ['07', '鼠牛']
  },
  dawei_shahao: {
    dawei: ['07', '01,02'],
    shahao: ['07', '09'],
    shengxiao: ['鼠', '牛'],
    shaxiao: ['07', '01,02,03,04,05']
  },
  jiuxiang: {
    shabantou: ['07', '1头单'],
    shayitou: ['07', '1头'],
    shayibo: ['07', '红波'],
    shabanbo: ['07', '蓝单'],
    shayihe: ['07', '03合'],
    shayixiao: ['07', '鼠'],
    shayixiao2: ['07', '牛'],
    shayiduan: ['07', '1段'],
    shayihang: ['07', '金行'],
    shayiwei: ['07', '1尾']
  }
};

function stateFor(projectId) {
  const project = getProject(projectId);
  const makeDay = suffix => Object.fromEntries(project.modes.map((mode, index) => {
    const [query, content] = FIXTURES[projectId][mode.id];
    return [mode.id, {
      query,
      entries: [{ name: `目录${index + 1}`, content, original: `${content} 目录${index + 1}-${suffix}` }]
    }];
  }));
  return {
    project,
    projectState: {
      date: '2026-07-27',
      modeId: project.modes[0].id,
      snapshot: {
        days: {
          '2026-06-30': makeDay('六月'),
          '2026-07-26': makeDay('前日'),
          '2026-07-27': makeDay('当日')
        }
      }
    }
  };
}

test('restores the original calendar and workspace structure for every project', () => {
  for (const { id } of PROJECTS) {
    const { project, projectState } = stateFor(id);
    const calendar = renderCalendar({ project, projectState });
    const record = projectState.snapshot.days[projectState.date][projectState.modeId];
    const workspace = renderWorkspace({
      project,
      projectState,
      record,
      busy: false,
      today: projectState.date,
      rawText: record.entries[0].original
    });

    assert.match(calendar, /class="dashboard"/);
    assert.match(calendar, /活跃数据加载天数/);
    assert.match(calendar, /class="month-selector"/);
    assert.equal((calendar.match(/class="weekday"/g) || []).length, 7);
    assert.match(calendar, /class="day-cell[^\"]*"[^>]*data-action="open-date"/);
    assert.doesNotMatch(calendar, /\sstyle=/);

    assert.match(workspace, /class="nav-tabs"/);
    assert.equal((workspace.match(/class="tab-item/g) || []).length, project.modes.length);
    assert.match(workspace, /粘贴原始数据/);
    assert.match(workspace, /一键清空并置顶/);
    assert.match(workspace, /搜索过滤资料名/);
    assert.match(workspace, /存至本地/);
    assert.match(workspace, /允许自主修改历史/);
    assert.match(workspace, /资料正确区 \(按连对排名\)/);
    assert.match(workspace, /资料错误区 \(按连错排名\)/);
    assert.match(workspace, /data-action="clear-current-date"/);
    assert.match(workspace, /name="unlock-history"/);
  }

  const dayCellRule = css.match(/\.day-cell\s*\{([\s\S]*?)\}/)?.[1] || '';
  const calendarRule = [...css.matchAll(/\.calendar-grid\s*\{([\s\S]*?)\}/g)]
    .map(match => match[1])
    .join('\n');
  assert.match(calendarRule, /grid-template-columns:\s*repeat\(7,\s*1fr\)/);
  assert.match(dayCellRule, /aspect-ratio:\s*1/);
  assert.match(dayCellRule, /font-size:\s*20px/);
  assert.match(css, /\.has-data-dot\s*\{[\s\S]*?border-radius:\s*50%/);
});

test('restores the complete original detailed-analysis surface for every project', () => {
  for (const { id } of PROJECTS) {
    const { project, projectState } = stateFor(id);
    const analysis = renderAnalysis({ project, projectState });

    assert.match(analysis, /id="analysis-mode-switcher"/);
    assert.equal((analysis.match(/class="btn btn-outline analysis-mode-btn/g) || []).length, project.modes.length);
    assert.match(analysis, /id="no-update-panel"/);
    assert.match(analysis, /断更统计（按自然日）/);
    assert.match(analysis, /class="analysis-table"/);
    for (const heading of [
      '#', '资料名称', '目前状态', '持续天数', '总连断', '最高连对天数',
      '最高连错天数', '命中率', '7天命中率', '10天命中率', '近30错次', '本月错次', '入库天数'
    ]) assert.match(analysis, new RegExp(heading));
    assert.match(analysis, /class="sparkline"/);
    assert.match(analysis, /data-action="show-trend"/);
    assert.match(analysis, /data-action="manage-directory"/);
    assert.match(analysis, /data-action="toggle-no-update"/);
    assert.match(analysis, /data-action="sort-analysis"/);
  }
});

test('keeps the detailed-analysis table as readable as the legacy cloud version', () => {
  const tableRule = css.match(/\.analysis-table\s*\{([\s\S]*?)\}/)?.[1] || '';
  const sortButtonRule = css.match(/\.analysis-sort-button\s*\{([\s\S]*?)\}/)?.[1] || '';
  const pagerRule = css.match(/\.analysis-pager\s*\{([\s\S]*?)\}/)?.[1] || '';
  const rankRule = css.match(/\.rank-num\s*\{([\s\S]*?)\}/)?.[1] || '';
  const trendButtonRule = css.match(/\.trend-button\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(tableRule, /font-family:\s*"Microsoft YaHei"/);
  assert.match(tableRule, /font-size:\s*18px/);
  assert.match(sortButtonRule, /font-size:\s*13px/);
  assert.match(pagerRule, /font-size:\s*13px/);
  assert.match(rankRule, /font-size:\s*26px/);
  assert.match(rankRule, /background:\s*transparent/);
  assert.match(trendButtonRule, /min-width:\s*68px/);
  assert.match(trendButtonRule, /min-height:\s*34px/);
  assert.match(trendButtonRule, /padding:\s*6px 10px/);
  assert.match(trendButtonRule, /font-size:\s*12px/);
  assert.match(trendButtonRule, /font-weight:\s*800/);
});

test('enlarges only the no-update directory rows by six pixels', () => {
  const rowRule = Array.from(css.matchAll(/\.no-update-row\s*\{([\s\S]*?)\}/g)).at(-1)?.[1] || '';
  const headerRule = Array.from(css.matchAll(/\.no-update-columns\s*\{([\s\S]*?)\}/g)).at(-1)?.[1] || '';

  assert.match(rowRule, /font-size:\s*19px/);
  assert.match(rowRule, /line-height:\s*1\.5/);
  assert.match(headerRule, /font-size:\s*12px/);
});

test('keeps every analysis mode in one centered desktop row', () => {
  const switcherRule = css.match(/\.section-title\.analysis-mode-switcher\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(switcherRule, /display:\s*flex/);
  assert.match(switcherRule, /justify-content:\s*center/);
  assert.match(switcherRule, /flex-wrap:\s*nowrap/);
  assert.match(switcherRule, /overflow-x:\s*auto/);
});

test('spaces trend dates for clear reading without changing the chart structure', () => {
  const chartRule = css.match(/\.trend-chart\s*\{([\s\S]*?)\}/)?.[1] || '';
  const connectorRule = css.match(/\.trend-chart-point::before\s*\{([\s\S]*?)\}/)?.[1] || '';
  const dateRule = css.match(/\.trend-chart-point small\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(chartRule, /gap:\s*32px/);
  assert.match(connectorRule, /left:\s*-32px/);
  assert.match(connectorRule, /width:\s*32px/);
  assert.match(dateRule, /width:\s*60px/);
  assert.match(dateRule, /font-size:\s*13px/);
  assert.match(dateRule, /text-align:\s*center/);
  assert.match(dateRule, /rotate\(-35deg\)/);
});

test('opens the trend chart at the latest date on the right', () => {
  assert.match(appJs, /const trendScroller = document\.querySelector\('\.legacy-modal-host \.chart-scroll-wrap'\)/);
  assert.match(appJs, /trendScroller\.scrollLeft = trendScroller\.scrollWidth/);
});

test('matches the legacy cloud workspace cards and hover trend tooltip', () => {
  const titleRule = css.match(/\.section-title\s*\{([\s\S]*?)\}/)?.[1] || '';
  const rowRule = css.match(/\.data-row\.entry-row\s*\{([\s\S]*?)\}/)?.[1] || '';
  const nameRule = css.match(/\.row-name\s*\{([\s\S]*?)\}/)?.[1] || '';
  const detailRule = css.match(/\.row-name small\s*\{([\s\S]*?)\}/)?.[1] || '';
  const badgeRule = css.match(/\.badge\s*\{([\s\S]*?)\}/)?.[1] || '';
  const tooltipRule = css.match(/\.trend-point-tooltip\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(titleRule, /margin:\s*15px 0 10px/);
  assert.match(titleRule, /padding:\s*10px/);
  assert.match(rowRule, /padding:\s*15px 20px/);
  assert.match(rowRule, /line-height:\s*1\.4/);
  assert.match(rowRule, /background:\s*var\(--surface\)/);
  assert.match(nameRule, /width:\s*60%/);
  assert.match(nameRule, /font-size:\s*16px/);
  assert.match(detailRule, /font-size:\s*12px/);
  assert.match(badgeRule, /padding:\s*4px 10px/);
  assert.match(badgeRule, /font-size:\s*13px/);
  assert.match(tooltipRule, /background:\s*rgb\(20 20 20 \/ 95%\)/);
  assert.match(tooltipRule, /border:\s*1px solid #444444/);
  assert.match(tooltipRule, /padding:\s*15px/);
  assert.match(tooltipRule, /font-size:\s*13px/);
  assert.match(css, /\.trend-chart-point:hover \.trend-point-tooltip/);
  assert.match(appJs, /class="trend-point-tooltip"/);
  assert.match(appJs, /<b>日期：<\/b>/);
  assert.match(appJs, /<b>开奖结果：<\/b>/);
  assert.match(appJs, /<b>当日内容：<\/b>/);
  assert.match(appJs, /<b>当日表现：<\/b>/);
});

test('restores monthly all-mode daily statistics instead of a single-mode flat table', () => {
  for (const { id } of PROJECTS) {
    const { project, projectState } = stateFor(id);
    const daily = renderDailyStats({ project, projectState, minimumPriorRightStreak: 0 });

    assert.match(daily, /每日对错统计（按月）/);
    assert.match(daily, /class="daily-stats-month/);
    assert.match(daily, /class="daily-stats-month-head"/);
    assert.match(daily, /class="daily-stats-summary/);
    assert.match(daily, /合计/);
    project.modes.forEach(mode => assert.match(daily, new RegExp(mode.name)));
    assert.doesNotMatch(daily, /class="mode-switcher/);
    assert.equal((daily.match(/class="daily-stats-streak-control"/g) || []).length >= project.modes.length, true);
    assert.match(daily, /data-action="toggle-daily-month"/);
    assert.match(daily, /data-action="set-daily-filter"/);
    assert.doesNotMatch(daily, /\sstyle=/);
  }
});

test('restores the original batch-management workflow', () => {
  for (const { id } of PROJECTS) {
    const { project, projectState } = stateFor(id);
    const manage = renderManage({ project, projectState });

    assert.match(manage, /批量数据分发中心/);
    assert.match(manage, /指定全局注入模式/);
    assert.match(manage, /资料名称/);
    assert.match(manage, /独立数据内容区/);
    assert.match(manage, /锁定注入日期/);
    assert.match(manage, /对应开奖结果/);
    assert.match(manage, /执行逐行安全分发/);
    assert.equal((manage.match(/class="batch-row"/g) || []).length, 20);
    assert.equal((manage.match(/data-action="select-batch-mode"/g) || []).length, project.modes.length);
    assert.match(manage, /class="local-maintenance"/);
  }
});

test('renders the all-mode missing-directory summary with the ninety-percent gate', () => {
  const project = getProject('pingte');
  const snapshot = {
    days: {
      '2026-07-26': {
        pingteyixiao: {
          query: '鼠',
          entries: Array.from({ length: 10 }, (_, index) => ({ name: `目录${index + 1}`, content: '鼠' }))
        }
      },
      '2026-07-27': {
        pingteyixiao: {
          query: '鼠',
          entries: Array.from({ length: 9 }, (_, index) => ({ name: `目录${index + 1}`, content: '鼠' }))
        }
      }
    }
  };
  const html = renderMissingDirectoryStats({
    projects: [project],
    projectStates: { pingte: { snapshot } }
  });

  assert.match(html, /缺少目录统计（全部种类汇总）/);
  assert.match(html, /最新期覆盖率达到 90%/);
  assert.match(html, /平特一肖/);
  assert.match(html, /目录10/);
  assert.match(html, /覆盖率 90\.0%/);
  assert.match(html, /未更新 1 天/);
  assert.match(html, /<span>操作<\/span>/);
  assert.match(
    html,
    /data-action="replenish-missing-directory"[^>]*data-project="pingte"[^>]*data-mode="pingteyixiao"[^>]*data-name="目录10"/
  );
  assert.match(
    html,
    /data-action="delete-missing-directory"[^>]*data-project="pingte"[^>]*data-mode="pingteyixiao"[^>]*data-name="目录10"/
  );
});
