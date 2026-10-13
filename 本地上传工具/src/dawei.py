import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import common


MODE_BY_LABEL = {
    "大围": "dawei",
    "生肖": "shengxiao",
    "杀数字": "shahao",
    "杀五码": "shaxiao",
}

MODE_TITLE = {
    "dawei": "大围",
    "shengxiao": "生肖",
    "shahao": "杀数字",
    "shaxiao": "杀五码",
}

UPLOAD_MODES = ("dawei", "shengxiao", "shahao", "shaxiao")
ZODIACS = "鼠牛虎兔龙蛇马羊猴鸡狗猪"
ZODIAC_TRADITIONAL_TO_SIMPLIFIED = str.maketrans(
    {"雞": "鸡", "馬": "马", "豬": "猪", "龍": "龙"}
)
FILE_PATTERN = re.compile(
    r"^\s*(\d{1,2})[.\-月](\d{1,2})(?:日)?\s*(大围|生肖|杀数字|杀五码)\.txt$",
    re.I,
)


@dataclass(frozen=True)
class TxtFile:
    mode: str
    path: Path
    month: int
    day: int


read_text_file = common.read_text_file


def normalize_line(line: str) -> str:
    return (
        str(line or "")
        .replace("\u200b", "")
        .replace("\u200c", "")
        .replace("\u200d", "")
        .replace("\ufeff", "")
        .replace("　", " ")
        .replace("。", ",")
        .replace("，", ",")
        .replace("．", ",")
        .replace("；", ",")
        .replace("：", ",")
        .replace("、", ",")
        .replace(".", ",")
        .strip()
    )


def is_slim_raw_line(line: str) -> bool:
    text = str(line or "").strip()
    return text == "-" or re.fullmatch(r"\d{1,2}", text) is not None


def expected_txt_file_names(day: datetime | None = None) -> list[str]:
    day = day or datetime.now()
    prefix = f"{day.month}.{day.day}"
    return [f"{prefix}{title}.txt" for title in ("大围", "生肖", "杀数字", "杀五码")]


def check_duplicate_names(rows: list[dict], mode: str) -> None:
    seen = set()
    duplicates = []
    for row in rows:
        name = str(row.get("name") or "未命名").strip()
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)
    if duplicates:
        names = ", ".join(duplicates[:20])
        raise ValueError(f"{MODE_TITLE[mode]} 检测到重复资料名：{names}")


def parse_raw_text(mode: str, text: str, *, reject_duplicates: bool = False) -> list[dict]:
    if mode not in UPLOAD_MODES:
        raise ValueError(f"未知模式：{mode}")

    rows = []
    in_zodiac_ranking = False
    for raw_line in str(text or "").splitlines():
        if not raw_line.strip() or is_slim_raw_line(raw_line):
            continue
        if common.is_count_ranking_header(raw_line):
            break

        cleaned = normalize_line(raw_line)
        if mode == "shengxiao":
            compact = re.sub(r"\s+", "", cleaned)
            if compact == "生肖次数排行榜":
                in_zodiac_ranking = True
                continue
            if in_zodiac_ranking and re.fullmatch(
                r"[鼠牛虎兔龙蛇马羊猴鸡狗猪龍馬雞豬]\d+次", compact
            ):
                continue
            in_zodiac_ranking = False

        if mode == "shengxiao":
            parts = [part for part in re.split(r"[:：\s]+", cleaned) if part]
            content = (parts[0] if parts else "").translate(
                ZODIAC_TRADITIONAL_TO_SIMPLIFIED
            )
            name = " ".join(parts[1:]).strip()
        else:
            match = re.search(r"[\d,.]{4,}", cleaned)
            if match:
                content = match.group(0)
                name = (cleaned[: match.start()] + cleaned[match.end() :]).strip(" \t:,")
            else:
                single_number = (
                    re.fullmatch(r"(0[1-9]|[1-4][0-9])\s+(.+)", cleaned)
                    if mode in {"dawei", "shahao"}
                    else None
                )
                if single_number:
                    content = single_number.group(1)
                    name = single_number.group(2).strip(" :,")
                else:
                    parts = [part for part in re.split(r"[:：\s]+", cleaned) if part]
                    name = parts[0] if parts else "未知"
                    content = " ".join(parts[1:]).strip()

        rows.append(
            {
                "name": name or "未命名",
                "content": content,
                "original": raw_line.strip(),
            }
        )

    if reject_duplicates:
        check_duplicate_names(rows, mode)
    return rows


