import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { evaluateCorrectness, getActualZodiac } from '../assets/js/domain/rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = path.join(ROOT, '回测报告-20260717-20260817.html');
const DB_PATH = path.join(ROOT, 'data', 'lottery_tools.sqlite3');
const START_DATE = '2026-07-17';
const END_DATE = '2026-08-17';
const ZODIACS = [...'鼠牛虎兔龙蛇马羊猴鸡狗猪'];
const NUMBERS = Array.from({ length: 49 }, (_, index) => String(index + 1).padStart(2, '0'));

function createReportTemplate() {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>号码组合回测报告 2026-07-17 至 2026-08-17</title>
<style>
:root{color-scheme:dark;--bg:#0b1220;--panel:#111c2f;--panel2:#16243a;--line:#263957;--text:#e6edf7;--muted:#9fb0c7;--good:#35d07f;--bad:#ff6b7a;--accent:#63a4ff}
*{box-sizing:border-box}body{margin:0;background:linear-gradient(135deg,#09111f,#101b2e 55%,#0c1728);color:var(--text);font:14px/1.6 "Microsoft YaHei",system-ui,sans-serif}
main{max-width:1500px;margin:0 auto;padding:28px 22px 48px}h1{margin:0 0 6px;font-size:28px}h2{font-size:17px;margin:0 0 12px}.sub{color:var(--muted);margin-bottom:22px}
.cards{display:grid;grid-template-columns:repeat(4,minmax(130px,1fr));gap:12px;margin-bottom:18px}.card,.note,.panel{background:rgba(17,28,47,.92);border:1px solid var(--line);border-radius:12px}.card{padding:15px 17px}.card span{display:block;color:var(--muted);font-size:13px}.card strong{display:block;font-size:26px;margin-top:4px}.good{color:var(--good)}.bad{color:var(--bad)}.accent{color:var(--accent)}
.note{padding:14px 17px;margin-bottom:18px;color:#c8d5e8}.note b{color:#fff}.panel{padding:15px 17px;margin-bottom:18px}.panel p{margin:6px 0;color:#c8d5e8}
.toolbar{display:flex;gap:10px;flex-wrap:wrap;margin:0 0 12px}.toolbar input,.toolbar select{background:#0d1829;color:var(--text);border:1px solid var(--line);border-radius:8px;padding:9px 11px}.toolbar input{min-width:260px}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}.table{width:100%;min-width:1060px;border-collapse:collapse;background:rgba(10,18,32,.7)}th,td{padding:10px 11px;border-bottom:1px solid #203049;text-align:left;vertical-align:top}th{position:sticky;top:0;background:#182941;color:#c9d7e9;white-space:nowrap}.date{white-space:nowrap}.base-detail{display:block;margin-top:3px;font-size:12px;line-height:1.5}.base-actual{color:#d8e4f3}.base-dirs{display:block;color:#8fc9ff}.base-none{display:block;color:#7f8da3}.status{font-weight:700;white-space:nowrap}.status.hit{color:var(--good)}.status.miss{color:var(--bad)}.hit-reasons{display:block;margin-top:2px;color:#b7e8cb;font-size:12px;font-weight:500;line-height:1.45;white-space:normal}.nums{max-width:520px;color:#d8e4f3;word-break:break-word}.missing{color:#ffca6b}.empty{padding:25px;text-align:center;color:var(--muted)}
@media(max-width:700px){main{padding:20px 12px}.cards{grid-template-columns:repeat(2,1fr)}h1{font-size:22px}.card strong{font-size:22px}}
</style>
</head>
<body>
<main>
<h1>号码组合回测报告</h1>
<div class="sub">回测区间：2026-07-17 至 2026-08-17（共32期）</div>
<section class="cards">
<div class="card"><span>回测期数</span><strong>0</strong></div>
<div class="card"><span>实际号码被杀号</span><strong class="good">0</strong></div>
<div class="card"><span>未被杀号</span><strong class="bad">0</strong></div>
<div class="card"><span>覆盖率</span><strong class="accent">0.0%</strong></div>
</section>
<section class="note"><b>计算口径：</b>先将“杀一肖、杀肖第二版、杀两肖”的生肖取并集作为基准；再在这些生肖对应的号码中，按杀一尾、杀半头、杀一头、杀半波、杀一合、杀一段、杀一行、杀五码、杀数字的条件筛出最终杀号。命中表示当天实际号码出现在最终杀号中。平均每天最终杀号 0.0 个。</section>
<section class="note"><b>数据提示：</b>待生成</section>
<section class="panel">
<h2>每日回测明细</h2>
<div class="toolbar"><input id="search" placeholder="搜索日期、号码或生肖"><select id="filter"><option value="all">全部</option><option value="hit">命中</option><option value="miss">未命中</option></select></div>
<div class="table-wrap"><table class="table"><thead><tr><th>日期</th><th>实际号码</th><th>基准生肖 / 命中目录</th><th>基准号码数</th><th>杀号数</th><th>最终杀号</th><th>结果</th><th>缺失数据</th></tr></thead><tbody id="rows"></tbody></table></div>
</section>
</main>
<script>
const DATA=[];
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const REASON_LABELS={尾:'杀一尾',半头:'杀半头',一头:'杀一头',半波:'杀半波',合:'杀一合',段:'杀一段',行:'杀一行',五码:'杀五码',数字:'杀数字'};
const BASE_MATCHES={};
function render(){
 const query=$('search').value.trim().toLowerCase(), filter=$('filter').value;
 const rows=DATA.filter(row=>{
   const text=[row.date,row.actual,(row.baseZodiac||[]).join(''),(row.killed||[]).map(x=>x.number).join(','),(row.missing||[]).join('')].join(' ').toLowerCase();
   return (!query||text.includes(query))&&(filter==='all'||(filter==='hit'&&row.hit)||(filter==='miss'&&!row.hit));
 }).map(row=>{
   const killed=(row.killed||[]).map(x=>x.number).join('、');
   const reasons=(row.killed||[]).map(x=>x.number+'（'+x.reasons.map(reason=>REASON_LABELS[reason]||reason).join('、')+'）').join('、');
   const visibleMissing=(row.missing||[]).filter(item=>item!=='杀一肖:创财之星');
   const actualKill=(row.killed||[]).find(item=>item.number===row.actual);
   const hitReasons=actualKill?(actualKill.reasons||[]).map(reason=>REASON_LABELS[reason]||reason):[];
   const resultText=row.hit?'命中<span class="hit-reasons">原因：'+esc(hitReasons.join('、'))+'</span>':'未命中';
   const baseMatch=BASE_MATCHES[row.date]||{zodiac:'',dirs:[]};
   const baseDetail='<span class="base-detail"><span class="base-actual">实际生肖：'+esc(baseMatch.zodiac||'—')+'</span>'+(baseMatch.dirs.length?'<span class="base-dirs">命中目录：'+esc(baseMatch.dirs.join('、'))+'</span>':'<span class="base-none">实际生肖未进入基准</span>')+'</span>';
   return '<tr><td class="date">'+esc(row.date.slice(5).replace('-','.'))+'</td><td><b>'+esc(row.actual||'—')+'</b></td><td>'+esc((row.baseZodiac||[]).join('、'))+baseDetail+'</td><td>'+row.baseCount+'</td><td><b>'+row.killed.length+'</b></td><td class="nums" title="'+esc(reasons)+'">'+esc(killed)+'</td><td class="status '+(row.hit?'hit':'miss')+'">'+resultText+'</td><td class="missing">'+esc(visibleMissing.join('；')||'—')+'</td></tr>';
 }).join('');
 $('rows').innerHTML=rows||'<tr><td colspan="8" class="empty">没有符合条件的记录</td></tr>';
}
$('search').addEventListener('input',render);$('filter').addEventListener('change',render);render();
</script>
</body>
</html>
`;
}

const BASE_SPECS = [
  { projectId: 'jiuxiang', modeId: 'shayixiao', category: '杀一肖', names: ['福星金牌', '预判晚风', '绣闼雕甍', '创财之星', '精杀一肖'], ignoreMissing: new Set(['创财之星']) },
  { projectId: 'jiuxiang', modeId: 'shayixiao2', category: '杀肖第二版', names: ['创财之星', '浮光掠影'] },
  { projectId: 'pingte', modeId: 'shaliangxiao', category: '杀两肖', names: ['寸草不生'] }
];

const FILTER_SPECS = [
  { projectId: 'jiuxiang', modeId: 'shayiwei', category: '杀一尾', reason: '尾', names: ['伊伊把', '禄无常家', '爱不单行'] },
  { projectId: 'jiuxiang', modeId: 'shabantou', category: '杀半头', reason: '半头', names: ['西库规划', '顾而言他'] },
  { projectId: 'jiuxiang', modeId: 'shayitou', category: '杀一头', reason: '一头', names: ['金牌谜语', '谢天谢地'] },
  { projectId: 'jiuxiang', modeId: 'shabanbo', category: '杀半波', reason: '半波', names: ['百事通'] },
  { projectId: 'jiuxiang', modeId: 'shayihe', category: '杀一合', reason: '合', names: ['大田方是', '末学肤受'] },
  { projectId: 'jiuxiang', modeId: 'shayiduan', category: '杀一段', reason: '段', names: ['吹散思绪', '泪眼问花'] },
  { projectId: 'jiuxiang', modeId: 'shayihang', category: '杀一行', reason: '行', names: ['稳稳稳', '今非昔比', '人才资料'] },
  { projectId: 'dawei_shahao', modeId: 'shaxiao', category: '杀五码', reason: '五码', names: ['大富翁'] },
  { projectId: 'dawei_shahao', modeId: 'shahao', category: '杀数字', reason: '数字', names: ['码友系列'] }
];

const db = new DatabaseSync(DB_PATH, { readOnly: true });
const entryStatement = db.prepare(`
  SELECT content
  FROM data_entries
  WHERE project_id = ? AND date = ? AND mode_id = ? AND name = ?
`);
const actualRows = db.prepare(`
  SELECT date, query
  FROM daily_modes
  WHERE project_id = ? AND mode_id = ? AND date BETWEEN ? AND ?
  ORDER BY date
`).all('dawei_shahao', 'shahao', START_DATE, END_DATE);

function actualNumber(value) {
  const match = String(value ?? '').match(/\d{1,2}/);
  if (!match) return '';
  const number = Number(match[0]);
  return number >= 1 && number <= 49 ? String(number).padStart(2, '0') : '';
}

function loadEntries(spec, date, missing) {
  return spec.names.flatMap(name => {
    const entry = entryStatement.get(spec.projectId, date, spec.modeId, name);
    if (!entry) {
      if (!spec.ignoreMissing?.has(name)) missing.push(`${spec.category}:${name}`);
      return [];
    }
    return [{ ...spec, name, content: String(entry.content ?? '') }];
  });
}

function kills(entry, query, date) {
  return !evaluateCorrectness({
    projectId: entry.projectId,
    modeId: entry.modeId,
    content: entry.content,
    query,
    date,
    name: entry.name
  });
}

const rows = [];
const baseMatches = {};
for (const actualRow of actualRows) {
  const date = String(actualRow.date);
  const actual = actualNumber(actualRow.query);
  if (!actual) continue;

  const missing = [];
  const baseEntries = BASE_SPECS.flatMap(spec => loadEntries(spec, date, missing));
  const filterEntries = FILTER_SPECS.flatMap(spec => loadEntries(spec, date, missing));
  const baseZodiac = ZODIACS.filter(zodiac => baseEntries.some(entry => kills(entry, zodiac, date)));
  const baseNumberSet = new Set(NUMBERS.filter(number => baseZodiac.includes(getActualZodiac(number))));
  const actualZodiac = getActualZodiac(actual);
  const matchingBaseDirs = baseEntries
    .filter(entry => kills(entry, actualZodiac, date))
    .map(entry => `${entry.category}·${entry.name}`);

  const killed = [...baseNumberSet].flatMap(number => {
    const reasons = [...new Set(filterEntries.filter(entry => kills(entry, number, date)).map(entry => entry.reason))];
    return reasons.length ? [{ number, reasons }] : [];
  });
  const killedSet = new Set(killed.map(item => item.number));

  rows.push({
    date,
    actual,
    baseZodiac,
    baseCount: baseNumberSet.size,
    killed,
    hit: killedSet.has(actual),
    missing
  });
  baseMatches[date] = { zodiac: actualZodiac, dirs: matchingBaseDirs };
}

const hitCount = rows.filter(row => row.hit).length;
const missCount = rows.length - hitCount;
const coverage = rows.length ? `${(hitCount * 100 / rows.length).toFixed(1)}%` : '0.0%';
const averageKilled = rows.length
  ? (rows.reduce((total, row) => total + row.killed.length, 0) / rows.length).toFixed(1)
  : '0.0';
const missingOccurrences = rows.flatMap(row => row.missing.map(item => `${row.date.slice(5).replace('-', '月')}日 ${item}`));
const missingText = missingOccurrences.length
  ? `${missingOccurrences.join('；')}。缺失目录按无该项条件处理。`
  : '所有指定目录在回测区间内均有数据。';

let html = fs.existsSync(REPORT_PATH) ? fs.readFileSync(REPORT_PATH, 'utf8') : createReportTemplate();
html = html
  .replace(/(<div class="card"><span>回测期数<\/span><strong>)\d+(<\/strong><\/div>)/, `$1${rows.length}$2`)
  .replace(/(<div class="card"><span>实际号码被杀号<\/span><strong class="good">)\d+(<\/strong><\/div>)/, `$1${hitCount}$2`)
  .replace(/(<div class="card"><span>未被杀号<\/span><strong class="bad">)\d+(<\/strong><\/div>)/, `$1${missCount}$2`)
  .replace(/(<div class="card"><span>覆盖率<\/span><strong class="accent">)[^<]+(<\/strong><\/div>)/, `$1${coverage}$2`)
  .replace(/先将“杀一肖、杀肖第二版、杀两肖(?:、杀三肖)?”的生肖/, '先将“杀一肖、杀肖第二版、杀两肖”的生肖')
  .replace(/按杀一尾、杀半头、(?:杀一头、)?(?:杀半波、)?杀一合、杀一段、杀一行、杀五码、杀数字的条件/, '按杀一尾、杀半头、杀一头、杀半波、杀一合、杀一段、杀一行、杀五码、杀数字的条件')
  .replace(/平均每天最终杀号 [\d.]+ 个。/, `平均每天最终杀号 ${averageKilled} 个。`)
  .replace(/<section class="note"><b>数据提示：<\/b>.*?<\/section>/s, `<section class="note"><b>数据提示：</b>“创财之星”使用杀肖第二版中已入库的数据参与计算，不重复提示第一版同名目录缺失；新增的“百事通”“金牌谜语”“谢天谢地”均有完整${rows.length}期数据；${missingText}</section>`)
  .replace(/const DATA=\[.*?\];\r?\nconst \$/s, `const DATA=${JSON.stringify(rows)};\nconst $`)
  .replace(/const REASON_LABELS=.*?;\r?\n(?:const DIRECT_HIT_REASONS=.*?;\r?\n)?const BASE_MATCHES=.*?;\r?\nfunction render/s, `const REASON_LABELS={尾:'杀一尾',半头:'杀半头',一头:'杀一头',半波:'杀半波',合:'杀一合',段:'杀一段',行:'杀一行',五码:'杀五码',数字:'杀数字'};\nconst BASE_MATCHES=${JSON.stringify(baseMatches)};\nfunction render`)
  .replace("const reasons=(row.killed||[]).map(x=>x.number+'（'+x.reasons.join('、')+'）').join('、');", "const reasons=(row.killed||[]).map(x=>x.number+'（'+x.reasons.map(reason=>REASON_LABELS[reason]||reason).join('、')+'）').join('、');")
  .replace(/const hitReasons=.*?;/, "const hitReasons=actualKill?(actualKill.reasons||[]).map(reason=>REASON_LABELS[reason]||reason):[];");

fs.writeFileSync(REPORT_PATH, html, 'utf8');
console.log(JSON.stringify({ periods: rows.length, hitCount, missCount, coverage, averageKilled, missingOccurrences }, null, 2));
