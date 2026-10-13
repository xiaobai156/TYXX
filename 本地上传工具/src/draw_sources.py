from __future__ import annotations

import re

import requests


MACAU_API_URL = "https://macaumarksix.com/api/macaujc2.com"
MACAU_REFERER = "https://macaujc.com/"
ZODIACS = "鼠牛虎兔龙蛇马羊猴鸡狗猪"
TO_SIMPLIFIED = str.maketrans({"雞": "鸡", "馬": "马", "豬": "猪", "龍": "龙"})


def extract_macau_latest(payload: dict) -> tuple[str, str, str]:
    numbers = [
        value.strip().zfill(2)
        for value in str(payload.get("openCode") or "").split(",")
        if value.strip()
    ]
    zodiacs = [
        value.strip().translate(TO_SIMPLIFIED)
        for value in str(payload.get("zodiac") or "").split(",")
        if value.strip()
    ]
    issue = str(payload.get("expect") or "").strip()
    if len(numbers) < 7 or len(zodiacs) < 7 or not issue:
        raise RuntimeError(f"macaujc 开奖号字段不完整：{payload}")
    number = numbers[-1]
    zodiac = zodiacs[-1]
    if not re.fullmatch(r"(?:0[1-9]|[1-4][0-9])", number) or zodiac not in ZODIACS:
        raise RuntimeError(f"macaujc 开奖号字段不正确：{payload}")
    return number, zodiac, issue


def fetch_macau_latest() -> tuple[str, str, str]:
    response = requests.get(
        MACAU_API_URL,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36",
            "Referer": MACAU_REFERER,
        },
        timeout=20,
    )
    response.raise_for_status()
    body = response.json()
    if not isinstance(body, list) or not body:
        raise RuntimeError(f"macaujc 开奖接口数据格式不正确：{body}")
    return extract_macau_latest(body[0])
