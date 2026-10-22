import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLongTermRanking, compareLongTermRows, longTermScore } from '../../assets/js/domain/long-term-ranking.js';
import { buildDirectoryStats, buildModeDirectoryStats } from '../../assets/js/domain/stats.js';
import { PROJECTS } from '../../assets/js/projects.js';

function row(name, states) {
  return { name, stateHistory: states, daysInSystem: states.filter(state => state != null).length, totalRight: states.filter(state => state === true).length };
}

function date(index) {
  return new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
}

test('Wilson scores match the agreed examples, and remain finite at the boundaries', () => {
  assert.equal(longTermScore(285, 300), 91.9);
  assert.equal(longTermScore(114, 120), 89.5);
  assert.equal(longTermScore(120, 120), 96.9);
  assert.equal(longTermScore(0, 120), 0);
  assert.equal(longTermScore(0, 0), 0);
  assert.ok(longTermScore(270, 300) < longTermScore(114, 120), 'age cannot outweigh clearly better results');
});

test('120 days is inclusive and younger perfect records do not take official ranks', () => {
  const rows = buildLongTermRanking([
    row('119天全对', Array(119).fill(true)),
    row('120天全对', Array(120).fill(true)),
    row('121天全对', Array(121).fill(true)),
    row('待开奖', [null]),
    row('300天95%', [...Array(15).fill(false), ...Array(285).fill(true)]),
    row('120天95%', [...Array(6).fill(false), ...Array(114).fill(true)])
  ]);
  assert.deepEqual(rows.map(item => item.name), ['300天95%', '121天全对', '120天全对', '120天95%', '119天全对', '待开奖']);
  assert.deepEqual(rows.map(item => item.officialRank), [1, 2, 3, 4, null, null]);
});

test('long-term scores use only the last 120 valid results and preserve full history', () => {
  const recent = [...Array(6).fill(false), ...Array(114).fill(true)];
  const oldWrong = Object.freeze(row('旧错', Object.freeze([...Array(180).fill(false), ...recent])));
  const oldRight = row('旧对', [...Array(180).fill(true), ...recent]);
  const ranked = buildLongTermRanking([oldWrong, oldRight]);
  for (const item of ranked) {
    assert.equal(item.longTermDays, 120);
    assert.equal(item.longTermRight, 114);
    assert.equal(item.longTermScore, 89.5);
    assert.equal(item.daysInSystem, 300);
    assert.equal(item.stateHistory.length, 300);
  }
  assert.equal(ranked.find(item => item.name === '旧错').totalRight, 114);
  assert.equal(ranked.find(item => item.name === '旧对').totalRight, 294);
  assert.strictEqual(ranked.find(item => item.name === '旧错').stateHistory, oldWrong.stateHistory);
});

test('rolling replacement raises, lowers, or preserves the score according to the outgoing result', () => {
  const tail = [...Array(9).fill(false), ...Array(110).fill(true)];
  for (const outgoing of [true, false]) {
    const states = [outgoing, ...tail];
    const [before] = buildLongTermRanking([row('目录', states)]);
    for (const incoming of [true, false]) {
      const [after] = buildLongTermRanking([row('目录', [...states, incoming])]);
      assert.equal(after.longTermDays, 120);
      assert.equal(after.longTermRight, before.longTermRight + Number(incoming) - Number(outgoing));
      assert.equal(Math.sign(after.longTermScore - before.longTermScore), Number(incoming) - Number(outgoing));
      assert.equal(after.daysInSystem, 121);
    }
  }
});

test('unknown days do not consume the score window and observation scores remain unchanged', () => {
  const [full] = buildLongTermRanking([row('跨空日', [false, null, ...Array(119).fill(true), null, true, null])]);
  assert.equal(full.daysInSystem, 121);
  assert.equal(full.longTermDays, 120);
  assert.equal(full.longTermRight, 120);
  assert.equal(full.longTermScore, 96.9);
  const states = [...Array(3).fill(false), null, ...Array(116).fill(true), null];
  const [young] = buildLongTermRanking([row('观察', states)]);
  assert.equal(young.longTermDays, 119);
  assert.equal(young.longTermScore, longTermScore(116, 119));
  assert.equal(young.rankingEligible, false);
  assert.equal(young.officialRank, null);
  for (const states of [[], [null, null]]) {
    const [empty] = buildLongTermRanking([row('无结果', states)]);
    assert.equal(empty.longTermDays, 0);
    assert.equal(empty.longTermScore, 0);
    assert.equal(empty.officialRank, null);
  }
});

test('the last 120 valid results clip older runs and retain unknown dates as streak breaks', () => {
  const [clipped] = buildLongTermRanking([row('旧错段', [...Array(20).fill(false), ...Array(120).fill(true)])]);
  assert.equal(clipped.recent120MaxWrong, 0);
  const [broken] = buildLongTermRanking([row('断点', [...Array(118).fill(true), false, null, false, null])]);
  assert.equal(broken.daysInSystem, 120);
  assert.equal(broken.recent120MaxWrong, 1);
  assert.equal(broken.recent30Rate, 28 / 30);
  const [partial] = buildLongTermRanking([row('不足窗口', [false, false, null, true])]);
  assert.equal(partial.recent120MaxWrong, 2);
  assert.equal(partial.recent30Rate, 1 / 3);
});

