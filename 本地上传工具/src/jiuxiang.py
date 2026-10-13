from __future__ import annotations

import base64
import json
import re
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from common import is_count_ranking_header, read_text_file as read_text


MODE_BY_LABEL = {
    "半头": "shabantou",
    "头": "shayitou",
    "一波": "shayibo",
    "半波": "shabanbo",
    "合": "shayihe",
    "肖": "shayixiao",
    "肖-新增": "shayixiao2",
    "段": "shayiduan",
    "五行": "shayihang",
    "尾": "shayiwei",
}

MODE_DISPLAY_NAMES = {
    "shabantou": "杀半头",
    "shayitou": "杀一头",
    "shayibo": "杀一波",
    "shabanbo": "杀半波",
    "shayihe": "杀一合",
    "shayixiao": "杀一肖",
    "shayixiao2": "杀肖第二版",
    "shayiduan": "杀一段",
    "shayihang": "杀一行",
    "shayiwei": "杀一尾",
}

REQUIRED_LABELS = tuple(MODE_BY_LABEL)
REQUIRED_MODES = tuple(MODE_BY_LABEL[label] for label in REQUIRED_LABELS)

STOP_PATTERNS = (
    "排行",
    "排行榜",
    "当前合数排行",
    "尾数 次数",
    "内容 次数",
    "生肖次数排行榜",
    "前一期失败统计",
)

MODE_CONTENT_PATTERNS = {
    "shabantou": re.compile(r"^[0-4]头[单双]$"),
    "shayitou": re.compile(r"^[0-4]头$"),
    "shayibo": re.compile(r"^[红蓝绿]波$"),
    "shabanbo": re.compile(r"^[红蓝绿][单双]$"),
    "shayihe": re.compile(r"^(?:0?[1-9]|1[0-3])合$"),
    "shayixiao": re.compile(r"^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$"),
    "shayixiao2": re.compile(r"^[鼠牛虎兔龙蛇马羊猴鸡狗猪]$"),
    "shayiduan": re.compile(r"^[1-7]段$"),
    "shayihang": re.compile(r"^[金木水火土]行$"),
    "shayiwei": re.compile(r"^[0-9]尾$"),
}

SHAYITOU_TWO_HEAD_DIRECTORY_NAMES = frozenset(
    {
        "往事如烟", "米津玄师", "兴隆大业", "王报传奇", "彩梦码人", "伯温传世",
        "码王财金", "春水初生", "千方百计", "善良没用", "楚云潇雨", "余味回甘",
        "知小谋大", "囧囧有神", "举世瞩目", "妙不可及", "皇牌富翁", "两全其美",
        "同声同气", "一生所爱", "星河泛滥", "一抹晚霞", "刻苦专研", "毁家纾难",
        "精品秘籍", "千佳万富", "神彩皇牌", "且听且行", "北风呼啸", "算彩才子",
        "金牌好料", "必赢玄机", "地主之谊", "神码透料", "三彩联盟", "财神秘籍",
        "招财神手", "月明如水",
    }
)

RESULT_URL = "https://h5.492947.com:8443/index"
RESULT_API_HOSTS = (
    "https://api22.4c9api2.com",
    "https://api.4a9api0.com:8443",
    "https://api2.4c9api2.com:8443",
    "https://api3.4d9api3.com:8443",
    "https://api4.4k9api4.com:8443",
)
RESULT_AES_KEY = b"d7f404619cbb59ci"

_FILE_NAME_PATTERN = re.compile(
    r"(\d+)期-(半头|头|一波|半波|合|肖-新增|肖|段|五行|尾)\.txt",
    re.IGNORECASE,
)
_RESERVED_NAME_PATTERN = re.compile(r"^_*QUERY_*$", re.IGNORECASE)
_DRAW_NUMBER_PATTERN = re.compile(r"^(?:0[1-9]|[1-4][0-9])$")


@dataclass(frozen=True)
class TxtFile:
    path: Path
    issue: str
    label: str
    mode: str


def find_txt_files(folder: str | Path) -> list[TxtFile]:
    base = Path(folder)
    if not base.is_dir():
        raise FileNotFoundError(f"搜索文件夹不存在：{base}")

    found: list[TxtFile] = []
    candidates = sorted(
        (path for path in base.rglob("*") if path.is_file() and path.suffix.lower() == ".txt"),
        key=lambda path: str(path).casefold(),
    )
    for path in candidates:
        match = _FILE_NAME_PATTERN.fullmatch(path.name)
        if not match:
            continue
        issue, label = match.groups()
        found.append(TxtFile(path=path, issue=issue, label=label, mode=MODE_BY_LABEL[label]))
    return found


