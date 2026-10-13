function getDays(snapshot) {
  return snapshot?.days && typeof snapshot.days === 'object' ? snapshot.days : {};
}

function normalizeEntry(entry) {
  return {
    name: String(entry?.name ?? ''),
    content: String(entry?.content ?? ''),
    original: entry?.original == null ? null : String(entry.original)
  };
}

export function getModeRecord(snapshot, date, modeId) {
  const record = getDays(snapshot)?.[date]?.[modeId];
  if (!record || typeof record !== 'object') return { query: '', entries: [] };
  return {
    query: String(record.query ?? ''),
    entries: Array.isArray(record.entries) ? record.entries.map(normalizeEntry) : []
  };
}

export function removeDirectoryFromSnapshot(snapshot, modeId, name) {
  const targetName = String(name ?? '').trim();
  if (!targetName || !snapshot?.days || typeof snapshot.days !== 'object') return snapshot;
  let changed = false;
  const days = Object.fromEntries(Object.entries(snapshot.days).map(([date, day]) => {
    const record = day?.[modeId];
    if (!Array.isArray(record?.entries)) return [date, day];
    const entries = record.entries.filter(entry => String(entry?.name ?? '').trim() !== targetName);
    if (entries.length === record.entries.length) return [date, day];
    changed = true;
    return [date, { ...day, [modeId]: { ...record, entries } }];
  }));
  return changed ? { ...snapshot, days } : snapshot;
}

function toDateString(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function buildCalendarMonth(year, month, snapshot) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const mondayOffset = (first.getUTCDay() + 6) % 7;
  const start = new Date(Date.UTC(year, month - 1, 1 - mondayOffset));
  const days = getDays(snapshot);

  return Array.from({ length: 42 }, (_, index) => {
    const dateValue = new Date(start);
    dateValue.setUTCDate(start.getUTCDate() + index);
    const date = toDateString(dateValue);
    const modeRecords = days[date] && typeof days[date] === 'object'
      ? Object.values(days[date]).filter(Boolean)
      : [];
    return {
      date,
      day: dateValue.getUTCDate(),
      inMonth: dateValue.getUTCMonth() === month - 1,
      modeCount: modeRecords.length,
      entryCount: modeRecords.reduce((total, record) => (
        total + (Array.isArray(record?.entries) ? record.entries.length : 0)
      ), 0)
    };
  });
}

export function buildDirectoryHistory(snapshot, modeId) {
  const histories = new Map();
  const dates = Object.keys(getDays(snapshot)).sort();

  dates.forEach(date => {
    const record = getModeRecord(snapshot, date, modeId);
    record.entries.forEach(entry => {
      if (!entry.name.trim()) return;
      const current = histories.get(entry.name) || {
        name: entry.name,
        recordCount: 0,
        firstDate: date,
        latestDate: date,
        latestContent: ''
      };
      current.recordCount += 1;
      current.latestDate = date;
      current.latestContent = entry.content;
      histories.set(entry.name, current);
    });
  });

  return Array.from(histories.values()).sort((left, right) => (
    right.recordCount - left.recordCount || left.name.localeCompare(right.name, 'zh-CN')
  ));
}

export function buildDailyRows(snapshot, modeId) {
  const days = getDays(snapshot);
  return Object.keys(days)
    .filter(date => Object.prototype.hasOwnProperty.call(days[date] || {}, modeId))
    .sort((left, right) => right.localeCompare(left))
    .map(date => {
      const record = getModeRecord(snapshot, date, modeId);
      return {
        date,
        query: record.query,
        directoryCount: record.entries.length,
        contentCount: record.entries.filter(entry => entry.content.trim()).length
      };
    });
}

export function searchEntries(snapshot, modeId, searchText) {
  const term = String(searchText ?? '').trim().toLocaleLowerCase('zh-CN');
  if (!term) return [];
  const results = [];
  const days = getDays(snapshot);
  Object.keys(days).sort((left, right) => right.localeCompare(left)).forEach(date => {
    const record = getModeRecord(snapshot, date, modeId);
    record.entries.forEach(entry => {
      const haystack = `${entry.name}\n${entry.content}\n${entry.original ?? ''}`.toLocaleLowerCase('zh-CN');
      if (!haystack.includes(term)) return;
      results.push({
        date,
        query: record.query,
        name: entry.name,
        content: entry.content,
        original: entry.original
      });
    });
  });
  return results;
}

export function listDirectories(snapshot, modeId) {
  return buildDirectoryHistory(snapshot, modeId)
    .map(({ name, recordCount }) => ({ name, recordCount }))
    .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
}

export function snapshotSummary(snapshot) {
  const days = getDays(snapshot);
  const dates = Object.keys(days).sort();
  let modes = 0;
  let entries = 0;
  dates.forEach(date => {
    Object.values(days[date] || {}).forEach(record => {
      modes += 1;
      entries += Array.isArray(record?.entries) ? record.entries.length : 0;
    });
  });
  return {
    dayCount: dates.length,
    modeRecordCount: modes,
    entryCount: entries,
    firstDate: dates[0] || '',
    latestDate: dates.at(-1) || ''
  };
}
