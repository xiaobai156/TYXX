const assert = require('node:assert/strict');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { chromium } = require('playwright');

// Read-only regression against the running local service. Never seed real data.
const ROOT = path.resolve(__dirname, '../..');
const BASE_URL = process.env.RANKING_TEST_URL || 'http://127.0.0.1:23962/';
const ARTIFACT_DIR = path.join(__dirname, 'artifacts/ranking-window-20261014');
const load = name => import(pathToFileURL(path.join(ROOT, 'assets/js', name)).href);
const percent = value => `${(value * 100).toFixed(1)}%`;

async function rowsFromPage(page) {
  return page.locator('.analysis-table tbody tr[data-name]').evaluateAll(rows => rows.map(row => ({
    name: row.dataset.name,
    group: row.closest('tbody').dataset.rankingGroup,
    officialRank: row.dataset.officialRank,
    scoreDetails: row.querySelector('.ranking-score-details').textContent.replace(/\s+/g, ' ').trim(),
    cells: [...row.children].map(cell => cell.querySelector('details > summary')?.textContent.trim() || cell.textContent.trim())
  })));
}

async function assertNoOverflow(page) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth,
    page: document.documentElement.scrollWidth,
    table: document.querySelector('.analysis-table-wrap').scrollWidth,
    container: document.querySelector('.analysis-table-wrap').clientWidth
  }));
  assert.ok(geometry.page <= geometry.viewport + 1, `Page overflows: ${JSON.stringify(geometry)}`);
  assert.ok(geometry.table > geometry.container, 'Wide table should scroll inside its container');
  return geometry;
}

async function selectMode(page, project, mode) {
  await page.locator(`[data-action="select-project"][data-project="${project.id}"]`).click();
  await page.getByText(project.name, { exact: true }).waitFor();
  await page.locator('[data-page="analysis"]').click();
  await page.locator(`#analysis-mode-switcher [data-mode="${mode.id}"]`).click();
  await page.locator('.ranking-toolbar').filter({ hasText: `${mode.name} · 长期稳定榜` }).waitFor();
  const reset = page.locator('[data-action="reset-analysis-ranking"]');
  if (await reset.isEnabled()) await reset.click();
  await assertResetButton(page, false);
}

async function assertResetButton(page, active) {
  const reset = page.locator('[data-action="reset-analysis-ranking"]');
  assert.equal(await reset.isEnabled(), active, 'Restore button enabled only for manual sorting');
  assert.equal(await reset.innerText(), active ? '恢复榜单顺序' : '当前为榜单顺序');
}

function assertDefaultRows(actual, expected, label) {
  assert.deepEqual(actual.map(row => row.name), expected.map(row => row.name), `${label}: default order`);
  actual.forEach((row, index) => {
    const stat = expected[index];
    assert.equal(row.group, stat.rankingEligible ? 'official' : 'observation', `${label}/${row.name}: group`);
    assert.equal(row.officialRank, stat.officialRank ? String(stat.officialRank) : '', `${label}/${row.name}: rank`);
    assert.equal(row.cells[0], stat.rankingEligible ? String(stat.officialRank) : '观察');
    assert.equal(row.cells.at(-5), stat.daysInSystem ? stat.longTermScore.toFixed(1) : '—', `${label}/${row.name}: score`);
    assert.equal(row.cells.at(-4), `${stat.recent120MaxWrong} 天`, `${label}/${row.name}: recent120 streak`);
    assert.equal(row.cells[2], percent(stat.recent30Rate), `${label}/${row.name}: recent30 rate`);
    assert.equal(row.cells.at(-1), `${stat.daysInSystem} 天`, `${label}/${row.name}: effective days`);
    assert.ok(row.scoreDetails.includes(`长期分仅计算最近 ${stat.longTermDays} 个有效日，${stat.longTermRight} 对 / ${stat.longTermDays - stat.longTermRight} 错`), `${label}/${row.name}: score window details`);
  });
}

