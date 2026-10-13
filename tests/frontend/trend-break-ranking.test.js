import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import * as statsDomain from '../../assets/js/domain/stats.js';
import { formatHistoricalContent } from '../../assets/js/domain/display.js';
import { renderAnalysis, renderWorkspace } from '../../assets/js/views.js';

const appJs = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../../assets/css/app.css', import.meta.url), 'utf8');

const PROJECT_MODES = [
  {
    id: 'pingte',
    name: '平特分析',
    modes: [
      { id: 'pingteyixiao', name: '平特一肖', query: '鼠' },
      { id: 'pingtewei', name: '平特尾', query: '1尾' },
      { id: 'shaliangxiao', name: '杀两肖', query: '07' }
    ]
  },
  {
    id: 'dawei_shahao',
    name: '大围杀号分析',
    modes: [
      { id: 'dawei', name: '大围', query: '07' },
      { id: 'shahao', name: '杀号', query: '07' },
      { id: 'shengxiao', name: '生肖', query: '鼠' },
      { id: 'shaxiao', name: '杀肖', query: '07' }
    ]
  },
  {
    id: 'jiuxiang',
    name: '九项分析',
    modes: [
      { id: 'shabantou', name: '杀半头', query: '07' },
      { id: 'shayitou', name: '杀一头', query: '07' },
      { id: 'shayibo', name: '杀一波', query: '07' },
      { id: 'shabanbo', name: '杀半波', query: '07' },
      { id: 'shayihe', name: '杀一合', query: '07' },
      { id: 'shayixiao', name: '杀一肖', query: '07' },
      { id: 'shayixiao2', name: '杀一肖二', query: '07' },
      { id: 'shayiduan', name: '杀一段', query: '07' },
      { id: 'shayihang', name: '杀一行', query: '07' },
      { id: 'shayiwei', name: '杀一尾', query: '07' }
    ]
  }
];

const DIRECTORY_NAMES = Array.from({ length: 21 }, (_, index) => `目录${index + 1}`);

function projectInput(projectSpec, mode) {
  const entries = DIRECTORY_NAMES.map(name => ({ name, content: '' }));
  return {
    project: {
      id: projectSpec.id,
      name: projectSpec.name,
      modes: projectSpec.modes.map(({ id, name }) => ({ id, name }))
    },
    projectState: {
      date: '2026-08-18',
      modeId: mode.id,
      snapshot: {
        days: {
          '2026-08-18': {
            [mode.id]: { query: mode.query, entries }
          }
        }
      }
    }
  };
}

function analysisTrendButtons(markup) {
  return (markup.match(/<tr class="hover-row"[\s\S]*?<\/tr>/g) || []).map(row => {
    const name = row.match(/\bdata-name="([^"]+)"/)?.[1] || '';
    const button = row.match(/<button\b[^>]*\bdata-action="show-trend"[^>]*>/)?.[0] || '';
    return {
      name,
      enabled: /\bdata-show-break-ranking="true"/.test(button)
    };
  });
}

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

function rank(stateHistory) {
  assert.equal(
    typeof statsDomain.rankRightStreaksBeforeWrong,
    'function',
    'stats.js must export rankRightStreaksBeforeWrong(stateHistory)'
  );
  return statsDomain.rankRightStreaksBeforeWrong(stateHistory);
}

function summarize(stateHistory) {
  assert.equal(
    typeof statsDomain.summarizeRightStreakBreaks,
    'function',
    'stats.js must export summarizeRightStreakBreaks(stateHistory)'
  );
  return statsDomain.summarizeRightStreakBreaks(stateHistory);
}

function renderRankedTrendModal(stats) {
  const start = appJs.indexOf('function showTrendModal(');
  const end = appJs.indexOf('\nfunction showDailyRankingModal(', start);
  assert.ok(start >= 0 && end > start, 'app.js must define showTrendModal before showDailyRankingModal');

  let markup = '';
  const document = {
    body: {
      insertAdjacentHTML(position, value) {
        assert.equal(position, 'beforeend');
        markup = value;
      }
    },
    querySelector(selector) {
      assert.equal(selector, '.legacy-modal-host .chart-scroll-wrap');
      return { scrollLeft: 0, scrollWidth: 100 };
    }
  };
  const showTrendModal = Function(
    'activeContext',
    'buildDirectoryStats',
    'closeLegacyModal',
    'getModeRecord',
    'escapeHtml',
    'summarizeRightStreakBreaks',
    'formatHistoricalContent',
    'document',
    `"use strict";\n${appJs.slice(start, end)}\nreturn showTrendModal;`
  )(
    () => ({ project: { id: 'pingte' }, projectState: { snapshot: {} } }),
    () => stats,
    () => {},
    () => ({ query: '鼠', entries: [{ name: '目录1', content: '鼠' }] }),
    value => String(value),
    statsDomain.summarizeRightStreakBreaks,
    formatHistoricalContent,
    document
  );

  showTrendModal('目录1', 'pingteyixiao', true);
  return markup;
}

