const assert = require('node:assert/strict');
const { mkdirSync, mkdtempSync, rmSync } = require('node:fs');
const { spawn } = require('node:child_process');
const { createServer } = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const HISTORY_DATES = ['2099-12-28', '2099-12-29', '2099-12-30'];
const TEST_DATE = '2099-12-31';
const TEST_NAME = 'E2E-统一平台验收';
const ARTIFACT_DIR = path.resolve(__dirname, 'artifacts');
let baseUrl = '';

function localDate(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0')
  ].join('-');
}

async function availablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForHealth(url, process) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (process.exitCode != null) throw new Error(`临时服务提前退出: ${process.exitCode}`);
    try {
      const response = await fetch(`${url}api/health`);
      if (response.ok) return;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('等待临时服务启动超时');
}

async function startIsolatedServer() {
  const port = await availablePort();
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'unified-lottery-e2e-'));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: APP_ROOT,
    env: {
      ...globalThis.process.env,
      LOTTERY_PORT: String(port),
      LOTTERY_DATA_DIR: dataDir,
      LOTTERY_STATIC_DIR: APP_ROOT
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  const url = `http://127.0.0.1:${port}/`;
  try {
    await waitForHealth(url, child);
  } catch (error) {
    child.kill('SIGTERM');
    rmSync(dataDir, { recursive: true, force: true });
    throw new Error(`${error.message}\n${output}`);
  }
  return {
    url,
    async close() {
      if (child.exitCode == null) {
        child.kill('SIGTERM');
        await new Promise(resolve => child.once('exit', resolve));
      }
      rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

async function putMode(projectId, date, modeId, payload) {
  const response = await fetch(`${baseUrl}api/projects/${projectId}/dates/${date}/modes/${modeId}`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200, await response.text());
}

async function seedData() {
  const rows = [
    { date: HISTORY_DATES[0], query: '鼠', entries: [['目录甲', '鼠'], ['目录乙', '牛'], ['目录丙', '鼠']] },
    { date: HISTORY_DATES[1], query: '牛', entries: [['目录甲', '牛'], ['目录乙', '牛'], ['目录丙', '虎']] },
    { date: HISTORY_DATES[2], query: '虎', entries: [['目录甲', '牛'], ['目录乙', '虎'], ['目录丙', '虎']] }
  ];
  for (const row of rows) {
    await putMode('pingte', row.date, 'pingteyixiao', {
      query: row.query,
      entries: row.entries.map(([name, content]) => ({ name, content, original: `${content} ${name}` }))
    });
  }
  await putMode('jiuxiang', localDate(), 'shabantou', {
    query: '07',
    entries: [{ name: '九项目录', content: '1头单', original: '1头单 九项目录' }]
  });
}

async function assertNoPageOverflow(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: window.innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth
  }));
  assert.ok(dimensions.documentWidth <= dimensions.viewport + 1, JSON.stringify(dimensions));
  assert.ok(dimensions.bodyWidth <= dimensions.viewport + 1, JSON.stringify(dimensions));
}

