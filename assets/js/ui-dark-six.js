const projects = [
  { id: 'pingte', code: 'PT', name: '平特', modes: [['pingteyixiao', '平特一肖'], ['pingtewei', '平特尾'], ['shaliangxiao', '杀两肖']] },
  { id: 'dawei_shahao', code: 'DW', name: '大围+杀号', modes: [['dawei', '大围'], ['shahao', '杀号'], ['shengxiao', '生肖'], ['shaxiao', '杀五码']] },
  { id: 'jiuxiang', code: 'JX', name: '九项综合', modes: [['shabantou', '杀半头'], ['shayitou', '杀一头'], ['shayibo', '杀一波'], ['shabanbo', '杀半波'], ['shayihe', '杀一合'], ['shayixiao', '杀一肖'], ['shayixiao2', '杀肖第二版'], ['shayiduan', '杀一段'], ['shayihang', '杀一行'], ['shayiwei', '杀一尾']] }
];

const pages = [
  ['calendar', '日历'], ['workspace', '数据工作台'], ['analysis', '详细分析'],
  ['daily-stats', '每日统计'],
  ['manage', '批量数据分发'], ['missing-directory-stats', '缺少目录统计']
];

const state = {
  project: 'jiuxiang',
  mode: 'shayiwei',
  page: 'analysis',
  indexProject: 'all'
};

let commandReturnFocus = null;

function activeProject() {
  return projects.find(project => project.id === state.project);
}

function activeMode() {
  return activeProject().modes.find(([id]) => id === state.mode);
}

function activePage() {
  return pages.find(([id]) => id === state.page);
}

function pageButtons(version) {
  return pages.map(([id, name], index) => `
    <button class="${version}-page command-search-item" type="button" data-page="${id}" data-search="${name}">
      <span>${String(index + 1).padStart(2, '0')}</span><b>${name}</b>
    </button>
  `).join('');
}

function projectButtons() {
  return projects.map(project => `
    <button class="v1-project" type="button" data-project="${project.id}"><span>${project.code}</span><b>${project.name}</b><small>${project.modes.length}</small></button>
  `).join('');
}

function currentModeButtons() {
  return activeProject().modes.map(([id, name]) => `
    <button class="v1-mode" type="button" data-project="${activeProject().id}" data-mode="${id}">${name}</button>
  `).join('');
}

function modeButton(project, mode, version) {
  const [id, name] = mode;
  return `<button class="${version}-mode command-search-item" type="button" data-project="${project.id}" data-mode="${id}" data-search="${project.name} ${name}">${name}</button>`;
}

function allModeGroups(version) {
  return projects.map(project => {
    const modes = project.modes.map(mode => modeButton(project, mode, version)).join('');
    if (version === 'v2') return `
      <section class="v2-group tone-${project.code.toLowerCase()}">
        <button class="group-heading" type="button" data-project="${project.id}"><span>${project.name}</span><small>${project.modes.length} 种</small></button>
        <div class="v2-modes">${modes}</div>
      </section>`;
    if (version === 'v3') return `
      <section class="tree-group command-search-group">
        <button class="tree-project command-search-item" type="button" data-project="${project.id}" data-search="${project.name}"><span class="tree-code">${project.code}</span><b>${project.name}</b><small>${project.modes.length}</small></button>
        <div class="tree-modes">${modes}</div>
      </section>`;
    if (version === 'v5') return `
      <section class="v5-group command-search-group">
        <button class="group-heading command-search-item" type="button" data-project="${project.id}" data-search="${project.name}"><span>${project.name}</span><small>${project.modes.length} 种</small></button>
        <div class="v5-modes">${modes}</div>
      </section>`;
    return `
      <section class="portal-project">
        <button class="portal-project-head" type="button" data-project="${project.id}"><span><i>${project.code}</i><b>${project.name}</b></span><small>${project.modes.length} 个种类</small></button>
        <div class="portal-modes">${modes}</div>
      </section>`;
  }).join('');
}

document.querySelectorAll('[data-page-list]').forEach(node => {
  node.innerHTML = pageButtons(node.dataset.pageList);
});
document.querySelector('[data-project-list="v1"]').innerHTML = projectButtons();
document.querySelectorAll('[data-all-mode-list]').forEach(node => {
  node.innerHTML = allModeGroups(node.dataset.allModeList);
});

function renderCurrentModes() {
  document.querySelector('[data-current-mode-list="v1"]').innerHTML = currentModeButtons();
}

function renderIndexFilters() {
  document.querySelector('[data-index-filters]').innerHTML = [
    ['all', '全部'],
    ...projects.map(project => [project.id, project.name])
  ].map(([id, name]) => `<button type="button" data-index-filter="${id}">${name}</button>`).join('');
}

function filteredIndexRows() {
  const query = document.querySelector('[data-index-search]')?.value.trim().toLocaleLowerCase('zh-CN') || '';
  return projects.flatMap(project => project.modes.map(([id, name]) => ({ project, id, name })))
    .filter(row => state.indexProject === 'all' || row.project.id === state.indexProject)
    .filter(row => !query || `${row.project.name} ${row.name}`.toLocaleLowerCase('zh-CN').includes(query));
}

