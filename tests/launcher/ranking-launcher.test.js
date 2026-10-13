import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const outputRoot = join(projectRoot, '每天最高', 'outputs');
const batch = fs.readFileSync(join(outputRoot, '启动七类数据排行榜.bat'), 'utf8');
const vbsBytes = fs.readFileSync(join(outputRoot, '启动七类数据排行榜.vbs'));
const vbs = vbsBytes[0] === 0xff && vbsBytes[1] === 0xfe
  ? vbsBytes.toString('utf16le')
  : vbsBytes.toString('utf8').replace(/^\uFEFF/, '');

test('batch launcher validates Python before selecting it and supports the py launcher fallback', () => {
  assert.match(batch, /--version/);
  assert.match(batch, /PYTHON_ARGS/);
  assert.match(batch, /py\.exe/);
  assert.match(batch, /if not errorlevel 1/i);
});

test('VBS launcher validates Python before selecting it and supports py.exe -3 fallback', () => {
  assert.match(vbs, /Function CanRunPython/);
  assert.match(vbs, /CanRunPython\("py\.exe -3"\)/);
  assert.match(vbs, /If CanRunPython\(/);
});

test('VBS launcher checks the service port before opening the browser', () => {
  assert.match(vbs, /127\.0\.0\.1:8766/);
  assert.match(vbs, /Get-NetTCPConnection/);
  assert.match(vbs, /服务启动失败|service failed/i);
});
