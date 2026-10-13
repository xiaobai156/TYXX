import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createAppState } from '../../assets/js/state.js';

test('keeps page, mode, date, snapshot, and draft state isolated by project', () => {
  const store = createAppState({ today: '2026-07-27' });

  store.setPage('workspace');
  store.setMode('pingtewei');
  store.setDate('2026-07-20');
  store.setSnapshot({ days: { '2026-07-20': {} } });
  store.setDraft('pingtewei', '2026-07-20', { query: '08', entries: [] });

  store.selectProject('dawei_shahao');
  store.setPage('analysis');
  store.setMode('shaxiao');
  store.setDate('2026-07-21');

  assert.deepEqual(store.getProjectState(), {
    pageId: 'analysis',
    modeId: 'shaxiao',
    date: '2026-07-21',
    snapshot: null,
    drafts: {}
  });

  store.selectProject('pingte');
  const pingte = store.getProjectState();
  assert.equal(pingte.pageId, 'workspace');
  assert.equal(pingte.modeId, 'pingtewei');
  assert.equal(pingte.date, '2026-07-20');
  assert.deepEqual(pingte.snapshot, { days: { '2026-07-20': {} } });
  assert.deepEqual(pingte.drafts['2026-07-20'].pingtewei, { query: '08', entries: [] });
});

test('validates project, page, mode, and date changes before updating state', () => {
  const store = createAppState({ today: '2026-07-27' });

  assert.throws(() => store.selectProject('missing'), /未知项目/);
  assert.throws(() => store.setPage('missing'), /未知页面/);
  assert.throws(() => store.setMode('dawei'), /不属于项目/);
  assert.throws(() => store.setDate('2026-02-30'), /日期格式/);
  assert.equal(store.get().activeProjectId, 'pingte');
});

test('notifies subscribers once per successful state change', () => {
  const store = createAppState({ today: '2026-07-27' });
  const events = [];
  const unsubscribe = store.subscribe(state => events.push(state.activeProjectId));

  store.selectProject('jiuxiang');
  unsubscribe();
  store.selectProject('pingte');

  assert.deepEqual(events, ['jiuxiang']);
});

test('sets an inactive project snapshot and clears only the requested draft', () => {
  const store = createAppState({ today: '2026-07-27' });
  store.setDraft('pingteyixiao', '2026-07-27', { query: '07', entries: [] });
  store.setDraft('pingtewei', '2026-07-27', { query: '08', entries: [] });
  store.setProjectSnapshot('jiuxiang', { days: { '2026-07-20': {} } });
  store.clearDraft('pingteyixiao', '2026-07-27');

  assert.equal(store.getProjectState('pingte').drafts['2026-07-27'].pingteyixiao, undefined);
  assert.deepEqual(store.getProjectState('pingte').drafts['2026-07-27'].pingtewei, {
    query: '08', entries: []
  });
  assert.deepEqual(store.getProjectState('jiuxiang').snapshot, {
    days: { '2026-07-20': {} }
  });

  store.clearDraft('pingtewei', '2026-07-27');
  assert.deepEqual(store.getProjectState('pingte').drafts, {});
});
