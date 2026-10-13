const ZODIACS = '鼠牛虎兔龙蛇马羊猴鸡狗猪';
const TRADITIONAL_ZODIACS = { 龍: '龙', 雞: '鸡', 馬: '马', 豬: '猪' };
const ZODIAC_NUMBERS = {
  马: ['01', '13', '25', '37', '49'], 蛇: ['02', '14', '26', '38'],
  龙: ['03', '15', '27', '39'], 兔: ['04', '16', '28', '40'],
  虎: ['05', '17', '29', '41'], 牛: ['06', '18', '30', '42'],
  鼠: ['07', '19', '31', '43'], 猪: ['08', '20', '32', '44'],
  狗: ['09', '21', '33', '45'], 鸡: ['10', '22', '34', '46'],
  猴: ['11', '23', '35', '47'], 羊: ['12', '24', '36', '48']
};
const WAVE_NUMBERS = {
  红波: '01 02 07 08 12 13 18 19 23 24 29 30 34 35 40 45 46',
  蓝波: '03 04 09 10 14 15 20 25 26 31 36 37 41 42 47 48',
  绿波: '05 06 11 16 17 21 22 27 28 32 33 38 39 43 44 49'
};
const HALF_WAVE_NUMBERS = {
  红单: '01 07 13 19 23 29 35 45',
  红双: '02 08 12 18 24 30 34 40 46',
  蓝单: '03 09 15 25 31 37 41 47',
  蓝双: '04 10 14 20 26 36 42 48',
  绿单: '05 11 17 21 27 33 39 43 49',
  绿双: '06 16 22 28 32 38 44'
};
const ELEMENT_NUMBERS = {
  金行: '04 05 12 13 26 27 34 35 42 43',
  木行: '08 09 16 17 24 25 38 39 46 47',
  水行: '01 14 15 22 23 30 31 44 45',
  火行: '02 03 10 11 18 19 32 33 40 41 48 49',
  土行: '06 07 20 21 28 29 36 37'
};

function numberSetMap(source) {
  return Object.fromEntries(Object.entries(source).map(([key, value]) => [key, new Set(value.split(' '))]));
}

const WAVE_SETS = numberSetMap(WAVE_NUMBERS);
const HALF_WAVE_SETS = numberSetMap(HALF_WAVE_NUMBERS);
const ELEMENT_SETS = numberSetMap(ELEMENT_NUMBERS);

export function normalizeFullWidthDigits(value) {
  return String(value ?? '').replace(/[０-９]/g, digit => (
    String.fromCharCode(digit.charCodeAt(0) - 0xFEE0)
  ));
}

function normalizeText(value) {
  return normalizeFullWidthDigits(value)
    .replace(/[龍雞馬豬]/g, char => TRADITIONAL_ZODIACS[char])
    .replace(/[，、；;]/g, ',')
    .trim();
}

function unique(values) {
  return [...new Set(values)];
}

function extractNumbers(value) {
  return (normalizeText(value).match(/\d{1,2}/g) || [])
    .map(token => Number(token))
    .filter(number => number >= 1 && number <= 49)
    .map(number => String(number).padStart(2, '0'));
}

function extractZodiacs(value) {
  return unique(normalizeText(value).split('').filter(char => ZODIACS.includes(char)));
}

function zodiacForNumber(number) {
  return Object.entries(ZODIAC_NUMBERS).find(([, numbers]) => numbers.includes(number))?.[0] || '';
}

function firstDrawNumber(query) {
  return extractNumbers(query)[0] || '';
}

export function getActualZodiac(value) {
  return extractZodiacs(value)[0] || zodiacForNumber(firstDrawNumber(value));
}

function extractTails(value) {
  const text = normalizeText(value);
  const tails = [];
  for (const match of text.matchAll(/([0-9]+)尾/g)) tails.push(...match[1].split(''));
  if (tails.length === 0) tails.push(...extractNumbers(text).map(number => String(Number(number) % 10)));
  return unique(tails.map(tail => `${tail}尾`));
}

function typeForNumber(modeId, number) {
  const numeric = Number(number);
  if (!Number.isInteger(numeric) || numeric < 1 || numeric > 49) return '';
  if (modeId === 'shabantou') return `${Math.floor(numeric / 10)}头${numeric % 2 ? '单' : '双'}`;
  if (modeId === 'shayitou') return `${Math.floor(numeric / 10)}头`;
  if (modeId === 'shayibo') return Object.keys(WAVE_SETS).find(type => WAVE_SETS[type].has(number)) || '';
  if (modeId === 'shabanbo') return Object.keys(HALF_WAVE_SETS).find(type => HALF_WAVE_SETS[type].has(number)) || '';
  if (modeId === 'shayihe') {
    const sum = Math.floor(numeric / 10) + (numeric % 10);
    return `${String(sum).padStart(2, '0')}合`;
  }
  if (modeId === 'shayixiao' || modeId === 'shayixiao2') return zodiacForNumber(number);
  if (modeId === 'shayiduan') return `${Math.ceil(numeric / 7)}段`;
  if (modeId === 'shayihang') return Object.keys(ELEMENT_SETS).find(type => ELEMENT_SETS[type].has(number)) || '';
  if (modeId === 'shayiwei') return `${numeric % 10}尾`;
  return '';
}

function collectTypes(text, pattern, normalizeMatch = match => match[0]) {
  const compact = normalizeText(text).replace(/\s+/g, '');
  const matches = [...compact.matchAll(pattern)];
  if (matches.length === 0) return [];
  const residue = matches.reduce((value, match) => value.replace(match[0], ''), compact)
    .replace(/,+/g, '');
  if (residue) return [];
  return unique(matches.map(normalizeMatch));
}

