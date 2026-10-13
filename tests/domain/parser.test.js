import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  parsePastedEntries,
  parseBatchRows,
  validateModePayload
} from '../../assets/js/domain/parser.js';

test('parses pingte content-first lines and skips slim storage rows', () => {
  assert.deepEqual(parsePastedEntries({
    projectId: 'pingte',
    modeId: 'pingtewei',
    text: '\ufeff24尾 目录甲\n-\n12\n鼠 目录乙'
  }), [
    { name: '目录甲', content: '2尾4尾', original: '\ufeff24尾 目录甲' },
    { name: '目录乙', content: '鼠', original: '鼠 目录乙' }
  ]);
});

test('parses dawei number and zodiac lines with traditional characters', () => {
  assert.deepEqual(parsePastedEntries({
    projectId: 'dawei_shahao',
    modeId: 'shahao',
    text: '7 高手甲\n01 02 49 高手乙'
  }), [
    { name: '高手甲', content: '07', original: '7 高手甲' },
    { name: '高手乙', content: '01,02,49', original: '01 02 49 高手乙' }
  ]);
  assert.deepEqual(parsePastedEntries({
    projectId: 'dawei_shahao', modeId: 'shengxiao', text: '龍雞 高手'
  })[0], { name: '高手', content: '龙鸡', original: '龍雞 高手' });
});

test('parses and normalizes all jiuxiang type-first lines', () => {
  assert.deepEqual(parsePastedEntries({
    projectId: 'jiuxiang', modeId: 'shayihe', text: '3合,１３合 女人味'
  }), [{ name: '女人味', content: '03合,13合', original: '3合,１３合 女人味' }]);
  assert.deepEqual(parsePastedEntries({
    projectId: 'jiuxiang', modeId: 'shayihang', text: '金 老师甲'
  })[0].content, '金行');
});

test('parses and enforces the four two-tail jiuxiang directories', () => {
  assert.deepEqual(parsePastedEntries({
    projectId: 'jiuxiang',
    modeId: 'shayiwei',
    text: [
      '5尾 3尾 强烈招牌',
      '4尾 7尾 华丽恶梦',
      '1尾 5尾 专注凯子',
      '5尾 9尾 唯一火势'
    ].join('\n')
  }).map(({ name, content }) => ({ name, content })), [
    { name: '强烈招牌', content: '5尾,3尾' },
    { name: '华丽恶梦', content: '4尾,7尾' },
    { name: '专注凯子', content: '1尾,5尾' },
    { name: '唯一火势', content: '5尾,9尾' }
  ]);

  const payload = (name, content) => ({
    projectId: 'jiuxiang', modeId: 'shayiwei', query: '49', entries: [{ name, content }]
  });
  assert.doesNotThrow(() => validateModePayload(payload('强烈招牌', '5尾,3尾')));
  assert.throws(() => validateModePayload(payload('强烈招牌', '5尾')), /两个不同尾数/);
  assert.throws(() => validateModePayload(payload('强烈招牌', '5尾,5尾')), /两个不同尾数/);
  assert.throws(() => validateModePayload(payload('普通目录', '5尾,3尾')), /一个尾数/);
});

test('validates system names, duplicates, queries, and mode-specific content', () => {
  assert.throws(() => validateModePayload({
    projectId: 'pingte', modeId: 'pingteyixiao', query: '', entries: [{ name: 'A', content: '鼠' }]
  }), /查询值/);
  assert.throws(() => validateModePayload({
    projectId: 'pingte', modeId: 'shaliangxiao', query: '01', entries: [{ name: 'A', content: '马马' }]
  }), /两个不同生肖/);
  assert.throws(() => validateModePayload({
    projectId: 'dawei_shahao', modeId: 'shaxiao', query: '01',
    entries: [{ name: 'A', content: '01 02 03 04' }]
  }), /5 个数字/);
  assert.throws(() => validateModePayload({
    projectId: 'jiuxiang', modeId: 'shayiduan', query: '49',
    entries: [{ name: '__QUERY__', content: '7段' }]
  }), /系统查询名/);
});

test('parses at most twenty transactional batch rows', () => {
  assert.deepEqual(parseBatchRows('2026-06-01 | 07 | 鼠\n2026-06-02\t08\t牛'), [
    { date: '2026-06-01', query: '07', content: '鼠', original: null },
    { date: '2026-06-02', query: '08', content: '牛', original: null }
  ]);
  assert.throws(() => parseBatchRows('2026-06-01|07'), /日期、query、content/);
  assert.throws(() => parseBatchRows(Array.from({ length: 21 }, (_, index) => (
    `2026-06-${String(index + 1).padStart(2, '0')}|07|鼠`
  )).join('\n')), /最多 20/);
});
