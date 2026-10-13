import sys
import threading
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from tkinter import Tk
from tkinter import font as tkfont
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"
sys.path.insert(0, str(SRC))

import local_api  # noqa: E402
import unified_app  # noqa: E402
from dawei import UPLOAD_MODES as DAWEI_MODES  # noqa: E402
from jiuxiang import REQUIRED_MODES as JIUXIANG_MODES  # noqa: E402
from pingte import PINGTE_TAIL, PINGTE_YIXIAO, SHA_LIANG_XIAO  # noqa: E402


def widget_texts(widget):
    values = []
    for child in widget.winfo_children():
        try:
            text = child.cget("text")
        except Exception:
            text = ""
        if text:
            values.append(text)
        values.extend(widget_texts(child))
    return values


def mode_payloads(mode_ids, prefix):
    return {
        mode_id: {
            "query": "07",
            "entries": [{"name": f"{prefix}-{mode_id}", "content": "测试"}],
        }
        for mode_id in mode_ids
    }


def pingte_result(issue="2026145"):
    numbers = ["01", "12", "23", "34", "45", "06", "17"]
    zodiacs = ["鼠", "牛", "鼠", "虎", "兔", "龙", "蛇"]
    return {
        "issue": issue,
        "zodiacs": zodiacs,
        "numbers": [
            {"number": number, "zodiac": zodiac, "special": index == 6}
            for index, (number, zodiac) in enumerate(zip(numbers, zodiacs))
        ],
    }


class FakeApi:
    def __init__(self):
        self.calls = []

    def replace_projects_day(self, date, projects, progress=None):
        self.calls.append((date, projects))
        if progress:
            progress("测试回读完成")
        return {"ok": True, "recovered": False}

