const freezeProject = project => Object.freeze({
  ...project,
  modes: Object.freeze(project.modes.map(mode => Object.freeze({ ...mode })))
});

export const PROJECTS = Object.freeze([
  freezeProject({
    id: 'pingte',
    name: '平特分析',
    shortName: '平特',
    accent: '#0f766e',
    modes: [
      { id: 'pingteyixiao', name: '平特一肖', shortName: '一肖' },
      { id: 'pingtewei', name: '平特尾', shortName: '尾数' },
      { id: 'shaliangxiao', name: '杀两肖', shortName: '杀两肖' }
    ]
  }),
  freezeProject({
    id: 'dawei_shahao',
    name: '大围+杀号分析',
    shortName: '大围+杀号',
    accent: '#b45309',
    modes: [
      { id: 'dawei', name: '大围', shortName: '大围' },
      { id: 'shahao', name: '杀号', shortName: '杀号' },
      { id: 'shengxiao', name: '生肖', shortName: '生肖' },
      { id: 'shaxiao', name: '杀五码', shortName: '杀五码' }
    ]
  }),
  freezeProject({
    id: 'jiuxiang',
    name: '九项综合分析',
    shortName: '九项综合',
    accent: '#9f1239',
    modes: [
      { id: 'shabantou', name: '杀半头', shortName: '半头' },
      { id: 'shayitou', name: '杀一头', shortName: '一头' },
      { id: 'shayibo', name: '杀一波', shortName: '一波' },
      { id: 'shabanbo', name: '杀半波', shortName: '半波' },
      { id: 'shayihe', name: '杀一合', shortName: '一合' },
      { id: 'shayixiao', name: '杀一肖', shortName: '一肖' },
      { id: 'shayixiao2', name: '杀肖第二版', shortName: '杀肖二' },
      { id: 'shayiduan', name: '杀一段', shortName: '一段' },
      { id: 'shayihang', name: '杀一行', shortName: '一行' },
      { id: 'shayiwei', name: '杀一尾', shortName: '一尾' }
    ]
  })
]);

export const PAGES = Object.freeze([
  Object.freeze({ id: 'calendar', name: '日历' }),
  Object.freeze({ id: 'workspace', name: '数据工作台' }),
  Object.freeze({ id: 'analysis', name: '详细分析' }),
  Object.freeze({ id: 'daily-stats', name: '每日统计' }),
  Object.freeze({ id: 'manage', name: '批量数据分发' }),
  Object.freeze({ id: 'missing-directory-stats', name: '缺少目录统计' })
]);

const PROJECT_BY_ID = new Map(PROJECTS.map(project => [project.id, project]));

export function getProject(projectId) {
  const project = PROJECT_BY_ID.get(projectId);
  if (!project) throw new Error(`未知项目: ${projectId}`);
  return project;
}

export function getMode(projectId, modeId) {
  const project = getProject(projectId);
  const mode = project.modes.find(item => item.id === modeId);
  if (!mode) throw new Error(`模式 ${modeId} 不属于项目 ${projectId}`);
  return mode;
}
