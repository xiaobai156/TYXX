import importlib.util
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
BUILD_SCRIPT = ROOT / "build_exes.py"


class BuildContractTests(unittest.TestCase):
    def test_builds_only_the_unified_entrypoint(self):
        spec = importlib.util.spec_from_file_location("build_exes", BUILD_SCRIPT)
        module = importlib.util.module_from_spec(spec)
        with patch("subprocess.run") as run:
            sys.modules[spec.name] = module
            try:
                spec.loader.exec_module(module)
                module.main()
            finally:
                sys.modules.pop(spec.name, None)

        command = run.call_args.args[0]
        self.assertIn(str(ROOT / "src" / "unified_app.py"), command)
        self.assertNotIn("BUILD_TARGETS", BUILD_SCRIPT.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
