import assert from 'node:assert/strict';
import { test } from 'node:test';

import { renderDailyRankingModal, renderDailyStats } from '../../assets/js/views.js';

function render(project, modeId, record, dailyState = { expandedMonths: ['2026-07'] }) {
  return renderDailyStats({
    project,
    projectState: {
      modeId,
      date: '2026-07-27',
      snapshot: { days: { '2026-07-27': { [modeId]: record } } }
    },
    dailyState
  });
}

function renderMonth(project, days) {
  return renderDailyStats({
    project,
    projectState: {
      modeId: project.modes[0].id,
      date: '2026-07-28',
      snapshot: { days }
    },
    dailyState: { expandedMonths: ['2026-07'] }
  });
}

function repeatedEntries(prefix, content, count) {
  return Array.from({ length: count }, (_, index) => ({ name: `${prefix}${index + 1}`, content }));
}

function daweiRateEntries(prefix, right, total) {
  return [
    ...repeatedEntries(`${prefix}对`, '01', right),
    ...repeatedEntries(`${prefix}错`, '49', total - right)
  ];
}

function numberFrequencyEntries(prefix, frequencies) {
  return frequencies.flatMap(([number, count]) => repeatedEntries(`${prefix}${number}-`, number, count));
}

test('生肖每日统计与云端一致显示开奖、前两名、并列及命中状态', () => {
  const html = render(
    { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'shengxiao', name: '生肖' }] },
    'shengxiao',
    {
      query: '鼠',
      entries: [
        { name: '甲', content: '鼠牛虎' },
        { name: '乙', content: '鼠牛' },
        { name: '丙', content: '虎龙' }
      ]
    }
  );

  assert.match(html, /当日开奖：鼠，共出现 2 次/);
  assert.match(html, /第一名：鼠、牛、虎 2次（<span class="daily-stats-zodiac-hit">命中<\/span>）/);
  assert.match(html, /第二名：龙 1次（<span class="daily-stats-zodiac-miss">未命中<\/span>）/);
});

test('生肖每日统计和月度合计显示第三名及命中明细', () => {
  const project = { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'shengxiao', name: '生肖' }] };
  const html = render(project, 'shengxiao', {
    query: '虎',
    entries: [
      ...repeatedEntries('甲', '鼠', 4),
      ...repeatedEntries('乙', '牛', 3),
      ...repeatedEntries('丙', '虎', 2)
    ]
  });
  assert.match(html, /第三名：虎 2次（<span class="daily-stats-zodiac-hit">命中<\/span>）/);
  assert.match(html, /第三名本月命中：<b>1次<\/b>/);

  const modal = renderDailyRankingModal({
    project,
    snapshot: { days: { '2026-07-27': { shengxiao: {
      query: '虎',
      entries: [
        ...repeatedEntries('甲', '鼠', 4),
        ...repeatedEntries('乙', '牛', 3),
        ...repeatedEntries('丙', '虎', 2)
      ]
    } } } },
    monthKey: '2026-07',
    modeId: 'shengxiao'
  });
  assert.match(modal, /第三名本月命中：<b>1次<\/b>/);
  assert.match(modal, /当日第三名次数：<b>2次<\/b>/);
});

test('生肖每日统计不把数字开奖转成生肖', () => {
  const html = render(
    { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'shengxiao', name: '生肖' }] },
    'shengxiao',
    { query: '19', entries: [{ name: '甲', content: '鼠牛' }, { name: '乙', content: '鼠虎' }] }
  );

  assert.doesNotMatch(html, /当日开奖：/);
  assert.match(html, /第一名：鼠 2次（<span class="daily-stats-zodiac-pending">未录入<\/span>）/);
});