async function setWorkspaceDate(page, date) {
  await page.locator('#workspace-form [name="date"]').evaluate((input, value) => {
    input.value = value;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, date);
  await page.locator('#workspace-form [name="date"]').waitFor({ state: 'attached' });
}

async function setBatchDate(input, date) {
  await input.evaluate((element, value) => {
    element.value = value;
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }, date);
}

(async () => {
  mkdirSync(ARTIFACT_DIR, { recursive: true });
  const isolatedServer = await startIsolatedServer();
  baseUrl = isolatedServer.url;
  await seedData();
  const browser = await chromium.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true
  });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    permissions: ['clipboard-read', 'clipboard-write']
  });
  const page = await context.newPage();
  const errors = [];
  const externalRequests = [];
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== new URL(baseUrl).origin) externalRequests.push(request.url());
  });

  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
    await page.getByText('本地服务已连接').waitFor({ timeout: 60000 });
    assert.equal(await page.locator('#project-switcher [data-project]').count(), 3);
    const calendarCell = page.locator('.day-cell').first();
    const box = await calendarCell.boundingBox();
    // 2026-10-19 UI 修订（P1-15，用户批准）：日期格由 1:1 正方形改为 96px 最小高度的紧凑格。
    assert.ok(box && box.height >= 90 && box.height <= 160, JSON.stringify(box));
    assert.ok(box && box.width > box.height, JSON.stringify(box));
    await assertNoPageOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-1920-calendar.png'), fullPage: true });

    await page.locator('[data-project="dawei_shahao"]').click();
    await page.getByText('大围+杀号分析', { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('.calendar-grid').waitFor({ timeout: 60000 });
    await page.locator('[data-project="jiuxiang"]').click();
    await page.getByText('九项综合分析', { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('.calendar-grid').waitFor({ timeout: 60000 });
    await page.locator('[data-page="workspace"]').click();
    await page.locator('.mode-switcher').waitFor({ timeout: 60000 });
    assert.equal(await page.locator('.mode-switcher [data-mode]').count(), 10);

    await page.locator('[data-project="pingte"]').click();
    await page.getByText('平特分析', { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('[data-page="workspace"]').click();
    await setWorkspaceDate(page, TEST_DATE);
    await page.locator('#workspace-form [name="query"]').fill('鼠');
    await page.locator('#workspace-form [name="raw-input"]').fill(`鼠 ${TEST_NAME}`);
    await page.locator('[name="entry-name"]').first().waitFor({ state: 'attached', timeout: 60000 });
    assert.equal(await page.locator('[name="entry-name"]').first().inputValue(), TEST_NAME);
    await page.locator('.badge.success').filter({ hasText: '连对' }).waitFor();
    await page.locator('#workspace-form button[type="submit"]').click();
    await page.getByText('当前模式已保存', { exact: true }).waitFor({ timeout: 60000 });

    const saved = await (await fetch(`${baseUrl}api/projects/pingte/snapshot`)).json();
    assert.equal(saved.snapshot.days[TEST_DATE].pingteyixiao.entries[0].name, TEST_NAME);

    await page.setViewportSize({ width: 1366, height: 768 });
    await page.locator('.workspace-layout').waitFor({ timeout: 60000 });
    await page.locator('[name="directory-search"]').fill('不存在的目录');
    assert.equal(await page.locator('.entry-row:visible').count(), 0);
    await page.locator('[name="directory-search"]').fill(TEST_NAME);
    assert.equal(await page.locator('.entry-row:visible').count(), 1);
    await assertNoPageOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-1366-workspace.png'), fullPage: true });
    await page.locator('[data-page="analysis"]').click();
    await page.locator('.analysis-table').waitFor({ timeout: 60000 });
    await page.getByText(TEST_NAME, { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('[data-action="sort-analysis"][data-key="hitrate"]').click();
    await page.setViewportSize({ width: 1366, height: 300 });
    await page.evaluate(() => {
      const firstRow = document.querySelector('.analysis-table tbody tr[data-name]');
      window.scrollTo(0, firstRow.getBoundingClientRect().top + window.scrollY + 10);
    });
    await page.locator('[data-action="sort-analysis"][data-key="maxRight"]').dispatchEvent('click');
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    const sortedTableGeometry = await page.evaluate(() => {
      const row = document.querySelector('.analysis-table tbody tr[data-name]').getBoundingClientRect();
      const head = document.querySelector('.analysis-table thead th').getBoundingClientRect();
      return { rowTop: row.top, rowBottom: row.bottom, headBottom: head.bottom, viewportHeight: window.innerHeight };
    });
    assert.ok(sortedTableGeometry.rowTop >= sortedTableGeometry.headBottom - 1, JSON.stringify(sortedTableGeometry));
    assert.ok(sortedTableGeometry.rowBottom <= sortedTableGeometry.viewportHeight, JSON.stringify(sortedTableGeometry));
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByText('本地服务已连接').waitFor({ timeout: 60000 });
    await page.locator('[data-page="analysis"]').click();
    await page.locator('[data-action="sort-analysis"][data-key="hitrate"]').click();
    await page.locator('[data-action="show-trend"]').first().dispatchEvent('click');
    await page.locator('.legacy-modal-host .chart-box').waitFor();
    const trendScrollPosition = await page.locator('.chart-scroll-wrap').evaluate(element => ({
      left: element.scrollLeft,
      max: element.scrollWidth - element.clientWidth
    }));
    assert.ok(trendScrollPosition.max > 0);
    assert.ok(Math.abs(trendScrollPosition.left - trendScrollPosition.max) <= 1);
    const firstTrendPoint = page.locator('.trend-chart-point').first();
    const trendTooltip = firstTrendPoint.locator('.trend-point-tooltip');
    await firstTrendPoint.hover();
    await trendTooltip.waitFor({ state: 'visible' });
    assert.match(await trendTooltip.innerText(), /日期：/);
    assert.match(await trendTooltip.innerText(), /开奖结果：/);
    assert.match(await trendTooltip.innerText(), /当日内容：/);
    assert.match(await trendTooltip.innerText(), /当日表现：/);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-1366-trend-hover-tooltip.png') });
    await page.locator('.legacy-modal-host [data-action="close-modal"]').click();
    await page.locator('.analysis-table tbody tr[data-name]').first().dispatchEvent('click');
    await page.locator('.legacy-modal-host .manage-dialog').waitFor();
    await page.locator('.legacy-modal-host [data-action="close-modal"]').click();
    await assertNoPageOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-1366-analysis.png'), fullPage: true });

    await page.locator('[data-page="daily-stats"]').click();
    const historyMonth = page.locator('.daily-stats-month').filter({ hasText: '2099年12月' });
    await historyMonth.locator('[data-action="toggle-daily-month"]').click();
    await historyMonth.getByRole('rowheader', { name: TEST_DATE, exact: true }).waitFor({ timeout: 60000 });
    const streakDays = historyMonth.locator('[data-action="set-daily-filter"][name="days"]').first();
    await streakDays.fill('2.5');
    await streakDays.dispatchEvent('change');
    assert.equal(await historyMonth.locator('[data-action="set-daily-filter"][name="days"]').first().inputValue(), '2');
    await assertNoPageOverflow(page);

    await page.setViewportSize({ width: 390, height: 844 });
    await assertNoPageOverflow(page);
    for (const pageId of ['workspace', 'analysis', 'daily-stats', 'manage']) {
      await page.locator(`[data-page="${pageId}"]`).click();
      await page.locator('.legacy-page').waitFor({ timeout: 60000 });
      await assertNoPageOverflow(page);
    }
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile-390-manage.png'), fullPage: true });

    await page.setViewportSize({ width: 1366, height: 768 });
    const batchRows = page.locator('#batch-form .batch-row');
    const firstBatchDate = batchRows.nth(0).locator('[name="date"]');
    const firstBatchQuery = batchRows.nth(0).locator('[name="query"]');
    await setBatchDate(firstBatchDate, TEST_DATE);
    assert.equal(await firstBatchQuery.inputValue(), '鼠');
    await setBatchDate(firstBatchDate, '2099-12-27');
    assert.equal(await firstBatchQuery.inputValue(), '');
    await setBatchDate(firstBatchDate, localDate(-19));
    await setBatchDate(firstBatchDate, localDate(-1));
    assert.equal(await batchRows.nth(2).locator('[name="date"]').inputValue(), '');
    await setBatchDate(firstBatchDate, localDate(-2));
    const secondBatchDate = batchRows.nth(1).locator('[name="date"]');
    await secondBatchDate.evaluate(element => { element.value = ''; });
    await secondBatchDate.dispatchEvent('click');
    assert.equal(await secondBatchDate.inputValue(), localDate(-1));

    await page.locator('[data-project="jiuxiang"]').click();
    await page.getByText('九项综合分析', { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('[data-page="daily-stats"]').click();
    await page.locator('.daily-stats-day-card').first().waitFor({ timeout: 60000 });
    assert.equal(await page.locator('.daily-stats-day').first().locator('.daily-stats-day-card').count(), 10);
    await assertNoPageOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'desktop-1366-jiuxiang-daily-10-modes.png'), fullPage: true });

    await page.locator('[data-project="pingte"]').click();
    await page.getByText('平特分析', { exact: true }).waitFor({ timeout: 60000 });
    await page.locator('[data-page="workspace"]').click();
    await setWorkspaceDate(page, TEST_DATE);
    await page.locator('[data-action="clear-current-date"]').waitFor({ timeout: 60000 });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => window.innerWidth), 390);
    await assertNoPageOverflow(page);
    await page.screenshot({ path: path.join(ARTIFACT_DIR, 'mobile-390-workspace-viewport.png') });
    page.once('dialog', dialog => dialog.accept());
    await page.locator('[data-action="clear-current-date"]').click();
    await page.getByText('本日数据已清空', { exact: true }).waitFor({ timeout: 60000 });
    const cleared = await (await fetch(`${baseUrl}api/projects/pingte/snapshot`)).json();
    assert.equal(cleared.snapshot.days[TEST_DATE], undefined);

    assert.deepEqual(errors, []);
    assert.deepEqual(externalRequests, []);
    console.log(JSON.stringify({ ok: true, screenshots: 8, errors: 0, externalRequests: 0, isolatedDatabase: true }));
  } finally {
    await browser.close();
    await isolatedServer.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
