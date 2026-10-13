import sys
import unittest
from pathlib import Path


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

from unified_app import self_test  # noqa: E402


class PackagedSelfTestTests(unittest.TestCase):
    def test_unified_entrypoint_has_an_offline_self_test(self):
        self.assertIsNone(self_test())


if __name__ == "__main__":
    unittest.main()