class UnifiedAppTests(unittest.TestCase):
    def make_app(self, settings_path=None):
        root = Tk()
        root.withdraw()
        app = unified_app.UnifiedLocalUploaderApp(root, settings_path=settings_path)
        app.run_worker = lambda target: target()
        return root, app

    def test_three_source_cards_show_active_folders_and_selectors(self):
        with TemporaryDirectory() as settings_dir:
            root, app = self.make_app(Path(settings_dir) / "settings.json")
            try:
                self.assertEqual(set(app.folder_buttons), set(unified_app.PROJECT_IDS))
                self.assertEqual(len(app.folder_buttons), 3)
                self.assertEqual(widget_texts(root).count("选择文件夹"), 3)
                for source_id in unified_app.PROJECT_IDS:
                    self.assertIn(str(app.source_folders[source_id]), app.folder_vars[source_id].get())
            finally:
                root.destroy()

    def test_source_cards_keep_all_selectors_visible_at_default_window_size(self):
        with TemporaryDirectory() as settings_dir:
            root, app = self.make_app(Path(settings_dir) / "settings.json")
            try:
                root.deiconify()
                root.geometry("1080x600")
                root.update_idletasks()
                root.update()
                self.assertEqual(len(app.status_cards), 3)
                widths = [card.winfo_width() for card in app.status_cards.values()]
                self.assertLessEqual(max(widths) - min(widths), 20)
                for source_id, card in app.status_cards.items():
                    button = app.folder_buttons[source_id]
                    self.assertTrue(card.winfo_ismapped())
                    self.assertTrue(button.winfo_ismapped())
                    self.assertGreater(button.winfo_width(), 60)
                    self.assertGreaterEqual(button.winfo_rootx(), card.winfo_rootx())
                    self.assertLessEqual(
                        button.winfo_rootx() + button.winfo_width(),
                        card.winfo_rootx() + card.winfo_width(),
                    )
            finally:
                root.destroy()

    def test_folder_selection_persists_and_restores(self):
        with TemporaryDirectory() as settings_dir, TemporaryDirectory() as selected_dir:
            settings_path = Path(settings_dir) / "settings.json"
            selected = Path(selected_dir)
            root, app = self.make_app(settings_path)
            try:
                app.ready = True
                app.upload_button.config(state="normal")
                with patch.object(unified_app.filedialog, "askdirectory", return_value=str(selected)):
                    app.choose_folder("jiuxiang")
                self.assertEqual(app.source_folders["jiuxiang"], selected)
                self.assertTrue(app.source_customized["jiuxiang"])
                self.assertFalse(app.ready)
                self.assertEqual(str(app.upload_button.cget("state")), "disabled")
                payload = json.loads(settings_path.read_text(encoding="utf-8"))
                self.assertEqual(payload["version"], 1)
                self.assertEqual(payload["folders"]["jiuxiang"], str(selected))
                self.assertTrue(payload["customized"]["jiuxiang"])
            finally:
                root.destroy()

            root, restored = self.make_app(settings_path)
            try:
                self.assertEqual(restored.source_folders["jiuxiang"], selected)
                self.assertTrue(restored.source_customized["jiuxiang"])
            finally:
                root.destroy()

    def test_cancelled_folder_selection_preserves_state(self):
        with TemporaryDirectory() as settings_dir:
            settings_path = Path(settings_dir) / "settings.json"
            root, app = self.make_app(settings_path)
            try:
                original = dict(app.source_folders)
                with patch.object(unified_app.filedialog, "askdirectory", return_value=""):
                    app.choose_folder("pingte")
                self.assertEqual(app.source_folders, original)
                self.assertFalse(settings_path.exists())
            finally:
                root.destroy()

    def test_invalid_saved_folders_fall_back_to_defaults(self):
        with TemporaryDirectory() as settings_dir:
            settings_path = Path(settings_dir) / "settings.json"
            settings_path.write_text(
                json.dumps(
                    {
                        "version": 1,
                        "folders": {
                            "jiuxiang": str(Path(settings_dir) / "missing"),
                            "dawei_shahao": str(Path(settings_dir) / "missing-dawei"),
                            "pingte": str(Path(settings_dir) / "missing-pingte"),
                        },
                        "customized": {
                            "jiuxiang": True,
                            "dawei_shahao": True,
                            "pingte": True,
                        },
                    }
                ),
                encoding="utf-8",
            )
            root, app = self.make_app(settings_path)
            try:
                self.assertEqual(app.source_folders["jiuxiang"], unified_app.KILL_TWO_INPUT_DIR)
                self.assertEqual(app.source_folders["dawei_shahao"], unified_app.DAWEI_INPUT_DIR)
                self.assertEqual(app.source_folders["pingte"], unified_app.TXT_INPUT_DIR)
                self.assertFalse(any(app.source_customized.values()))
            finally:
                root.destroy()

    def test_pingte_custom_folder_uses_one_directory_for_all_inputs(self):
        root, app = self.make_app()
        with TemporaryDirectory() as selected_dir:
            selected = Path(selected_dir)
            files = {
                PINGTE_YIXIAO: selected / "平特肖.txt",
                PINGTE_TAIL: selected / "平特尾.txt",
                SHA_LIANG_XIAO: selected / "145期-二肖.txt",
            }
            snapshot = {
                "folders": {"jiuxiang": unified_app.KILL_TWO_INPUT_DIR, "dawei_shahao": unified_app.DAWEI_INPUT_DIR, "pingte": selected},
                "customized": {"jiuxiang": False, "dawei_shahao": False, "pingte": True},
            }
            with (
                patch.object(unified_app, "find_prediction_files", return_value=(145, files)) as finder,
                patch.object(unified_app, "load_prediction_file", return_value=[]),
                patch.object(unified_app, "fetch_issue_result", return_value=[pingte_result()]),
                patch.object(unified_app, "build_upload_queries", return_value={PINGTE_YIXIAO: "鼠牛", PINGTE_TAIL: "1尾2尾", SHA_LIANG_XIAO: "07"}),
                patch.object(unified_app, "build_pingte_mode_payloads", return_value=mode_payloads((PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO), "平特")),
            ):
                try:
                    app._prepare_pingte(snapshot)
                    self.assertEqual(finder.call_args.args, (selected, selected))
                finally:
                    root.destroy()

    def test_pingte_default_search_keeps_split_input_roots(self):
        root, app = self.make_app()
        files = {
            PINGTE_YIXIAO: Path("平特肖.txt"),
            PINGTE_TAIL: Path("平特尾.txt"),
            SHA_LIANG_XIAO: Path("145期-二肖.txt"),
        }
        with (
            patch.object(unified_app, "find_prediction_files", return_value=(145, files)) as finder,
            patch.object(unified_app, "load_prediction_file", return_value=[]),
            patch.object(unified_app, "fetch_issue_result", return_value=[pingte_result()]),
            patch.object(unified_app, "build_upload_queries", return_value={PINGTE_YIXIAO: "鼠牛", PINGTE_TAIL: "1尾2尾", SHA_LIANG_XIAO: "07"}),
            patch.object(unified_app, "build_pingte_mode_payloads", return_value=mode_payloads((PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO), "平特")),
        ):
            try:
                app._prepare_pingte()
                self.assertEqual(finder.call_args.args, (unified_app.TXT_INPUT_DIR, unified_app.KILL_TWO_INPUT_DIR))
            finally:
                root.destroy()

    def test_custom_jiuxiang_clear_scope_is_only_selected_folder(self):
        root, app = self.make_app()
        with TemporaryDirectory() as selected_dir, TemporaryDirectory() as legacy_dir:
            selected = Path(selected_dir)
            legacy = Path(legacy_dir)
            selected_file = selected / "selected.txt"
            legacy_file = legacy / "legacy.txt"
            selected_file.write_text("delete", encoding="utf-8")
            legacy_file.write_text("keep", encoding="utf-8")
            app.source_folders["jiuxiang"] = selected
            app.source_customized["jiuxiang"] = True
            with (
                patch.object(unified_app, "TXT_CLEAR_ROOTS", (legacy,)),
                patch.object(unified_app.messagebox, "askyesno", return_value=True),
                patch.object(unified_app.messagebox, "showinfo"),
            ):
                try:
                    app.clear_all_txt()
                    self.assertFalse(selected_file.exists())
                    self.assertTrue(legacy_file.exists())
                finally:
                    root.destroy()

    def test_search_uses_snapshot_captured_before_folder_changes(self):
        root, app = self.make_app()
        pending = []
        app.run_worker = lambda target: pending.append(target)
        with TemporaryDirectory() as selected_dir:
            selected = Path(selected_dir)
            captured = []
            results = (
                ("2026-07-27", {}, {}, "07", {}),
                ("2026-07-27", {}, {}, "09", "狗", "2026150", {}),
                (145, {}, {}, {}, {}, "2026145"),
            )
            def record(index):
                def _prepare(snapshot):
                    captured.append(snapshot)
                    return results[index]
                return _prepare

            with patch.object(app, "_prepare_jiuxiang", side_effect=record(0)), patch.object(app, "_prepare_dawei", side_effect=record(1)), patch.object(app, "_prepare_pingte", side_effect=record(2)):
                try:
                    app.search_all_txt()
                    app.source_folders["pingte"] = selected
                    app.source_customized["pingte"] = True
                    pending[0]()
                    self.assertEqual(len(captured), 3)
                    self.assertTrue(all(snapshot["folders"]["pingte"] == unified_app.TXT_INPUT_DIR for snapshot in captured))
                    self.assertTrue(all(snapshot["customized"]["pingte"] is False for snapshot in captured))
                finally:
                    root.destroy()

    def test_folder_selectors_disable_during_search(self):
        root, app = self.make_app()
        pending = []
        app.run_worker = lambda target: pending.append(target)
        try:
            app.search_all_txt()
            self.assertEqual(len(pending), 1)
            self.assertTrue(all(str(button.cget("state")) == "disabled" for button in app.folder_buttons.values()))
        finally:
            root.destroy()

    def test_settings_save_failure_does_not_apply_folder(self):
        with TemporaryDirectory() as settings_dir, TemporaryDirectory() as selected_dir:
            root, app = self.make_app(Path(settings_dir) / "settings.json")
            try:
                original = app.source_folders["dawei_shahao"]
                with (
                    patch.object(unified_app.filedialog, "askdirectory", return_value=selected_dir),
                    patch.object(app, "_save_settings", side_effect=OSError("read-only")),
                    patch.object(unified_app.messagebox, "showerror") as showerror,
                ):
                    app.choose_folder("dawei_shahao")
                self.assertEqual(app.source_folders["dawei_shahao"], original)
                self.assertFalse(app.source_customized["dawei_shahao"])
                showerror.assert_called_once()
            finally:
                root.destroy()

    def test_unified_window_is_flat_with_one_search_and_one_upload(self):
        root, app = self.make_app()
        try:
            texts = widget_texts(root)
            self.assertEqual(root.title(), "统一本地上传工具")
            self.assertFalse(hasattr(app, "notebook"))
            self.assertNotIn("Notebook", " ".join(type(child).__name__ for child in root.winfo_children()))
            self.assertEqual(texts.count("上传本地"), 1)
            self.assertEqual(texts.count("搜索TXT"), 1)
            self.assertEqual(texts.count("清除TXT"), 1)
            self.assertNotIn("搜索全部TXT", texts)
            self.assertFalse(any(text in texts for text in ("清除九项TXT", "清除大围TXT", "清除平特TXT")))
            self.assertEqual(root.cget("bg"), unified_app.DARK_BG)
            self.assertEqual(app.clear_button.cget("bg"), unified_app.CLEAR_RED)
            self.assertTrue(all(hasattr(app, name) for name in (
                "jiuxiang_status_var", "dawei_status_var", "pingte_status_var", "log_box",
            )))
        finally:
            root.destroy()

    def test_default_window_is_compact_and_uses_larger_readable_fonts(self):
        root, app = self.make_app()
        try:
            root.update_idletasks()
            width, height = (int(value) for value in root.geometry().split("+")[0].split("x"))
            self.assertLessEqual(height, 620)
            self.assertGreaterEqual(width, 1000)
            self.assertEqual(root.resizable(), (1, 1))
            self.assertGreaterEqual(tkfont.Font(root=root, font=app.search_button.cget("font")).cget("size"), 15)
            self.assertGreaterEqual(tkfont.Font(root=root, font=app.log_box.cget("font")).cget("size"), 12)
        finally:
            root.destroy()

    def test_default_window_is_centered(self):
        root, _app = self.make_app()
        try:
            root.update_idletasks()
            geometry = root.geometry()
            size, x, y = geometry.split("+")
            width, height = (int(value) for value in size.split("x"))
            self.assertEqual(int(x), max(0, (root.winfo_screenwidth() - width) // 2))
            self.assertEqual(int(y), max(0, (root.winfo_screenheight() - height) // 2))
        finally:
            root.destroy()

    def test_one_clear_button_deletes_all_three_scopes_with_one_confirmation(self):
        root, app = self.make_app()
        with TemporaryDirectory() as jiuxiang_root_name, TemporaryDirectory() as dawei_root_name, TemporaryDirectory() as pingte_root_name:
            jiuxiang_root = Path(jiuxiang_root_name)
            dawei_root = Path(dawei_root_name)
            pingte_root = Path(pingte_root_name)
            jiuxiang_file = jiuxiang_root / "九项.txt"
            dawei_file = dawei_root / "大围.txt"
            pingte_file = pingte_root / "平特.txt"
            keep_file = jiuxiang_root / "保留.json"
            for path in (jiuxiang_file, dawei_file, pingte_file):
                path.write_text("delete", encoding="utf-8")
            keep_file.write_text("keep", encoding="utf-8")
            app.ready = True
            app.dawei_files = {"dawei": dawei_file}
            app.pingte_files = {"pingte": pingte_file}
            with (
                patch.object(unified_app, "TXT_CLEAR_ROOTS", (jiuxiang_root,)),
                patch.object(unified_app.messagebox, "askyesno", return_value=True) as askyesno,
                patch.object(unified_app.messagebox, "showinfo"),
            ):
                try:
                    app.clear_all_txt()
                    askyesno.assert_called_once()
                    self.assertFalse(app.ready)
                    self.assertFalse(jiuxiang_file.exists())
                    self.assertFalse(dawei_file.exists())
                    self.assertFalse(pingte_file.exists())
                    self.assertTrue(keep_file.exists())
                finally:
                    root.destroy()

    def test_clear_scan_and_deletion_are_dispatched_off_the_ui_thread(self):
        root, app = self.make_app()
        pending = []
        app.run_worker = lambda target: pending.append(target)
        with TemporaryDirectory() as folder_name:
            path = Path(folder_name) / "delete.txt"
            path.write_text("delete", encoding="utf-8")
            app.ready = True
            with (
                patch.object(app, "_all_clear_targets", return_value=[path]),
                patch.object(unified_app.messagebox, "askyesno", return_value=True),
                patch.object(unified_app.messagebox, "showinfo"),
            ):
                try:
                    app.clear_all_txt()
                    self.assertTrue(path.exists())
                    self.assertEqual(len(pending), 1)
                    self.assertEqual(str(app.search_button.cget("state")), "disabled")
                    self.assertEqual(str(app.clear_button.cget("state")), "disabled")
                    self.assertTrue(all(str(button.cget("state")) == "disabled" for button in app.folder_buttons.values()))

                    pending.pop(0)()
                    self.assertTrue(path.exists())
                    self.assertEqual(len(pending), 1)

                    pending.pop(0)()
                    root.update()
                    self.assertFalse(path.exists())
                    self.assertFalse(app.ready)
                    self.assertEqual(str(app.search_button.cget("state")), "normal")
                    self.assertTrue(all(str(button.cget("state")) == "normal" for button in app.folder_buttons.values()))
                finally:
                    root.destroy()

    def test_search_prepares_three_sources_in_parallel(self):
        root, app = self.make_app()
        barrier = threading.Barrier(3)

        def synchronized(value):
            barrier.wait(timeout=0.5)
            return value

        jiuxiang_payloads = mode_payloads(JIUXIANG_MODES, "九项")
        dawei_payloads = mode_payloads(DAWEI_MODES, "大围")
        pingte_payloads = mode_payloads((PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO), "平特")
        app._search_generation = 1
        with (
            patch.object(unified_app, "load_jiuxiang_bundle", side_effect=lambda *_: synchronized(("2026-07-27", {}, {}))),
            patch.object(unified_app, "fetch_draw_number", return_value="07"),
            patch.object(unified_app, "build_jiuxiang_mode_payloads", return_value=jiuxiang_payloads),
            patch.object(unified_app, "load_dawei_bundle", side_effect=lambda *_: synchronized(("2026-07-27", {}, {}))),
            patch.object(unified_app, "fetch_macau_latest", return_value=("09", "狗", "2026150")),
            patch.object(unified_app, "build_dawei_mode_payloads", return_value=dawei_payloads),
            patch.object(
                unified_app,
                "find_prediction_files",
                side_effect=lambda *_: synchronized((145, {
                    PINGTE_YIXIAO: Path("平特肖.txt"),
                    PINGTE_TAIL: Path("平特尾.txt"),
                    SHA_LIANG_XIAO: Path("145期-二肖.txt"),
                })),
            ),
            patch.object(unified_app, "load_prediction_file", return_value=[]),
            patch.object(unified_app, "fetch_issue_result", return_value=[pingte_result()]),
            patch.object(unified_app, "build_upload_queries", return_value={PINGTE_YIXIAO: "鼠牛", PINGTE_TAIL: "1尾2尾", SHA_LIANG_XIAO: "07"}),
            patch.object(unified_app, "build_pingte_mode_payloads", return_value=pingte_payloads),
            patch.object(unified_app.messagebox, "showerror"),
        ):
            try:
                app._search_worker(1)
                root.update()
                self.assertTrue(app.ready)
                self.assertEqual(app.date_var.get(), "2026-07-27")
            finally:
                root.destroy()

    def test_search_prepares_all_sources_and_one_upload_posts_three_projects(self):
        root, app = self.make_app()
        fake_api = FakeApi()
        app.api = fake_api
        jiuxiang_payloads = mode_payloads(JIUXIANG_MODES, "九项")
        dawei_payloads = mode_payloads(DAWEI_MODES, "大围")
        pingte_payloads = mode_payloads((PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO), "平特")
        with (
            patch.object(
                unified_app,
                "load_jiuxiang_bundle",
                return_value=("2026-07-27", {mode: object() for mode in JIUXIANG_MODES}, {mode: [] for mode in JIUXIANG_MODES}),
            ),
            patch.object(unified_app, "fetch_draw_number", side_effect=["07", "08"]),
            patch.object(unified_app, "build_jiuxiang_mode_payloads", return_value=jiuxiang_payloads),
            patch.object(
                unified_app,
                "load_dawei_bundle",
                return_value=("2026-07-27", {mode: object() for mode in DAWEI_MODES}, {mode: [] for mode in DAWEI_MODES}),
            ),
            patch.object(unified_app, "fetch_macau_latest", return_value=("09", "狗", "2026150")),
            patch.object(unified_app, "build_dawei_mode_payloads", return_value=dawei_payloads),
            patch.object(
                unified_app,
                "find_prediction_files",
                return_value=(145, {
                    PINGTE_YIXIAO: Path("平特肖.txt"),
                    PINGTE_TAIL: Path("平特尾.txt"),
                    SHA_LIANG_XIAO: Path("145期-二肖.txt"),
                }),
            ),
            patch.object(unified_app, "load_prediction_file", return_value=[]),
            patch.object(unified_app, "fetch_issue_result", return_value=[pingte_result()]),
            patch.object(unified_app, "build_upload_queries", return_value={PINGTE_YIXIAO: "鼠牛", PINGTE_TAIL: "1尾2尾", SHA_LIANG_XIAO: "07"}),
            patch.object(unified_app, "build_pingte_mode_payloads", return_value=pingte_payloads),
            patch.object(unified_app.messagebox, "askyesno", return_value=True),
            patch.object(unified_app.messagebox, "showinfo"),
            patch.object(unified_app.messagebox, "showerror") as showerror,
        ):
            try:
                app.search_all_txt()
                root.update()
                self.assertTrue(app.ready)
                self.assertEqual(app.date_var.get(), "2026-07-27")
                app.upload_local()
                root.update()
                self.assertFalse(showerror.called)
                self.assertEqual(len(fake_api.calls), 1)
                upload_date, projects = fake_api.calls[0]
                self.assertEqual(upload_date, "2026-07-27")
                self.assertEqual(set(projects), {"jiuxiang", "dawei_shahao", "pingte"})
                self.assertEqual(list(projects), ["jiuxiang", "dawei_shahao", "pingte"])
                self.assertEqual(projects["jiuxiang"], jiuxiang_payloads)
                self.assertEqual(projects["dawei_shahao"], dawei_payloads)
                self.assertEqual(projects["pingte"], pingte_payloads)
            finally:
                root.destroy()

    def test_search_failure_clears_stale_readiness_and_clear_invalidates_all(self):
        root, app = self.make_app()
        with TemporaryDirectory() as folder_name:
            folder = Path(folder_name)
            dawei_file = folder / "7.27大围.txt"
            dawei_file.write_text("keep", encoding="utf-8")
            try:
                app.ready = True
                app.upload_button.config(state="normal")
                with (
                    patch.object(unified_app, "load_jiuxiang_bundle", side_effect=RuntimeError("bad TXT")),
                    patch.object(app, "_prepare_dawei", return_value=("2026-07-27", {}, {}, "09", "狗", "2026150", {})),
                    patch.object(app, "_prepare_pingte", return_value=(145, {}, {}, {}, {}, "2026145")),
                    patch.object(unified_app.messagebox, "showerror"),
                ):
                    app.search_all_txt()
                root.update()
                self.assertFalse(app.ready)
                self.assertEqual(str(app.upload_button.cget("state")), "disabled")
                self.assertEqual(str(app.search_button.cget("state")), "normal")
                self.assertEqual(str(app.clear_button.cget("state")), "normal")

                app.ready = True
                app.upload_button.config(state="normal")
                app.dawei_files = {"dawei": dawei_file}
                with (
                    patch.object(app, "_all_clear_targets", return_value=[dawei_file]),
                    patch.object(unified_app.messagebox, "askyesno", return_value=True),
                    patch.object(unified_app.messagebox, "showinfo"),
                ):
                    app.clear_all_txt()
                self.assertFalse(dawei_file.exists())
                self.assertFalse(app.ready)
                self.assertEqual(str(app.upload_button.cget("state")), "disabled")
            finally:
                root.destroy()

    def test_search_disables_all_conflicting_controls_until_worker_finishes(self):
        root, app = self.make_app()
        pending = []
        app.run_worker = lambda target: pending.append(target)
        try:
            app.search_all_txt()
            self.assertEqual(len(pending), 1)
            self.assertEqual(str(app.search_button.cget("state")), "disabled")
            self.assertEqual(str(app.upload_button.cget("state")), "disabled")
            self.assertEqual(str(app.clear_button.cget("state")), "disabled")
        finally:
            root.destroy()

    def test_upload_uses_immutable_prepared_snapshot_and_restores_controls(self):
        root, app = self.make_app()
        pending = []
        fake_api = FakeApi()
        app.api = fake_api
        app.ready = True
        app.date_var.set("2026-07-27")
        jiuxiang_payloads = mode_payloads(JIUXIANG_MODES, "九项")
        dawei_payloads = mode_payloads(DAWEI_MODES, "大围")
        pingte_payloads = mode_payloads((PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO), "平特")
        app.jiuxiang_parsed = {"prepared": "original"}
        app.dawei_modes = dawei_payloads
        app.pingte_modes = pingte_payloads
        app.run_worker = lambda target: pending.append(target)
        with (
            patch.object(unified_app.messagebox, "askyesno", return_value=True),
            patch.object(unified_app.messagebox, "showinfo"),
            patch.object(unified_app.messagebox, "showerror"),
            patch.object(unified_app, "fetch_draw_number", return_value="08"),
            patch.object(unified_app, "build_jiuxiang_mode_payloads", return_value=jiuxiang_payloads),
        ):
            try:
                app.upload_button.config(state="normal")
                app.upload_local()
                self.assertEqual(len(pending), 1)
                self.assertEqual(str(app.search_button.cget("state")), "disabled")
                self.assertEqual(str(app.upload_button.cget("state")), "disabled")
                self.assertEqual(str(app.clear_button.cget("state")), "disabled")
                self.assertTrue(all(str(button.cget("state")) == "disabled" for button in app.folder_buttons.values()))
                app.dawei_modes["dawei"]["query"] = "MUTATED"
                pending[0]()
                uploaded = fake_api.calls[0][1]
                self.assertEqual(uploaded["dawei_shahao"]["dawei"]["query"], "07")
                self.assertEqual(str(app.search_button.cget("state")), "normal")
                self.assertEqual(str(app.upload_button.cget("state")), "normal")
                self.assertEqual(str(app.clear_button.cget("state")), "normal")
                self.assertTrue(all(str(button.cget("state")) == "normal" for button in app.folder_buttons.values()))
            finally:
                root.destroy()

    def test_cancelled_or_empty_clear_preserves_prepared_state(self):
        root, app = self.make_app()
        try:
            app.ready = True
            app.dawei_modes = {"prepared": "state"}
            generation = app._search_generation
            with (
                patch.object(app, "_all_clear_targets", return_value=[]),
                patch.object(unified_app.messagebox, "showinfo"),
            ):
                app.clear_all_txt()
            self.assertTrue(app.ready)
            self.assertEqual(app.dawei_modes, {"prepared": "state"})
            self.assertEqual(app._search_generation, generation)

            with TemporaryDirectory() as folder_name:
                path = Path(folder_name) / "recognized.txt"
                path.write_text("keep", encoding="utf-8")
                with (
                    patch.object(app, "_all_clear_targets", return_value=[path]),
                    patch.object(unified_app.messagebox, "askyesno", return_value=False),
                ):
                    app.clear_all_txt()
                self.assertTrue(app.ready)
                self.assertEqual(app.dawei_modes, {"prepared": "state"})
                self.assertTrue(path.exists())
                self.assertEqual(app._search_generation, generation)
        finally:
            root.destroy()

    def test_confirmed_clear_invalidates_stale_search_completion(self):
        root, app = self.make_app()
        pending = []
        app.run_worker = lambda target: pending.append(target)
        with TemporaryDirectory() as folder_name:
            path = Path(folder_name) / "recognized.txt"
            path.write_text("delete", encoding="utf-8")
            try:
                app.search_all_txt()
                stale_generation = app._search_generation
                with (
                    patch.object(app, "_all_clear_targets", return_value=[path]),
                    patch.object(unified_app.messagebox, "askyesno", return_value=True),
                    patch.object(unified_app.messagebox, "showinfo"),
                ):
                    app.clear_all_txt()
                    pending[1]()
                    pending[2]()
                self.assertFalse(app.ready)
                self.assertGreater(app._search_generation, stale_generation)
                self.assertFalse(path.exists())

                with (
                    patch.object(unified_app, "load_jiuxiang_bundle", return_value=("2026-07-27", {}, {})),
                    patch.object(unified_app, "fetch_draw_number", return_value="07"),
                    patch.object(unified_app, "build_jiuxiang_mode_payloads", return_value=mode_payloads(JIUXIANG_MODES, "九项")),
                    patch.object(unified_app, "load_dawei_bundle", return_value=("2026-07-27", {}, {})),
                    patch.object(unified_app, "fetch_macau_latest", return_value=("09", "狗", "2026150")),
                    patch.object(unified_app, "build_dawei_mode_payloads", return_value=mode_payloads(DAWEI_MODES, "大围")),
                    patch.object(
                        unified_app,
                        "find_prediction_files",
                        return_value=(145, {
                            PINGTE_YIXIAO: Path("pingte-xiao.txt"),
                            PINGTE_TAIL: Path("pingte-tail.txt"),
                            SHA_LIANG_XIAO: Path("pingte-kill.txt"),
                        }),
                    ),
                    patch.object(unified_app, "load_prediction_file", return_value=[]),
                    patch.object(unified_app, "fetch_issue_result", return_value=[pingte_result()]),
                    patch.object(unified_app, "build_upload_queries", return_value={PINGTE_YIXIAO: "鼠牛", PINGTE_TAIL: "1尾2尾", SHA_LIANG_XIAO: "07"}),
                    patch.object(unified_app, "build_pingte_mode_payloads", return_value=mode_payloads((PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO), "平特")),
                ):
                    pending[0]()
                self.assertFalse(app.ready)
            finally:
                root.destroy()

    def test_upload_error_invalidates_prepared_state(self):
        root, app = self.make_app()
        try:
            app.ready = True
            app.upload_button.config(state="normal")
            app.date_var.set("2026-07-27")
            with (
                patch.object(unified_app.messagebox, "askyesno", return_value=True),
                patch.object(unified_app.messagebox, "showerror"),
                patch.object(unified_app, "fetch_draw_number", side_effect=RuntimeError("draw unavailable")),
            ):
                app.upload_local()
            self.assertFalse(app.ready)
            self.assertEqual(str(app.upload_button.cget("state")), "disabled")
        finally:
            root.destroy()

    def test_constructor_invariants_and_clear_roots_remain_exact(self):
        self.assertEqual(
            unified_app.DAWEI_INPUT_DIR,
            Path(r"C:\Users\Administrator\Desktop\每天工具\爬虫合集\大围杀号生肖数据统一归纳"),
        )
        self.assertEqual(unified_app.TXT_INPUT_DIR, unified_app.DAWEI_INPUT_DIR)
        self.assertEqual(
            unified_app.KILL_TWO_INPUT_DIR,
            Path(r"C:\Users\Administrator\Desktop\每天工具\爬虫合集\七类数据统一归纳"),
        )
        self.assertEqual(
            unified_app.TXT_CLEAR_ROOTS,
            (
                Path(r"C:\Users\Administrator\Desktop\每天工具\数据系列"),
                Path(r"C:\Users\Administrator\Desktop\每天工具\爬虫合集"),
            ),
        )
        self.assertEqual(unified_app.LOCAL_API_URL, "http://127.0.0.1:23962/api")
        self.assertEqual(unified_app.PROJECT_IDS, ("jiuxiang", "dawei_shahao", "pingte"))

    def test_unified_self_test_is_offline_and_returns_none(self):
        with patch.object(local_api, "request_json", side_effect=AssertionError("network called")):
            self.assertIsNone(unified_app.self_test())


if __name__ == "__main__":
    unittest.main()