test('the 120-day window also reports the total wrong count used by the table column', () => {
  // 窗口内 20 次错但全不连续：最高连错是 1，总连断次数是 20。
  const states = Array.from({ length: 140 }, (_, index) => (index % 7 === 0 ? false : true));
  const [row120] = buildLongTermRanking([row('分散错', states)]);
  assert.equal(row120.recent120MaxWrong, 1);
  assert.equal(row120.recent120WrongCount, states.slice(-120).filter(state => state === false).length);

  // 旧错段被 120 天窗口切掉，总次数只算窗口内。
  const [clipped] = buildLongTermRanking([row('旧错段', [...Array(20).fill(false), ...Array(120).fill(true)])]);
  assert.equal(clipped.recent120WrongCount, 0);

  // 待定日期不算错。
  const [pending] = buildLongTermRanking([row('待定', [false, null, false, null])]);
  assert.equal(pending.recent120WrongCount, 2);
});

test('rounded long-term score dominates stability, then recent form, coverage, and name', () => {
  const base = { name: '目录2', longTermScore: 91.9, recent120MaxWrong: 2, recent30Rate: 0.8, daysInSystem: 300 };
  const ordered = [
    { ...base, name: '长期分优先', longTermScore: 92, recent120MaxWrong: 5, recent30Rate: 0.2 },
    { ...base, name: '少连错优先', recent120MaxWrong: 1, recent30Rate: 0.2 },
    { ...base, name: '近期优先', recent30Rate: 0.9, daysInSystem: 120 },
    { ...base, name: '天数优先', daysInSystem: 301 },
    base,
    { ...base, name: '目录10' }
  ];
  assert.deepEqual([...ordered].reverse().sort(compareLongTermRows), ordered);
});

test('settled ranking excludes unknown queries, keeps missing directories as wrong, and isolates caches and cutoffs', () => {
  const snapshot = { days: {
    [date(0)]: { shabantou: { query: '07', entries: [{ name: '甲', content: '1头单' }] } },
    [date(1)]: { shabantou: { query: '', entries: [{ name: '甲', content: '1头单' }] } },
    [date(2)]: { shabantou: { query: '07', entries: [] } },
    [date(3)]: {},
    [date(4)]: { shabantou: { query: '07', entries: [{ name: '后来者', content: '1头单' }] } }
  } };
  const input = { projectId: 'jiuxiang', modeId: 'shabantou', snapshot };
  const legacy = buildModeDirectoryStats(input);
  const settled = buildModeDirectoryStats({ ...input, settledOnly: true });
  const earlier = buildModeDirectoryStats({ ...input, settledOnly: true, asOfDate: date(2) });
  assert.equal(legacy.find(item => item.name === '甲').daysInSystem, 4);
  assert.deepEqual(settled.find(item => item.name === '甲').stateHistory, [true, null, false, null, false]);
  assert.equal(settled.find(item => item.name === '甲').daysInSystem, 3);
  assert.deepEqual(buildDirectoryStats({ ...input, name: '甲', settledOnly: true }).stateHistory,
    settled.find(item => item.name === '甲').stateHistory, 'analysis trend and ranking must share pending-date rules');
  assert.equal(earlier.length, 1, 'future directory names must not leak into historical rankings');
  assert.equal(earlier[0].daysInSystem, 2);
  assert.equal(earlier[0].totalBroken, 1);
  assert.strictEqual(buildModeDirectoryStats(input), legacy);
  assert.strictEqual(buildModeDirectoryStats({ ...input, settledOnly: true }), settled);
  assert.strictEqual(buildModeDirectoryStats({ ...input, settledOnly: true, asOfDate: date(2) }), earlier);
});

test('settled history inserts missing calendar dates as null streak breaks without adding samples', () => {
  const snapshot = { days: {
    '2026-08-04': { shayihe: { query: '07', entries: [{ name: '甲', content: '1合单' }] } },
    '2026-08-06': { shayihe: { query: '07', entries: [{ name: '甲', content: '1合单' }] } }
  } };
  const row = buildModeDirectoryStats({ projectId: 'jiuxiang', modeId: 'shayihe', snapshot, settledOnly: true })[0];
  assert.deepEqual(row.stateHistory, [false, null, false]);
  assert.deepEqual(row.stateDates, ['2026-08-04', '2026-08-05', '2026-08-06']);
  assert.equal(row.daysInSystem, 2);
  assert.equal(row.maxWrongStreak, 1);
});

test('all 17 modes require 120 settled days and exclude future data in historical rankings', () => {
  let modeCount = 0;
  for (const project of PROJECTS) {
    for (const mode of project.modes) {
      modeCount += 1;
      const query = ['pingteyixiao', 'shengxiao'].includes(mode.id) ? '鼠' : mode.id === 'pingtewei' ? '1尾' : '07';
      const snapshot = { days: {} };
      for (let index = 0; index < 121; index += 1) {
        snapshot.days[date(index)] = { [mode.id]: { query: index === 119 ? '' : query, entries: [{ name: '测试目录', content: '' }] } };
      }
      const input = { projectId: project.id, modeId: mode.id, snapshot, settledOnly: true };
      const [before] = buildLongTermRanking(buildModeDirectoryStats({ ...input, asOfDate: date(119) }));
      const [after] = buildLongTermRanking(buildModeDirectoryStats(input));
      assert.equal(before.daysInSystem, 119, mode.id);
      assert.equal(before.officialRank, null, mode.id);
      assert.equal(after.daysInSystem, 120, mode.id);
      assert.equal(after.officialRank, 1, mode.id);
    }
  }
  assert.equal(modeCount, 17);
});
