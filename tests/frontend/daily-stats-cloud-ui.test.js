import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { getProject } from '../../assets/js/projects.js';
import { renderDailyStats } from '../../assets/js/views.js';

const css = readFileSync(new URL('../../assets/css/app.css', import.meta.url), 'utf8');

function cssRule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`))?.[1] || '';
}

function jiuxiangDailyMarkup() {
  const project = getProject('jiuxiang');
  const modes = Object.fromEntries(project.modes.map((mode, index) => [mode.id, {
    query: index % 2 ? '07' : '01',
    entries: [{ name: `目录${index + 1}`, content: index % 2 ? '1头' : '2头' }]
  }]));
  return renderDailyStats({
    project,
    projectState: {
      date: '2026-07-27',
      modeId: project.modes[0].id,
      snapshot: { days: { '2026-07-27': modes } }
    },
    dailyState: { expandedMonths: ['2026-07'] }
  });
}

test('uses the cloud daily-stat header structure and five-by-two mode-card layout', () => {
  const markup = jiuxiangDailyMarkup();
  const day = markup.match(/<section class="daily-stats-day">([\s\S]*?)<\/section>/)?.[1] || '';

  assert.match(day, /<div class="daily-stats-day-head">\s*<div class="daily-stats-day-date">\s*<button[^>]*>2026-07-27<\/button>\s*<\/div>\s*<div class="daily-stats-day-total">/);
  assert.doesNotMatch(day, /daily-stats-day-overview/);
  assert.equal((day.match(/class="daily-stats-day-card /g) || []).length, 10);
  assert.match(markup, /<summary>连对筛选 <span>未启用<\/span><\/summary>/);

  assert.match(cssRule('.daily-stats-day'), /grid-template-columns:\s*132px minmax\(0, 1fr\)/);
  assert.match(cssRule('.daily-stats-day-head'), /display:\s*contents/);
  assert.match(cssRule('.daily-stats-day-total'), /grid-template-columns:\s*repeat\(4, minmax\(110px, 1fr\)\)/);
  assert.match(cssRule('.daily-stats-day-cards'), /grid-column:\s*2/);
  assert.match(cssRule('.daily-stats-day-cards'), /grid-template-columns:\s*repeat\(5, minmax\(0, 1fr\)\)/);
});

test('matches the cloud daily-stat spacing, type sizes, and surfaces', () => {
  assert.match(cssRule('.daily-stats-summary'), /grid-template-columns:\s*repeat\(5, minmax\(150px, 1fr\)\)/);
  assert.match(cssRule('.daily-stats-filter-panel'), /overflow:\s*hidden/);
  assert.match(cssRule('.daily-stats-filter-grid'), /grid-template-columns:\s*repeat\(5, minmax\(145px, 1fr\)\)/);

  const list = cssRule('.daily-stats-day-list');
  assert.match(list, /padding:\s*14px/);
  assert.match(list, /background:\s*#101213/);

  const date = cssRule('.daily-stats-day-date');
  assert.match(date, /padding:\s*17px 14px/);
  assert.match(date, /background:\s*#202529/);
  assert.match(date, /font-size:\s*19px/);

  const cards = cssRule('.daily-stats-day-cards');
  assert.match(cards, /gap:\s*11px/);
  assert.match(cards, /padding:\s*13px/);

  const card = cssRule('.daily-stats-day-card');
  assert.match(card, /padding:\s*12px 13px/);
  assert.match(card, /background:\s*#14181a/);
  assert.match(cssRule('.daily-stats-day-card-main > b'), /font-size:\s*25px/);
});
