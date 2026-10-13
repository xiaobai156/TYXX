from __future__ import annotations

import os
import re
from urllib.parse import quote

import requests

from common import SYSTEM_QUERY_NAME, validate_iso_date


DEFAULT_BASE_URL = "http://127.0.0.1:23962/api"
PROJECT_MODES = {
    "pingte": ("pingteyixiao", "pingtewei", "shaliangxiao"),
    "dawei_shahao": ("dawei", "shahao", "shengxiao", "shaxiao"),
    "jiuxiang": (
        "shabantou",
        "shayitou",
        "shayibo",
        "shabanbo",
        "shayihe",
        "shayixiao",
        "shayixiao2",
        "shayiduan",
        "shayihang",
        "shayiwei",
    ),
}
MULTI_PROJECT_IDS = ("jiuxiang", "dawei_shahao", "pingte")


class LocalApiError(RuntimeError):
    def __init__(self, message: str, *, status: int | None = None, definite: bool = False):
        super().__init__(message)
        self.status = status
        self.definite = definite


class UploadStateUnknownError(RuntimeError):
    pass


def _normalize_modes(project_id: str, modes: dict) -> dict[str, dict]:
    expected = PROJECT_MODES.get(project_id)
    if expected is None:
        raise ValueError(f"未知项目：{project_id}")
    if not isinstance(modes, dict) or set(modes) != set(expected):
        missing = [mode for mode in expected if mode not in (modes or {})]
        extra = [mode for mode in (modes or {}) if mode not in expected]
        detail = "、".join([*(f"缺少 {mode}" for mode in missing), *(f"多余 {mode}" for mode in extra)])
        raise ValueError(f"项目 {project_id} 的模式必须完整{f'：{detail}' if detail else ''}")

    normalized: dict[str, dict] = {}
    for mode_id in expected:
        record = modes[mode_id]
        if not isinstance(record, dict):
            raise ValueError(f"模式 {mode_id} 数据格式不正确")
        query = str(record.get("query", "")).strip()
        entries = record.get("entries")
        if not query:
            raise ValueError(f"模式 {mode_id} 的 query 不能为空")
        if not isinstance(entries, list) or not entries:
            raise ValueError(f"模式 {mode_id} 至少一条有效资料")
        clean_entries = []
        names: set[str] = set()
        for entry in entries:
            if not isinstance(entry, dict):
                raise ValueError(f"模式 {mode_id} 的目录格式不正确")
            name = str(entry.get("name", "")).strip()
            content = str(entry.get("content", "")).strip()
            if not name or not content:
                raise ValueError(f"模式 {mode_id} 的目录名和内容不能为空")
            if SYSTEM_QUERY_NAME.fullmatch(name):
                raise ValueError(f"目录名 {name} 是系统保留名")
            if name in names:
                raise ValueError(f"模式 {mode_id} 目录名重复：{name}")
            names.add(name)
            clean_entries.append({"name": name, "content": content})
        normalized[mode_id] = {"query": query, "entries": clean_entries}
    return normalized


def build_multi_project_import_document(date: str, projects: dict) -> dict:
    """Build one schema-v1 import document for all local upload projects."""

    upload_date = validate_iso_date(date)
    if not isinstance(projects, dict) or set(projects) != set(MULTI_PROJECT_IDS):
        supplied = set(projects) if isinstance(projects, dict) else set()
        missing = [project_id for project_id in MULTI_PROJECT_IDS if project_id not in supplied]
        extra = [project_id for project_id in supplied if project_id not in MULTI_PROJECT_IDS]
        detail = "、".join([*(f"缺少 {project_id}" for project_id in missing), *(f"多余 {project_id}" for project_id in extra)])
        raise ValueError(f"三个项目必须完整{f'：{detail}' if detail else ''}")

    project_documents = []
    for project_id in MULTI_PROJECT_IDS:
        normalized = _normalize_modes(project_id, projects[project_id])
        project_documents.append({
            "id": project_id,
            "days": [{
                "date": upload_date,
                "modes": [
                    {"id": mode_id, **normalized[mode_id]}
                    for mode_id in PROJECT_MODES[project_id]
                ],
            }],
        })
    return {"schemaVersion": 1, "projects": project_documents}


def request_json(method: str, url: str, body=None, timeout: int = 30) -> dict:
    try:
        response = requests.request(method, url, json=body, timeout=timeout)
    except requests.RequestException as exc:
        raise ConnectionError(f"无法连接本地服务：{exc}") from exc
    if response.status_code >= 400:
        detail = response.text
        try:
            payload = response.json() if detail else {}
        except ValueError:
            payload = {}
        message = payload.get("error") if isinstance(payload, dict) else ""
        raise LocalApiError(
            f"本地服务返回 {response.status_code}：{message or detail or response.reason}",
            status=response.status_code,
            definite=400 <= response.status_code < 500,
        )
    try:
        result = response.json() if response.content else {}
    except ValueError as exc:
        raise LocalApiError("本地服务返回了无效 JSON") from exc
    if not isinstance(result, dict):
        raise LocalApiError("本地服务返回格式不正确")
    return result


