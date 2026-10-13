import assert from 'node:assert/strict';
import { test } from 'node:test';

import { formatHistoricalContent } from '../../assets/js/domain/display.js';

test('strips a mixed directory name from kill-two trend content', () => {
  assert.equal(formatHistoricalContent({
    projectId: 'pingte',
    modeId: 'shaliangxiao',
    name: '与虎谋皮',
    content: '牛猪 与虎谋皮'
  }), '牛猪');
  assert.equal(formatHistoricalContent({
    projectId: 'pingte',
    modeId: 'shaliangxiao',
    name: '文房四宝',
    content: '鸡猴（文房四宝'
  }), '鸡猴');
});

test('leaves clean content and other modes unchanged', () => {
  assert.equal(formatHistoricalContent({
    projectId: 'pingte',
    modeId: 'shaliangxiao',
    name: '目录甲',
    content: '狗猴'
  }), '狗猴');
  assert.equal(formatHistoricalContent({
    projectId: 'pingte',
    modeId: 'pingteyixiao',
    name: '目录甲',
    content: '鼠 目录甲'
  }), '鼠 目录甲');
});
