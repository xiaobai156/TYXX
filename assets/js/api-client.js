function encodeSegment(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new TypeError('API 路径参数不能为空');
  return encodeURIComponent(normalized);
}

export function createApiPaths(basePath = '/api') {
  const root = `/${String(basePath).replace(/^\/+|\/+$/g, '')}`;
  return Object.freeze({
    health: () => `${root}/health`,
    projects: () => `${root}/projects`,
    snapshot: projectId => `${root}/projects/${encodeSegment(projectId)}/snapshot`,
    modeDate: (projectId, date, modeId) => (
      `${root}/projects/${encodeSegment(projectId)}/dates/${encodeSegment(date)}/modes/${encodeSegment(modeId)}`
    ),
    batch: (projectId, modeId) => (
      `${root}/projects/${encodeSegment(projectId)}/modes/${encodeSegment(modeId)}/batch`
    ),
    entry: (projectId, date, modeId, name) => (
      `${root}/projects/${encodeSegment(projectId)}/dates/${encodeSegment(date)}/modes/${encodeSegment(modeId)}/directories/${encodeSegment(name)}`
    ),
    date: (projectId, date) => `${root}/projects/${encodeSegment(projectId)}/dates/${encodeSegment(date)}`,
    directory: (projectId, modeId, name) => (
      `${root}/projects/${encodeSegment(projectId)}/directories/${encodeSegment(modeId)}/${encodeSegment(name)}`
    ),
    backup: () => `${root}/backup`,
    exportData: projectId => projectId
      ? `${root}/projects/${encodeSegment(projectId)}/export`
      : `${root}/export`,
    importData: strategy => `${root}/import?strategy=${encodeSegment(strategy)}`
  });
}

export const API_PATHS = createApiPaths();

export class ApiError extends Error {
  constructor(message, { status = 0, details = null } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

async function parseResponse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new ApiError('服务返回了无法识别的数据', { status: response.status });
  }
}

export function createApiClient({ fetchImpl = globalThis.fetch, basePath = '/api' } = {}) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch 不可用');
  const paths = createApiPaths(basePath);

  async function request(path, { method = 'GET', body } = {}) {
    const options = {
      method,
      headers: { accept: 'application/json' }
    };
    if (body !== undefined) {
      options.headers['content-type'] = 'application/json';
      options.body = JSON.stringify(body);
    }

    let response;
    try {
      response = await fetchImpl(path, options);
    } catch (error) {
      throw new ApiError('无法连接本地服务', { details: error });
    }
    const data = await parseResponse(response);
    if (!response.ok || data?.ok === false) {
      throw new ApiError(data?.error || `请求失败 (${response.status})`, {
        status: response.status,
        details: data
      });
    }
    return data;
  }

  return Object.freeze({
    async health() {
      return request(paths.health());
    },

    async getProjects() {
      const data = await request(paths.projects());
      if (!Array.isArray(data?.projects)) throw new ApiError('项目列表格式无效');
      return data.projects;
    },

    async getSnapshot(projectId) {
      const data = await request(paths.snapshot(projectId));
      if (!data?.snapshot || typeof data.snapshot !== 'object') {
        throw new ApiError('项目数据格式无效');
      }
      return data.snapshot;
    },

    saveMode(projectId, date, modeId, payload) {
      return request(paths.modeDate(projectId, date, modeId), {
        method: 'PUT',
        body: payload
      });
    },

    saveBatch(projectId, modeId, payload) {
      return request(paths.batch(projectId, modeId), { method: 'POST', body: payload });
    },

    deleteEntry(projectId, date, modeId, name) {
      return request(paths.entry(projectId, date, modeId, name), { method: 'DELETE' });
    },

    deleteDate(projectId, date) {
      return request(paths.date(projectId, date), { method: 'DELETE' });
    },

    deleteDirectory(projectId, modeId, name) {
      return request(paths.directory(projectId, modeId, name), { method: 'DELETE' });
    },

    renameDirectory(projectId, modeId, name, newName) {
      return request(paths.directory(projectId, modeId, name), {
        method: 'PATCH',
        body: { newName }
      });
    },

    createBackup() {
      return request(paths.backup(), { method: 'POST', body: {} });
    },

    exportData(projectId) {
      return request(paths.exportData(projectId));
    },

    importData(payload, strategy = 'merge') {
      return request(paths.importData(strategy), { method: 'POST', body: payload });
    }
  });
}