function assertSortedRows(actual, baseline, key, columnIndex, cycle) {
  const ranks = new Map(baseline.map(row => [row.name, row.officialRank]));
  for (const group of ['official', 'observation']) {
    const rows = actual.filter(row => row.group === group);
    assert.deepEqual(rows.map(row => row.name).sort(), baseline.filter(row => row.group === group).map(row => row.name).sort());
    rows.forEach(row => assert.equal(row.officialRank, ranks.get(row.name), `${key}: original rank preserved`));
    for (let i = 1; i < rows.length; i += 1) {
      const left = rows[i - 1];
      const right = rows[i];
      let comparison;
      if (key === 'default') comparison = left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
      else if (key === 'status') {
        const status = row => row.cells[columnIndex].includes('连对') ? 2 : row.cells[columnIndex].includes('连断') ? 1 : 0;
        comparison = status(left) - status(right) || parseFloat(left.cells[columnIndex + 1]) - parseFloat(right.cells[columnIndex + 1]);
      } else comparison = (parseFloat(left.cells[columnIndex]) || 0) - (parseFloat(right.cells[columnIndex]) || 0);
      assert.ok(cycle === 1 ? comparison >= -1e-9 : comparison <= 1e-9,
        `${group}/${key}/cycle${cycle}: ${left.name} (${left.cells[columnIndex]}) before ${right.name} (${right.cells[columnIndex]})`);
    }
  }
}

