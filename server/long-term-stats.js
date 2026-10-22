import { buildModeDirectoryStats } from '../assets/js/domain/stats.js';
import { buildLongTermRanking } from '../assets/js/domain/long-term-ranking.js';

export function buildPlatformRankingResults(store) {
  const projects = {};
  // Match the detailed analysis UI within one SQLite snapshot.
  store.connection.exec('BEGIN');
  try {
    for (const project of store.listProjects()) {
      const snapshot = store.getSnapshot(project.id);
      const modes = {};
      for (const mode of project.modes) {
        const input = { projectId: project.id, modeId: mode.id, snapshot };
        modes[mode.id] = Object.fromEntries(
          buildLongTermRanking(buildModeDirectoryStats({ ...input, settledOnly: true }))
            .map(row => [row.name, {
              score: row.longTermScore,
              days: row.daysInSystem,
              wrong: row.totalBroken,
              eligible: row.rankingEligible,
              currentState: row.currentState,
              currentStreak: row.currentStreak
            }])
        );
      }
      projects[project.id] = { dataVersion: store.getSnapshotDataVersion(project.id), modes };
    }
    store.connection.exec('COMMIT');
  } catch (error) {
    store.connection.exec('ROLLBACK');
    throw error;
  }
  return { schemaVersion: 'platform-ranking-v1', databasePath: store.dbPath, projects };
}
