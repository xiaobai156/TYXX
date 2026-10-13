import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateCorrectness,
  getQueryTypes,
  normalizeFullWidthDigits
} from '../../assets/js/domain/rules.js';

function correct(projectId, modeId, content, query, date = '2026-07-27', name = '') {
  return evaluateCorrectness({ projectId, modeId, content, query, date, name });
}

test('implements the three pingte correctness contracts', () => {
  assert.equal(correct('pingte', 'pingteyixiao', '鼠', '牛鼠'), true);
  assert.equal(correct('pingte', 'pingteyixiao', '龙', '牛鼠'), false);
  assert.equal(correct('pingte', 'pingtewei', '2尾4尾', '1尾2尾'), true);
  assert.equal(correct('pingte', 'pingtewei', '24尾', '01 42'), true);
  assert.equal(correct('pingte', 'shaliangxiao', '马蛇', '01'), false);
  assert.equal(correct('pingte', 'shaliangxiao', '蛇龙', '01'), true);
  assert.equal(correct('pingte', 'shaliangxiao', '马马', '01'), false);
});

test('implements dawei include, kill, zodiac boundary, and traditional character rules', () => {
  assert.equal(correct('dawei_shahao', 'dawei', '01,02', '02'), true);
  assert.equal(correct('dawei_shahao', 'shahao', '01,02', '03'), true);
  assert.equal(correct('dawei_shahao', 'shaxiao', '01,02,04,05,06', '03'), true);
  assert.equal(correct('dawei_shahao', 'shahao', '01,02', '02'), false);
  assert.equal(correct('dawei_shahao', 'shengxiao', '狗龍', '狗', '2026-05-20'), true);
  assert.equal(correct('dawei_shahao', 'shengxiao', '狗龍', '狗', '2026-05-21'), false);
  assert.equal(correct('dawei_shahao', 'shengxiao', '龍', '龙', '2026-05-21'), false);
});

test('前八后一从2026-05-01起永久按不含开奖号为对', () => {
  assert.equal(correct('dawei_shahao', 'shengxiao', '牛鼠兔', '猪', '2026-04-30', '前八后一'), false);
  assert.equal(correct('dawei_shahao', 'shengxiao', '牛鼠兔', '猪', '2026-05-01', '前八后一'), true);
  assert.equal(correct('dawei_shahao', 'shengxiao', '牛鼠兔猪', '猪', '2026-05-01', '前八后一'), false);
  assert.equal(correct('dawei_shahao', 'shengxiao', '牛鼠兔', '猪', '2027-01-01', '前八后一'), true);
  assert.equal(correct('dawei_shahao', 'shengxiao', '牛鼠兔', '猪', '2026-05-01', '其他目录'), false);
  assert.equal(correct('dawei_shahao', 'shengxiao', '牛鼠兔猪', '猪', '2026-05-01', '其他目录'), true);
});

test('maps a draw number and evaluates all ten jiuxiang kill modes', () => {
  const cases = [
    ['shabantou', '4头双', '4头单'],
    ['shayitou', '3头', '4头'],
    ['shayibo', '红波', '绿波'],
    ['shabanbo', '绿双', '绿单'],
    ['shayihe', '01合', '13合'],
    ['shayixiao', '牛', '马'],
    ['shayixiao2', '牛', '马'],
    ['shayiduan', '6段', '7段'],
    ['shayihang', '土行', '火行'],
    ['shayiwei', '0尾', '9尾']
  ];
  for (const [modeId, safeContent, killedContent] of cases) {
    assert.equal(correct('jiuxiang', modeId, safeContent, '４９'), true, `${modeId} safe`);
    assert.equal(correct('jiuxiang', modeId, killedContent, '49'), false, `${modeId} killed`);
  }
  assert.deepEqual(getQueryTypes('shayihang', '49'), ['火行']);
  assert.deepEqual(getQueryTypes('shayihe', '3合'), ['03合']);
  assert.equal(normalizeFullWidthDigits('４９'), '49');
});

test('evaluates either tail from a two-tail jiuxiang directory', () => {
  assert.equal(correct('jiuxiang', 'shayiwei', '5尾,3尾', '49'), true);
  assert.equal(correct('jiuxiang', 'shayiwei', '5尾,3尾', '35'), false);
  assert.equal(correct('jiuxiang', 'shayiwei', '5尾,3尾', '43'), false);
});

test('treats invalid or empty jiuxiang content and query as wrong', () => {
  assert.equal(correct('jiuxiang', 'shayiduan', '', '49'), false);
  assert.equal(correct('jiuxiang', 'shayiduan', '8段', '49'), false);
  assert.equal(correct('jiuxiang', 'shayiduan', '7段', 'not-a-query'), false);
  assert.throws(
    () => correct('missing', 'shayiduan', '7段', '49'),
    /未知项目/
  );
  assert.throws(
    () => correct('jiuxiang', 'missing', '7段', '49'),
    /未知模式/
  );
});
