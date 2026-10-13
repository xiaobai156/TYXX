import sys
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from pingte import (  # noqa: E402
    PINGTE_YIXIAO,
    PINGTE_TAIL,
    SHA_LIANG_XIAO,
    build_mode_payloads,
    build_upload_queries,
    fetch_issue_result,
    find_prediction_files,
    parse_prediction_text,
    parse_tail_content,
)


class PingteParsingTests(unittest.TestCase):
    def test_finds_exactly_three_reference_files(self):
        with TemporaryDirectory() as pingte_name, TemporaryDirectory() as kill_name:
            pingte_dir = Path(pingte_name)
            kill_dir = Path(kill_name)
            (pingte_dir / "7.27平特肖.txt").write_text("鼠 A", encoding="utf-8")
            (pingte_dir / "7.27平特尾.txt").write_text("3尾 B", encoding="utf-8")
            (kill_dir / "145期-二肖.txt").write_text("鼠牛 C", encoding="utf-8")

            issue, files = find_prediction_files(pingte_dir, kill_dir)

        self.assertEqual(issue, 145)
        self.assertEqual(set(files), {PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO})

    def test_rejects_duplicate_files(self):
        with TemporaryDirectory() as pingte_name, TemporaryDirectory() as kill_name:
            pingte_dir = Path(pingte_name)
            kill_dir = Path(kill_name)
            (pingte_dir / "A平特肖.txt").write_text("鼠 A", encoding="utf-8")
            (pingte_dir / "B平特肖.txt").write_text("牛 B", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "找到多个"):
                find_prediction_files(pingte_dir, kill_dir)

    def test_parses_tail_variants_and_full_width_digits(self):
        self.assertEqual(parse_tail_content("47尾"), "4尾7尾")
        self.assertEqual(parse_tail_content("4尾7尾"), "4尾7尾")
        self.assertEqual(parse_tail_content("３尾４尾"), "3尾4尾")
        rows = parse_prediction_text("3尾 4尾 如梦一场", PINGTE_TAIL)
        self.assertEqual(rows, [{"content": "3尾4尾", "name": "如梦一场"}])

    def test_stops_at_rankings_and_suffixes_duplicate_names(self):
        rows = parse_prediction_text("鼠 同名\n牛 同名\n排行榜\n虎 不应上传", PINGTE_YIXIAO)

        self.assertEqual(rows, [
            {"content": "鼠", "name": "同名"},
            {"content": "牛", "name": "同名 #2"},
        ])

    def test_all_three_modes_stop_at_tab_separated_ranking_tables(self):
        for mode, content in (
            (PINGTE_YIXIAO, "鼠牛"),
            (PINGTE_TAIL, "3尾4尾"),
            (SHA_LIANG_XIAO, "鼠牛"),
        ):
            with self.subTest(mode=mode):
                text = f"{content}\t有效目录\n内容\t次数\t排名\n{content}\t12\t2"
                self.assertEqual(parse_prediction_text(text, mode), [{
                    "content": content,
                    "name": "有效目录",
                }])

    def test_rejects_invalid_kill_two_content(self):
        with self.assertRaisesRegex(ValueError, "杀两肖格式错误"):
            parse_prediction_text("鼠鼠 重复生肖", SHA_LIANG_XIAO)

    def test_builds_three_queries_and_mode_payloads(self):
        result = {
            "issue": "2026145",
            "zodiacs": ["鼠", "牛", "鼠", "虎", "兔", "龙", "蛇"],
            "numbers": [
                {"number": value, "zodiac": zodiac, "special": index == 6}
                for index, (value, zodiac) in enumerate(zip(
                    ["01", "12", "23", "34", "45", "06", "17"],
                    ["鼠", "牛", "鼠", "虎", "兔", "龙", "蛇"],
                ))
            ],
        }
        queries = build_upload_queries(result)
        predictions = {
            PINGTE_YIXIAO: [{"name": "A", "content": "鼠牛"}],
            PINGTE_TAIL: [{"name": "B", "content": "1尾2尾"}],
            SHA_LIANG_XIAO: [{"name": "C", "content": "鼠牛"}],
        }

        modes = build_mode_payloads(predictions, queries)

        self.assertEqual(queries[PINGTE_YIXIAO], "鼠牛虎兔龙蛇")
        self.assertEqual(queries[PINGTE_TAIL], "1尾2尾3尾4尾5尾6尾7尾")
        self.assertEqual(queries[SHA_LIANG_XIAO], "17")
        self.assertEqual(set(modes), {PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO})

    def test_fetches_the_exact_requested_issue(self):
        payload = {"data": [{
            "expect": "2026145",
            "openCode": "01,12,23,34,45,06,17",
            "zodiac": "鼠,牛,虎,兔,龙,蛇,马",
            "openTime": "2026-07-27",
        }, {
            "expect": "2026146",
            "openCode": "02,13,24,35,46,07,18",
            "zodiac": "牛,虎,兔,龙,蛇,马,羊",
        }]}

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def read(self):
                return json.dumps(payload, ensure_ascii=False).encode("utf-8")

        with patch("pingte.urlopen", return_value=Response()):
            result = fetch_issue_result(2026145)

        self.assertEqual([item["issue"] for item in result], ["2026145"])

    def test_rejects_invalid_prediction_content_before_local_write(self):
        predictions = {
            PINGTE_YIXIAO: [{"name": "A", "content": "鼠X"}],
            PINGTE_TAIL: [{"name": "B", "content": "1尾"}],
            SHA_LIANG_XIAO: [{"name": "C", "content": "鼠牛"}],
        }
        queries = {
            PINGTE_YIXIAO: "鼠牛",
            PINGTE_TAIL: "1尾2尾",
            SHA_LIANG_XIAO: "07",
        }
        with self.assertRaisesRegex(ValueError, "平特一肖"):
            build_mode_payloads(predictions, queries)


if __name__ == "__main__":
    unittest.main()
