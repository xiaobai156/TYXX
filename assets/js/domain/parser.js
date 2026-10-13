import { getQueryTypes, isValidQuery, normalizeFullWidthDigits } from './rules.js';

const ZODIACS = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const TRADITIONAL_ZODIACS = { 龍: '龙', 雞: '鸡', 馬: '马', 豬: '猪' };
const SYSTEM_QUERY_NAME = /^_*QUERY_*$/i;
const SHAYIWEI_TWO_TAIL_DIRECTORY_NAMES = new Set([
  '强烈招牌', '华丽恶梦', '专注凯子', '唯一火势'
]);

function cleanText(value) {
  return normalizeFullWidthDigits(value)
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/　/g, ' ')
    .replace(/[龍雞馬豬]/g, value => TRADITIONAL_ZODIACS[value])
    .replace(/[。，．；：、.]/g, ',')
    .trim();
}

function unique(values) {
  return [...new Set(values)];
}

function zodiacTokens(value) {
  return unique([...cleanText(value)].filter(character => ZODIACS.includes(character)));
}

function numberTokens(value) {
  return (cleanText(value).match(/\d{1,2}/g) || [])
    .map(Number)
    .filter(number => number >= 1 && number <= 49)
    .map(number => String(number).padStart(2, '0'));
}

function tailTokens(value) {
  const digits = cleanText(value).match(/\d/g) || [];
  return unique(digits.map(digit => `${digit}尾`));
}

function parsePingteLine(modeId, cleaned) {
  let match;
  if (modeId === 'pingteyixiao') {
    match = cleaned.match(/^([鼠牛虎兔龙蛇马羊猴鸡狗猪]+)\s*(.*)$/);
    if (match) return { content: zodiacTokens(match[1]).join(''), name: match[2].trim() };
  }
  if (modeId === 'pingtewei') {
    match = cleaned.match(/^((?:\d+\s*尾?\s*)+)\s*(.*)$/);
    if (match) return { content: tailTokens(match[1]).join(''), name: match[2].trim() };
  }
  if (modeId === 'shaliangxiao') {
    match = cleaned.match(/^([鼠牛虎兔龙蛇马羊猴鸡狗猪]{2})\s*(.*)$/);
    if (match) return { content: match[1], name: match[2].trim() };
  }
  const parts = cleaned.split(/[,\s]+/).filter(Boolean);
  return { content: parts[0] || '', name: parts.slice(1).join(' ') };
}

function findNumberSequence(text, allowLeadingSingle) {
  return text.match(/\d{1,2}(?:[\s,]+\d{1,2})+/)
    || (allowLeadingSingle ? text.match(/^\s*\d{1,2}(?=\s+\S)/) : null);
}

function parseDaweiLine(modeId, cleaned) {
  if (modeId === 'shengxiao') {
    const parts = cleaned.split(/[,\s]+/).filter(Boolean);
    return { content: zodiacTokens(parts[0] || '').join(''), name: parts.slice(1).join(' ') };
  }
  const numberMatch = findNumberSequence(cleaned, modeId === 'shahao');
  if (numberMatch) {
    return {
      content: numberTokens(numberMatch[0]).join(','),
      name: cleaned.replace(numberMatch[0], '').replace(/^[,\s]+|[,\s]+$/g, '').trim()
    };
  }
  const parts = cleaned.split(/[,\s]+/).filter(Boolean);
  return { name: parts[0] || '', content: parts.slice(1).join(' ') };
}

function normalizeJiuxiangContent(modeId, value) {
  const chineseDigits = { 零: '0', 一: '1', 二: '2', 两: '2', 三: '3', 四: '4', 五: '5', 六: '6', 七: '7', 八: '8', 九: '9' };
  let content = cleanText(value)
    .replace(/[零一二两三四五六七八九](?=[头尾段合])/g, digit => chineseDigits[digit])
    .replace(/(\d{1,2})合/g, (_, number) => `${String(Number(number)).padStart(2, '0')}合`);
  if (modeId === 'shayihang') content = content.replace(/[金木水火土](?!行)/g, type => `${type}行`);
  if (modeId === 'shayibo') content = content.replace(/[红蓝绿](?!波)/g, type => `${type}波`);
  return content;
}

function parseJiuxiangLine(modeId, cleaned) {
  if (modeId === 'shayiwei') {
    const twoTailMatch = cleaned.match(/^([0-9]尾)\s+([0-9]尾)\s+(.+)$/);
    if (twoTailMatch) {
      return {
        content: `${twoTailMatch[1]},${twoTailMatch[2]}`,
        name: twoTailMatch[3].trim()
      };
    }
  }
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return {
    content: normalizeJiuxiangContent(modeId, parts[0] || ''),
    name: parts.slice(1).join(' ')
  };
}

function ensureUniqueNames(entries) {
  const names = new Set();
  for (const entry of entries) {
    if (SYSTEM_QUERY_NAME.test(entry.name)) throw new Error(`目录名 ${entry.name} 是系统查询名`);
    if (names.has(entry.name)) throw new Error(`目录名重复：${entry.name}`);
    names.add(entry.name);
  }
}

