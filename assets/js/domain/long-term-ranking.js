export const LONG_TERM_MIN_DAYS = 120;

export function longTermScore(totalRight, days) {
  if (!days) return 0;
  const p = totalRight / days;
  const z2 = 1.96 ** 2;
  const lower = (p + z2 / (2 * days)
    - 1.96 * Math.sqrt(p * (1 - p) / days + z2 / (4 * days ** 2))) / (1 + z2 / days);
  // Display and compare the same one-decimal Wilson score.
  return Number((100 * Math.max(0, lower)).toFixed(1));
}

export function compareLongTermRows(left, right) {
  return right.longTermScore - left.longTermScore
    || left.recent120MaxWrong - right.recent120MaxWrong
    || right.recent30Rate - left.recent30Rate
    || right.daysInSystem - left.daysInSystem
    || left.name.localeCompare(right.name, 'zh-CN', { numeric: true });
}

export function buildLongTermRanking(rows) {
  const enriched = rows.map(row => {
    const states = row.stateHistory;
    let start = states.length;
    let covered = 0;
    while (start > 0 && covered < LONG_TERM_MIN_DAYS) {
      start -= 1;
      if (typeof states[start] === 'boolean') covered += 1;
    }
    let wrongStreak = 0;
    let recent120MaxWrong = 0;
    const recent120 = states.slice(start);
    const longTermRight = recent120.filter(state => state === true).length;
    // 窗口内一共错了多少次（用户要求这一列改显示总连断次数）。
    const recent120WrongCount = recent120.filter(state => state === false).length;
    for (const state of recent120) {
      // Keep pending dates inside the window: they break a streak, not count as a result.
      wrongStreak = state === false ? wrongStreak + 1 : 0;
      recent120MaxWrong = Math.max(recent120MaxWrong, wrongStreak);
    }
    const recent30 = states.filter(state => typeof state === 'boolean').slice(-30);
    return {
      ...row,
      longTermDays: covered,
      longTermRight,
      longTermScore: longTermScore(longTermRight, covered),
      recent120MaxWrong,
      recent120WrongCount,
      recent30Rate: recent30.length ? recent30.filter(Boolean).length / recent30.length : 0,
      rankingEligible: row.daysInSystem >= LONG_TERM_MIN_DAYS
    };
  });
  enriched.sort((left, right) => Number(right.rankingEligible) - Number(left.rankingEligible)
    || (!left.rankingEligible ? right.daysInSystem - left.daysInSystem : 0)
    || compareLongTermRows(left, right));
  return enriched.map((row, index) => ({ ...row, officialRank: row.rankingEligible ? index + 1 : null }));
}
