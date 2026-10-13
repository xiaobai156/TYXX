import sys
import base64
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from Crypto.Cipher import AES
from Crypto.Util.Padding import pad


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from jiuxiang import (  # noqa: E402
    MODE_BY_LABEL,
    RESULT_AES_KEY,
    _decrypt_draw_data,
    _parse_draw_payload,
    build_mode_payloads,
    fetch_draw_number,
    load_txt_bundle,
    parse_txt_content,
    read_text,
)


class JiuxiangParsingTests(unittest.TestCase):
    def test_rejects_oversized_txt_before_decoding(self):
        with TemporaryDirectory() as folder_name:
            path = Path(folder_name) / "large.txt"
            path.write_bytes(b"12345")
            with self.assertRaisesRegex(ValueError, "过大"):
                read_text(path, max_bytes=4)

    def test_parses_half_head_current_section_only(self):
        text = "\n".join([
            "===== 当前排行榜 =====",
            "1 2头双 11 五六七八",
            "===== 当期数据 =====",
            "内容 网站名称",
            "1头单 忠不可兼",
            "2头双 五六七八",
        ])

        self.assertEqual(parse_txt_content("shabantou", text), [
            {"content": "1头单", "name": "忠不可兼"},
            {"content": "2头双", "name": "五六七八"},
        ])

    def test_parses_one_wave_and_stops_before_rankings(self):
        text = "内容 名称\n红波 无以言表\n绿波 爱答不理\n内容 次数 排名\n红波 19 1"

        self.assertEqual(parse_txt_content("shayibo", text), [
            {"content": "红波", "name": "无以言表"},
            {"content": "绿波", "name": "爱答不理"},
        ])

    def test_all_modes_stop_at_tab_separated_ranking_tables(self):
        samples = {
            "shabantou": "1头单",
            "shayitou": "1头",
            "shayibo": "红波",
            "shabanbo": "蓝单",
            "shayihe": "03合",
            "shayixiao": "鼠",
            "shayixiao2": "牛",
            "shayiduan": "1段",
            "shayihang": "金行",
            "shayiwei": "1尾",
        }
        for mode, content in samples.items():
            with self.subTest(mode=mode):
                text = f"{content}\t有效目录\n内容\t次数\t排名\n{content}\t12\t2"
                self.assertEqual(parse_txt_content(mode, text), [{
                    "content": content,
                    "name": "有效目录",
                }])

    def test_rejects_invalid_content_duplicate_names_and_query_name(self):
        with self.assertRaisesRegex(ValueError, "无效内容"):
            parse_txt_content("shayihe", "内容 网站名称\n内容 东益散人")
        with self.assertRaisesRegex(ValueError, "目录名重复"):
            parse_txt_content("shayihe", "03合 东益散人\n04合 东益散人")
        with self.assertRaisesRegex(ValueError, "保留目录名"):
            parse_txt_content("shayihe", "03合 __QUERY__")

    def test_all_tail_directories_allow_one_or_two_distinct_tails(self):
        for text, content, name in (
            ("5尾 普通目录", "5尾", "普通目录"),
            ("5尾 3尾 普通目录", "5尾,3尾", "普通目录"),
            ("8尾、1尾 小黄人", "8尾,1尾", "小黄人"),
        ):
            with self.subTest(text=text):
                self.assertEqual(parse_txt_content("shayiwei", text), [{
                    "content": content,
                    "name": name,
                }])

        for text in ("5尾 5尾 重复尾", "5尾 3尾 1尾 三尾目录"):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, "一至两个不同尾数"):
                parse_txt_content("shayiwei", text)

    def test_parses_and_enforces_the_thirty_eight_two_head_directories(self):
        names = (
            "往事如烟", "米津玄师", "兴隆大业", "王报传奇", "彩梦码人", "伯温传世",
            "码王财金", "春水初生", "千方百计", "善良没用", "楚云潇雨", "余味回甘",
            "知小谋大", "囧囧有神", "举世瞩目", "妙不可及", "皇牌富翁", "两全其美",
            "同声同气", "一生所爱", "星河泛滥", "一抹晚霞", "刻苦专研", "毁家纾难",
            "精品秘籍", "千佳万富", "神彩皇牌", "且听且行", "北风呼啸", "算彩才子",
            "金牌好料", "必赢玄机", "地主之谊", "神码透料", "三彩联盟", "财神秘籍",
            "招财神手", "月明如水",
        )
        for name in names:
            with self.subTest(name=name):
                self.assertEqual(parse_txt_content("shayitou", f"0头、1头 {name}"), [{
                    "content": "0头,1头",
                    "name": name,
                }])

        for text, message in (
            ("0头 往事如烟", "两个不同头数"),
            ("0头、0头 往事如烟", "两个不同头数"),
            ("0头、1头 普通目录", "一个头数"),
        ):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, message):
                parse_txt_content("shayitou", text)

    def test_requires_one_file_for_each_of_ten_modes_and_one_issue(self):
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            samples = {
                "半头": "1头单 A",
                "头": "1头 B",
                "一波": "红波 C",
                "半波": "蓝单 D",
                "合": "03合 E",
                "肖": "鼠 F",
                "肖-新增": "牛 G",
                "段": "1段 H",
                "五行": "金行 I",
                "尾": "1尾 J",
            }
            for label, text in samples.items():
                (folder / f"145期-{label}.txt").write_text(text, encoding="utf-8")

            issue, files, parsed = load_txt_bundle(folder)

        self.assertEqual(issue, "145")
        self.assertEqual(set(files), set(MODE_BY_LABEL.values()))
        self.assertEqual(set(parsed), set(MODE_BY_LABEL.values()))

    def test_rejects_duplicate_mode_files_even_in_subfolders(self):
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            (folder / "a").mkdir()
            (folder / "b").mkdir()
            (folder / "a" / "145期-半头.txt").write_text("1头单 A", encoding="utf-8")
            (folder / "b" / "145期-半头.txt").write_text("1头单 B", encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "重复文件"):
                load_txt_bundle(folder)

    def test_builds_all_ten_modes_with_one_draw_number(self):
        parsed = {
            mode_id: [{"name": f"{mode_id}-目录", "content": content}]
            for mode_id, content in {
                "shabantou": "1头单",
                "shayitou": "1头",
                "shayibo": "红波",
                "shabanbo": "蓝单",
                "shayihe": "03合",
                "shayixiao": "鼠",
                "shayixiao2": "牛",
                "shayiduan": "1段",
                "shayihang": "金行",
                "shayiwei": "1尾",
            }.items()
        }

        modes = build_mode_payloads(parsed, "07")

        self.assertEqual(set(modes), set(MODE_BY_LABEL.values()))
        self.assertTrue(all(item["query"] == "07" for item in modes.values()))

    def test_parses_plain_and_encrypted_draw_payloads(self):
        payload = {"number": "11 30 20 19 05 16 42", "te_attr": {"number": "42"}}
        self.assertEqual(_parse_draw_payload(payload), "42")
        self.assertEqual(_parse_draw_payload({"number": "11 30 20 19 05 16 07"}), "07")

        raw = json.dumps(payload).encode("utf-8")
        cipher = AES.new(RESULT_AES_KEY, AES.MODE_CBC, iv=RESULT_AES_KEY)
        encrypted = base64.b64encode(cipher.encrypt(pad(raw, AES.block_size))).decode("ascii")
        self.assertEqual(_decrypt_draw_data(encrypted), payload)

    def test_fetches_draw_number_from_first_working_reference_host(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            "status": 20000,
            "data": {"te_attr": {"number": "42"}},
        }
        with patch("requests.get", return_value=response) as get:
            self.assertEqual(fetch_draw_number(2026), "42")
        self.assertEqual(get.call_count, 1)


if __name__ == "__main__":
    unittest.main()
