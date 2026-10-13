import sys
import unittest
from pathlib import Path
from tkinter import Tk


SRC = Path(__file__).resolve().parents[1] / "src"
sys.path.insert(0, str(SRC))

import unified_app  # noqa: E402


def widget_texts(widget):
    values = []
    for child in widget.winfo_children():
        text = child.cget("text") if "text" in child.keys() else ""
        if text:
            values.append(text)
        values.extend(widget_texts(child))
    return values


class GuiSmokeTests(unittest.TestCase):
    def test_unified_window_has_one_public_workflow(self):
        root = Tk()
        root.withdraw()
        try:
            app = unified_app.UnifiedLocalUploaderApp(root)
            texts = widget_texts(root)
            self.assertEqual(root.title(), "统一本地上传工具")
            self.assertEqual(texts.count("上传本地"), 1)
            self.assertEqual(texts.count("搜索TXT"), 1)
            self.assertEqual(texts.count("清除TXT"), 1)
            for legacy_clear in ("clear_jiuxiang_txt", "clear_dawei_txt", "clear_pingte_txt"):
                self.assertFalse(hasattr(app, legacy_clear))
        finally:
            root.destroy()


if __name__ == "__main__":
    unittest.main()