test('杀两肖每日统计与云端一致按不同次数档位显示前两名命中状态', () => {
  const html = render(
    { id: 'pingte', name: '平特', modes: [{ id: 'shaliangxiao', name: '杀两肖' }] },
    'shaliangxiao',
    {
      query: '19',
      entries: [
        { name: '甲', content: '鼠牛' },
        { name: '乙', content: '鼠虎' },
        { name: '丙', content: '牛虎' },
        { name: '丁', content: '鼠龙' },
        { name: '___QUERY___', content: '鼠龙' },
        { name: '无效', content: '鼠' }
      ]
    }
  );

  assert.match(html, /开奖生肖：鼠，共3次/);
  assert.match(html, /daily-stats-kill-two-result is-first[^>]*>第一名：命中/);
  assert.match(html, /daily-stats-kill-two-result is-second is-miss[^>]*>第二名：不命中/);
});

test('杀两肖多个生肖或多个号码开奖时不显示排行', () => {
  for (const query of ['鼠牛', '19 20']) {
    const html = render(
      { id: 'pingte', name: '平特', modes: [{ id: 'shaliangxiao', name: '杀两肖' }] },
      'shaliangxiao',
      { query, entries: [{ name: '甲', content: '鼠牛' }] }
    );
    assert.doesNotMatch(html, /daily-stats-kill-two-draw-count/);
  }
});

test('杀两肖第二档并列时显示云端的命中数量', () => {
  const html = render(
    { id: 'pingte', name: '平特', modes: [{ id: 'shaliangxiao', name: '杀两肖' }] },
    'shaliangxiao',
    {
      query: '03',
      entries: [
        { name: '甲', content: '牛鼠' },
        { name: '乙', content: '牛龙' },
        { name: '丙', content: '牛虎' },
        { name: '丁', content: '龙虎' }
      ]
    }
  );

  assert.match(html, /第一名：不命中/);
  assert.match(html, /第二名：命中2个/);
});

test('开启连对筛选后专用排行位于云端的比较说明之后', () => {
  const html = render(
    { id: 'pingte', name: '平特', modes: [{ id: 'shaliangxiao', name: '杀两肖' }] },
    'shaliangxiao',
    { query: '19', entries: [{ name: '甲', content: '鼠牛' }] },
    { expandedMonths: ['2026-07'], filters: { shaliangxiao: { enabled: true, days: 2 } } }
  );

  const dailyCell = html.match(/<td>([\s\S]*?)<\/td>/)?.[1] || '';
  assert.ok(dailyCell.indexOf('daily-stats-compare-note') < dailyCell.indexOf('daily-stats-kill-two-draw-count'));
});

test('杀两肖并列档位沿用云端的命中数量文案', () => {
  const html = render(
    { id: 'pingte', name: '平特', modes: [{ id: 'shaliangxiao', name: '杀两肖' }] },
    'shaliangxiao',
    {
      query: '19',
      entries: [
        { name: '甲', content: '鼠牛' },
        { name: '乙', content: '鼠虎' },
        { name: '丙', content: '牛虎' }
      ]
    }
  );

  assert.match(html, /第一名：命中3个/);
  assert.doesNotMatch(html, /第二名：/);
});

test('九项全部类别按不同次数档位显示前两名，并分别累计月度命中', () => {
  const cases = [
    ['shabantou', '0头单', '0头双', '1头单'],
    ['shayitou', '0头', '1头', '2头'],
    ['shayibo', '红波', '蓝波', '绿波'],
    ['shabanbo', '红单', '红双', '蓝单'],
    ['shayihe', '01合', '02合', '03合'],
    ['shayixiao', '鼠', '牛', '虎'],
    ['shayixiao2', '鼠', '牛', '虎'],
    ['shayiduan', '1段', '2段', '3段'],
    ['shayihang', '金行', '木行', '水行'],
    ['shayiwei', '1尾', '2尾', '3尾']
  ];
  for (const [modeId, first, tiedFirst, second] of cases) {
    const project = { id: 'jiuxiang', name: '九项综合', modes: [{ id: modeId, name: modeId }] };
    const html = render(project, modeId, {
      query: second,
      entries: [
        ...repeatedEntries('甲', first, 3),
        ...repeatedEntries('乙', tiedFirst, 3),
        ...repeatedEntries('丙', second, 2)
      ]
    });
    assert.match(html, /class="miss">第一名：未中（3次）/, modeId);
    assert.match(html, /class="hit">第二名：命中（2次）/, modeId);
    assert.match(html, /第一名本月命中：<b>0次<\/b>/, modeId);
    assert.match(html, /第二名本月命中：<b>1次<\/b>/, modeId);
  }
});