function renderIndexList() {
  const rows = filteredIndexRows();
  document.querySelector('[data-index-count]').textContent = rows.length;
  document.querySelector('[data-index-list]').innerHTML = rows.length ? rows.map(row => `
    <button class="index-row" type="button" data-project="${row.project.id}" data-mode="${row.id}">
      <span><i>${row.project.code}</i>${row.project.name}</span><b>${row.name}</b><em>进入</em>
    </button>
  `).join('') : '<div class="index-empty">没有匹配的种类</div>';
  document.querySelectorAll('[data-index-filter]').forEach(button => {
    const active = button.dataset.indexFilter === state.indexProject;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
}

function syncSelection() {
  renderCurrentModes();
  const project = activeProject();
  const mode = activeMode();
  const page = activePage();
  const path = `${project.name} / ${mode[1]} / ${page[1]}`;

  document.querySelectorAll('[data-project]:not([data-mode])').forEach(button => {
    const active = button.dataset.project === project.id;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === mode[0];
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('[data-page]').forEach(button => {
    const active = button.dataset.page === page[0];
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  document.querySelectorAll('[data-current-path]').forEach(node => { node.textContent = path; });
  document.querySelectorAll('[data-selected-mode]').forEach(node => { node.textContent = mode[1]; });
}

function selectProject(projectId) {
  state.project = projectId;
  if (!activeProject().modes.some(([id]) => id === state.mode)) state.mode = activeProject().modes[0][0];
  syncSelection();
}

function setCommandOpen(open) {
  const layer = document.querySelector('[data-command-layer]');
  layer.classList.toggle('open', open);
  layer.setAttribute('aria-hidden', String(!open));
  if (open) {
    commandReturnFocus = document.activeElement;
    requestAnimationFrame(() => document.querySelector('[data-command-search]').focus());
  } else if (commandReturnFocus?.focus && !commandReturnFocus.closest?.('[data-command-layer]')) {
    commandReturnFocus.focus();
  }
}

function filterCommand(queryValue) {
  const query = queryValue.trim().toLocaleLowerCase('zh-CN');
  document.querySelectorAll('#version-command .command-search-item').forEach(item => {
    item.hidden = Boolean(query) && !item.dataset.search.toLocaleLowerCase('zh-CN').includes(query);
  });
  document.querySelectorAll('#version-command .command-search-group').forEach(group => {
    group.hidden = ![...group.querySelectorAll('.command-search-item')].some(item => !item.hidden);
  });
}

function filterTree(queryValue) {
  const query = queryValue.trim().toLocaleLowerCase('zh-CN');
  document.querySelectorAll('#version-tree [data-mode]').forEach(button => {
    button.hidden = Boolean(query) && !button.dataset.search.toLocaleLowerCase('zh-CN').includes(query);
  });
  document.querySelectorAll('#version-tree .tree-group').forEach(group => {
    group.hidden = ![...group.querySelectorAll('[data-mode]')].some(button => !button.hidden);
  });
}

function showVersion(version) {
  document.querySelectorAll('[data-show-version]').forEach(button => {
    const active = button.dataset.showVersion === version;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  document.querySelectorAll('.version').forEach(section => section.classList.toggle('active', section.id === `version-${version}`));
  if (version === 'command') setCommandOpen(true);
  if (version === 'portal') document.querySelector('.v6-shell').dataset.portalView = 'chooser';
}

document.addEventListener('click', event => {
  const versionButton = event.target.closest('[data-show-version]');
  if (versionButton) {
    showVersion(versionButton.dataset.showVersion);
    return;
  }

  const commandButton = event.target.closest('[data-command]');
  if (commandButton) {
    setCommandOpen(commandButton.dataset.command === 'open');
    return;
  }

  if (event.target.closest('[data-portal="choose"]')) {
    document.querySelector('.v6-shell').dataset.portalView = 'chooser';
    return;
  }

  const filterButton = event.target.closest('[data-index-filter]');
  if (filterButton) {
    state.indexProject = filterButton.dataset.indexFilter;
    renderIndexList();
    return;
  }

  const modeButton = event.target.closest('[data-mode]');
  if (modeButton) {
    state.project = modeButton.dataset.project;
    state.mode = modeButton.dataset.mode;
    syncSelection();
    if (modeButton.closest('#version-command')) setCommandOpen(false);
    if (modeButton.closest('#version-portal')) document.querySelector('.v6-shell').dataset.portalView = 'workspace';
    return;
  }

  const projectButton = event.target.closest('[data-project]:not([data-mode])');
  if (projectButton) {
    selectProject(projectButton.dataset.project);
    return;
  }

  const pageButton = event.target.closest('[data-page]');
  if (pageButton) {
    state.page = pageButton.dataset.page;
    syncSelection();
    if (pageButton.closest('#version-command')) setCommandOpen(false);
    return;
  }

  if (event.target.closest('[data-utility="calendar"]')) {
    state.page = 'calendar';
    syncSelection();
  }
});

document.querySelector('[data-index-search]').addEventListener('input', renderIndexList);
document.querySelector('[data-tree-search]').addEventListener('input', event => filterTree(event.target.value));
document.querySelector('[data-command-search]').addEventListener('input', event => filterCommand(event.target.value));

document.addEventListener('keydown', event => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault();
    showVersion('command');
  }
  if (event.key === 'Escape') setCommandOpen(false);
  if (event.key === 'Enter' && event.target.matches('[data-command-search]')) {
    const firstResult = document.querySelector('#version-command [data-mode]:not([hidden]), #version-command [data-page]:not([hidden])');
    firstResult?.click();
  }
});

console.assert(projects.reduce((total, project) => total + project.modes.length, 0) === 17, '种类必须为17个');
console.assert(pages.length === 7, '功能入口必须为7个');
renderIndexFilters();
renderIndexList();
showVersion('tabs');
syncSelection();