def _find_txt_files(input_dir: Path, year: int) -> tuple[str, dict[str, TxtFile]]:
    if not input_dir.exists():
        raise FileNotFoundError(f"搜索文件夹不存在：{input_dir}")
    if not input_dir.is_dir():
        raise NotADirectoryError(f"搜索路径不是文件夹：{input_dir}")

    found: dict[str, TxtFile] = {}
    date_parts = set()
    for path in sorted(input_dir.iterdir(), key=lambda item: item.name):
        if not path.is_file() or path.suffix.lower() != ".txt":
            continue
        match = FILE_PATTERN.fullmatch(path.name)
        if not match:
            continue

        month = int(match.group(1))
        day = int(match.group(2))
        mode = MODE_BY_LABEL[match.group(3)]
        if mode in found:
            raise ValueError(
                f"{MODE_TITLE[mode]} 检测到重复文件："
                f"{found[mode].path.name}、{path.name}"
            )
        found[mode] = TxtFile(mode=mode, path=path, month=month, day=day)
        date_parts.add((month, day))

    missing = [mode for mode in UPLOAD_MODES if mode not in found]
    if missing:
        missing_names = "、".join(MODE_TITLE[mode] for mode in missing)
        expected_names = "、".join(expected_txt_file_names(datetime(year, 1, 1)))
        raise ValueError(f"缺少TXT文件：{missing_names}。需要四个文件：{expected_names}")
    if len(date_parts) != 1:
        raise ValueError("四个TXT文件日期不一致，请只放同一天的数据。")

    month, day = next(iter(date_parts))
    try:
        parsed_date = datetime(year, month, day)
    except ValueError as exc:
        raise ValueError(f"TXT文件日期无效：{year:04d}-{month:02d}-{day:02d}") from exc
    return parsed_date.strftime("%Y-%m-%d"), found


def load_txt_bundle(
    input_dir: Path | str,
    *,
    year: int | None = None,
) -> tuple[str, dict[str, TxtFile], dict[str, list[dict]]]:
    resolved_dir = Path(input_dir)
    selected_year = datetime.now().year if year is None else int(year)
    date_str, files = _find_txt_files(resolved_dir, selected_year)
    parsed = {}
    for mode in UPLOAD_MODES:
        info = files[mode]
        rows = parse_raw_text(
            mode,
            common.read_text_file(info.path),
            reject_duplicates=True,
        )
        if not rows:
            raise ValueError(f"{info.path.name} 没有解析到有效资料。")
        parsed[mode] = rows
    return date_str, files, parsed


def _normalize_entries(rows: object, mode: str) -> list[dict]:
    if not isinstance(rows, list):
        raise ValueError(f"缺少{MODE_TITLE[mode]}数组")

    entries = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError(f"{MODE_TITLE[mode]}资料格式无效")
        name = str(row.get("name") or "").strip()
        content = str(row.get("content") or "").strip()
        if not name or not content:
            continue
        entry = {"name": name, "content": content}
        if row.get("original") is not None:
            entry["original"] = str(row["original"])
        entries.append(entry)

    check_duplicate_names(entries, mode)
    if not entries:
        raise ValueError(f"{MODE_TITLE[mode]}没有可上传的有效资料")
    return entries


NUMBER_PATTERN = re.compile(r"(?:0[1-9]|[1-4][0-9])(?:[\s,]+(?:0[1-9]|[1-4][0-9]))*")


def _number_tokens(content: str, mode: str, name: str) -> list[str]:
    if not NUMBER_PATTERN.fullmatch(content):
        raise ValueError(
            f"{MODE_TITLE[mode]}【{name}】号码必须全部为 01-49 的两位数字"
        )
    return re.findall(r"0[1-9]|[1-4][0-9]", content)


def _validate_mode_entries(mode: str, entries: list[dict]) -> None:
    for entry in entries:
        name = entry["name"]
        content = entry["content"]
        if mode == "shengxiao":
            compact = re.sub(r"[\s,]+", "", content).translate(
                ZODIAC_TRADITIONAL_TO_SIMPLIFIED
            )
            if not compact or any(zodiac not in ZODIACS for zodiac in compact):
                raise ValueError(f"生肖【{name}】只能填写合法生肖串")
            continue

        _number_tokens(content, mode, name)


def build_mode_payloads(
    parsed: dict[str, list[dict]],
    number_query: str,
    zodiac_query: str,
) -> dict[str, dict]:
    if not isinstance(parsed, dict) or set(parsed) != set(UPLOAD_MODES):
        raise ValueError("四模式资料必须完整")

    number = str(number_query or "").strip()
    if not re.fullmatch(r"(0[1-9]|[1-4][0-9])", number):
        raise ValueError("开奖号必须是 01-49 的两位数字")
    zodiac = str(zodiac_query or "").strip().translate(
        ZODIAC_TRADITIONAL_TO_SIMPLIFIED
    )
    if zodiac not in ZODIACS or len(zodiac) != 1:
        raise ValueError("开奖号生肖无效")

    payloads = {}
    for mode in UPLOAD_MODES:
        query = zodiac if mode == "shengxiao" else number
        entries = _normalize_entries(parsed[mode], mode)
        _validate_mode_entries(mode, entries)
        payloads[mode] = {
            "query": query,
            "entries": entries,
        }
    return payloads