def _canonical_entries(entries) -> list[tuple[str, str]]:
    if not isinstance(entries, list):
        raise ValueError("回读 entries 不是数组")
    if any(not isinstance(entry, dict) for entry in entries):
        raise ValueError("回读 entries 包含无效目录")
    return sorted(
        (str(entry.get("name", "")), str(entry.get("content", "")))
        for entry in entries
    )


def verify_snapshot(project_id: str, date: str, modes: dict, response: dict) -> None:
    if not isinstance(response, dict) or response.get("ok") is not True:
        raise ValueError("回读响应无效")
    snapshot = response.get("snapshot")
    if not isinstance(snapshot, dict) or snapshot.get("project", {}).get("id") != project_id:
        raise ValueError("回读项目不一致")
    actual_modes = snapshot.get("days", {}).get(date)
    if not isinstance(actual_modes, dict) or set(actual_modes) != set(PROJECT_MODES[project_id]):
        raise ValueError("回读模式集合不一致")
    for mode_id in PROJECT_MODES[project_id]:
        expected = modes[mode_id]
        actual = actual_modes.get(mode_id)
        if not isinstance(actual, dict) or str(actual.get("query", "")) != expected["query"]:
            raise ValueError(f"回读 {mode_id} query 不一致")
        expected_entries = sorted((item["name"], item["content"]) for item in expected["entries"])
        if _canonical_entries(actual.get("entries")) != expected_entries:
            raise ValueError(f"回读 {mode_id} 目录数据不一致")


class LocalLotteryApi:
    def __init__(self, base_url: str | None = None, requester=request_json):
        self.base_url = base_url or os.environ.get("LOTTERY_LOCAL_API") or DEFAULT_BASE_URL
        match = re.fullmatch(r"http://(?:127\.0\.0\.1|localhost):([0-9]+)/api", self.base_url)
        if match is None or not 1 <= int(match.group(1)) <= 65535:
            raise ValueError("本地 API 地址必须是 http://127.0.0.1:<端口>/api 或 http://localhost:<端口>/api")
        self.requester = requester

    def _request(self, method: str, path: str, body=None, timeout: int = 30):
        return self.requester(method, f"{self.base_url}{path}", body=body, timeout=timeout)

    def health(self) -> None:
        result = self._request("GET", "/health", timeout=5)
        if result.get("ok") is not True or result.get("database") != "ok":
            raise LocalApiError("统一分析平台本地数据库未就绪", definite=True)

    def get_snapshot(self, project_id: str) -> dict:
        return self._request("GET", f"/projects/{quote(project_id, safe='')}/snapshot")

    def replace_projects_day(self, date: str, projects: dict, progress=None) -> dict:
        """Atomically replace all three project days with one POST and verify each readback."""

        document = build_multi_project_import_document(date, projects)
        upload_date = document["projects"][0]["days"][0]["date"]
        normalized_projects = {
            project["id"]: {
                mode["id"]: {"query": mode["query"], "entries": mode["entries"]}
                for mode in project["days"][0]["modes"]
            }
            for project in document["projects"]
        }
        expected_entries = sum(
            len(mode["entries"])
            for modes in normalized_projects.values()
            for mode in modes.values()
        )
        notify = progress or (lambda _message: None)
        notify("正在检查本地服务...")
        self.health()
        notify("正在事务保存 3 个项目、17 个模式...")
        write_error: Exception | None = None
        try:
            result = self._request(
                "POST",
                "/import?strategy=merge",
                body=document,
                timeout=45,
            )
            if (
                result.get("ok") is not True
                or result.get("projects") != 3
                or result.get("days") != 3
                or result.get("modes") != 17
                or result.get("entries") != expected_entries
            ):
                write_error = LocalApiError("本地服务写入响应不完整")
        except LocalApiError as exc:
            if exc.definite:
                raise
            write_error = exc
        except Exception as exc:
            write_error = exc

        notify("正在回读三个项目并逐项校验...")
        readback_error: Exception | None = None
        for project_id in MULTI_PROJECT_IDS:
            try:
                response = self.get_snapshot(project_id)
                verify_snapshot(project_id, upload_date, normalized_projects[project_id], response)
            except Exception as exc:
                readback_error = readback_error or exc
        if readback_error:
            if write_error:
                raise UploadStateUnknownError(
                    "上传请求异常且三个项目回读校验失败，本地状态未知；请勿重复上传，先在统一平台核对当天数据"
                ) from write_error
            raise UploadStateUnknownError(
                "三个项目写入后的回读校验失败；请勿重复上传，先在统一平台核对当天数据"
            ) from readback_error
        return {"ok": True, "recovered": write_error is not None}
