# Unified Platform Agent Tasks

All legacy directories are read-only. Work only under:

`C:\Users\Administrator\Desktop\每天工具\统一分析平台`

Use tests before implementation. Do not add cloud writes, credentials, frameworks, or unrelated features.

## Shared Product Contract

- One browser entry: `统一分析平台.html`.
- One same-origin local Node.js service on `127.0.0.1:23962`.
- One SQLite database, with every business key scoped by `project_id`.
- Project ids: `pingte`, `dawei_shahao`, `jiuxiang`.
- Preserve all 17 current modes and all current analysis pages.
- Old projects remain untouched as behavior references.
- In `dawei_shahao`, `shahao` and `shaxiao` share one query per date. Saving either query must synchronize the sibling mode while their entries remain independent.

## Backend API Contract

- `GET /api/health`
- `GET /api/projects`
- `GET /api/projects/:projectId/snapshot`
- `PUT /api/projects/:projectId/modes/:modeId/dates/:date`
  body: `{ "query": "...", "entries": [{ "name": "...", "content": "...", "original": "..." }] }`
- `DELETE /api/projects/:projectId/dates/:date`
- `DELETE /api/projects/:projectId/modes/:modeId/directories/:name`
- `PATCH /api/projects/:projectId/modes/:modeId/directories/:name`
  body: `{ "newName": "..." }`
- `POST /api/backup`
- `GET /api/export`
- `POST /api/import`

Responses use `{ "ok": true, "data": ... }` or `{ "ok": false, "error": "..." }`.

## Role: legacy_contract

Read all three legacy HTML/assets/tests. Create only `docs/legacy-contract.md`. Document exact pages, modes, source data shapes, system query conventions, scoring/parser differences, shared vs divergent files, and a parity checklist. Do not edit runtime code.

## Role: backend_unified

Create only backend-owned files under `server/` and backend tests under `tests/backend/`. Implement project-scoped SQLite schema, validation, atomic mode replacement, delete/rename, snapshot, import/export, backup, same-origin static serving helpers, and unit/integration tests. Use Node 24 built-ins and `node:sqlite`; no npm runtime dependencies. Do not edit frontend files or package metadata.

## Role: frontend_unified

Create only `统一分析平台.html`, `assets/css/`, `assets/js/`, and frontend tests under `tests/frontend/`. Build a quiet desktop operational UI with project switcher, calendar, workspace, detail analysis, daily stats, one-time filter, data management, loading/empty/error states, accessible controls, and a fetch client matching the API contract. Use vanilla ES modules and retain only local ECharts if needed. Do not edit backend files or package metadata.

## Role: domain_rules

Use `docs/legacy-contract.md` as the source of truth. Create only `assets/js/domain/` and `tests/domain/`. Write failing tests first for PT-01..04, DW-01..05, JX-01..05, SCORE-01, DAY-01, and OT-01 where pure functions are appropriate. Implement shared normalization plus project strategy modules for all 17 mode correctness rules, query validation/type mapping, project-specific missing-day handling, and the two different recent-seven switch metrics. Do not edit the app shell, backend, package metadata, or legacy files. Run the domain tests and report remaining UI/integration gaps.

## Completion Message

Report files changed, tests run, known gaps, and integration assumptions to `/root`.
