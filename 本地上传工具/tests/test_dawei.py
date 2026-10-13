import sys
import unittest
from datetime import datetime
from pathlib import Path
from tempfile import TemporaryDirectory


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from dawei import (  # noqa: E402
    build_mode_payloads,
    expected_txt_file_names,
    load_txt_bundle,
    parse_raw_text,
)


class DaweiParsingTests(unittest.TestCase):
    def test_keeps_v22_single_number_behavior(self):
        self.assertEqual(parse_raw_text("dawei", "13 上错统计")[0], {
            "name": "上错统计", "content": "13", "original": "13 上错统计"
        })
        self.assertEqual(parse_raw_text("shahao", "09 杀号A")[0]["content"], "09")

    def test_multi_number_content_has_priority(self):
        row = parse_raw_text("shahao", "09 号资料 01,02,03")[0]
        self.assertEqual(row["name"], "09 号资料")
        self.assertEqual(row["content"], "01,02,03")

    def test_normalizes_zodiac_and_drops_ranking_block(self):
        text = "鼠雞龍馬豬 繁体目录\n生肖次数排行榜\n龙 127次\n兔蛇狗 不应上传"

        self.assertEqual(parse_raw_text("shengxiao", text), [
            {"name": "繁体目录", "content": "鼠鸡龙马猪", "original": "鼠雞龍馬豬 繁体目录"},
            {"name": "不应上传", "content": "兔蛇狗", "original": "兔蛇狗 不应上传"},
        ])

    def test_all_modes_stop_at_tab_separated_ranking_tables(self):
        for mode, content in (
            ("dawei", "01,02"),
            ("shengxiao", "鼠牛"),
            ("shahao", "09"),
            ("shaxiao", "01,02,03"),
        ):
            with self.subTest(mode=mode):
                text = f"{content}\t有效目录\n内容\t次数\t排名\n{content}\t12\t2"
                self.assertEqual(parse_raw_text(mode, text), [{
                    "name": "有效目录",
                    "content": content,
                    "original": f"{content}\t有效目录",
                }])

    def test_expected_names_and_four_file_loading(self):
        self.assertEqual(expected_txt_file_names(datetime(2026, 5, 28)), [
            "5.28大围.txt", "5.28生肖.txt", "5.28杀数字.txt", "5.28杀五码.txt"
        ])
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            data = {
                "5.28大围.txt": "01,02 大围A",
                "5.28生肖.txt": "鼠牛 生肖A",
                "5.28杀数字.txt": "09 杀号A",
                "5.28杀五码.txt": "01,02,03,04,05 杀五码A",
            }
            for name, text in data.items():
                (folder / name).write_text(text, encoding="utf-8")

            date_str, files, parsed = load_txt_bundle(folder, year=2026)

        self.assertEqual(date_str, "2026-05-28")
        self.assertEqual(set(files), {"dawei", "shengxiao", "shahao", "shaxiao"})
        self.assertEqual(len(parsed), 4)

    def test_rejects_duplicate_mode_file_and_duplicate_directory(self):
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            (folder / "5.28大围.txt").write_text("01 A", encoding="utf-8")
            (folder / "5月28日大围.txt").write_text("02 B", encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "重复文件"):
                load_txt_bundle(folder, year=2026)

        with self.assertRaisesRegex(ValueError, "重复资料名"):
            parse_raw_text("dawei", "01 A\n02 A", reject_duplicates=True)

    def test_builds_atomic_four_mode_payload_with_shared_query(self):
        parsed = {
            "dawei": [{"name": "A", "content": "01", "original": "01 A"}],
            "shengxiao": [{"name": "B", "content": "鼠", "original": "鼠 B"}],
            "shahao": [{"name": "C", "content": "09", "original": "09 C"}],
            "shaxiao": [{"name": "D", "content": "01,02,03,04,05", "original": "01,02,03,04,05 D"}],
        }

        modes = build_mode_payloads(parsed, "09", "狗")

        self.assertEqual(modes["dawei"]["query"], "09")
        self.assertEqual(modes["shahao"]["query"], "09")
        self.assertEqual(modes["shaxiao"]["query"], "09")
        self.assertEqual(modes["shengxiao"]["query"], "狗")

    def test_rejects_invalid_mode_content_before_local_write(self):
        parsed = {
            "dawei": [{"name": "A", "content": "50"}],
            "shengxiao": [{"name": "B", "content": "鼠"}],
            "shahao": [{"name": "C", "content": "09"}],
            "shaxiao": [{"name": "D", "content": "01,02,03,04,05"}],
        }
        with self.assertRaisesRegex(ValueError, "大围.*号码"):
            build_mode_payloads(parsed, "09", "狗")

        parsed["dawei"][0]["content"] = "01"
        parsed["shaxiao"][0]["content"] = "01,50"
        with self.assertRaisesRegex(ValueError, "杀五码.*01-49"):
            build_mode_payloads(parsed, "09", "狗")

    def test_keeps_any_shaxiao_number_count_from_txt(self):
        parsed = {
            "dawei": [{"name": "A", "content": "01"}],
            "shengxiao": [{"name": "B", "content": "鼠"}],
            "shahao": [{"name": "C", "content": "09"}],
            "shaxiao": [{"name": "D", "content": "01"}],
        }

        for name, content in (
            ("D", "01"),
            ("D", "01,02,03"),
            ("D", "01,02,03,04,05,06,07"),
            ("拔树寻根", "01,02"),
        ):
            with self.subTest(name=name, content=content):
                parsed["shaxiao"][0] = {"name": name, "content": content}

                modes = build_mode_payloads(parsed, "09", "狗")

                self.assertEqual(modes["shaxiao"]["entries"][0]["content"], content)


if __name__ == "__main__":
    unittest.main()
