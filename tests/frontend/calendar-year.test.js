import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { renderCalendar } from '../../assets/js/views.js';

const css = readFileSync(new URL('../../assets/css/app.css', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../assets/js/app.js', import.meta.url), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`)) || [])[1] || '';
}

const project = {
  id: 'pingte',
  name: '平特分析',
  modes: [{ id: 'pingteyixiao', name: '平特一肖' }]
};

// Data lives in 2026; the selected date sits in 2027, exactly the post-rollover situation.
const projectState = {
  date: '2027-01-05',
  modeId: 'pingteyixiao',
  snapshot: { days: {
    '2026-11-30': { pingteyixiao: { query: '鼠', entries: [{ name: '目录甲', content: '鼠' }] } },
    '2026-12-31': { pingteyixiao: { query: '鼠', entries: [{ name: '目录甲', content: '鼠' }] } },
    '2027-01-02': { pingteyixiao: { query: '鼠', entries: [{ name: '目录甲', content: '鼠' }] } }
  } }
};

test('calendar exposes a year switcher next to the month buttons', () => {
  const html = renderCalendar({ project, projectState });

  assert.match(html, /data-action="select-year"[^>]*data-year="2026"/);
  assert.match(html, /data-action="select-year"[^>]*data-year="2028"/);
  assert.match(html, /class="year-label"[^>]*>2027年/);
  // The selected month stays selected regardless of the year.
  assert.match(html, /class="month-btn active"[^>]*data-month="1"/);
  assert.equal((html.match(/class="month-btn /g) || []).length, 12);
  assert.match(cssRule('.year-label'), /white-space:\s*nowrap/);
  assert.match(cssRule('.year-step'), /min-width:\s*34px/);
});

test('calendar exposes a today jump that reaches the existing handler', () => {
  const html = renderCalendar({ project, projectState });

  // The handler already existed but no control triggered it; this pins the wiring.
  assert.match(html, /class="year-step today-jump"[^>]*data-action="today"/);
  assert.match(html, />今天</);
  assert.match(appJs, /case 'today':\s*\n\s*store\.setDate\(localToday\(\)\);/);
  assert.match(cssRule('.today-jump'), /min-width:\s*52px/);
});

test('an empty year is flagged so the user knows to step back', () => {
  const html = renderCalendar({ project, projectState });
  assert.doesNotMatch(html, /class="year-label empty-year"/);

  const otherYear = renderCalendar({
    project,
    projectState: { ...projectState, date: '2030-03-01' }
  });
  assert.match(otherYear, /class="year-label empty-year"/);
  assert.match(otherYear, /2030年（无数据）/);
});

test('month switching falls back to the closest year that has that month', () => {
  // 2027-01 has data, so January stays in 2027.
  assert.match(appJs, /function resolveYearForMonth\(projectState, currentYear, targetMonth\)/);
  assert.match(appJs, /if \(!years\.length \|\| years\.includes\(currentYear\)\) return currentYear;/);
  assert.match(appJs, /const withMonth = years\.filter/);
  assert.match(appJs, /Math\.abs\(candidate - currentYear\) < Math\.abs\(best - currentYear\)/);
});

test('year switching keeps the month and clamps the day to the shorter month', () => {
  assert.match(appJs, /function selectYear\(targetYear\)/);
  assert.match(appJs, /new Date\(Date\.UTC\(targetYear, month, 0\)\)\.getUTCDate\(\)/);
  assert.match(appJs, /case 'select-year':\s*\n\s*selectYear\(Number\(button\.dataset\.year\)\);/);
});

test('the calendar renders the chosen year and month in its grid label', () => {
  const html = renderCalendar({ project, projectState });
  assert.match(html, /aria-label="2027年1月"/);
  // February 2027 has no data, but the grid must still render the month.
  const february = renderCalendar({
    project,
    projectState: { ...projectState, date: '2027-02-05' }
  });
  assert.match(february, /aria-label="2027年2月"/);
  assert.match(february, /class="month-btn active"[^>]*data-month="2"/);
});
