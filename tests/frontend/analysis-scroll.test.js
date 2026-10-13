import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

import { scrollAnalysisToTop } from '../../assets/js/analysis-scroll.js';

test('keeps the fixed analysis header at the top of its own scroll container', () => {
  const css = readFileSync(new URL('../../assets/css/app.css', import.meta.url), 'utf8');
  const rule = css.match(/\.analysis-table thead th\s*\{([\s\S]*?)\}/)?.[1] || '';

  assert.match(rule, /top:\s*0\s*;/);
  assert.doesNotMatch(rule, /top:\s*54px/);
});

test('moves rank one below the fixed table header when it is covered', () => {
  const calls = [];
  const firstRow = {
    scrollIntoView(options) { calls.push(['scrollIntoView', options]); },
    getBoundingClientRect() { return { top: 60, bottom: 119 }; }
  };
  const document = {
    querySelector(selector) {
      if (selector === '.analysis-table tbody tr') return firstRow;
      if (selector === '.analysis-table thead th') {
        return { getBoundingClientRect: () => ({ top: 64, bottom: 108 }) };
      }
      if (selector === '.app-header') {
        return { getBoundingClientRect: () => ({ top: 0, bottom: 81 }) };
      }
      return null;
    }
  };
  const window = {
    scrollBy(options) { calls.push(['scrollBy', options]); }
  };

  assert.equal(scrollAnalysisToTop({ document, window }), true);
  assert.deepEqual(calls, [
    ['scrollIntoView', { block: 'center', inline: 'nearest', behavior: 'auto' }],
    ['scrollBy', { top: -56, left: 0, behavior: 'auto' }]
  ]);
});

test('does not apply an extra correction when rank one clears the fixed header', () => {
  const calls = [];
  const document = {
    querySelector(selector) {
      if (selector === '.analysis-table tbody tr') return {
        scrollIntoView(options) { calls.push(['scrollIntoView', options]); },
        getBoundingClientRect() { return { top: 160, bottom: 219 }; }
      };
      if (selector === '.analysis-table thead th') return {
        getBoundingClientRect() { return { top: 64, bottom: 108 }; }
      };
      if (selector === '.app-header') return {
        getBoundingClientRect() { return { top: 0, bottom: 81 }; }
      };
      return null;
    }
  };
  const window = { scrollBy(options) { calls.push(['scrollBy', options]); } };

  assert.equal(scrollAnalysisToTop({ document, window }), true);
  assert.deepEqual(calls, [
    ['scrollIntoView', { block: 'center', inline: 'nearest', behavior: 'auto' }]
  ]);
});

test('does nothing when the analysis table is not rendered', () => {
  const document = { querySelector: () => null };
  const window = { scrollBy() { throw new Error('不应滚动'); } };

  assert.equal(scrollAnalysisToTop({ document, window }), false);
});
