# 本地后端契约

服务只监听 `127.0.0.1:23962`，页面和 API 使用同一个源。正式数据库默认位于：

`统一分析平台\data\lottery_tools.sqlite3`

可通过 `LOTTERY_PORT`、`LOTTERY_DATA_DIR`、`LOTTERY_STATIC_DIR` 覆盖端口、数据目录和静态文件目录。运行环境要求 Node.js 24 或更高版本。

## 数据边界

三个项目 id 固定为 `pingte`、`dawei_shahao`、`jiuxiang`，分别包含 3、4、10 个模式。业务主键均包含 `project_id`：

- `days`: `(project_id, date)`
- `daily_modes`: `(project_id, date, mode_id)`
- `data_entries`: `(project_id, date, mode_id, name)`

SQLite 启用 `WAL`、外键约束和 5 秒 `busy_timeout`。单模式保存、日期删除、目录删除/重命名及导入均在事务内完成。

## JSON API

| 方法 | 路径 | 用途 |
|---|---|---|
| `GET` | `/api/health` | 数据库快速检查 |
| `GET` | `/api/projects` | 三个项目及 17 个模式 |
| `GET` | `/api/projects/:projectId/snapshot` | 项目快照；可选 `from=YYYY-MM-DD`、`to=YYYY-MM-DD`、逗号分隔的 `modes` |
| `PUT` | `/api/projects/:projectId/dates/:date/modes/:modeId` | 原子替换某日某模式 |
| `POST` | `/api/projects/:projectId/modes/:modeId/batch` | 单目录跨最多 20 日事务写入 |
| `DELETE` | `/api/projects/:projectId/dates/:date` | 删除项目内一个日期 |
| `DELETE` | `/api/projects/:projectId/dates/:date/modes/:modeId/directories/:name` | 删除单日单目录 |
| `DELETE` | `/api/projects/:projectId/directories/:modeId/:name` | 删除项目模式内同名目录的全部历史 |
| `PATCH` | `/api/projects/:projectId/directories/:modeId/:name` | 重命名项目模式内同名目录的全部历史 |
| `GET` | `/api/projects/:projectId/export` | 导出一个项目 |
| `GET` | `/api/export` | 导出全部项目 |
| `POST` | `/api/import?strategy=merge|replace` | 导入标准 JSON |
| `POST` | `/api/backup` | 创建并校验 SQLite 在线备份 |

为兼容早期统一契约，写入也接受 `/api/projects/:projectId/modes/:modeId/dates/:date`，目录操作也接受 `/api/projects/:projectId/modes/:modeId/directories/:name`。新代码应使用表格中的规范路径。

模式替换请求：

```json
{
  "query": "07",
  "entries": [
    {
      "name": "目录甲",
      "content": "01 02",
      "original": "目录甲: 01 02"
    }
  ]
}
```

`entries` 是完整替换集，不是增量补丁。目录名为空、重复或匹配系统名 `^_*QUERY_*$`（忽略大小写）时整次写入失败，原数据不变。

批量请求为 `{ "name": "目录甲", "rows": [{ "date": "2026-07-27", "query": "07", "content": "鼠", "original": null }] }`。每批只能包含一个项目、模式和目录名，必须有 1 至 20 个不重复日期；每行的日期、query、content 全部有效后才会在一个事务中 upsert，原模式内其他目录不受影响。

大围项目的 `shahao` 与 `shaxiao` 沿用旧版规则，共享同一个查询值。保存任一模式会在同一事务中同步另一模式的查询值，但两边的目录记录始终独立；导入文件同时包含两者且查询值不同时，整次导入拒绝。

项目快照会保留范围内没有任何模式记录的空日期，并表示为 `"YYYY-MM-DD": {}`。九项统计以此识别旧版全局缺失日；导入导出不得过滤这些日期。`from`、`to` 必须是有效日期且前者不得晚于后者；`modes` 中的每个模式必须属于请求项目。非法参数返回 `400`，查询值使用参数绑定。

范围快照响应包含非空的 `schemaVersion` 和 `dataVersion`。响应同时带有确定性的 SHA-256 `ETag`，并使用 `private, max-age=0, must-revalidate`；重复发送相同的 `If-None-Match` 时返回 `304` 空响应。API 快照会附带数据库已有的 `created_at`、`updated_at` 时间值，以及由现有内容确定性计算的 `content_hash` 和 `version`（不新增数据库字段）。

项目快照：

```json
{
  "ok": true,
  "schemaVersion": "local-snapshot-v2",
  "dataVersion": "db-v1:...",
  "snapshot": {
    "project": { "id": "pingte", "name": "平特分析", "modes": [] },
    "days": {
      "2026-07-27": {
        "pingteyixiao": {
          "query": "07",
          "created_at": "2026-07-27T00:00:00.000Z",
          "updated_at": "2026-07-27T00:00:00.000Z",
          "version": "2026-07-27T00:00:00.000Z",
          "entries": []
        }
      }
    }
  }
}
```

导入导出顶层格式：

```json
{
  "schemaVersion": 1,
  "projects": [
    {
      "id": "pingte",
      "days": [
        {
          "date": "2026-07-27",
          "modes": [
            { "id": "pingteyixiao", "query": "07", "entries": [] }
          ]
        }
      ]
    }
  ]
}
```

`merge` 只替换导入文件明确包含的日期/模式；`replace` 会先清空导入文件所列项目，再导入这些项目。导入前会完整验证全部内容，任何错误都不会产生部分写入。

## 状态码与安全约束

- `400`: JSON、日期、项目模式关系或导入结构无效
- `403`: 浏览器请求不是同源
- `404`: 项目、接口或静态文件不存在
- `405`: HTTP 方法不允许
- `409`: 目录重命名目标已存在
- `413`: JSON 请求超过 128 MiB

SQL 值全部使用参数绑定。静态文件只能从应用目录读取，并拒绝路径穿越和隐藏文件。服务没有云端凭据、跨域接口或公网监听能力。