def parse_txt_content(mode: str, text: str) -> list[dict[str, str]]:
    lines = [
        line.strip()
        for line in str(text or "").splitlines()
        if line.strip() and not _is_data_header(line)
    ]
    if mode == "shabantou":
        lines = _extract_half_head_lines(lines)
    elif mode == "shayibo":
        lines = _extract_one_wave_lines(lines)
    else:
        lines = _drop_summary_lines(lines)

    rows = [_parse_data_line(mode, line) for line in lines]
    rows = [row for row in rows if row["content"] and row["name"]]
    _validate_mode_rows(mode, rows)
    return _require_unique_names(rows)


def load_txt_bundle(folder: str | Path) -> tuple[str, dict[str, TxtFile], dict[str, list[dict[str, str]]]]:
    found = find_txt_files(folder)
    if not found:
        expected = " / ".join(f"N期-{label}.txt" for label in REQUIRED_LABELS)
        raise ValueError(f"没有找到九项 TXT：{expected}")

    files: dict[str, TxtFile] = {}
    for item in found:
        previous = files.get(item.mode)
        if previous is not None:
            raise ValueError(
                f"{MODE_DISPLAY_NAMES[item.mode]}检测到重复文件："
                f"{previous.path.name} / {item.path.name}"
            )
        files[item.mode] = item

    issues = sorted({item.issue for item in found})
    if len(issues) != 1:
        raise ValueError(f"TXT 期号不一致：{', '.join(issues)}")

    missing = [label for label in REQUIRED_LABELS if MODE_BY_LABEL[label] not in files]
    if missing:
        names = " / ".join(f"{issues[0]}期-{label}.txt" for label in missing)
        raise ValueError(f"缺少TXT文件：{names}")

    parsed: dict[str, list[dict[str, str]]] = {}
    for mode in REQUIRED_MODES:
        rows = parse_txt_content(mode, read_text(files[mode].path))
        if not rows:
            raise ValueError(f"{files[mode].path.name} 没有解析到有效资料")
        parsed[mode] = rows
    return issues[0], files, parsed


def build_mode_payloads(
    parsed: dict[str, list[dict[str, str]]], draw_number: str
) -> dict[str, dict[str, object]]:
    query = str(draw_number or "").strip()
    if _DRAW_NUMBER_PATTERN.fullmatch(query) is None:
        raise ValueError("开奖号必须是 01-49 的两位数字")

    missing = [mode for mode in REQUIRED_MODES if mode not in parsed]
    extras = [mode for mode in parsed if mode not in REQUIRED_MODES]
    if missing or extras:
        raise ValueError("九项模式必须完整且不能包含未知模式")

    modes: dict[str, dict[str, object]] = {}
    for mode in REQUIRED_MODES:
        source_rows = parsed[mode]
        if not isinstance(source_rows, list) or not source_rows:
            raise ValueError(f"{MODE_DISPLAY_NAMES[mode]}至少需要一条目录资料")
        rows = [
            {
                "name": str(row.get("name") or "").strip(),
                "content": str(row.get("content") or "").strip(),
            }
            for row in source_rows
            if isinstance(row, dict)
        ]
        if len(rows) != len(source_rows) or any(not row["name"] or not row["content"] for row in rows):
            raise ValueError(f"{MODE_DISPLAY_NAMES[mode]}包含空目录名或空内容")
        _validate_mode_rows(mode, rows)
        _require_unique_names(rows)
        modes[mode] = {"query": query, "entries": rows}
    return modes


def fetch_draw_number(year: int | None = None) -> str:
    import requests

    requests.packages.urllib3.disable_warnings()
    params = {"lotteryType": "2", "year": str(year or date.today().year)}
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) TXTLocalUploader/1.0",
        "Accept": "application/json, text/plain, */*",
        "Origin": "https://h5.492947.com:8443",
        "Referer": RESULT_URL,
        "Encipher": "enable",
    }
    last_error: Exception | None = None
    for host in RESULT_API_HOSTS:
        try:
            response = requests.get(
                f"{host}/api/v1/liuhe/numbers",
                params=params,
                timeout=20,
                verify=False,
                headers=headers,
            )
            response.raise_for_status()
            payload = response.json()
            if payload.get("status") != 20000:
                raise ValueError(payload.get("message") or "开奖号接口状态异常")
            data = payload.get("data")
            if isinstance(data, str):
                data = _decrypt_draw_data(data)
            return _parse_draw_payload(data)
        except Exception as exc:
            last_error = exc
    raise ValueError(f"开奖号抓取失败：{last_error}")


def _decrypt_draw_data(encrypted_data: str) -> object:
    from Crypto.Cipher import AES
    from Crypto.Util.Padding import unpad

    cipher = AES.new(RESULT_AES_KEY, AES.MODE_CBC, iv=RESULT_AES_KEY)
    decrypted = unpad(cipher.decrypt(base64.b64decode(encrypted_data)), AES.block_size)
    return json.loads(decrypted.decode("utf-8"))


