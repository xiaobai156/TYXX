import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const commandPath = join(projectRoot, '启动统一分析平台.cmd');
const launcherPath = join(projectRoot, 'launcher.ps1');
const serverPath = join(projectRoot, 'server', 'index.js');
const streakToolRoot = join(projectRoot, '连对档位筛选本地版');

test('double-click bootstrap is one ASCII command that cmd.exe can decode reliably', () => {
  const source = readFileSync(commandPath, 'utf8').trim();

  assert.doesNotMatch(source, /[^\x00-\x7f]/);
  assert.equal(source.split(/\r?\n/).length, 1);
  assert.match(source, /"%~dp0launcher\.ps1"/i);
});

test('launcher and server share the local port 23962 contract', () => {
  const launcher = readFileSync(launcherPath, 'utf8');
  const server = readFileSync(serverPath, 'utf8');

  assert.match(launcher, /127\.0\.0\.1:23962/);
  assert.match(launcher, /LocalPort 23962/);
  assert.match(server, /LOTTERY_PORT \|\| 23962/);
  assert.doesNotMatch(`${launcher}\n${server}`, /8787/);
});

test('launcher always opens the platform with Microsoft Edge instead of the default browser', () => {
  const launcher = readFileSync(launcherPath, 'utf8');

  assert.match(launcher, /Microsoft\\Edge\\Application\\msedge\.exe/i);
  assert.match(launcher, /Get-Command\s+msedge\.exe/i);
  assert.match(launcher, /Start-Process\s+-FilePath\s+\$edgePath\s+-ArgumentList\s+\$url/i);
  assert.doesNotMatch(launcher, /Start-Process\s+\$url/i);
});

test('server keeps the default database inside the portable application folder', () => {
  const server = readFileSync(serverPath, 'utf8');

  assert.match(server, /process\.env\.LOTTERY_DATA_DIR \|\| path\.join\(APP_ROOT, 'data'\)/);
  assert.doesNotMatch(server, /homedir\(\)|Documents.*每天工具数据/);
  assert.match(server, /path\.join\(DATA_DIR, 'lottery_tools\.sqlite3'\)/);
  assert.match(server, /path\.join\(DATA_DIR, 'backups'\)/);
});

test('portable application folder includes the independent local streak tool', () => {
  const requiredFiles = [
    '隐藏启动连对档位筛选本地版.vbs',
    'launch.ps1',
    'server.js',
    'app-core.js',
    join('public', 'index.html'),
    join('public', 'app.js')
  ];

  assert.equal(requiredFiles.every(file => existsSync(join(streakToolRoot, file))), true);
});

test('nested local streak tool keeps its CommonJS runtime boundary', () => {
  const config = JSON.parse(readFileSync(join(streakToolRoot, 'package.json'), 'utf8'));

  assert.equal(config.type, 'commonjs');
});

test('Windows PowerShell 5.1 can execute the launcher when the service is healthy', {
  skip: process.platform !== 'win32'
}, () => {
  const command = readFileSync(commandPath, 'utf8');
  const target = command.match(/"%~dp0([^"]+\.ps1)"/i)?.[1];
  assert.ok(target, 'the bootstrap must reference a PowerShell launcher');

  const scriptPath = join(projectRoot, target).replaceAll("'", "''");
  const probe = [
    "function Invoke-RestMethod { param($Uri, $TimeoutSec) [pscustomobject]@{ ok = $true; database = 'ok' } }",
    'function Start-Process { param($FilePath, $ArgumentList, $WorkingDirectory, $WindowStyle, $RedirectStandardOutput, $RedirectStandardError) }',
    `& '${scriptPath}'`
  ].join('; ');
  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', probe], {
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
