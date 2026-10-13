from __future__ import annotations

import copy
import json
import os
import sys
import tempfile
import threading
import tkinter as tk
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path
from tkinter import filedialog, messagebox, scrolledtext

from common import validate_iso_date
from dawei import (
    UPLOAD_MODES as DAWEI_MODES,
    build_mode_payloads as build_dawei_mode_payloads,
    load_txt_bundle as load_dawei_bundle,
)
from draw_sources import fetch_macau_latest
from jiuxiang import (
    REQUIRED_MODES as JIUXIANG_MODES,
    build_mode_payloads as build_jiuxiang_mode_payloads,
    fetch_draw_number,
    load_txt_bundle as load_jiuxiang_bundle,
)
from local_api import (
    DEFAULT_BASE_URL as LOCAL_API_URL,
    MULTI_PROJECT_IDS as PROJECT_IDS,
    LocalLotteryApi,
    build_multi_project_import_document,
)
from pingte import (
    PINGTE_TAIL,
    PINGTE_YIXIAO,
    SHA_LIANG_XIAO,
    build_mode_payloads as build_pingte_mode_payloads,
    build_upload_queries,
    fetch_issue_result,
    find_prediction_files,
    load_prediction_file,
)
APP_TITLE = "统一本地上传工具"
SETTINGS_VERSION = 1
SETTINGS_FILENAME = f"{APP_TITLE}.settings.json"
DAWEI_INPUT_DIR = Path(r"C:\Users\Administrator\Desktop\每天工具\爬虫合集\大围杀号生肖数据统一归纳")
TXT_INPUT_DIR = DAWEI_INPUT_DIR
KILL_TWO_INPUT_DIR = Path(r"C:\Users\Administrator\Desktop\每天工具\爬虫合集\七类数据统一归纳")
TXT_CLEAR_ROOTS = (
    Path(r"C:\Users\Administrator\Desktop\每天工具\数据系列"),
    Path(r"C:\Users\Administrator\Desktop\每天工具\爬虫合集"),
)
UPLOAD_MODES = (
    ("九项/TXT", "jiuxiang"),
    ("大围四模式", "dawei_shahao"),
    ("平特三模式", "pingte"),
)


DARK_BG = "#17191f"
DARK_PANEL = "#23262d"
DARK_INPUT = "#111318"
DARK_TEXT = "#f2f4f7"
DARK_MUTED = "#aeb6c2"
DARK_BORDER = "#3a414d"
SEARCH_BLUE = "#1976d2"
UPLOAD_GREEN = "#35a313"
CLEAR_RED = "#d83b3b"