function createTrendBreakJumper(targetOffsets) {
  const start = appJs.indexOf('function jumpToTrendBreak(');
  const end = appJs.indexOf('\nfunction showTrendModal(', start);
  assert.ok(start >= 0 && end > start, 'app.js must define jumpToTrendBreak before showTrendModal');

  const scrolls = [];
  const scroller = {
    clientWidth: 200,
    scrollTo(options) { scrolls.push(options); }
  };
  const targets = targetOffsets.map(offsetLeft => {
    const classes = new Set();
    return {
      offsetLeft,
      offsetWidth: 36,
      classList: {
        add(value) { classes.add(value); },
        remove(value) { classes.delete(value); },
        contains(value) { return classes.has(value); }
      }
    };
  });
  const modal = {
    querySelector(selector) {
      if (selector === '.chart-scroll-wrap') return scroller;
      assert.equal(selector, '.trend-chart-point.trend-break-target');
      return targets.find(target => target.classList.contains('trend-break-target')) || null;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '.trend-chart-point[data-break-days="1"]');
      return targets;
    }
  };
  const button = {
    dataset: { days: '1' },
    closest(selector) {
      assert.equal(selector, '.legacy-modal-host');
      return modal;
    }
  };
  const jumpToTrendBreak = Function(
    `"use strict";\n${appJs.slice(start, end)}\nreturn jumpToTrendBreak;`
  )();

  return { button, jumpToTrendBreak, scrolls, targets };
}

function trendStats(stateHistory, currentState, currentStreak) {
  return {
    stateHistory,
    stateDates: stateHistory.map((_, index) => `2026-08-${String(index + 1).padStart(2, '0')}`),
    currentState,
    currentStreak
  };
}