test('前两名处理并列第二、缺少第二档和未录入开奖，不重复计算同一天', () => {
  const project = { id: 'jiuxiang', name: '九项综合', modes: [{ id: 'shabantou', name: '杀半头' }] };
  const entries = [
    ...repeatedEntries('甲', '0头单', 3),
    ...repeatedEntries('乙', '0头双', 2),
    ...repeatedEntries('丙', '1头单', 2)
  ];
  const tiedSecond = render(project, 'shabantou', { query: '0头双,1头单', entries });
  assert.match(tiedSecond, /第二名：命中（2次）/);
  assert.match(tiedSecond, /第二名本月命中：<b>1次<\/b>/);

  const noSecond = render(project, 'shabantou', {
    query: '01', entries: [...repeatedEntries('甲', '0头单', 2), ...repeatedEntries('乙', '0头双', 2)]
  });
  assert.match(noSecond, /第一名：命中（2次）/);
  assert.match(noSecond, /第二名：-/);
  assert.match(noSecond, /第二名本月命中：<b>0次<\/b>/);

  const pending = render(project, 'shabantou', { query: '', entries });
  assert.match(pending, /第一名：-/);
  assert.match(pending, /第二名：-/);
  assert.doesNotMatch(pending, /本月命中/);
});

test('九项月度合计独立统计前两名命中次数和开奖号最高次数', () => {
  const project = { id: 'jiuxiang', name: '九项综合', modes: [{ id: 'shabantou', name: '杀半头' }] };
  const html = renderMonth(project, {
    '2026-07-28': { shabantou: {
      query: '01',
      entries: [
        ...repeatedEntries('甲', '0头单', 3),
        ...repeatedEntries('乙', '0头双', 2)
      ]
    } },
    '2026-07-27': { shabantou: {
      query: '02',
      entries: [
        ...repeatedEntries('丙', '0头单', 8),
        ...repeatedEntries('丁', '0头双', 7)
      ]
    } },
    '2026-07-26': { shabantou: {
      query: '02',
      entries: [
        ...repeatedEntries('戊', '0头单', 1),
        ...repeatedEntries('己', '0头双', 5)
      ]
    } }
  });

  assert.match(html, /daily-stats-month-ranking[^>]*>[\s\S]*第一名本月命中：<b>2次<\/b>/);
  assert.match(html, /第二名本月命中：<b>1次<\/b>/);
  assert.match(html, /daily-stats-month-ranking[^>]*>[\s\S]*本月开奖号最高：<b>7次<\/b>/);
  assert.match(html, /data-action="show-daily-ranking"[^>]*data-mode="shabantou"[^>]*data-month="2026-07"/);
});