class UnifiedLocalUploaderApp:
    """One-page controller for preparing and atomically uploading all sources."""

    def __init__(self, root: tk.Tk, settings_path: Path | None = None):
        self.root = root
        self.root.title(APP_TITLE)
        x = max(0, (self.root.winfo_screenwidth() - 1080) // 2)
        y = max(0, (self.root.winfo_screenheight() - 600) // 2)
        self.root.geometry(f"1080x600+{x}+{y}")
        self.root.minsize(1000, 540)
        self.root.resizable(True, True)
        self.root.configure(bg=DARK_BG)
        self.api = LocalLotteryApi()
        self.upload_lock = threading.Lock()
        self._search_generation = 0
        self.folder_buttons = {}
        self.folder_vars = {}
        self.settings_path = Path(settings_path) if settings_path is not None else self._default_settings_path()
        self.source_folders = {
            "jiuxiang": KILL_TWO_INPUT_DIR,
            "dawei_shahao": DAWEI_INPUT_DIR,
            "pingte": TXT_INPUT_DIR,
        }
        self.source_customized = {source_id: False for source_id in PROJECT_IDS}
        self._load_settings()

        self.date_var = tk.StringVar(master=self.root, value=date.today().isoformat())
        self.jiuxiang_status_var = tk.StringVar(master=self.root, value="未搜索")
        self.dawei_status_var = tk.StringVar(master=self.root, value="未搜索")
        self.pingte_status_var = tk.StringVar(master=self.root, value="未搜索")
        self.ready = False
        self._reset_prepared_state()

        self._build_ui()
        self.log(f"大围文件夹：{self.source_folders['dawei_shahao']}")
        if self.source_customized["pingte"]:
            self.log(f"平特三模式文件夹：{self.source_folders['pingte']}")
        else:
            self.log(f"平特肖文件夹：{TXT_INPUT_DIR}")
            self.log(f"平特杀两肖文件夹：{KILL_TWO_INPUT_DIR}")
        self.log(f"九项/TXT文件夹：{self.source_folders['jiuxiang']}")
        self.log("点击【搜索TXT】准备三组资料，确认后只需点击一次【上传本地】。")

    def _build_ui(self) -> None:
        outer = tk.Frame(self.root, bg=DARK_BG, padx=14, pady=12)
        outer.pack(fill=tk.BOTH, expand=True)

        header = tk.Frame(outer, bg=DARK_BG)
        header.pack(fill=tk.X)
        self.search_button = tk.Button(
            header,
            text="搜索TXT",
            command=self.search_all_txt,
            width=16,
            height=2,
            bg=SEARCH_BLUE,
            fg=DARK_TEXT,
            activebackground="#2b8be0",
            activeforeground=DARK_TEXT,
            disabledforeground="#8b96a5",
            relief=tk.FLAT,
            bd=0,
            font=("Microsoft YaHei UI", 15, "bold"),
        )
        self.search_button.pack(side=tk.LEFT, padx=(0, 14))
        self.upload_button = tk.Button(
            header,
            text="上传本地",
            command=self.upload_local,
            width=16,
            height=2,
            bg=UPLOAD_GREEN,
            fg=DARK_TEXT,
            activebackground="#48bd24",
            activeforeground=DARK_TEXT,
            disabledforeground="#8b96a5",
            relief=tk.FLAT,
            bd=0,
            font=("Microsoft YaHei UI", 15, "bold"),
            state=tk.DISABLED,
        )
        self.upload_button.pack(side=tk.LEFT, padx=(0, 14))
        self.clear_button = tk.Button(
            header,
            text="清除TXT",
            command=self.clear_all_txt,
            width=16,
            height=2,
            bg=CLEAR_RED,
            fg=DARK_TEXT,
            activebackground="#ee4b4b",
            activeforeground=DARK_TEXT,
            disabledforeground="#8b96a5",
            relief=tk.FLAT,
            bd=0,
            font=("Microsoft YaHei UI", 15, "bold"),
        )
        self.clear_button.pack(side=tk.LEFT)

        date_row = tk.Frame(outer, bg=DARK_BG)
        date_row.pack(fill=tk.X, pady=(12, 9))
        tk.Label(
            date_row,
            text="统一上传日期：",
            bg=DARK_BG,
            fg=DARK_TEXT,
            font=("Microsoft YaHei UI", 12, "bold"),
        ).pack(side=tk.LEFT)
        tk.Entry(
            date_row,
            textvariable=self.date_var,
            width=14,
            font=("Microsoft YaHei UI", 12),
            bg=DARK_INPUT,
            fg=DARK_TEXT,
            insertbackground=DARK_TEXT,
            selectbackground="#264f78",
            selectforeground=DARK_TEXT,
            relief=tk.FLAT,
            bd=1,
        ).pack(side=tk.LEFT)
        tk.Label(
            date_row,
            text=f"    本地 API：{LOCAL_API_URL}    （三项目一次事务保存）",
            bg=DARK_BG,
            fg=DARK_MUTED,
            font=("Microsoft YaHei UI", 11),
        ).pack(side=tk.LEFT)

        status_frame = tk.Frame(outer, bg=DARK_BG)
        status_frame.pack(fill=tk.X, pady=(0, 10))
        self.status_cards = {}
        for column in range(3):
            status_frame.grid_columnconfigure(column, weight=1, uniform="status-cards")
        self._build_status_row(status_frame, "jiuxiang", "九项/TXT", self.jiuxiang_status_var, 0)
        self._build_status_row(status_frame, "dawei_shahao", "大围四模式", self.dawei_status_var, 1)
        self._build_status_row(status_frame, "pingte", "平特三模式", self.pingte_status_var, 2)

        tk.Label(
            outer,
            text="运行日志",
            anchor="w",
            bg=DARK_BG,
            fg=DARK_TEXT,
            font=("Microsoft YaHei UI", 13, "bold"),
        ).pack(fill=tk.X, pady=(4, 4))
        self.log_box = scrolledtext.ScrolledText(
            outer,
            wrap=tk.WORD,
            font=("Microsoft YaHei UI", 12),
            height=22,
            bg=DARK_INPUT,
            fg=DARK_TEXT,
            insertbackground=DARK_TEXT,
            selectbackground="#264f78",
            selectforeground=DARK_TEXT,
            relief=tk.FLAT,
            bd=1,
            padx=7,
            pady=6,
            spacing1=2,
            spacing3=2,
        )
        self.log_box.pack(fill=tk.BOTH, expand=True)
        self.log_box.vbar.configure(
            bg=DARK_PANEL,
            activebackground=DARK_MUTED,
            troughcolor=DARK_INPUT,
            relief=tk.FLAT,
            bd=0,
            highlightthickness=0,
        )

    def _build_status_row(self, parent, source_id, label, variable, column):
        row = tk.Frame(
            parent,
            bg=DARK_PANEL,
            relief=tk.GROOVE,
            borderwidth=1,
            highlightbackground=DARK_BORDER,
            highlightcolor=DARK_BORDER,
            padx=10,
            pady=7,
        )
        row.grid(row=0, column=column, sticky="nsew", padx=(0, 8) if column < 2 else 0)
        self.status_cards[source_id] = row
        top_line = tk.Frame(row, bg=DARK_PANEL)
        top_line.pack(fill=tk.X)
        tk.Label(
            top_line,
            text=label,
            bg=DARK_PANEL,
            fg=DARK_TEXT,
            font=("Microsoft YaHei UI", 12, "bold"),
            anchor="w",
        ).pack(side=tk.LEFT)
        tk.Label(
            top_line,
            textvariable=variable,
            bg=DARK_PANEL,
            fg=DARK_MUTED,
            font=("Microsoft YaHei UI", 11),
            anchor="w",
        ).pack(side=tk.LEFT, padx=(8, 0), expand=True, fill=tk.X)
        bottom_line = tk.Frame(row, bg=DARK_PANEL)
        bottom_line.pack(fill=tk.X, pady=(4, 0))
        folder_label = tk.Label(
            bottom_line,
            text=str(self.source_folders[source_id]),
            bg=DARK_PANEL,
            fg=DARK_MUTED,
            font=("Microsoft YaHei UI", 9),
            anchor="w",
            width=24,
        )
        folder_label.pack(side=tk.LEFT, padx=(0, 8), expand=True, fill=tk.X)
        folder_var = tk.StringVar(master=self.root, value=str(self.source_folders[source_id]))
        self.folder_vars[source_id] = folder_var
        folder_var.trace_add("write", lambda *_args, label_widget=folder_label, variable=folder_var: label_widget.config(text=variable.get()))
        button = tk.Button(
            bottom_line,
            text="选择文件夹",
            command=lambda selected_source=source_id: self.choose_folder(selected_source),
            bg=DARK_PANEL,
            fg=DARK_TEXT,
            activebackground=DARK_BORDER,
            activeforeground=DARK_TEXT,
            disabledforeground="#8b96a5",
            relief=tk.FLAT,
            bd=1,
            font=("Microsoft YaHei UI", 10),
            padx=6,
            pady=2,
        )
        button.pack(side=tk.RIGHT)
        self.folder_buttons[source_id] = button

    def _reset_prepared_state(self) -> None:
        self.jiuxiang_files = {}
        self.jiuxiang_parsed = {}
        self.jiuxiang_issue = ""
        self.jiuxiang_draw_number = ""
        self.jiuxiang_modes = {}
        self.dawei_files = {}
        self.dawei_parsed = {}
        self.dawei_search_result = None
        self.dawei_modes = {}
        self.pingte_files = {}
        self.pingte_predictions = {}
        self.pingte_queries = {}
        self.pingte_issue = None
        self.pingte_modes = {}

    @staticmethod
    def _default_settings_path() -> Path:
        """Return the deterministic settings location for source and frozen runs."""
        if getattr(sys, "frozen", False):
            base = Path(sys.executable).resolve().parent
        else:
            base = Path(__file__).resolve().parents[1]
        return base / SETTINGS_FILENAME

    def _load_settings(self) -> None:
        """Load valid customized folders, retaining safe defaults otherwise."""
        try:
            payload = json.loads(self.settings_path.read_text(encoding="utf-8"))
        except (OSError, TypeError, ValueError):
            return
        if not isinstance(payload, dict):
            return
        if payload.get("version") != SETTINGS_VERSION:
            return
        folders = payload.get("folders")
        customized = payload.get("customized")
        if not isinstance(folders, dict) or not isinstance(customized, dict):
            return
        for source_id in PROJECT_IDS:
            if not bool(customized.get(source_id)):
                continue
            raw_path = folders.get(source_id)
            if not isinstance(raw_path, str) or not raw_path.strip():
                continue
            try:
                candidate = Path(raw_path).expanduser().resolve()
            except (OSError, RuntimeError, TypeError, ValueError):
                continue
            if candidate.is_dir():
                self.source_folders[source_id] = candidate
                self.source_customized[source_id] = True

    def _settings_payload(self, folders=None, customized=None) -> dict:
        folders = folders if folders is not None else self.source_folders
        customized = customized if customized is not None else self.source_customized
        return {
            "version": SETTINGS_VERSION,
            "folders": {source_id: str(Path(folders[source_id])) for source_id in PROJECT_IDS},
            "customized": {source_id: bool(customized[source_id]) for source_id in PROJECT_IDS},
        }

    def _save_settings(self, folders=None, customized=None) -> None:
        """Persist settings atomically, raising so callers can keep old state."""
        target = self.settings_path
        target.parent.mkdir(parents=True, exist_ok=True)
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{target.name}.",
            suffix=".tmp",
            dir=str(target.parent),
        )
        temporary_path = Path(temporary_name)
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as handle:
                json.dump(self._settings_payload(folders, customized), handle, ensure_ascii=False, indent=2)
                handle.write("\n")
                handle.flush()
                os.fsync(handle.fileno())
            os.replace(temporary_path, target)
        except Exception:
            try:
                temporary_path.unlink(missing_ok=True)
            except OSError:
                pass
            raise

    def choose_folder(self, source_id: str) -> None:
        """Prompt for one source folder and apply only after durable persistence."""
        if source_id not in PROJECT_IDS:
            raise KeyError(f"unknown source: {source_id}")
        source_label = next(label for label, identifier in UPLOAD_MODES if identifier == source_id)
        current = self.source_folders[source_id]
        dialog_kwargs = {
            "parent": self.root,
            "title": f"选择{source_label}文件夹",
        }
        if current.is_dir():
            dialog_kwargs["initialdir"] = str(current)
        selected = filedialog.askdirectory(**dialog_kwargs)
        if not selected:
            return
        try:
            candidate = Path(selected).expanduser().resolve()
        except (OSError, RuntimeError, TypeError, ValueError) as exc:
            messagebox.showerror("文件夹无效", str(exc))
            return
        if not candidate.is_dir():
            messagebox.showerror("文件夹无效", "请选择一个可用的文件夹。")
            return

        folders = dict(self.source_folders)
        customized = dict(self.source_customized)
        folders[source_id] = candidate
        customized[source_id] = True
        try:
            self._save_settings(folders, customized)
        except Exception as exc:
            messagebox.showerror("保存设置失败", f"文件夹选择未应用：{exc}")
            return

        self.source_folders = folders
        self.source_customized = customized
        self.folder_vars[source_id].set(str(candidate))
        self._search_generation += 1
        self._invalidate_all(status="文件夹已变更，请重新搜索")
        self._restore_idle_controls()
        self.log(f"[{source_label}] 已切换文件夹：{candidate}")

    def _invalidate_all(self, *, status: str = "未准备") -> None:
        self.ready = False
        self._reset_prepared_state()
        self.jiuxiang_status_var.set(status)
        self.dawei_status_var.set(status)
        self.pingte_status_var.set(status)

    def _set_action_controls(self, *, search: bool, upload: bool, clear: bool) -> None:
        self.search_button.config(state=tk.NORMAL if search else tk.DISABLED)
        self.upload_button.config(state=tk.NORMAL if upload else tk.DISABLED)
        self.clear_button.config(state=tk.NORMAL if clear else tk.DISABLED)
        for button in self.folder_buttons.values():
            button.config(state=tk.NORMAL if search else tk.DISABLED)

    def _restore_idle_controls(self) -> None:
        self._set_action_controls(search=True, upload=self.ready, clear=True)

    def _ui(self, callback) -> None:
        if threading.current_thread() is threading.main_thread():
            callback()
        else:
            self.root.after(0, callback)

    def _set_status(self, variable, value: str) -> None:
        self._ui(lambda: variable.set(value))

    def _set_date(self, value: str) -> None:
        self._ui(lambda: self.date_var.set(value))

    def log(self, message: str) -> None:
        if threading.current_thread() is not threading.main_thread():
            self.root.after(0, lambda: self.log(message))
            return
        self.log_box.insert(tk.END, message + "\n")
        self.log_box.see(tk.END)

    def run_worker(self, target) -> None:
        threading.Thread(target=target, daemon=True).start()

    def search_all_txt(self) -> None:
        self._search_generation += 1
        generation = self._search_generation
        source_snapshot = self._capture_source_snapshot()
        self._invalidate_all(status="搜索中...")
        self.log("")
        self.log("开始搜索全部 TXT，准备三个项目...")
        self._set_action_controls(search=False, upload=False, clear=False)
        self.run_worker(lambda: self._search_worker(generation, source_snapshot))

    def _capture_source_snapshot(self) -> dict:
        """Copy source paths/customization flags once for a search run."""
        return {
            "folders": dict(self.source_folders),
            "customized": dict(self.source_customized),
        }

    def _prepare_jiuxiang(self, source_snapshot=None):
        snapshot = source_snapshot or self._capture_source_snapshot()
        folder = snapshot["folders"]["jiuxiang"]
        issue, files, parsed = load_jiuxiang_bundle(folder)
        draw = fetch_draw_number()
        modes = build_jiuxiang_mode_payloads(parsed, draw)
        return issue, files, parsed, draw, modes

    def _prepare_dawei(self, source_snapshot=None):
        snapshot = source_snapshot or self._capture_source_snapshot()
        folder = snapshot["folders"]["dawei_shahao"]
        upload_date, files, parsed = load_dawei_bundle(folder)
        number_query, zodiac_query, issue = fetch_macau_latest()
        modes = build_dawei_mode_payloads(parsed, number_query, zodiac_query)
        return upload_date, files, parsed, number_query, zodiac_query, issue, modes

    def _prepare_pingte(self, source_snapshot=None):
        snapshot = source_snapshot or self._capture_source_snapshot()
        if snapshot["customized"]["pingte"]:
            folder = snapshot["folders"]["pingte"]
            issue, files = find_prediction_files(folder, folder)
        else:
            issue, files = find_prediction_files(TXT_INPUT_DIR, KILL_TWO_INPUT_DIR)
        predictions = {
            mode_id: load_prediction_file(files[mode_id], mode_id)
            for mode_id in (PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO)
        }
        results = fetch_issue_result(issue)
        if not results:
            raise RuntimeError(f"没有抓到第 {issue} 期开奖结果")
        full_issue = str(results[0].get("issue", ""))
        if not full_issue or int(full_issue[-3:]) != issue:
            raise RuntimeError("开奖号期数与二肖文件期数不一致")
        queries = build_upload_queries(results[0])
        modes = build_pingte_mode_payloads(predictions, queries)
        return issue, files, predictions, queries, modes, full_issue

    def _search_worker(self, generation: int, source_snapshot=None) -> None:
        try:
            source_snapshot = source_snapshot or self._capture_source_snapshot()
            self.log("[九项/TXT] 搜索十项文件并抓取开奖号...")
            self.log("[大围四模式] 搜索四个文件并抓取澳门最新开奖号...")
            self.log("[平特三模式] 搜索三个文件并抓取对应期数结果...")
            with ThreadPoolExecutor(max_workers=3, thread_name_prefix="unified-search") as executor:
                jiuxiang_future = executor.submit(self._prepare_jiuxiang, source_snapshot)
                dawei_future = executor.submit(self._prepare_dawei, source_snapshot)
                pingte_future = executor.submit(self._prepare_pingte, source_snapshot)
                jiuxiang_issue, jiuxiang_files, jiuxiang_parsed, jiuxiang_draw, jiuxiang_modes = jiuxiang_future.result()
                (
                    dawei_date,
                    dawei_files,
                    dawei_parsed,
                    number_query,
                    zodiac_query,
                    issue,
                    dawei_modes,
                ) = dawei_future.result()
                (
                    pingte_issue,
                    pingte_files,
                    pingte_predictions,
                    pingte_queries,
                    pingte_modes,
                    full_issue,
                ) = pingte_future.result()

            if generation != self._search_generation:
                return
            self.jiuxiang_files = jiuxiang_files
            self.jiuxiang_parsed = jiuxiang_parsed
            self.jiuxiang_issue = jiuxiang_issue
            self.jiuxiang_draw_number = jiuxiang_draw
            self.jiuxiang_modes = jiuxiang_modes
            self.dawei_files = dawei_files
            self.dawei_parsed = dawei_parsed
            self.dawei_modes = dawei_modes
            self.dawei_search_result = {
                "date": dawei_date,
                "number_query": number_query,
                "zodiac_query": zodiac_query,
                "issue": issue,
            }
            self.pingte_files = pingte_files
            self.pingte_predictions = pingte_predictions
            self.pingte_queries = pingte_queries
            self.pingte_issue = pingte_issue
            self.pingte_modes = pingte_modes
            self.ready = True
            self._set_date(dawei_date)
            self._set_status(self.jiuxiang_status_var, f"已准备：第 {jiuxiang_issue} 期，十项有效")
            self._set_status(self.dawei_status_var, f"已准备：第 {issue} 期，四模式有效")
            self._set_status(self.pingte_status_var, f"已准备：第 {full_issue} 期，三模式有效")
            self._ui(self._restore_idle_controls)
            self.log("三个项目均已准备完成，可以统一上传。")
        except Exception as exc:
            error_text = str(exc)
            if generation == self._search_generation:
                self._ui(lambda: self._invalidate_all(status="搜索失败，请重新搜索"))
                self.log(f"统一搜索失败：{error_text}")
                self._ui(lambda: messagebox.showerror("搜索失败", error_text))
        finally:
            if generation == self._search_generation:
                self._ui(self._restore_idle_controls)

    def upload_local(self) -> None:
        if not self.ready:
            messagebox.showwarning("不能上传", "请先点击【搜索TXT】，等待三个项目都准备完成。")
            return
        date_str = self.date_var.get().strip()
        try:
            validate_iso_date(date_str)
        except ValueError:
            messagebox.showerror("日期错误", "上传日期格式必须是有效的 YYYY-MM-DD。")
            return
        if not messagebox.askyesno(
            "确认上传",
            "将把九项、大围四模式、平特三模式通过一次本地事务写入统一数据库。继续吗？",
        ):
            return
        if not self.upload_lock.acquire(blocking=False):
            messagebox.showwarning("正在上传", "已有统一上传任务正在进行，请勿重复点击。")
            return
        try:
            prepared_snapshot = self._snapshot_prepared_state()
        except Exception as exc:
            self.upload_lock.release()
            messagebox.showerror("上传失败", str(exc))
            return
        self._set_action_controls(search=False, upload=False, clear=False)
        self.run_worker(lambda: self._upload_worker(date_str, prepared_snapshot))

    def _snapshot_prepared_state(self) -> dict:
        return copy.deepcopy({
            "jiuxiang_parsed": self.jiuxiang_parsed,
            "dawei_modes": self.dawei_modes,
            "pingte_modes": self.pingte_modes,
        })

    def _upload_worker(self, date_str: str, prepared_snapshot: dict | None = None) -> None:
        try:
            prepared_snapshot = prepared_snapshot or self._snapshot_prepared_state()
            self.log("开始统一上传三个项目...")
            draw_number = fetch_draw_number()
            jiuxiang_modes = build_jiuxiang_mode_payloads(
                prepared_snapshot["jiuxiang_parsed"],
                draw_number,
            )
            projects = {
                "jiuxiang": jiuxiang_modes,
                "dawei_shahao": prepared_snapshot["dawei_modes"],
                "pingte": prepared_snapshot["pingte_modes"],
            }
            # Validate the complete document before invoking the API so an
            # incomplete preparation can never reach the network.
            build_multi_project_import_document(date_str, projects)
            result = self.api.replace_projects_day(date_str, projects, progress=self.log)
            if result.get("recovered"):
                self.log("写入响应中断，三个项目均已通过回读确认成功。")
            else:
                self.log("三个项目上传完成，回读校验一致。")
            self._ui(lambda: messagebox.showinfo("上传成功", f"{date_str} 三个项目已一次事务写入本地数据库"))
            self._ui(self._restore_idle_controls)
        except Exception as exc:
            error_text = str(exc)
            self.ready = False
            self._set_status(self.jiuxiang_status_var, "上传失败，请重新搜索")
            self._set_status(self.dawei_status_var, "上传失败，请重新搜索")
            self._set_status(self.pingte_status_var, "上传失败，请重新搜索")
            self.log(f"统一上传失败：{error_text}")
            self._ui(self._restore_idle_controls)
            self._ui(lambda: messagebox.showerror("上传失败", error_text))
        finally:
            self.upload_lock.release()

    @staticmethod
    def _paths_for_files(files) -> list[Path]:
        paths = []
        for item in files.values():
            path = getattr(item, "path", item)
            paths.append(Path(path))
        return paths

    @staticmethod
    def _scan_txt_root(root: Path) -> list[Path]:
        targets = []
        for folder_name, _folder_names, file_names in os.walk(root):
            folder = Path(folder_name)
            targets.extend(folder / name for name in file_names if name.lower().endswith(".txt"))
        return targets

    def _jiuxiang_clear_roots(self) -> list[Path]:
        if self.source_customized.get("jiuxiang"):
            selected = self.source_folders.get("jiuxiang")
            return [selected] if selected is not None and selected.is_dir() else []
        return [root for root in TXT_CLEAR_ROOTS if root.is_dir()]

    def _jiuxiang_txt_targets(self) -> list[Path]:
        roots = self._jiuxiang_clear_roots()
        if not roots:
            return []
        if len(roots) == 1:
            targets = self._scan_txt_root(roots[0])
        else:
            with ThreadPoolExecutor(
                max_workers=min(len(roots), 2),
                thread_name_prefix="txt-scan",
            ) as executor:
                targets = [
                    path
                    for root_targets in executor.map(self._scan_txt_root, roots)
                    for path in root_targets
                ]
        return sorted(targets, key=lambda path: str(path).casefold())

    def _all_clear_targets(self) -> list[Path]:
        targets = set(self._jiuxiang_txt_targets())
        for files in (self.dawei_files, self.pingte_files):
            targets.update(path for path in self._paths_for_files(files) if path.is_file())
        return sorted(targets, key=lambda path: str(path).casefold())

    def _begin_confirmed_clear(self) -> None:
        self._search_generation += 1
        self._set_action_controls(search=False, upload=False, clear=False)
        self._invalidate_all(status="清除中...")

    def clear_all_txt(self) -> None:
        self._set_action_controls(search=False, upload=False, clear=False)
        self.log("正在后台扫描三个工具的 TXT 清理范围...")
        self.run_worker(self._scan_all_clear_targets_worker)

    def _scan_all_clear_targets_worker(self) -> None:
        try:
            targets = self._all_clear_targets()
        except Exception as exc:
            error_text = str(exc)
            self._ui(lambda: self._finish_clear_scan_error(error_text))
            return
        self._ui(lambda: self._confirm_all_clear(targets))

    def _finish_clear_scan_error(self, error_text: str) -> None:
        self.log(f"TXT 扫描失败：{error_text}")
        messagebox.showerror("扫描失败", error_text)
        self._restore_idle_controls()

    def _confirm_all_clear(self, targets: list[Path]) -> None:
        if not targets:
            messagebox.showinfo("没有TXT", "当前三个工具的清理范围内没有 TXT 文件。")
            self.log("扫描完成：当前清理范围没有 TXT 文件。")
            self._restore_idle_controls()
            return
        roots_text = "\n".join(str(root) for root in self._jiuxiang_clear_roots())
        if not messagebox.askyesno(
            "确认清除",
            f"将一次清除九项、大围、平特三个工具范围内的 TXT 文件（共 {len(targets)} 个）。\n"
            f"九项递归目录：\n{roots_text}\n\n确认继续吗？",
        ):
            self.log("已取消清除，原准备状态保持不变。")
            self._restore_idle_controls()
            return
        self._begin_confirmed_clear()
        self.log(f"已确认，正在后台清除 {len(targets)} 个 TXT 文件...")
        self.run_worker(lambda: self._clear_targets_worker(targets))

    def _clear_targets_worker(self, targets: list[Path]) -> None:
        deleted = 0
        errors = []
        for path in targets:
            try:
                if path.exists():
                    path.unlink()
                    deleted += 1
            except Exception as exc:
                errors.append((path, str(exc)))
        self._ui(lambda: self._finish_clear(deleted, errors))

    def _finish_clear(self, deleted: int, errors: list[tuple[Path, str]]) -> None:
        if errors:
            self._invalidate_all(status="部分清除，请重新搜索")
            first_path, first_error = errors[0]
            self.log(f"清除完成：成功 {deleted} 个，失败 {len(errors)} 个。")
            messagebox.showerror(
                "部分清除失败",
                f"成功清除 {deleted} 个，失败 {len(errors)} 个。\n"
                f"首个失败文件：{first_path}\n{first_error}",
            )
        else:
            self._invalidate_all(status="已清除，请重新搜索")
            self.log(f"清除完成：已清除 {deleted} 个 TXT 文件。")
            messagebox.showinfo("清除完成", f"已一次清除 {deleted} 个 TXT 文件。")
        self._restore_idle_controls()

def main() -> None:
    root = tk.Tk()
    UnifiedLocalUploaderApp(root)
    root.mainloop()


def self_test() -> None:
    samples = {
        "jiuxiang": {
            mode: {"query": "07", "entries": [{"name": f"{mode}-测试", "content": "测试"}]}
            for mode in JIUXIANG_MODES
        },
        "dawei_shahao": {
            mode: {"query": "鼠" if mode == "shengxiao" else "07", "entries": [{"name": f"{mode}-测试", "content": "测试"}]}
            for mode in DAWEI_MODES
        },
        "pingte": {
            mode: {"query": "鼠牛" if mode == PINGTE_YIXIAO else "1尾2尾" if mode == PINGTE_TAIL else "07", "entries": [{"name": f"{mode}-测试", "content": "测试"}]}
            for mode in (PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO)
        },
    }
    build_multi_project_import_document("2026-01-01", samples)


if __name__ == "__main__":
    if "--self-test" in sys.argv:
        self_test()
    else:
        main()
