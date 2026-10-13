from __future__ import annotations

import re
from datetime import date
from pathlib import Path


SYSTEM_QUERY_NAME = re.compile(r"^_*QUERY_*$", re.IGNORECASE)
DEFAULT_MAX_TEXT_BYTES = 16 * 1024 * 1024


def is_count_ranking_header(line: str) -> bool:
    normalized = re.sub(r"\s+", " ", str(line or "").strip())
    return re.fullmatch(r"(?:内容|尾数) 次数(?: 排名)?", normalized) is not None


def read_text_file(
    path: str | Path,
    max_bytes: int = DEFAULT_MAX_TEXT_BYTES,
) -> str:
    if isinstance(max_bytes, bool) or not isinstance(max_bytes, int) or max_bytes < 1:
        raise ValueError("max_bytes 必须是正整数")
    file_path = Path(path)
    size = file_path.stat().st_size
    if size > max_bytes:
        raise ValueError(f"TXT 文件过大：{file_path.name}（{size} 字节）")
    data = file_path.read_bytes()
    if len(data) > max_bytes:
        raise ValueError(f"TXT 文件过大：{file_path.name}（{len(data)} 字节）")
    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def validate_iso_date(value: str) -> str:
    text = str(value or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", text):
        raise ValueError("日期格式必须是 YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(text)
    except ValueError as exc:
        raise ValueError("日期不是有效日期") from exc
    if parsed.isoformat() != text:
        raise ValueError("日期格式必须是 YYYY-MM-DD")
    return text


def delete_exact_txt_files(paths: list[Path] | tuple[Path, ...]) -> list[Path]:
    unique_paths = sorted({Path(path).resolve() for path in paths}, key=str)
    for path in unique_paths:
        if path.suffix.lower() != ".txt":
            raise ValueError(f"拒绝删除非 TXT 文件：{path.name}")
        if not path.is_file():
            raise FileNotFoundError(f"文件不存在：{path}")
    for path in unique_paths:
        path.unlink()
    return unique_paths


def clean_entries(entries: list[dict]) -> list[dict[str, str]]:
    cleaned: list[dict[str, str]] = []
    names: set[str] = set()
    for entry in entries:
        name = str(entry.get("name", "")).strip()
        content = str(entry.get("content", "")).strip()
        if not name or not content:
            continue
        if SYSTEM_QUERY_NAME.fullmatch(name):
            raise ValueError(f"{name} 是系统保留目录名")
        if name in names:
            raise ValueError(f"目录名重复：{name}")
        names.add(name)
        cleaned.append({"name": name, "content": content})
    return cleaned
