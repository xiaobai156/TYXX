import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createLocalServer } from './app.js';
import { openLotteryDatabase } from './database.js';

const HOST = '127.0.0.1';
const PORT = Number(process.env.LOTTERY_PORT || 23962);
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = path.resolve(
  process.env.LOTTERY_DATA_DIR || path.join(APP_ROOT, 'data')
);
const STATIC_DIR = path.resolve(process.env.LOTTERY_STATIC_DIR || APP_ROOT);

const store = openLotteryDatabase({
  dbPath: path.join(DATA_DIR, 'lottery_tools.sqlite3'),
  backupDir: path.join(DATA_DIR, 'backups')
});
const server = createLocalServer({ store, staticDir: STATIC_DIR });

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}

server.listen(PORT, HOST, () => {
  console.log(`统一分析平台已启动：http://${HOST}:${PORT}/`);
  console.log(`本地数据库：${store.dbPath}`);
});
server.on('error', error => {
  console.error(`本地服务启动失败：${error.message}`);
  store.close();
  process.exitCode = 1;
});
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
