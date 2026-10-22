import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalServer } from '../../server/app.js';
import { openLotteryDatabase } from '../../server/database.js';
import { buildPlatformRankingResults } from '../../server/long-term-stats.js';
import { buildModeDirectoryStats } from '../../assets/js/domain/stats.js';
import { buildLongTermRanking } from '../../assets/js/domain/long-term-ranking.js';
import { renderAnalysis } from '../../assets/js/views.js';
import { createTestPaths, jsonRequest } from './helpers.js';

test('HTTP results reuse UI ranking and current states for all 17 modes', async t => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  for (let index = 0; index < 165; index++) {
    const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
    store.replaceMode('jiuxiang', date, 'shabantou', {query:'01', entries:[
      {name:'顾而言他', content: index === 0 || index >= 159 ? '0头单' : '2头双'},
      ...(index >= 46 ? [{name:'观察',content:'2头双'}] : [])
    ]});
  }
  store.replaceMode('jiuxiang', '2026-06-15', 'shabantou', {query:'待开奖',entries:[]});
  const server = createLocalServer({store, staticDir:paths.staticDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); paths.cleanup();});
  const url = `http://127.0.0.1:${server.address().port}`;
  const {response,body} = await jsonRequest(url, '/api/long-term-stats');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(body.databasePath, store.dbPath);
  assert.equal(body.schemaVersion, 'platform-ranking-v1');
  for (const project of store.listProjects()) {
    assert.deepEqual(Object.keys(body.projects[project.id].modes), project.modes.map(mode => mode.id));
    const snapshot = store.getSnapshot(project.id);
    for (const mode of project.modes) {
      const input = {projectId:project.id, modeId:mode.id, snapshot};
      const expected = Object.fromEntries(buildLongTermRanking(buildModeDirectoryStats({...input,settledOnly:true})).map(row => [row.name,{
        score:row.longTermScore,days:row.daysInSystem,wrong:row.totalBroken,eligible:row.rankingEligible,
        currentState:row.currentState,currentStreak:row.currentStreak
      }]));
      assert.deepEqual(body.projects[project.id].modes[mode.id], expected);
    }
  }
  const rows = body.projects.jiuxiang.modes.shabantou;
  assert.deepEqual(rows['顾而言他'], {score:89.5,days:165,wrong:7,eligible:true,currentState:null,currentStreak:0});
  assert.equal(rows['观察'].days,119);
  assert.equal(rows['观察'].eligible,false);
  assert.equal(Object.values(rows).some(row => row.eligible && row.score >= 90),false);
  assert.equal((await jsonRequest(url,'/api/long-term-stats',{method:'POST'})).response.status,405);
  assert.equal((await jsonRequest(url,'/api/long-term-stats',{headers:{origin:'https://example.com'}})).response.status,403);
  store.replaceMode('jiuxiang','2026-06-15','shabantou',{query:'01',entries:[{name:'顾而言他',content:'2头双'}]});
  const fresh = (await jsonRequest(url,'/api/long-term-stats')).body;
  assert.notEqual(fresh.projects.jiuxiang.dataVersion,body.projects.jiuxiang.dataVersion);
  assert.equal(fresh.projects.jiuxiang.modes.shabantou['顾而言他'].days,166);
});

test('HTTP and detailed UI agree on pending days and calendar gaps in every mode', async t => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  const content = {
    pingteyixiao:'马', pingtewei:'1尾', shaliangxiao:'牛虎',
    dawei:'01', shahao:'02', shengxiao:'马', shaxiao:'02',
    shabantou:'2头双', shayitou:'2头', shayibo:'蓝波', shabanbo:'蓝双',
    shayihe:'05合', shayixiao:'鸡', shayixiao2:'猪',
    shayiduan:'2段', shayihang:'金行', shayiwei:'7尾'
  };
  const projects = store.listProjects();
  const addDay = (date, pending = false) => {
    for (const project of projects) {
      for (const mode of project.modes) {
        store.replaceMode(project.id, date, mode.id, {
          query: pending ? '待开奖' : mode.id === 'pingteyixiao' ? '马' : '01',
          entries: [{name:'边界目录', content:content[mode.id]}]
        });
      }
    }
  };
  for (let index = 0; index < 120; index++) {
    addDay(new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10));
  }
  const server = createLocalServer({store, staticDir:paths.staticDir});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {await new Promise(resolve => server.close(resolve)); store.close(); paths.cleanup();});
  const url = `http://127.0.0.1:${server.address().port}`;
  const check = async (state, streak, days) => {
    const {body} = await jsonRequest(url, '/api/long-term-stats');
    let checked = 0;
    for (const project of projects) {
      const snapshot = store.getSnapshot(project.id);
      for (const mode of project.modes) {
        const actual = body.projects[project.id].modes[mode.id]['边界目录'];
        assert.deepEqual([actual.currentState, actual.currentStreak, actual.days, actual.wrong, actual.eligible],
          [state, streak, days, 0, true], mode.id);
        const html = renderAnalysis({project, projectState:{modeId:mode.id, snapshot}});
        const row = (html.match(/<tr\b[\s\S]*?<\/tr>/gi) || []).find(row => row.includes('边界目录'));
        const cells = [...row.matchAll(/<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi)]
          .map(match => match[1].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
        assert.equal(cells[2], state === null ? '待定' : '✓ 连对中', mode.id);
        assert.equal(cells[3], `${streak} 天`, mode.id);
        checked++;
      }
    }
    assert.equal(checked, 17);
  };
  await check(true, 120, 120);
  addDay('2026-05-02'); // May 1 is absent and must break the current streak.
  await check(true, 1, 121);
  addDay('2026-05-03', true);
  await check(null, 0, 121);
});

test('all projects are read from one SQLite snapshot, with rollback on failure', t => {
  const paths = createTestPaths(t);
  const store = openLotteryDatabase(paths);
  const writer = openLotteryDatabase(paths);
  t.after(() => {store.close();writer.close();paths.cleanup();});
  const payload = {query:'01',entries:[{name:'目录',content:'02'}]};
  store.replaceMode('dawei_shahao','2026-01-01','dawei',payload);
  const snapshot = store.getSnapshot;
  let changed = false;
  store.getSnapshot = id => {
    const value = snapshot(id);
    if (!changed) {
      changed = true;
      writer.replaceMode('dawei_shahao','2026-01-01','dawei',{...payload,entries:[{name:'目录',content:'01'}]});
    }
    return value;
  };
  assert.equal(buildPlatformRankingResults(store).projects.dawei_shahao.modes.dawei['目录'].wrong,1);
  store.getSnapshot = snapshot;
  assert.equal(buildPlatformRankingResults(store).projects.dawei_shahao.modes.dawei['目录'].wrong,0);
  store.getSnapshot = () => {throw new Error('fixture failure');};
  assert.throws(() => buildPlatformRankingResults(store),/fixture failure/);
  store.getSnapshot = snapshot;
  assert.doesNotThrow(() => buildPlatformRankingResults(store));
});
