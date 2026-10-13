import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import local_api  # noqa: E402
from local_api import (  # noqa: E402
    LocalLotteryApi,
    LocalApiError,
    MULTI_PROJECT_IDS,
    PROJECT_MODES,
    UploadStateUnknownError,
    build_multi_project_import_document,
)


def sample_modes(project_id):
    return {
        mode_id: {
            "query": "07",
            "entries": [{"name": f"{mode_id}-目录", "content": "测试"}],
        }
        for mode_id in PROJECT_MODES[project_id]
    }


def snapshot_for(project_id, date, modes):
    return {
        "ok": True,
        "snapshot": {
            "project": {"id": project_id, "name": project_id, "modes": []},
            "days": {
                date: {
                    mode_id: {
                        "query": record["query"],
                        "entries": [
                            {**entry, "original": None}
                            for entry in sorted(record["entries"], key=lambda item: item["name"])
                        ],
                    }
                    for mode_id, record in modes.items()
                }
            },
        },
    }


def sample_projects():
    return {project_id: sample_modes(project_id) for project_id in MULTI_PROJECT_IDS}


class MultiFakeRequester:
    def __init__(self, date, projects, write_error=None, mismatch_project=None, malformed_project=None):
        self.date = date
        self.projects = projects
        self.write_error = write_error
        self.mismatch_project = mismatch_project
        self.malformed_project = malformed_project
        self.calls = []

    def __call__(self, method, url, body=None, timeout=30):
        self.calls.append((method, url, body, timeout))
        if url.endswith("/health"):
            return {"ok": True, "database": "ok"}
        if "/import?strategy=merge" in url:
            if self.write_error:
                raise self.write_error
            return {
                "ok": True,
                "projects": 3,
                "days": 3,
                "modes": sum(len(modes) for modes in self.projects.values()),
                "entries": sum(
                    len(record["entries"])
                    for modes in self.projects.values()
                    for record in modes.values()
                ),
            }
        prefix = "/projects/"
        if prefix in url and url.endswith("/snapshot"):
            project_id = url.split(prefix, 1)[1].split("/snapshot", 1)[0]
            if project_id not in self.projects:
                raise AssertionError(f"unexpected project snapshot: {project_id}")
            result = snapshot_for(project_id, self.date, self.projects[project_id])
            if project_id == self.mismatch_project:
                first_mode = PROJECT_MODES[project_id][0]
                result["snapshot"]["days"][self.date][first_mode]["query"] = "49"
            if project_id == self.malformed_project:
                first_mode = PROJECT_MODES[project_id][0]
                result["snapshot"]["days"][self.date][first_mode]["entries"].append("malformed")
            return result
        raise AssertionError(f"unexpected request: {method} {url}")


class ImportDocumentTests(unittest.TestCase):
    def test_builds_three_project_document_in_stable_order_with_seventeen_modes(self):
        projects = sample_projects()

        document = build_multi_project_import_document("2026-07-27", projects)

        self.assertEqual(document["schemaVersion"], 1)
        self.assertEqual(
            [project["id"] for project in document["projects"]],
            list(MULTI_PROJECT_IDS),
        )
        self.assertEqual(sum(len(project["days"]) for project in document["projects"]), 3)
        self.assertEqual(
            sum(len(project["days"][0]["modes"]) for project in document["projects"]),
            17,
        )
        for project_id, project in zip(MULTI_PROJECT_IDS, document["projects"]):
            self.assertEqual(
                [item["id"] for item in project["days"][0]["modes"]],
                list(PROJECT_MODES[project_id]),
            )

    def test_multi_document_requires_exact_three_projects(self):
        projects = sample_projects()
        projects.pop("pingte")
        with self.assertRaisesRegex(ValueError, "项目必须完整"):
            build_multi_project_import_document("2026-07-27", projects)


