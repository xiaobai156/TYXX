import sys
import unittest
from pathlib import Path
from unittest.mock import Mock, patch


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from draw_sources import extract_macau_latest, fetch_macau_latest  # noqa: E402


class DrawSourceTests(unittest.TestCase):
    def test_extracts_special_number_zodiac_and_issue(self):
        payload = {
            "expect": "2026150",
            "openCode": "11,04,22,25,44,19,09",
            "zodiac": "猴,兔,雞,馬,豬,鼠,狗",
        }

        self.assertEqual(extract_macau_latest(payload), ("09", "狗", "2026150"))

    def test_rejects_incomplete_or_out_of_range_results(self):
        with self.assertRaisesRegex(RuntimeError, "字段不完整"):
            extract_macau_latest({"expect": "2026150", "openCode": "01,02"})
        with self.assertRaisesRegex(RuntimeError, "字段不正确"):
            extract_macau_latest({
                "expect": "2026150",
                "openCode": "01,02,03,04,05,06,50",
                "zodiac": "鼠,牛,虎,兔,龙,蛇,马",
            })

    def test_fetches_latest_result_from_the_reference_draw_source(self):
        response = Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = [{
            "expect": "2026150",
            "openCode": "11,04,22,25,44,19,09",
            "zodiac": "猴,兔,雞,馬,豬,鼠,狗",
        }]
        with patch("draw_sources.requests.get", return_value=response) as get:
            self.assertEqual(fetch_macau_latest(), ("09", "狗", "2026150"))
        self.assertEqual(get.call_count, 1)


if __name__ == "__main__":
    unittest.main()
