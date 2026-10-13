from __future__ import annotations

import json
import re
from datetime import date
from pathlib import Path
from urllib.request import Request, urlopen

from common import clean_entries, is_count_ranking_header, read_text_file


PINGTE_YIXIAO = "pingteyixiao"
PINGTE_TAIL = "pingtewei"
SHA_LIANG_XIAO = "shaliangxiao"
PROJECT_ID = "pingte"
PROJECT_MODES = (PINGTE_YIXIAO, PINGTE_TAIL, SHA_LIANG_XIAO)
ZODIACS = "鼠牛虎兔龙蛇马羊猴鸡狗猪"
SIMPLIFIED_ZODIAC = str.maketrans({"龍": "龙", "馬": "马", "雞": "鸡", "豬": "猪"})
HISTORY_YEAR_URL = "https://history.macaumarksix.com/history/macaujc2/y/{year}"
REFERER = "https://macaujc.com/"
KILL_TWO_FILE_PATTERN = re.compile(r"^(?P<issue>\d+)期-二肖\.txt$")


def find_prediction_file(input_dir: Path, file_keyword: str) -> Path | None:
    files = sorted(Path(input_dir).glob(f"*{file_keyword}.txt"))
    if len(files) > 1:
        raise ValueError(f"找到多个 {file_keyword}.txt 文件，请只保留一个：{input_dir}")
    return files[0] if files else None


def find_prediction_files(pingte_dir: Path, kill_two_dir: Path) -> tuple[int, dict[str, Path]]:
    xiao_file = find_prediction_file(Path(pingte_dir), "平特肖")
    tail_file = find_prediction_file(Path(pingte_dir), "平特尾")
    kill_two_files = sorted(
        path for path in Path(kill_two_dir).glob("*.txt")
        if KILL_TWO_FILE_PATTERN.fullmatch(path.name)
    )
    missing = []
    if not xiao_file:
        missing.append(f"平特肖（{pingte_dir}）")
    if not tail_file:
        missing.append(f"平特尾（{pingte_dir}）")
    if not kill_two_files:
        missing.append(f"N期-二肖（{kill_two_dir}）")
    if missing:
        raise FileNotFoundError("必须三个 TXT 都存在，缺少：" + "、".join(missing))
    if len(kill_two_files) > 1:
        raise ValueError(f"找到多个 N期-二肖.txt 文件，请只保留一个：{kill_two_dir}")
    match = KILL_TWO_FILE_PATTERN.fullmatch(kill_two_files[0].name)
    return int(match.group("issue")), {
        PINGTE_YIXIAO: xiao_file,
        PINGTE_TAIL: tail_file,
        SHA_LIANG_XIAO: kill_two_files[0],
    }


def parse_tail_content(content: str) -> str:
    value = str(content).translate(str.maketrans("０１２３４５６７８９", "0123456789")).strip()
    tails: list[str] = []

    def add_tail(digit: str) -> None:
        tail = f"{digit}尾"
        if tail not in tails:
            tails.append(tail)

    compact = re.fullmatch(r"([0-9]+)尾", value)
    if compact:
        for digit in compact.group(1):
            add_tail(digit)
    for digit in re.findall(r"([0-9])尾", value):
        add_tail(digit)
    if re.fullmatch(r"[0-9]+", value):
        for digit in value:
            add_tail(digit)
    if not tails:
        raise ValueError(f"尾数格式错误：{content}")
    return "".join(tails)


def parse_prediction_line(line: str, mode: str) -> dict[str, str]:
    parts = line.strip().split()
    if len(parts) < 2:
        raise ValueError(f"格式错误：{line}")
    content = parts[0]
    name_parts = parts[1:]
    if mode == PINGTE_TAIL:
        tail_parts = [content]
        if len(parts) >= 3 and re.fullmatch(r"[0-9０-９]+尾", parts[1]):
            tail_parts.append(parts[1])
            name_parts = parts[2:]
        content = parse_tail_content("".join(tail_parts))
    elif mode == SHA_LIANG_XIAO:
        content = content.translate(SIMPLIFIED_ZODIAC)
        if len(content) != 2 or content[0] == content[1] or any(char not in ZODIACS for char in content):
            raise ValueError(f"杀两肖格式错误：{line}")
    else:
        content = content.translate(SIMPLIFIED_ZODIAC)
        if not content or any(char not in ZODIACS for char in content):
            raise ValueError(f"生肖格式错误：{line}")
    return {"content": content, "name": " ".join(name_parts).strip() or "未命名"}


def parse_prediction_text(text: str, mode: str = PINGTE_YIXIAO) -> list[dict[str, str]]:
    rows = []
    for line in str(text).splitlines():
        cleaned = line.strip()
        if not cleaned:
            continue
        if "排行榜" in cleaned or is_count_ranking_header(cleaned):
            break
        rows.append(parse_prediction_line(cleaned, mode))
    seen: dict[str, int] = {}
    for row in rows:
        base_name = row["name"]
        seen[base_name] = seen.get(base_name, 0) + 1
        if seen[base_name] > 1:
            row["name"] = f"{base_name} #{seen[base_name]}"
    return rows


