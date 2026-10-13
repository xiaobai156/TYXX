import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"


class LocalOnlyContractTests(unittest.TestCase):
    def test_only_the_unified_gui_entrypoint_remains(self):
        self.assertEqual(
            sorted(path.name for path in SRC.glob("*_app.py")),
            ["unified_app.py"],
        )

    def test_sources_have_no_cloud_storage_credentials(self):
        source = "\n".join(path.read_text(encoding="utf-8") for path in SRC.glob("*.py")).lower()
        for forbidden in ("supabase", "sb_publishable_", "/rest/v1/", "127.0.0.1:8787"):
            self.assertNotIn(forbidden, source)
        self.assertIn("127.0.0.1:23962", source)


if __name__ == "__main__":
    unittest.main()
