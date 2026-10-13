import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import common  # noqa: E402
from common import clean_entries, delete_exact_txt_files, read_text_file, validate_iso_date  # noqa: E402


class CommonUtilityTests(unittest.TestCase):
    def test_recognizes_count_ranking_headers_with_any_whitespace(self):
        for line in ("内容 次数 排名", "内容\t次数\t排名", "内容　次数　排名", "尾数\t次数"):
            with self.subTest(line=line):
                self.assertTrue(common.is_count_ranking_header(line))
        self.assertFalse(common.is_count_ranking_header("鼠牛 有效目录"))

    def test_reads_utf8_bom_and_gb18030(self):
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            bom = folder / "bom.txt"
            gb = folder / "gb.txt"
            bom.write_bytes("测试BOM".encode("utf-8-sig"))
            gb.write_bytes("繁体目录".encode("gb18030"))
            self.assertEqual(read_text_file(bom), "测试BOM")
            self.assertEqual(read_text_file(gb), "繁体目录")

    def test_rejects_oversized_txt_before_reading_it(self):
        with TemporaryDirectory() as folder_name:
            path = Path(folder_name) / "large.txt"
            path.write_bytes(b"12345")
            with self.assertRaisesRegex(ValueError, "过大"):
                read_text_file(path, max_bytes=4)

    def test_validates_strict_real_dates(self):
        self.assertEqual(validate_iso_date("2026-07-27"), "2026-07-27")
        with self.assertRaisesRegex(ValueError, "YYYY-MM-DD"):
            validate_iso_date("2026/07/27")
        with self.assertRaisesRegex(ValueError, "有效日期"):
            validate_iso_date("2026-02-30")

    def test_deletes_only_the_exact_txt_paths(self):
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            first = folder / "a.txt"
            second = folder / "b.txt"
            keep = folder / "keep.txt"
            first.write_text("a", encoding="utf-8")
            second.write_text("b", encoding="utf-8")
            keep.write_text("keep", encoding="utf-8")

            removed = delete_exact_txt_files([second, first, first])

            self.assertEqual(removed, [first.resolve(), second.resolve()])
            self.assertTrue(keep.exists())

    def test_rejects_non_txt_missing_reserved_and_duplicate_entries(self):
        with TemporaryDirectory() as folder_name:
            binary = Path(folder_name) / "data.bin"
            binary.write_bytes(b"x")
            with self.assertRaisesRegex(ValueError, "非 TXT"):
                delete_exact_txt_files([binary])
            with self.assertRaises(FileNotFoundError):
                delete_exact_txt_files([Path(folder_name) / "missing.txt"])

        self.assertEqual(clean_entries([
            {"name": "", "content": "鼠"},
            {"name": "A", "content": "牛"},
        ]), [{"name": "A", "content": "牛"}])
        with self.assertRaisesRegex(ValueError, "保留目录名"):
            clean_entries([{"name": "__QUERY__", "content": "07"}])
        with self.assertRaisesRegex(ValueError, "目录名重复"):
            clean_entries([
                {"name": "A", "content": "鼠"},
                {"name": "A", "content": "牛"},
            ])


if __name__ == "__main__":
    unittest.main()