function modalClassTexts(markup, className) {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return [...markup.matchAll(new RegExp(
    `<[^>]+class="[^"]*\\b${escaped}\\b[^"]*"[^>]*>([\\s\\S]*?)<\\/[^>]+>`,
    'g'
  ))].map(match => match[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
}

test('ranks completed right streaks descending and preserves duplicate lengths', () => {
  assert.deepEqual(
    rank([true, true, false, true, true, true, false, true, true, false]),
    [3, 2, 2]
  );
});

test('groups equal streak lengths and sorts higher occurrence counts first', () => {
  assert.deepEqual(
    summarize([true, true, false, true, true, true, false, true, true, false]),
    [{ days: 2, count: 2 }, { days: 3, count: 1 }]
  );
});

test('sorts equal occurrence counts by longer right streak first', () => {
  assert.deepEqual(
    summarize([true, true, true, false, true, true, false, true, true, false, true, true, true, false]),
    [{ days: 3, count: 2 }, { days: 2, count: 2 }]
  );
});

test('omits zero-day items when false values are initial or consecutive', () => {
  assert.deepEqual(
    rank([false, false, true, false, false, false, true, true, false]),
    [2, 1]
  );
});

test('pending values reset the streak without recording it', () => {
  assert.deepEqual(
    rank([true, true, null, true, false, null, true, true, true]),
    [1]
  );
});

test('returns no ranking for empty input or an ongoing final right streak', () => {
  assert.deepEqual(rank([]), []);
  assert.deepEqual(rank([true, true, true]), []);
});

test('enables the true hit-rate top twenty in all 17 modes without requiring a header click', () => {
  const modes = PROJECT_MODES.flatMap(project => project.modes.map(mode => ({ project, mode })));
  assert.equal(modes.length, 17);

  for (const { project, mode } of modes) {
    const input = projectInput(project, mode);
    const hitRateButtons = analysisTrendButtons(renderAnalysis({
      ...input,
      analysisState: { sortKey: 'hitrate', sortCycle: 1 }
    }));
    const expectedNames = hitRateButtons.slice(0, 20).map(button => button.name).sort();
    const defaultButtons = analysisTrendButtons(renderAnalysis({ ...input, analysisState: {} }));

    assert.equal(defaultButtons.length, 21, `${project.id}/${mode.id} should render twenty-one test rows`);
    assert.deepEqual(
      defaultButtons.filter(button => button.enabled).map(button => button.name).sort(),
      expectedNames,
      `${project.id}/${mode.id} should enable its hit-rate top twenty on the default page`
    );
  }
});

test('keeps the same hit-rate top twenty eligible when another sort reorders the table', () => {
  const input = projectInput(PROJECT_MODES[0], PROJECT_MODES[0].modes[0]);
  const expectedNames = analysisTrendButtons(renderAnalysis({
    ...input,
    analysisState: { sortKey: 'hitrate', sortCycle: 1 }
  })).slice(0, 20).map(button => button.name).sort();
  const reversedNameButtons = analysisTrendButtons(renderAnalysis({
    ...input,
    analysisState: { sortKey: 'default', sortCycle: 1 }
  }));

  assert.equal(reversedNameButtons.filter(button => button.enabled).length, 20);
  assert.equal(reversedNameButtons.filter(button => !button.enabled).length, 1);
  assert.deepEqual(
    reversedNameButtons.filter(button => button.enabled).map(button => button.name).sort(),
    expectedNames
  );
});

test('keeps workspace trend entry points on the current unranked modal path', () => {
  const input = projectInput(PROJECT_MODES[0], PROJECT_MODES[0].modes[0]);
  const record = input.projectState.snapshot.days['2026-08-18'][input.projectState.modeId];
  record.entries.forEach(entry => { entry.content = '鼠'; });
  const workspace = renderWorkspace({
    ...input,
    record,
    busy: false,
    today: input.projectState.date,
    rawText: ''
  });

  assert.match(workspace, /\bdata-action="show-trend"/);
  assert.doesNotMatch(workspace, /\bdata-show-break-ranking="true"/);
});

test('wires eligible buttons to a ranked modal while preserving the existing timeline behavior', () => {
  assert.match(appJs, /summarizeRightStreakBreaks\s*\(\s*stats\.stateHistory\s*\)/);
  assert.match(appJs, /dataset\.showBreakRanking\s*===\s*['"]true['"]/);

  const titleIndex = appJs.indexOf('class="chart-fixed-title"');
  const shellIndex = appJs.indexOf('class="trend-chart-shell"', titleIndex);
  const rankingIndex = appJs.indexOf('class="trend-break-ranking"', shellIndex);
  const scrollerIndex = appJs.indexOf('class="chart-scroll-wrap"', rankingIndex);
  assert.ok(titleIndex >= 0 && titleIndex < shellIndex, 'trend shell should follow the fixed title');
  assert.ok(shellIndex < rankingIndex, 'ranking should be in the trend chart shell');
  assert.ok(rankingIndex < scrollerIndex, 'ranking should appear above the timeline scroller');

  const itemTemplates = [...appJs.matchAll(
    /<[^>]+class="trend-break-ranking-item"[^>]*>([^<]*)<\/[^>]+>/g
  )].map(match => match[1].replace(/\$\{[^}]+\}/g, 'N'));
  assert.deepEqual(itemTemplates, ['连对 N 天后错 · N 次']);

  assert.match(appJs, /class="trend-point-tooltip"/);
  assert.match(appJs, /const trendScroller = document\.querySelector\('\.legacy-modal-host \.chart-scroll-wrap'\)/);
  assert.match(appJs, /trendScroller\.scrollLeft = trendScroller\.scrollWidth/);
});

test('renders clickable break labels and marks their matching wrong points', () => {
  const markup = renderRankedTrendModal(trendStats(
    [true, false, true, true, false, true, false],
    false,
    1
  ));

  assert.match(markup, /<button[^>]+data-action="jump-trend-break"[^>]+data-days="1"/);
  assert.match(markup, /<button[^>]+data-action="jump-trend-break"[^>]+data-days="2"/);
  assert.equal((markup.match(/data-break-days="1"/g) || []).length, 2);
  assert.equal((markup.match(/data-break-days="2"/g) || []).length, 1);
});

test('cycles repeated label clicks through matching dates from oldest to newest', () => {
  const { button, jumpToTrendBreak, scrolls, targets } = createTrendBreakJumper([100, 300]);

  jumpToTrendBreak(button);
  assert.deepEqual(targets.map(target => target.classList.contains('trend-break-target')), [true, false]);
  jumpToTrendBreak(button);
  assert.deepEqual(targets.map(target => target.classList.contains('trend-break-target')), [false, true]);
  jumpToTrendBreak(button);
  assert.deepEqual(targets.map(target => target.classList.contains('trend-break-target')), [true, false]);

  assert.deepEqual(scrolls, [
    { left: 18, behavior: 'smooth' },
    { left: 218, behavior: 'smooth' },
    { left: 18, behavior: 'smooth' }
  ]);
});

test('keeps a single matching occurrence selected on every click', () => {
  const { button, jumpToTrendBreak, scrolls } = createTrendBreakJumper([300]);

  jumpToTrendBreak(button);
  jumpToTrendBreak(button);

  assert.deepEqual(scrolls, [
    { left: 218, behavior: 'smooth' },
    { left: 218, behavior: 'smooth' }
  ]);
});

test('shows a top arrow and breathing edge only on the selected trend point', () => {
  const markerRule = cssRule('.trend-chart-point.trend-break-target::after');
  const pulseRule = cssRule('.trend-chart-point.trend-break-target > span');
  const selectedDateRule = cssRule('.trend-chart-point.trend-break-target small');

  assert.match(markerRule, /content:\s*["']▼["']/);
  assert.match(markerRule, /position:\s*absolute/);
  assert.match(markerRule, /color:\s*#00f5ff/);
  assert.match(pulseRule, /animation:/);
  assert.match(css, /@keyframes\s+trend-break-pulse/);
  assert.match(css, /box-shadow:[^;]*#ffffff[^;]*rgb\(0\s+245\s+255/);
  assert.match(selectedDateRule, /top:\s*90px/);
  assert.match(selectedDateRule, /z-index:\s*3/);
  assert.match(selectedDateRule, /color:\s*#ffffff/);
  assert.match(selectedDateRule, /background:\s*#001b1d/);
  assert.match(selectedDateRule, /border:\s*1px\s+solid\s+#00f5ff/);
  assert.match(selectedDateRule, /transform:\s*translateX\(-50%\)/);
  assert.doesNotMatch(selectedDateRule, /rotate/);
});

test('shows current right streak and warns with the matching historical break count', () => {
  const markup = renderRankedTrendModal(trendStats(
    [true, true, false, true, true, false, true, true, true, false, true, true, true],
    true,
    3
  ));

  assert.match(markup, /当前：连对 3 天/);
  assert.deepEqual(
    modalClassTexts(markup, 'trend-break-ranking-item'),
    ['连对 2 天后错 · 2 次', '连对 3 天后错 · 1 次'],
    'occurrence-count-first ranking must remain unchanged'
  );
  const warnings = modalClassTexts(markup, 'trend-break-warning');
  assert.equal(warnings.length, 1, 'an exact current-right-streak match should render one visible warning');
  assert.match(warnings[0], /1\s*次/, 'the warning should contain the matching historical occurrence count');
});

test('shows a nonmatching current right streak without a break warning', () => {
  const markup = renderRankedTrendModal(trendStats(
    [true, false, true, true],
    true,
    2
  ));

  assert.match(markup, /当前：连对 2 天/);
  assert.deepEqual(modalClassTexts(markup, 'trend-break-warning'), []);
});

test('shows current wrong streak without a break warning', () => {
  const markup = renderRankedTrendModal(trendStats(
    [true, true, false, false],
    false,
    2
  ));

  assert.match(markup, /当前：连错 2 天/);
  assert.deepEqual(modalClassTexts(markup, 'trend-break-warning'), []);
});

test('shows pending current state without a break warning', () => {
  const markup = renderRankedTrendModal(trendStats(
    [true, true, false, null],
    null,
    0
  ));

  assert.match(markup, /当前：待定/);
  assert.deepEqual(modalClassTexts(markup, 'trend-break-warning'), []);
});

test('keeps the eligible ranked shell and current status when no completed break exists', () => {
  const markup = renderRankedTrendModal(trendStats([true, true], true, 2));

  assert.match(markup, /class="trend-chart-shell"/);
  assert.match(markup, /当前：连对 2 天/);
  assert.deepEqual(modalClassTexts(markup, 'trend-break-ranking-item'), []);
  assert.deepEqual(modalClassTexts(markup, 'trend-break-warning'), []);
});

test('bounds a wrapping or scrolling ranking region without displacing the timeline', () => {
  const shellRule = cssRule('.trend-chart-shell');
  const rankingRule = cssRule('.trend-break-ranking');
  const itemRule = cssRule('.trend-break-ranking-item');
  const scrollerRule = cssRule('.chart-scroll-wrap');

  assert.match(shellRule, /display:\s*flex/);
  assert.match(shellRule, /flex-direction:\s*column/);
  assert.match(shellRule, /min-height:\s*0/);
  assert.match(rankingRule, /(?:max-height|height):/);
  assert.match(rankingRule, /overflow-y:\s*(?:auto|scroll)/);
  assert.match(rankingRule, /(?:flex-wrap:\s*wrap|display:\s*grid)/);
  assert.ok(itemRule.trim(), 'trend-break-ranking-item requires its own CSS rule');
  assert.match(scrollerRule, /flex:\s*1\s+1\s+auto/);
});

test('uses larger muted warm-gray text for historical break chips', () => {
  const itemRule = cssRule('.trend-break-ranking-item');

  assert.match(itemRule, /color:\s*#b6b0a8/);
  assert.match(itemRule, /font-size:\s*15px/);
  assert.doesNotMatch(itemRule, /color:\s*#(?:ffffff|c8d2dc)/);
});
