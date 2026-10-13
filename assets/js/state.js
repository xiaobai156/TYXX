import { PAGES, PROJECTS, getMode, getProject } from './projects.js';

const PAGE_IDS = new Set(PAGES.map(({ id }) => id));

function isValidDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  return value.getUTCFullYear() === year
    && value.getUTCMonth() === month - 1
    && value.getUTCDate() === day;
}

function createProjectState(project, today) {
  return {
    pageId: 'calendar',
    modeId: project.modes[0].id,
    date: today,
    snapshot: null,
    drafts: {}
  };
}

export function createAppState({ today = new Date().toISOString().slice(0, 10) } = {}) {
  if (!isValidDate(today)) throw new Error('日期格式无效');

  let state = {
    activeProjectId: PROJECTS[0].id,
    projects: Object.fromEntries(PROJECTS.map(project => [
      project.id,
      createProjectState(project, today)
    ]))
  };
  const listeners = new Set();

  function notify() {
    listeners.forEach(listener => listener(state));
  }

  function updateProject(projectId, patch) {
    const current = state.projects[projectId];
    state = {
      ...state,
      projects: {
        ...state.projects,
        [projectId]: { ...current, ...patch }
      }
    };
    notify();
  }

  return {
    get() {
      return state;
    },

    getProjectState(projectId = state.activeProjectId) {
      getProject(projectId);
      return state.projects[projectId];
    },

    selectProject(projectId) {
      getProject(projectId);
      if (state.activeProjectId === projectId) return;
      state = { ...state, activeProjectId: projectId };
      notify();
    },

    setPage(pageId) {
      if (!PAGE_IDS.has(pageId)) throw new Error(`未知页面: ${pageId}`);
      updateProject(state.activeProjectId, { pageId });
    },

    setMode(modeId) {
      getMode(state.activeProjectId, modeId);
      updateProject(state.activeProjectId, { modeId });
    },

    setDate(date) {
      if (!isValidDate(date)) throw new Error('日期格式无效');
      updateProject(state.activeProjectId, { date });
    },

    setSnapshot(snapshot) {
      updateProject(state.activeProjectId, { snapshot });
    },

    setProjectSnapshot(projectId, snapshot) {
      getProject(projectId);
      updateProject(projectId, { snapshot });
    },

    setDraft(modeId, date, draft) {
      getMode(state.activeProjectId, modeId);
      if (!isValidDate(date)) throw new Error('日期格式无效');
      const projectState = state.projects[state.activeProjectId];
      const dateDrafts = projectState.drafts[date] || {};
      updateProject(state.activeProjectId, {
        drafts: {
          ...projectState.drafts,
          [date]: {
            ...dateDrafts,
            [modeId]: {
              query: String(draft?.query ?? ''),
              entries: Array.isArray(draft?.entries)
                ? draft.entries.map(entry => ({ ...entry }))
                : []
            }
          }
        }
      });
    },

    clearDraft(modeId, date, projectId = state.activeProjectId) {
      getMode(projectId, modeId);
      if (!isValidDate(date)) throw new Error('日期格式无效');
      const projectState = state.projects[projectId];
      const dateDrafts = { ...(projectState.drafts[date] || {}) };
      delete dateDrafts[modeId];
      const drafts = { ...projectState.drafts };
      if (Object.keys(dateDrafts).length) drafts[date] = dateDrafts;
      else delete drafts[date];
      updateProject(projectId, { drafts });
    },

    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError('listener 必须是函数');
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}
