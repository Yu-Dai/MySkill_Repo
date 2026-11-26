"""把 Excel 的底層數值依數字格式轉成顯示用的文字。

只處理常見格式：補零、小數位數、百分比、千分位、日期時間、前後綴文字。
其餘格式以一般數值輸出。
"""

import datetime
import re

BUILTIN = {
    0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00",
    9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??",
    37: "#,##0", 38: "#,##0", 39: "#,##0.00", 40: "#,##0.00", 48: "##0.0E+0",
    49: "@",
}
BUILTIN_DATE = {14, 15, 16, 17, 27, 28, 29, 30, 31, 34, 35, 36, 50, 51, 52, 53,
                54, 55, 56, 57, 58}
BUILTIN_TIME = {18, 19, 20, 21, 32, 33, 45, 46, 47}
BUILTIN_DATETIME = {22}

_INT_RE = re.compile(r"^-?\d+$")


def _strip_literals(code):
    """移除引號文字、方括號區段與跳脫字元，剩下的才是格式符號。"""
    code = re.sub(r'"[^"]*"', "", code)
    code = re.sub(r"\[[^\]]*\]", "", code)
    code = re.sub(r"\\.", "", code)
    code = re.sub(r"[_*].", "", code)
    return code


def date_kind(fmt_id, code):
    """回傳 'date'、'time'、'datetime' 或 None。"""
    if fmt_id in BUILTIN_DATE:
        return "date"
    if fmt_id in BUILTIN_TIME:
        return "time"
    if fmt_id in BUILTIN_DATETIME:
        return "datetime"
    if not code:
        return None
    bare = _strip_literals(code).lower()
    if "general" in bare:
        return None
    has_date = "y" in bare or "d" in bare
    has_time = "h" in bare or "s" in bare
    if not has_date and not has_time and "m" in bare:
        has_date = True
    if has_date and has_time:
        return "datetime"
    if has_date:
        return "date"
    if has_time:
        return "time"
    return None


def format_date(serial, kind, date1904):
    base = datetime.datetime(1904, 1, 1) if date1904 else datetime.datetime(1899, 12, 30)
    moment = base + datetime.timedelta(seconds=round(serial * 86400))
    if kind == "date":
        return moment.strftime("%Y-%m-%d")
    clock = moment.strftime("%H:%M:%S") if moment.second else moment.strftime("%H:%M")
    if kind == "time":
        return clock
    return moment.strftime("%Y-%m-%d ") + clock


def general(raw):
    """一般格式：整數原樣輸出，小數去掉浮點誤差。"""
    if _INT_RE.match(raw):
        return raw
    try:
        value = float(raw)
    except ValueError:
        return raw
    if value == int(value) and abs(value) < 1e15:
        return str(int(value))
    return format(value, ".15g")


def _split_affixes(section):
    """拆出數字格式前後的固定文字，例如 "0x"0000 的 0x、0.0"mV" 的 mV。"""
    tokens = []
    i = 0
    while i < len(section):
        ch = section[i]
        if ch == '"':
            end = section.find('"', i + 1)
            end = len(section) if end < 0 else end
            tokens.append(("lit", section[i + 1:end]))
            i = end + 1
        elif ch == "\\" and i + 1 < len(section):
            tokens.append(("lit", section[i + 1]))
            i += 2
        elif ch == "[":
            end = section.find("]", i)
            i = len(section) if end < 0 else end + 1
        elif ch in "_*" and i + 1 < len(section):
            i += 2
        else:
            tokens.append(("fmt", ch))
            i += 1
    digit_positions = [n for n, (kind, ch) in enumerate(tokens)
                       if kind == "fmt" and ch in "0#?"]
    if not digit_positions:
        return None
    first, last = digit_positions[0], digit_positions[-1]
    prefix = "".join(ch for kind, ch in tokens[:first] if kind == "lit" or ch in "$-+ ")
    suffix = "".join(ch for kind, ch in tokens[last + 1:] if kind == "lit" or ch in "% ")
    core = "".join(ch for kind, ch in tokens[first:last + 1] if kind == "fmt")
    return prefix, core, suffix


def format_number(raw, fmt_id, code, date1904=False):
    """raw 是 XML 裡的數值字串。回傳顯示文字。"""
    if code is None:
        code = BUILTIN.get(fmt_id, "General")
    try:
        value = float(raw)
    except ValueError:
        return raw

    kind = date_kind(fmt_id, code)
    if kind:
        try:
            return format_date(value, kind, date1904)
        except (OverflowError, ValueError):
            return general(raw)

    negative = value < 0
    sections = code.split(";")
    section = sections[0]
    if negative and len(sections) > 1:
        section = sections[1]
    bare = _strip_literals(section)
    if "general" in bare.lower() or "@" in bare or "E+" in bare.upper() or "/" in bare:
        return general(raw)

    parts = _split_affixes(section)
    if parts is None:
        return general(raw)
    prefix, core, suffix = parts

    if "%" in suffix or "%" in bare:
        value *= 100
    int_part, _, dec_part = core.partition(".")
    decimals = sum(1 for ch in dec_part if ch in "0#?")
    min_digits = int_part.count("0")
    thousands = "," in int_part

    text = format(abs(value), (",." if thousands else ".") + str(decimals) + "f")
    whole, _, frac = text.partition(".")
    digits_only = whole.replace(",", "")
    if len(digits_only) < min_digits:
        whole = digits_only.zfill(min_digits)
    text = whole + ("." + frac if frac else "")
    # 負數一律保留負號，不沿用括號或紅字等呈現方式
    sign = "-" if negative and float(text.replace(",", "")) != 0 else ""
    return sign + prefix + text + suffix