(async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const report = { startedAt: new Date().toISOString(), baseUrl: BASE_URL, modes: [], sortChecks: [], geometry: [], errors: [], writeAttempts: [] };
  let browser;
  try {
    const [{ PROJECTS }, { buildModeDirectoryStats }, { buildLongTermRanking }] = await Promise.all([
      load('projects.js'), load('domain/stats.js'), load('domain/long-term-ranking.js')
    ]);
    const snapshots = new Map(await Promise.all(PROJECTS.map(async project => {
      const response = await fetch(new URL(`api/projects/${project.id}/snapshot`, BASE_URL));
      assert.ok(response.ok, `${project.id} snapshot: ${response.status}`);
      return [project.id, (await response.json()).snapshot];
    })));
    browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
    const context = await browser.newContext({ viewport: { width: 1366, height: 768 }, timezoneId: 'America/Los_Angeles' });
    await context.route('**/*', async route => {
      const request = route.request();
      if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method())) {
        report.writeAttempts.push({ method: request.method(), url: request.url() });
        return route.abort('blockedbyclient');
      }
      return route.continue();
    });
    const page = await context.newPage();
    page.on('pageerror', error => report.errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') report.errors.push(message.text()); });
    await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
    await page.getByText('本地服务已连接', { exact: true }).waitFor({ timeout: 60000 });

    let mixedMode;
    for (const project of PROJECTS) {
      for (const mode of project.modes) {
        const expected = buildLongTermRanking(buildModeDirectoryStats({ projectId: project.id, modeId: mode.id, snapshot: snapshots.get(project.id), settledOnly: true }));
        await selectMode(page, project, mode);
        const headerKeys = await page.locator('.analysis-table thead [data-action="sort-analysis"]').evaluateAll(buttons => buttons.map(button => button.dataset.key));
        assert.deepEqual(headerKeys.slice(headerKeys.indexOf('recent10'), headerKeys.indexOf('recent10') + 4),
          ['recent10', 'longTermScore', 'recent120MaxWrong', 'recent30Wrong'], `${project.id}/${mode.id}: adjacent moved columns`);
        const actual = await rowsFromPage(page);
        assertDefaultRows(actual, expected, `${project.id}/${mode.id}`);
        const official = expected.filter(row => row.rankingEligible).length;
        const observation = expected.length - official;
        if (!official) assert.match(await page.locator('[data-ranking-group="official"]').innerText(), /暂无满120个有效统计日的资料/);
        if (official && observation && project.id !== 'pingte' && !mixedMode) mixedMode = { project, mode, expected };
        const result = { project: project.id, mode: mode.id, rows: expected.length, official, observation, columnOrderVerified: true,
          maxEffectiveDays: Math.max(0, ...expected.map(row => row.daysInSystem)),
          topThree: expected.filter(row => row.rankingEligible).slice(0, 3).map(row => ({ name: row.name, score: row.longTermScore, days: row.daysInSystem })) };
        report.modes.push(result);
        console.log(JSON.stringify(result));
      }
    }
    assert.equal(report.modes.length, 17);
    assert.ok(mixedMode, 'Need a real mode containing both official and observation rows');
    await selectMode(page, mixedMode.project, mixedMode.mode);
    const baseline = await rowsFromPage(page);
    const keys = await page.locator('.analysis-table thead [data-action="sort-analysis"]').evaluateAll(buttons => buttons.map(button => ({ key: button.dataset.key, columnIndex: [...button.closest('tr').children].indexOf(button.closest('th')) })));
    for (const { key, columnIndex } of keys) {
      const button = page.locator(`[data-action="sort-analysis"][data-key="${key}"]`);
      for (const cycle of [1, 2]) {
        await button.click();
        await assertResetButton(page, true);
        assert.equal(await page.getByText('已恢复榜单顺序', { exact: true }).count(), 0, `${key}: sorting clears the prior restore notice`);
        assertSortedRows(await rowsFromPage(page), baseline, key, columnIndex, cycle);
        assert.match(await page.locator('.analysis-sort-note').innerText(), /正式榜名次保留/);
      }
      await button.click();
      await assertResetButton(page, false);
      assert.deepEqual(await rowsFromPage(page), baseline, `${key}: third click restores default`);
      await button.click();
      await assertResetButton(page, true);
      await page.locator('[data-action="reset-analysis-ranking"]').click();
      await assertResetButton(page, false);
      await page.getByText('已恢复榜单顺序', { exact: true }).waitFor();
      assert.deepEqual(await rowsFromPage(page), baseline, `${key}: reset restores default`);
      report.sortChecks.push({ key, cycles: 3, reset: true, groups: 2, ranksPreserved: true, buttonStates: true, restoreNotice: true });
    }

    for (const viewport of [{ width: 1366, height: 768 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await page.locator('[data-action="sort-analysis"][data-key="recent120MaxWrong"]').click();
      await assertResetButton(page, true);
      assert.equal(await page.getByText('已恢复榜单顺序', { exact: true }).count(), 0);
      await page.locator('.ranking-toolbar').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `ranking-${viewport.width}-sorted-button.png`) });
      await page.locator('[data-action="reset-analysis-ranking"]').click();
      await assertResetButton(page, false);
      const notice = page.getByText('已恢复榜单顺序', { exact: true });
      await notice.waitFor();
      await notice.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `ranking-${viewport.width}-restored-feedback.png`) });
      const rules = page.locator('.ranking-rules');
      if (!await rules.evaluate(element => element.open)) await rules.locator('summary').click();
      assert.match(await rules.innerText(), /Wilson.*z = 1.96/s);
      assert.match(await rules.innerText(), /长期分只计算最近120个有效统计日/);
      const score = page.locator('.ranking-score-details').first();
      if (!await score.evaluate(element => element.open)) await score.locator('summary').click();
      assert.match(await score.innerText(), /同分先比较近120有效日最高连错/);
      assert.equal(await page.locator('.manage-dialog:visible').count(), 0, 'Score expansion must not open directory management');
      report.geometry.push({ ...viewport, ...(await assertNoOverflow(page)) });
      await page.locator('.ranking-toolbar').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `ranking-${viewport.width}-rules-score.png`) });
      await score.locator('summary').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(ARTIFACT_DIR, `ranking-${viewport.width}-score.png`) });
      await score.locator('summary').click();
      assert.equal(await score.evaluate(element => element.open), false);
      await rules.locator('summary').click();
      assert.equal(await rules.evaluate(element => element.open), false);
    }
    assert.deepEqual(report.writeAttempts, [], 'No write requests allowed');
    assert.deepEqual(report.errors, [], 'No browser errors allowed');
    report.passed = true;
  } catch (error) {
    report.passed = false;
    report.failure = error.stack;
    process.exitCode = 1;
    console.error(error);
  } finally {
    if (browser) await browser.close();
    report.finishedAt = new Date().toISOString();
    writeFileSync(path.join(ARTIFACT_DIR, 'browser-regression.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ passed: report.passed, modes: report.modes.length, sortKeys: report.sortChecks.length, errors: report.errors.length, writeAttempts: report.writeAttempts.length }));
  }
})();