def load_prediction_file(path: Path, mode: str) -> list[dict[str, str]]:
    rows = parse_prediction_text(read_text_file(path), mode)
    if not rows:
        raise ValueError(f"{path.name} 没有解析到有效资料")
    return rows


def special_number(result: dict) -> str:
    for row in result.get("numbers", []):
        if row.get("special"):
            number = str(row.get("number", "")).strip()
            return number.zfill(2) if number.isdigit() else number
    return ""


def special_zodiac(result: dict) -> str:
    for row in result.get("numbers", []):
        if row.get("special"):
            return str(row.get("zodiac", "")).strip()
    zodiacs = result.get("zodiacs", [])
    return str(zodiacs[-1]).strip() if zodiacs else ""


def build_upload_queries(result: dict) -> dict[str, str]:
    zodiac_query = "".join(dict.fromkeys(
        str(item).strip().translate(SIMPLIFIED_ZODIAC)
        for item in result.get("zodiacs", [])
        if str(item).strip()
    ))
    tails = []
    for row in result.get("numbers", []):
        number = str(row.get("number", "")).strip()
        if number and number.isdigit():
            tails.append(f"{int(number) % 10}尾")
    tail_query = "".join(dict.fromkeys(tails))
    kill_two_query = special_number(result)
    if not zodiac_query or not tail_query or not re.fullmatch(r"(?:0[1-9]|[1-4][0-9])", kill_two_query):
        raise RuntimeError("没有识别到完整开奖结果")
    return {
        PINGTE_YIXIAO: zodiac_query,
        PINGTE_TAIL: tail_query,
        SHA_LIANG_XIAO: kill_two_query,
    }


def result_from_api_item(item: dict) -> dict:
    numbers = [value.strip().zfill(2) for value in str(item.get("openCode", "")).split(",")]
    zodiacs = [
        value.strip().translate(SIMPLIFIED_ZODIAC)
        for value in str(item.get("zodiac", "")).split(",")
    ]
    if len(numbers) < 7 or len(zodiacs) < 7:
        raise RuntimeError("开奖号字段不完整")
    rows = [
        {"number": number, "zodiac": zodiac, "special": index == 6}
        for index, (number, zodiac) in enumerate(zip(numbers, zodiacs))
    ]
    return {
        "issue": str(item.get("expect", "")),
        "draw_time": str(item.get("openTime", "")),
        "zodiacs": [row["zodiac"] for row in rows],
        "numbers": rows,
    }


def fetch_issue_result(issue: int) -> list[dict]:
    full_issue = issue if issue >= 10000 else int(f"{date.today().year}{issue:03d}")
    year = str(full_issue)[:4]
    request = Request(
        HISTORY_YEAR_URL.format(year=year),
        headers={"User-Agent": "Mozilla/5.0", "Referer": REFERER},
    )
    with urlopen(request, timeout=20) as response:
        payload = json.loads(response.read().decode("utf-8", errors="replace"))
    items = payload.get("data") if isinstance(payload, dict) else []
    return [result_from_api_item(item) for item in items if int(item.get("expect", 0)) == full_issue]


def build_mode_payloads(predictions: dict, queries: dict) -> dict:
    if set(predictions) != set(PROJECT_MODES) or set(queries) != set(PROJECT_MODES):
        raise ValueError("平特三个模式必须完整")

    normalized_queries = {
        PINGTE_YIXIAO: str(queries[PINGTE_YIXIAO]).strip(),
        PINGTE_TAIL: str(queries[PINGTE_TAIL]).strip(),
        SHA_LIANG_XIAO: str(queries[SHA_LIANG_XIAO]).strip(),
    }
    if not normalized_queries[PINGTE_YIXIAO] or any(
        char not in ZODIACS for char in normalized_queries[PINGTE_YIXIAO]
    ):
        raise ValueError("平特一肖 query 必须只含简体生肖字符")
    try:
        normalized_queries[PINGTE_TAIL] = parse_tail_content(normalized_queries[PINGTE_TAIL])
    except ValueError as exc:
        raise ValueError("平特尾 query 格式错误") from exc
    if not re.fullmatch(r"(?:0[1-9]|[1-4][0-9])", normalized_queries[SHA_LIANG_XIAO]):
        raise ValueError("杀两肖 query 必须是 01-49 的两位号码")

    modes = {}
    for mode_id in PROJECT_MODES:
        entries = clean_entries(predictions[mode_id])
        if not entries:
            raise ValueError(f"{mode_id} 至少需要一条有效资料")
        for entry in entries:
            content = entry["content"]
            if mode_id == PINGTE_YIXIAO:
                if any(char not in ZODIACS for char in content):
                    raise ValueError(f"平特一肖【{entry['name']}】只能填写简体生肖字符")
            elif mode_id == PINGTE_TAIL:
                try:
                    entry["content"] = parse_tail_content(content)
                except ValueError as exc:
                    raise ValueError(f"平特尾【{entry['name']}】格式错误") from exc
            elif len(content) != 2 or content[0] == content[1] or any(
                char not in ZODIACS for char in content
            ):
                raise ValueError(f"杀两肖【{entry['name']}】必须填写两个不同生肖")
        modes[mode_id] = {"query": normalized_queries[mode_id], "entries": entries}
    return modes
