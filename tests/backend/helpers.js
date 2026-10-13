import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export function createTestPaths(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'unified-lottery-'));
  return {
    root,
    dbPath: path.join(root, 'data', 'lottery_tools.sqlite3'),
    backupDir: path.join(root, 'backups'),
    staticDir: path.join(root, 'static'),
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

export async function jsonRequest(baseUrl, pathname, options = {}) {
  const headers = { ...options.headers };
  if (options.body && !headers['content-type']) headers['content-type'] = 'application/json';
  const response = await fetch(`${baseUrl}${pathname}`, { ...options, headers });
  const text = await response.text();
  return {
    response,
    body: text ? JSON.parse(text) : null
  };
}
