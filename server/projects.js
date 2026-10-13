export const PROJECT_DEFINITIONS = [
  {
    id: 'pingte',
    name: '平特分析',
    sortOrder: 1,
    modes: [
      { id: 'pingteyixiao', name: '平特一肖', sortOrder: 1 },
      { id: 'pingtewei', name: '平特尾', sortOrder: 2 },
      { id: 'shaliangxiao', name: '杀两肖', sortOrder: 3 }
    ]
  },
  {
    id: 'dawei_shahao',
    name: '大围+杀号分析',
    sortOrder: 2,
    modes: [
      { id: 'dawei', name: '大围', sortOrder: 1 },
      { id: 'shahao', name: '杀号', sortOrder: 2 },
      { id: 'shengxiao', name: '生肖', sortOrder: 3 },
      { id: 'shaxiao', name: '杀五码', sortOrder: 4 }
    ]
  },
  {
    id: 'jiuxiang',
    name: '九项综合分析',
    sortOrder: 3,
    modes: [
      { id: 'shabantou', name: '杀半头', sortOrder: 1 },
      { id: 'shayitou', name: '杀一头', sortOrder: 2 },
      { id: 'shayibo', name: '杀一波', sortOrder: 3 },
      { id: 'shabanbo', name: '杀半波', sortOrder: 4 },
      { id: 'shayihe', name: '杀一合', sortOrder: 5 },
      { id: 'shayixiao', name: '杀一肖', sortOrder: 6 },
      { id: 'shayixiao2', name: '杀肖第二版', sortOrder: 7 },
      { id: 'shayiduan', name: '杀一段', sortOrder: 8 },
      { id: 'shayihang', name: '杀一行', sortOrder: 9 },
      { id: 'shayiwei', name: '杀一尾', sortOrder: 10 }
    ]
  }
];

export function cloneProjectDefinitions() {
  return PROJECT_DEFINITIONS.map(project => ({
    ...project,
    modes: project.modes.map(mode => ({ ...mode }))
  }));
}
