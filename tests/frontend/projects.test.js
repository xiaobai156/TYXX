import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PAGES,
  PROJECTS,
  getMode,
  getProject
} from '../../assets/js/projects.js';

test('defines the three projects and all 17 legacy modes', () => {
  assert.deepEqual(PROJECTS.map(({ id }) => id), [
    'pingte',
    'dawei_shahao',
    'jiuxiang'
  ]);
  assert.deepEqual(PROJECTS.map(({ modes }) => modes.length), [3, 4, 10]);
  assert.equal(PROJECTS.flatMap(({ modes }) => modes).length, 17);
});

test('preserves the exact mode ids within each project', () => {
  assert.deepEqual(getProject('pingte').modes.map(({ id }) => id), [
    'pingteyixiao', 'pingtewei', 'shaliangxiao'
  ]);
  assert.deepEqual(getProject('dawei_shahao').modes.map(({ id }) => id), [
    'dawei', 'shahao', 'shengxiao', 'shaxiao'
  ]);
  assert.deepEqual(getProject('jiuxiang').modes.map(({ id }) => id), [
    'shabantou', 'shayitou', 'shayibo', 'shabanbo', 'shayihe',
    'shayixiao', 'shayixiao2', 'shayiduan', 'shayihang', 'shayiwei'
  ]);
});

test('defines the seven shared pages and rejects cross-project mode lookups', () => {
  assert.deepEqual(PAGES.map(({ id }) => id), [
    'calendar', 'workspace', 'analysis', 'daily-stats', 'manage',
    'missing-directory-stats'
  ]);
  assert.equal(getMode('pingte', 'pingtewei').name, '平特尾');
  assert.throws(() => getMode('pingte', 'dawei'), /不属于项目/);
});