class LocalApiTests(unittest.TestCase):
    def test_single_project_compatibility_surface_is_removed(self):
        self.assertFalse(hasattr(local_api, "build_import_document"))
        self.assertFalse(hasattr(LocalLotteryApi, "replace_project_day"))

    def test_defaults_to_the_unified_local_port(self):
        api = LocalLotteryApi()

        self.assertEqual(api.base_url, "http://127.0.0.1:23962/api")

    def test_rejects_nonlocal_or_malformed_api_roots(self):
        for url in (
            "https://127.0.0.1:23962/api",
            "http://example.com/api",
            "http://127.0.0.1:23962/other",
            "http://127.0.0.1:23962/api?target=other",
            "http://user:pass@127.0.0.1:23962/api",
        ):
            with self.subTest(url=url), self.assertRaisesRegex(ValueError, "本地 API"):
                LocalLotteryApi(base_url=url)

    def test_replaces_three_projects_with_one_health_one_post_and_three_reads(self):
        projects = sample_projects()
        requester = MultiFakeRequester("2026-07-27", projects)
        api = LocalLotteryApi(requester=requester)

        result = api.replace_projects_day("2026-07-27", projects)

        self.assertFalse(result["recovered"])
        self.assertEqual(sum(call[0] == "GET" and call[1].endswith("/health") for call in requester.calls), 1)
        self.assertEqual(sum(call[0] == "POST" for call in requester.calls), 1)
        self.assertEqual(sum(call[0] == "GET" and call[1].endswith("/snapshot") for call in requester.calls), 3)
        post = next(call for call in requester.calls if call[0] == "POST")
        self.assertEqual([project["id"] for project in post[2]["projects"]], list(MULTI_PROJECT_IDS))
        self.assertEqual(sum(len(mode["entries"]) for project in projects.values() for mode in project.values()), 17)

    def test_multi_project_timeout_recovers_without_reposting(self):
        projects = sample_projects()
        requester = MultiFakeRequester(
            "2026-07-27",
            projects,
            write_error=TimeoutError("connection lost"),
        )
        api = LocalLotteryApi(requester=requester)

        result = api.replace_projects_day("2026-07-27", projects)

        self.assertTrue(result["recovered"])
        self.assertEqual(sum(call[0] == "POST" for call in requester.calls), 1)
        self.assertEqual(sum(call[0] == "GET" and call[1].endswith("/snapshot") for call in requester.calls), 3)

    def test_multi_project_mismatch_is_unknown_state(self):
        projects = sample_projects()
        requester = MultiFakeRequester(
            "2026-07-27",
            projects,
            mismatch_project="dawei_shahao",
        )
        api = LocalLotteryApi(requester=requester)

        with self.assertRaisesRegex(UploadStateUnknownError, "回读校验"):
            api.replace_projects_day("2026-07-27", projects)
        self.assertEqual(sum(call[0] == "POST" for call in requester.calls), 1)
        self.assertEqual(sum(call[0] == "GET" and call[1].endswith("/snapshot") for call in requester.calls), 3)

    def test_multi_project_timeout_with_malformed_extra_entry_is_unknown_state(self):
        projects = sample_projects()
        requester = MultiFakeRequester(
            "2026-07-27",
            projects,
            write_error=TimeoutError("connection lost"),
            malformed_project="dawei_shahao",
        )
        api = LocalLotteryApi(requester=requester)

        with self.assertRaisesRegex(UploadStateUnknownError, "回读校验"):
            api.replace_projects_day("2026-07-27", projects)
        self.assertEqual(sum(call[0] == "POST" for call in requester.calls), 1)
        self.assertEqual(sum(call[0] == "GET" and call[1].endswith("/snapshot") for call in requester.calls), 3)

    def test_multi_project_definite_write_error_is_returned_directly(self):
        projects = sample_projects()
        requester = MultiFakeRequester(
            "2026-07-27",
            projects,
            write_error=LocalApiError("bad document", status=400, definite=True),
        )
        api = LocalLotteryApi(requester=requester)

        with self.assertRaisesRegex(LocalApiError, "bad document"):
            api.replace_projects_day("2026-07-27", projects)
        self.assertEqual(sum(call[0] == "GET" and call[1].endswith("/snapshot") for call in requester.calls), 0)


class RequestJsonTests(unittest.TestCase):
    def test_malformed_http_error_stays_a_definite_local_api_error(self):
        response = Mock(status_code=400, text="not json", reason="Bad Request")
        response.json.side_effect = ValueError("bad json")
        with patch.object(local_api.requests, "request", return_value=response):
            with self.assertRaises(LocalApiError) as caught:
                local_api.request_json("POST", "http://127.0.0.1:23962/api/import", body={})
        self.assertTrue(caught.exception.definite)
        self.assertEqual(caught.exception.status, 400)


if __name__ == "__main__":
    unittest.main()
