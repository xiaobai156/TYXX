const ZODIAC_MAP = Object.freeze({
  龍: '龙',
  馬: '马',
  雞: '鸡',
  豬: '猪'
});

const ZODIAC_PATTERN = /[鼠牛虎兔龙蛇马羊猴鸡狗猪龍馬雞豬]/g;

function normalizeZodiac(value) {
  return ZODIAC_MAP[value] || value;
}

export function formatHistoricalContent({ projectId, modeId, name, content }) {
  const text = String(content ?? '');
  if (projectId !== 'pingte' || modeId !== 'shaliangxiao') return text;

  const directoryName = String(name ?? '').trim();
  const withoutDirectory = directoryName ? text.replace(directoryName, '') : text;
  const zodiacPair = [...withoutDirectory.matchAll(ZODIAC_PATTERN)]
    .slice(0, 2)
    .map(match => normalizeZodiac(match[0]))
    .join('');
  return zodiacPair.length === 2 ? zodiacPair : withoutDirectory.trim();
}