test('生肖和杀两肖加入月度排行统计，其他种类不加入', () => {
  const zodiacHtml = renderMonth(
    { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'shengxiao', name: '生肖' }] },
    {
      '2026-07-28': { shengxiao: { query: '鼠', entries: [
        ...repeatedEntries('甲', '鼠', 2),
        ...repeatedEntries('乙', '牛', 3)
      ] } },
      '2026-07-27': { shengxiao: { query: '鼠', entries: [
        ...repeatedEntries('丙', '鼠', 4),
        ...repeatedEntries('丁', '牛', 3)
      ] } }
    }
  );
  const killTwoHtml = renderMonth(
    { id: 'pingte', name: '平特', modes: [{ id: 'shaliangxiao', name: '杀两肖' }] },
    {
      '2026-07-28': { shaliangxiao: { query: '19', entries: [
        ...repeatedEntries('甲', '鼠牛', 3),
        ...repeatedEntries('乙', '虎龙', 2)
      ] } },
      '2026-07-27': { shaliangxiao: { query: '05', entries: [
        ...repeatedEntries('甲', '鼠牛', 3),
        ...repeatedEntries('乙', '虎龙', 2)
      ] } }
    }
  );
  const otherHtml = renderMonth(
    { id: 'pingte', name: '平特', modes: [{ id: 'pingtewei', name: '平特尾' }] },
    { '2026-07-28': { pingtewei: { query: '01', entries: [{ name: '甲', content: '1尾' }] } } }
  );

  assert.match(zodiacHtml, /第一名本月命中：<b>1次<\/b>/);
  assert.match(zodiacHtml, /第二名本月命中：<b>1次<\/b>/);
  assert.match(zodiacHtml, /本月开奖号最高：<b>4次<\/b>/);
  assert.match(killTwoHtml, /第一名本月命中：<b>1次<\/b>/);
  assert.match(killTwoHtml, /第二名本月命中：<b>1次<\/b>/);
  assert.match(killTwoHtml, /本月开奖号最高：<b>3次<\/b>/);
  assert.doesNotMatch(otherHtml, /daily-stats-month-ranking/);
  assert.doesNotMatch(otherHtml, /data-action="show-daily-ranking"/);
});

test('大围月度卡片只统计严格低于68%的日期，67.99%显示而68%不显示', () => {
  const project = { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'dawei', name: '大围' }] };
  const snapshot = { days: {
    '2026-07-28': { dawei: { query: '01', entries: daweiRateEntries('低于', 206, 303) } },
    '2026-07-27': { dawei: { query: '01', entries: daweiRateEntries('等于', 68, 100) } }
  } };
  const html = renderMonth(project, snapshot.days);
  const modal = renderDailyRankingModal({ project, snapshot, monthKey: '2026-07', modeId: 'dawei' });

  assert.match(html, /本月低于68%：<b>1天<\/b>/);
  assert.match(html, /data-action="show-daily-ranking"[^>]*data-mode="dawei"/);
  assert.match(modal, /本月低于68%：<b>1天<\/b>/);
  assert.match(modal, /2026-07-28[\s\S]*当日总目录：<b>303条<\/b>[\s\S]*当日胜率：<b>67\.99%<\/b>/);
  assert.doesNotMatch(modal, /2026-07-27/);
});

test('杀号按数字总次数分档，开奖号进入含并列的前五档才显示', () => {
  const project = { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'shahao', name: '杀号' }] };
  const snapshot = { days: {
    '2026-07-28': { shahao: { query: '06', entries: numberFrequencyEntries('命中', [
      ['01', 6], ['02', 5], ['03', 4], ['04', 3], ['05', 2], ['06', 2]
    ]) } },
    '2026-07-27': { shahao: { query: '07', entries: numberFrequencyEntries('未中', [
      ['01', 6], ['02', 5], ['03', 4], ['04', 3], ['05', 2], ['07', 1]
    ]) } }
  } };
  const html = renderMonth(project, snapshot.days);
  const modal = renderDailyRankingModal({ project, snapshot, monthKey: '2026-07', modeId: 'shahao' });

  assert.match(html, /开奖号进入前五档：<b>1天<\/b>/);
  assert.match(modal, /2026-07-28[\s\S]*当日总目录：<b>22条<\/b>[\s\S]*开奖号：<b>06<\/b>[\s\S]*所在档位：<b>第5档<\/b>[\s\S]*出现次数：<b>2次<\/b>/);
  assert.doesNotMatch(modal, /2026-07-27/);
});

