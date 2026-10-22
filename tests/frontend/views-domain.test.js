import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderAnalysis, renderDailyStats } from '../../assets/js/views.js';

const project = {
  id: 'pingte',
  name: '平特分析',
  modes: [{ id: 'pingteyixiao', name: '平特一肖' }]
};

const projectState = {
  modeId: 'pingteyixiao',
  snapshot: { days: {
    '2026-06-01': {
      pingteyixiao: {
        query: '鼠',
        entries: [
          { name: '目录甲', content: '鼠' },
          { name: '目录乙', content: '牛' }
        ]
      }
    },
    '2026-06-02': {
      pingteyixiao: {
        query: '牛',
        entries: [
          { name: '目录甲', content: '虎' },
          { name: '目录乙', content: '牛' }
        ]
      }
    }
  } }
};

function visibleText(markup) {
  return markup.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
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

function analysisRowNames(markup) {
  // 行上可能追加 top-tier-row 等标记类，只要求 class 以 hover-row 开头。
  return [...markup.matchAll(/<tr class="hover-row[^"]*"[^>]*data-name="([^"]+)"/g)]
    .map(match => match[1]);
}

test('renders correctness and streak metrics in detailed analysis', () => {
  const html = renderAnalysis({ project, projectState });
  const cells = rowCells(html, '目录甲');
  assert.match(html, /目前状态/);
  assert.match(html, /持续天数/);
  assert.match(html, /总连断/);
  assert.match(html, /命中率/);
  assert.match(html, /data-key="monthWrong"/);
  assert.match(cells[1], /^目录甲/);
  assert.equal(cells[0], '观察');
  // 2026-10-19 去掉近30有效日命中率、7天命中率、10天命中率三列显示后，列序号整体前移。
  assert.equal(cells[2], '✕ 连断中');
  assert.deepEqual([...cells.slice(3, 8), ...cells.slice(10)].flatMap(numericTokens), [
    '1', '1', '1', '1', '50.0%', '1', '0', '2'
  ]);
  assert.match(html, /近7期走势/);
  assert.match(html, /2026-06-02 错误/);
});

test('counts wrong results in the current month for each directory', () => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const html = renderAnalysis({
    project,
    projectState: {
      ...projectState,
      snapshot: { days: {
        [`${currentMonth}-01`]: {
          pingteyixiao: {
            query: '鼠',
            entries: [{ name: '目录甲', content: '牛' }]
          }
        },
        [`${currentMonth}-02`]: {
          pingteyixiao: {
            query: '牛',
            entries: [{ name: '目录甲', content: '鼠' }]
          }
        },
        [`${currentMonth}-03`]: {
          pingteyixiao: {
            query: '虎',
            entries: [{ name: '目录甲', content: '虎' }]
          }
        }
      } }
    }
  });
  const cells = rowCells(html, '目录甲');
  assert.match(html, /本月错次/);
  assert.equal(cells.at(-2), '2 次');
});

test('renders true daily right and wrong totals with a prior-streak filter', () => {
  const html = renderDailyStats({
    project,
    projectState,
    minimumPriorRightStreak: 0,
    dailyState: { expandedMonths: ['2026-06'] }
  });
  const cells = rowCells(html, '2026-06-02');
  assert.match(html, /连对/);
  assert.match(html, /2026-06-02/);
  assert.deepEqual(numericTokens(cells[1]), ['2', '1', '1', '50.0%']);
  assert.match(html, /data-action="set-daily-filter"/);
});

test('orders the observation group by coverage, while header clicks retain unranked status', () => {
  const input = {
    project,
    projectState: {
      modeId: 'pingteyixiao',
      snapshot: { days: {
        '2026-06-01': {
          pingteyixiao: {
            query: '鼠',
            entries: [
              { name: '目录甲', content: '鼠' },
              { name: '目录乙', content: '牛' }
            ]
          }
        },
        '2026-06-02': {
          pingteyixiao: {
            query: '牛',
            entries: [
              { name: '目录甲', content: '牛' },
              { name: '目录乙', content: '虎' }
            ]
          }
        },
        '2026-06-03': {
          pingteyixiao: {
            query: '虎',
            entries: [
              { name: '目录甲', content: '虎' },
              { name: '目录乙', content: '虎' }
            ]
          }
        },
        '2026-06-04': {
          pingteyixiao: {
            query: '兔',
            entries: [
              { name: '目录甲', content: '鼠' },
              { name: '目录乙', content: '兔' },
              { name: '目录丙', content: '兔' }
            ]
          }
        }
      } }
    }
  };
  const defaultHtml = renderAnalysis(input);
  const hitRateHtml = renderAnalysis({
    ...input,
    analysisState: { sortKey: 'hitrate', sortCycle: 1 }
  });

  assert.deepEqual(analysisRowNames(defaultHtml), ['目录甲', '目录乙', '目录丙']);
  assert.deepEqual(analysisRowNames(hitRateHtml), ['目录丙', '目录甲', '目录乙']);
  assert.doesNotMatch(defaultHtml, /class="rank-num"/);
  assert.match(defaultHtml, /正式榜 0 条，观察区 3 条/);
});

test('manual column sorting uses displayed values rather than dividing every metric by age', () => {
  const renderSorted = (key, shortStates, longStates) => {
    const days = {};
    for (let index = 0; index < longStates.length; index += 1) {
      const date = `2026-06-${String(index + 1).padStart(2, '0')}`;
      const entries = [{ name: '目录乙', content: longStates[index] ? '鼠' : '牛' }];
      const shortIndex = index - (longStates.length - shortStates.length);
      if (shortIndex >= 0) entries.push({ name: '目录甲', content: shortStates[shortIndex] ? '鼠' : '牛' });
      days[date] = { pingteyixiao: { query: '鼠', entries } };
    }
    return analysisRowNames(renderAnalysis({
      project,
      projectState: { modeId: 'pingteyixiao', snapshot: { days } },
      analysisState: { sortKey: key, sortCycle: 1 }
    }));
  };
  assert.equal(renderSorted('total', [false, true], [false, false, false, true, true, true, true, true, true, true])[0], '目录乙');
  assert.equal(renderSorted('maxRight', [true, true], [true, true, true, true, true, false, false, false, false, false])[0], '目录乙');
  assert.match(renderAnalysis({ project, projectState, analysisState: { sortKey: 'maxRight', sortCycle: 1 } }), /当前按表头字段查看；正式榜名次保留/);
});

test('official ranks survive manual sorting and remain separate from younger perfect records', () => {
  const days = {};
  for (let index = 0; index < 121; index += 1) {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    const entries = [
      { name: '老甲', content: index < 2 ? '牛' : '鼠' },
      { name: '老乙', content: index < 6 ? '牛' : '鼠' }
    ];
    if (index >= 2) entries.push({ name: '新人', content: '鼠' });
    days[date] = { pingteyixiao: { query: '鼠', entries } };
  }
  const input = { project, projectState: { modeId: 'pingteyixiao', snapshot: { days } } };
  const html = renderAnalysis(input);
  assert.deepEqual(analysisRowNames(html), ['老甲', '老乙', '新人']);
  assert.match(html, /正式榜 2 条，观察区 1 条/);
  assert.equal(rowCells(html, '老甲')[0], '1');
  assert.equal(rowCells(html, '老乙')[0], '2');
  assert.equal(rowCells(html, '新人')[0], '观察');
  const sorted = renderAnalysis({ ...input, analysisState: { sortKey: 'total', sortCycle: 1 } });
  assert.deepEqual(analysisRowNames(sorted), ['老乙', '老甲', '新人']);
  assert.equal(rowCells(sorted, '老乙')[0], '2');
  assert.equal(rowCells(sorted, '新人')[0], '观察');
  assert.deepEqual(analysisRowNames(renderAnalysis({ ...input, analysisState: { sortKey: 'total', sortCycle: 0 } })), ['老甲', '老乙', '新人']);
});

test('score details distinguish the last 120 valid results from preserved historical totals', () => {
  const days = {};
  for (let index = 0; index < 140; index += 1) {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    days[date] = { pingteyixiao: { query: '鼠', entries: [{ name: '长期目录', content: index < 20 ? '牛' : '鼠' }] } };
  }
  const html = renderAnalysis({ project, projectState: { modeId: 'pingteyixiao', snapshot: { days } } });
  const cells = rowCells(html, '长期目录');
  // 去掉三列后：4=总连断，7=命中率，8=长期可靠分。
  assert.match(cells[8], /^96\.9 /);
  assert.match(cells[8], /历史有效 140 天，120 对 \/ 20 错/);
  assert.match(cells[8], /长期分仅计算最近 120 个有效日，120 对 \/ 0 错/);
  assert.match(cells[8], /窗口命中率 100\.0%/);
  assert.equal(cells[4], '20 次');
  assert.equal(cells[7], '85.7%');
  assert.equal(cells.at(-1), '140 天');

  const young = rowCells(renderAnalysis({ project, projectState }), '目录甲');
  assert.match(young[8], /长期分仅计算最近 2 个有效日，1 对 \/ 1 错/);
  assert.match(young[8], /还需 118 个有效统计日参榜/);
});