function parseModeTypes(modeId, value) {
  if (modeId === 'shabantou') return collectTypes(value, /[0-4]头[单双]/g);
  if (modeId === 'shayitou') return collectTypes(value, /[0-4]头/g);
  if (modeId === 'shayibo') {
    return collectTypes(value, /[红蓝绿](?:波)?/g, match => `${match[0][0]}波`);
  }
  if (modeId === 'shabanbo') return collectTypes(value, /[红蓝绿][单双]/g);
  if (modeId === 'shayihe') {
    return collectTypes(value, /(?:0?[1-9]|1[0-3])合/g, match => (
      `${String(Number(match[0].replace('合', ''))).padStart(2, '0')}合`
    ));
  }
  if (modeId === 'shayixiao' || modeId === 'shayixiao2') {
    return collectTypes(value, /[鼠牛虎兔龙蛇马羊猴鸡狗猪]/g);
  }
  if (modeId === 'shayiduan') return collectTypes(value, /[1-7]段/g);
  if (modeId === 'shayihang') {
    return collectTypes(value, /[金木水火土](?:行)?/g, match => `${match[0][0]}行`);
  }
  if (modeId === 'shayiwei') return collectTypes(value, /[0-9]尾/g);
  return [];
}

export function getQueryTypes(modeId, query) {
  const normalized = normalizeText(query);
  if (/^0?[1-9]$|^[1-4][0-9]$/.test(normalized)) {
    const number = String(Number(normalized)).padStart(2, '0');
    const type = typeForNumber(modeId, number);
    return type ? [type] : [];
  }
  return parseModeTypes(modeId, normalized);
}

export function isValidQuery(projectId, modeId, query) {
  if (projectId === 'pingte') {
    if (modeId === 'pingteyixiao') return extractZodiacs(query).length > 0;
    if (modeId === 'pingtewei') return extractTails(query).length > 0;
    if (modeId === 'shaliangxiao') {
      return Boolean(extractZodiacs(query)[0] || zodiacForNumber(firstDrawNumber(query)));
    }
    throw new Error(`未知模式: ${modeId}`);
  }
  if (projectId === 'dawei_shahao') {
    if (modeId === 'shengxiao') {
      return Boolean(extractZodiacs(query)[0] || zodiacForNumber(firstDrawNumber(query)));
    }
    if (['dawei', 'shahao', 'shaxiao'].includes(modeId)) return Boolean(firstDrawNumber(query));
    throw new Error(`未知模式: ${modeId}`);
  }
  if (projectId === 'jiuxiang') return getQueryTypes(modeId, query).length > 0;
  throw new Error(`未知项目: ${projectId}`);
}

function evaluatePingte(modeId, content, query) {
  if (modeId === 'pingteyixiao') {
    const contentTypes = extractZodiacs(content);
    const queryTypes = extractZodiacs(query);
    return contentTypes.length > 0 && queryTypes.length > 0
      && contentTypes.some(type => queryTypes.includes(type));
  }
  if (modeId === 'pingtewei') {
    const contentTypes = extractTails(content);
    const queryTypes = extractTails(query);
    return contentTypes.length > 0 && queryTypes.length > 0
      && contentTypes.some(type => queryTypes.includes(type));
  }
  if (modeId === 'shaliangxiao') {
    const killed = extractZodiacs(content);
    const actual = extractZodiacs(query)[0] || zodiacForNumber(firstDrawNumber(query));
    return killed.length === 2 && Boolean(actual) && !killed.includes(actual);
  }
  throw new Error(`未知模式: ${modeId}`);
}

function evaluateDawei(modeId, content, query, date, name) {
  if (modeId === 'shengxiao') {
    const contentTypes = extractZodiacs(content);
    const actual = extractZodiacs(query)[0] || zodiacForNumber(firstDrawNumber(query));
    if (!contentTypes.length || !actual) return false;
    const hit = contentTypes.includes(actual);
    if (String(name || '').trim() === '前八后一' && String(date || '') >= '2026-05-01') return !hit;
    return String(date || '') >= '2026-05-21' ? !hit : hit;
  }
  if (!['dawei', 'shahao', 'shaxiao'].includes(modeId)) throw new Error(`未知模式: ${modeId}`);
  const numbers = extractNumbers(content);
  const actual = firstDrawNumber(query);
  if (!numbers.length || !actual) return false;
  const hit = numbers.includes(actual);
  return modeId === 'dawei' ? hit : !hit;
}

function evaluateJiuxiang(modeId, content, query) {
  const supported = [
    'shabantou', 'shayitou', 'shayibo', 'shabanbo', 'shayihe',
    'shayixiao', 'shayixiao2', 'shayiduan', 'shayihang', 'shayiwei'
  ];
  if (!supported.includes(modeId)) throw new Error(`未知模式: ${modeId}`);
  const queryTypes = getQueryTypes(modeId, query);
  const contentTypes = parseModeTypes(modeId, content);
  if (!queryTypes.length || !contentTypes.length) return false;
  return !contentTypes.some(type => queryTypes.includes(type));
}

export function evaluateCorrectness({ projectId, modeId, content, query, date, name }) {
  if (projectId === 'pingte') return evaluatePingte(modeId, content, query);
  if (projectId === 'dawei_shahao') return evaluateDawei(modeId, content, query, date, name);
  if (projectId === 'jiuxiang') return evaluateJiuxiang(modeId, content, query);
  throw new Error(`未知项目: ${projectId}`);
}
