import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);

test('provides one accessible HTML entry backed by local ES modules', () => {
  const html = readFileSync(new URL('统一分析平台.html', root), 'utf8');

  assert.match(html, /<html lang="zh-CN">/);
  assert.match(html, /id="project-switcher"/);
  assert.match(html, /id="main-nav"/);
  assert.match(html, /id="app-status"[^>]*role="status"/);
  assert.match(html, /id="page-content"/);
  assert.match(html, /<script type="module" src="\.\/assets\/js\/app\.js"><\/script>/);
  assert.match(html, /<link rel="stylesheet" href="\.\/assets\/css\/app\.css">/);
  assert.doesNotMatch(html, /supabase|https:\/\/|sb_publishable_/i);
});

test('keeps responsive layout and application behavior in separate assets', () => {
  const css = readFileSync(new URL('assets/css/app.css', root), 'utf8');
  const app = readFileSync(new URL('assets/js/app.js', root), 'utf8');

  assert.match(css, /@media \(max-width: 760px\)/);
  assert.match(css, /\.calendar-grid/);
  assert.match(app, /createAppState/);
  assert.match(app, /createApiClient/);
  assert.match(app, /data-action/);
  assert.doesNotMatch(app, /supabase|sb_publishable_/i);
});