export function parsePastedEntries({ projectId, modeId, text }) {
  const lines = String(text ?? '').split(/\r?\n/)
    .filter(line => line.trim() && line.trim() !== '-' && !/^\d{1,2}$/.test(line.trim()));
  const entries = lines.map(original => {
    const cleaned = cleanText(original);
    let parsed;
    if (projectId === 'pingte') parsed = parsePingteLine(modeId, cleaned);
    else if (projectId === 'dawei_shahao') parsed = parseDaweiLine(modeId, cleaned);
    else if (projectId === 'jiuxiang') parsed = parseJiuxiangLine(modeId, cleaned);
    else throw new Error(`未知项目: ${projectId}`);
    return {
      name: parsed.name.trim() || '未命名',
      content: parsed.content.trim(),
      original
    };
  });
  ensureUniqueNames(entries);
  return entries;
}

function validateEntryContent(projectId, modeId, entry) {
  if (!entry.content.trim()) throw new Error(`目录 ${entry.name} 的内容不能为空`);
  if (projectId === 'pingte') {
    if (modeId === 'pingteyixiao' && zodiacTokens(entry.content).length === 0) {
      throw new Error(`平特一肖【${entry.name}】必须填写生肖`);
    }
    if (modeId === 'pingtewei' && tailTokens(entry.content).length === 0) {
      throw new Error(`平特尾【${entry.name}】必须填写尾数`);
    }
    if (modeId === 'shaliangxiao' && zodiacTokens(entry.content).length !== 2) {
      throw new Error(`杀两肖【${entry.name}】必须填写两个不同生肖`);
    }
    return;
  }
  if (projectId === 'dawei_shahao') {
    if (modeId === 'shengxiao') {
      if (!zodiacTokens(entry.content).length) throw new Error(`生肖【${entry.name}】必须填写生肖`);
      return;
    }
    const count = numberTokens(entry.content).length;
    if (!count) throw new Error(`目录 ${entry.name} 必须填写号码`);
    if (modeId === 'shaxiao') {
      const required = entry.name === '拔树寻根' ? 6 : 5;
      if (count !== required) throw new Error(`杀五码【${entry.name}】必须填写 ${required} 个数字`);
    }
    return;
  }
  if (projectId === 'jiuxiang') {
    const content = normalizeJiuxiangContent(modeId, entry.content);
    if (/^\d{1,2}$/.test(content) || getQueryTypes(modeId, content).length === 0) {
      throw new Error(`目录 ${entry.name} 的内容不属于当前模式`);
    }
    if (modeId === 'shayiwei') {
      const tokens = [...content.replace(/\s+/g, '').matchAll(/[0-9]尾/g)]
        .map(match => match[0]);
      const requiredCount = SHAYIWEI_TWO_TAIL_DIRECTORY_NAMES.has(entry.name) ? 2 : 1;
      if (tokens.length !== requiredCount || new Set(tokens).size !== requiredCount) {
        const requirement = requiredCount === 2 ? '两个不同尾数' : '一个尾数';
        throw new Error(`杀一尾目录【${entry.name}】必须填写${requirement}`);
      }
    }
    return;
  }
  throw new Error(`未知项目: ${projectId}`);
}

export function validateModePayload({ projectId, modeId, query, entries }) {
  const normalizedQuery = String(query ?? '').trim();
  if (!normalizedQuery || !isValidQuery(projectId, modeId, normalizedQuery)) {
    throw new Error('当日查询值无效');
  }
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('至少需要一条有效资料');
  const normalizedEntries = entries.map(entry => ({
    name: String(entry?.name ?? '').trim(),
    content: String(entry?.content ?? '').trim(),
    ...(String(entry?.original ?? '').trim() ? { original: String(entry.original) } : {})
  }));
  if (normalizedEntries.some(entry => !entry.name)) throw new Error('每条数据都必须填写目录名');
  ensureUniqueNames(normalizedEntries);
  normalizedEntries.forEach(entry => validateEntryContent(projectId, modeId, entry));
  return { query: normalizedQuery, entries: normalizedEntries };
}

function isValidDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseBatchRows(text) {
  const lines = String(text ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error('至少需要一行批量数据');
  if (lines.length > 20) throw new Error('批量数据最多 20 行');
  const dates = new Set();
  return lines.map((line, index) => {
    const parts = line.includes('|')
      ? line.split(/\s*\|\s*/)
      : line.split(/\t+/);
    if (parts.length < 3) throw new Error(`第 ${index + 1} 行必须包含日期、query、content`);
    const [date, query, ...contentParts] = parts.map(part => part.trim());
    const content = contentParts.join(line.includes('|') ? '|' : '\t').trim();
    if (!isValidDate(date) || !query || !content) {
      throw new Error(`第 ${index + 1} 行必须包含有效日期、query、content`);
    }
    if (dates.has(date)) throw new Error(`批量日期重复：${date}`);
    dates.add(date);
    return { date, query, content, original: null };
  });
}
