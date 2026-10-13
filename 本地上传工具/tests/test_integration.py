import os
import socket
import subprocess
import sys
import time
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


TOOL_ROOT = Path(__file__).resolve().parents[1]
PLATFORM_ROOT = TOOL_ROOT.parent
SRC = TOOL_ROOT / "src"
sys.path.insert(0, str(SRC))

from local_api import (  # noqa: E402
    LocalApiError,
    LocalLotteryApi,
    build_multi_project_import_document,
    request_json,
)


def free_port():
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        return listener.getsockname()[1]


def records(project_id):
    if project_id == "pingte":
        values = {
            "pingteyixiao": ("鼠牛", "鼠"),
            "pingtewei": ("1尾2尾", "1尾"),
            "shaliangxiao": ("07", "鼠牛"),
        }
    elif project_id == "dawei_shahao":
        values = {
            "dawei": ("07", "01,02"),
            "shahao": ("07", "09"),
            "shengxiao": ("鼠", "牛"),
            "shaxiao": ("07", "01,02,03,04,05"),
        }
    else:
        values = {
            "shabantou": ("07", "1头单"),
            "shayitou": ("07", "1头"),
            "shayibo": ("07", "红波"),
            "shabanbo": ("07", "蓝单"),
            "shayihe": ("07", "03合"),
            "shayixiao": ("07", "鼠"),
            "shayixiao2": ("07", "牛"),
            "shayiduan": ("07", "1段"),
            "shayihang": ("07", "金行"),
            "shayiwei": ("07", "1尾"),
        }
    return {
        mode_id: {
            "query": query,
            "entries": [{"name": f"{mode_id}-集成测试", "content": content}],
        }
        for mode_id, (query, content) in values.items()
    }


class TemporaryDatabaseIntegrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp_dir = TemporaryDirectory()
        cls.port = free_port()
        cls.base_url = f"http://127.0.0.1:{cls.port}/api"
        env = os.environ.copy()
        env.update({
            "LOTTERY_PORT": str(cls.port),
            "LOTTERY_DATA_DIR": cls.temp_dir.name,
            "LOTTERY_STATIC_DIR": str(PLATFORM_ROOT),
        })
        creationflags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        cls.server = subprocess.Popen(
            ["node", "server/index.js"],
            cwd=PLATFORM_ROOT,
            env=env,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            creationflags=creationflags,
        )
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            if cls.server.poll() is not None:
                output = cls.server.stdout.read() if cls.server.stdout else ""
                raise RuntimeError(f"temporary server exited: {output}")
            try:
                request_json("GET", f"{cls.base_url}/health", timeout=1)
                break
            except Exception:
                time.sleep(0.1)
        else:
            raise RuntimeError("temporary server did not become healthy")

    @classmethod
    def tearDownClass(cls):
        cls.server.terminate()
        try:
            cls.server.wait(timeout=5)
        except subprocess.TimeoutExpired:
            cls.server.kill()
            cls.server.wait(timeout=5)
        if cls.server.stdout:
            cls.server.stdout.close()
        cls.temp_dir.cleanup()

    def test_three_projects_write_atomically_without_crossing(self):
        upload_date = "2026-07-27"
        api = LocalLotteryApi(base_url=self.base_url)

        projects = {project_id: records(project_id) for project_id in ("jiuxiang", "dawei_shahao", "pingte")}
        result = api.replace_projects_day(upload_date, projects)
        self.assertTrue(result["ok"])

        for project_id in projects:
            day = api.get_snapshot(project_id)["snapshot"]["days"][upload_date]
            self.assertEqual(set(day), set(records(project_id)))

    def test_invalid_cross_project_mode_rolls_back_the_whole_import(self):
        upload_date = "2026-07-28"
        api = LocalLotteryApi(base_url=self.base_url)
        projects = {project_id: records(project_id) for project_id in ("jiuxiang", "dawei_shahao", "pingte")}
        api.replace_projects_day(upload_date, projects)
        before = {project_id: api.get_snapshot(project_id) for project_id in projects}

        bad_document = build_multi_project_import_document(upload_date, projects)
        dawei_modes = bad_document["projects"][1]["days"][0]["modes"]
        dawei_modes[1]["entries"] = [
            {"name": "重复", "content": "01"},
            {"name": "重复", "content": "02"},
        ]
        with self.assertRaises(LocalApiError):
            request_json(
                "POST",
                f"{self.base_url}/import?strategy=merge",
                body=bad_document,
            )

        for project_id in projects:
            self.assertEqual(api.get_snapshot(project_id), before[project_id])


if __name__ == "__main__":
    unittest.main()