test('杀五码按每天数字总次数统计，开奖号只在前四档时显示', () => {
  const project = { id: 'dawei_shahao', name: '大围+杀号', modes: [{ id: 'shaxiao', name: '杀五码' }] };
  const entries = [
    { name: '甲', content: '01 02 03 04 05' },
    { name: '乙', content: '01 02 03 04 06' },
    { name: '丙', content: '01 02 03 07 08' },
    { name: '丁', content: '01 02 09 10 11' },
    { name: '戊', content: '01 12 13 14 15' }
  ];
  const snapshot = { days: {
    '2026-07-28': { shaxiao: { query: '04', entries } },
    '2026-07-27': { shaxiao: { query: '05', entries } }
  } };
  const html = renderMonth(project, snapshot.days);
  const modal = renderDailyRankingModal({ project, snapshot, monthKey: '2026-07', modeId: 'shaxiao' });

  assert.match(html, /开奖号进入前四档：<b>1天<\/b>/);
  assert.match(modal, /2026-07-28[\s\S]*当日总目录：<b>5条<\/b>[\s\S]*开奖号：<b>04<\/b>[\s\S]*所在档位：<b>第4档<\/b>[\s\S]*出现次数：<b>2次<\/b>/);
  assert.doesNotMatch(modal, /2026-07-27/);
});

test('月度排行悬浮框按日期倒序列出前两名命中日、当天目录总数和名次次数', () => {
  const project = { id: 'jiuxiang', name: '九项综合', modes: [{ id: 'shabantou', name: '杀半头' }] };
  const snapshot = { days: {
    '2026-07-28': { shabantou: { query: '01', entries: [
      ...repeatedEntries('甲', '0头单', 3),
      ...repeatedEntries('乙', '0头双', 2)
    ] } },
    '2026-07-27': { shabantou: { query: '02', entries: [
      ...repeatedEntries('丙', '0头单', 8),
      ...repeatedEntries('丁', '0头双', 7)
    ] } },
    '2026-07-26': { shabantou: { query: '02', entries: [
      ...repeatedEntries('戊', '0头单', 1),
      ...repeatedEntries('己', '0头双', 5)
    ] } }
  } };
  const html = renderDailyRankingModal({ project, snapshot, monthKey: '2026-07', modeId: 'shabantou' });

  assert.match(html, /2026年07月 · 杀半头/);
  assert.match(html, /第一名本月命中：<b>2次<\/b>/);
  assert.match(html, /第二名本月命中：<b>1次<\/b>/);
  assert.match(html, /2026-07-28[\s\S]*当日总目录：<b>5条<\/b>[\s\S]*当日第一名最高：<b>3次<\/b>/);
  assert.match(html, /2026-07-26[\s\S]*当日总目录：<b>6条<\/b>[\s\S]*当日第一名最高：<b>5次<\/b>/);
  assert.match(html, /2026-07-27[\s\S]*当日总目录：<b>15条<\/b>[\s\S]*当日第二名次数：<b>7次<\/b>/);
  assert.ok(html.indexOf('2026-07-28') < html.indexOf('2026-07-27'));
  assert.ok(html.indexOf('2026-07-27') < html.indexOf('2026-07-26'));
  assert.match(html, /data-action="close-modal"/);
});

test('月度排行悬浮框处理零命中，非目标种类不生成弹窗', () => {
  const zeroHtml = renderDailyRankingModal({
    project: { id: 'jiuxiang', name: '九项综合', modes: [{ id: 'shabantou', name: '杀半头' }] },
    snapshot: { days: { '2026-07-28': { shabantou: {
      query: '12',
      entries: [...repeatedEntries('甲', '0头单', 3), ...repeatedEntries('乙', '0头双', 2)]
    } } } },
    monthKey: '2026-07',
    modeId: 'shabantou'
  });
  const otherHtml = renderDailyRankingModal({
    project: { id: 'pingte', name: '平特', modes: [{ id: 'pingtewei', name: '平特尾' }] },
    snapshot: { days: {} },
    monthKey: '2026-07',
    modeId: 'pingtewei'
  });

  assert.match(zeroHtml, /第一名本月命中：<b>0次<\/b>/);
  assert.match(zeroHtml, /第二名本月命中：<b>0次<\/b>/);
  assert.match(zeroHtml, /本月没有第一名或第二名命中日期/);
  assert.equal(otherHtml, '');
});