def _parse_draw_payload(data: object) -> str:
    if isinstance(data, str):
        data = json.loads(data)
    if not isinstance(data, dict):
        raise ValueError("开奖号数据格式不正确")

    special = data.get("te_attr")
    if isinstance(special, dict) and special.get("number"):
        number = int(str(special["number"]).strip())
    else:
        numbers = [value for value in str(data.get("number", "")).split() if value]
        if not numbers:
            raise ValueError("开奖号数据没有号码")
        number = int(numbers[-1])
    if number < 1 or number > 49:
        raise ValueError(f"开奖号超出范围：{number}")
    return f"{number:02d}"


def _extract_half_head_lines(lines: list[str]) -> list[str]:
    marker_index = next((index for index, line in enumerate(lines) if "当期数据" in line), -1)
    if marker_index >= 0:
        lines = lines[marker_index + 1 :]

    output: list[str] = []
    for line in lines:
        if line.startswith("=") or re.fullmatch(r"内容\s+网站名称", line):
            continue
        if _is_summary_line(line):
            break
        if re.fullmatch(r"排名\s+内容\s+数量\s+网站", line):
            break
        if re.match(r"^\d+\s+[0-4]头[单双]\s+\d+\s+", line):
            break
        if re.match(r"^[0-4]头[单双]\s+\S+", line):
            output.append(line)
    return output


def _is_summary_line(line: str) -> bool:
    normalized = re.sub(r"\s+", " ", line.strip())
    return is_count_ranking_header(normalized) or any(
        pattern in normalized for pattern in STOP_PATTERNS
    )


def _drop_summary_lines(lines: list[str]) -> list[str]:
    for index, line in enumerate(lines):
        if _is_summary_line(line):
            return lines[:index]
    return lines


def _extract_one_wave_lines(lines: list[str]) -> list[str]:
    return [
        line
        for line in _drop_summary_lines(lines)
        if not re.fullmatch(r"内容\s+名称", line)
        and re.match(r"^(红波|绿波|蓝波)\s+\S+", line)
    ]


def _parse_data_line(mode: str, line: str) -> dict[str, str]:
    cleaned = re.sub(r"[\u200b-\u200d\ufeff]", "", line).strip()
    if mode == "shayitou":
        match = re.fullmatch(r"([0-4]头)[\s,，、|/;；]+([0-4]头)\s+(.+)", cleaned)
        if match:
            first_head, second_head, name = match.groups()
            return {"content": f"{first_head},{second_head}", "name": name.strip()}
    if mode == "shayiwei":
        match = re.fullmatch(r"((?:[0-9]尾[\s,，、|/;；]+)+)(.+)", cleaned)
        if match:
            tails = re.findall(r"[0-9]尾", match.group(1))
            return {"content": ",".join(tails), "name": match.group(2).strip()}
    parts = re.split(r"\s+", cleaned, maxsplit=1)
    if len(parts) == 1:
        return {"content": parts[0], "name": ""}
    return {"content": parts[0].strip(), "name": parts[1].strip()}


def _is_data_header(line: str) -> bool:
    normalized = re.sub(r"\s+", " ", line.strip())
    return re.fullmatch(r"内容 (?:名称|网站名称|目录名|资料名|网站)", normalized) is not None


def _validate_mode_rows(mode: str, rows: list[dict[str, str]]) -> None:
    pattern = MODE_CONTENT_PATTERNS.get(mode)
    if pattern is None:
        raise ValueError(f"未知分类：{mode}")
    for row in rows:
        tokens = [
            token.strip()
            for token in re.split(r"[,，、|/;；]+", row["content"])
            if token.strip()
        ]
        if not tokens or any(pattern.fullmatch(token) is None for token in tokens):
            raise ValueError(
                f"{MODE_DISPLAY_NAMES[mode]}无效内容：{row['content']}（目录：{row['name']}）"
            )
        if mode == "shayiwei":
            if not 1 <= len(tokens) <= 2 or len(set(tokens)) != len(tokens):
                raise ValueError(
                    f"杀一尾目录【{row['name']}】必须填写一至两个不同尾数"
                )
        if mode == "shayitou":
            required_count = 2 if row["name"] in SHAYITOU_TWO_HEAD_DIRECTORY_NAMES else 1
            if len(tokens) != required_count or len(set(tokens)) != required_count:
                requirement = "两个不同头数" if required_count == 2 else "一个头数"
                raise ValueError(f"杀一头目录【{row['name']}】必须填写{requirement}")
        if _RESERVED_NAME_PATTERN.fullmatch(row["name"]):
            raise ValueError(f"{row['name']} 是系统保留目录名")


def _require_unique_names(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    seen: set[str] = set()
    duplicates: list[str] = []
    for row in rows:
        name = row["name"]
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)
    if duplicates:
        raise ValueError(f"目录名重复：{', '.join(duplicates)}")
    return rows
