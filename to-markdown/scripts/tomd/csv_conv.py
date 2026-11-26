"""csv 轉 Markdown。"""

import csv
import io
import os

from . import CONVERTER, mdutil


def _decode(data):
    """依序嘗試 BOM、UTF-8、Big5。回傳 (文字, 編碼名稱)。"""
    if data.startswith(b"\xef\xbb\xbf"):
        return data[3:].decode("utf-8", errors="replace"), "utf-8-sig"
    if data.startswith((b"\xff\xfe", b"\xfe\xff")):
        return data.decode("utf-16", errors="replace"), "utf-16"
    for encoding in ("utf-8", "cp950"):
        try:
            return data.decode(encoding), encoding
        except UnicodeDecodeError:
            continue
    return data.decode("latin-1"), "latin-1"


def _delimiter(text):
    sample = text[:20000]
    try:
        return csv.Sniffer().sniff(sample, delimiters=",;\t|").delimiter
    except csv.Error:
        first = sample.split("\n", 1)[0]
        return max(",;\t|", key=first.count) if first else ","


def convert(path, out_dir, options):
    name = os.path.basename(path)
    with open(path, "rb") as handle:
        text, encoding = _decode(handle.read())
    warnings = []
    if encoding == "latin-1":
        warnings.append("無法判斷編碼，以 latin-1 讀取，非英文字元可能是亂碼")

    delimiter = _delimiter(text)
    rows = [row for row in csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
            if any(cell.strip() for cell in row)]

    out = [mdutil.front_matter([
        ("source", name), ("type", "csv"), ("converter", CONVERTER),
        ("mode", options.get("mode", "fast")),
        ("encoding", encoding),
        ("delimiter", "\\t" if delimiter == "\t" else delimiter),
    ]), "# " + name]

    if not rows:
        out.append("（空白檔案）")
        return mdutil.Result("\n\n".join(out) + "\n", warnings, {"tables": 0, "rows": 0})

    width = max(len(row) for row in rows)
    esc = mdutil.escape_cell
    grid = [[esc(cell) for cell in row] + [""] * (width - len(row)) for row in rows]
    header = [cell or "欄 %d" % (index + 1) for index, cell in enumerate(grid[0])]
    body = grid[1:]
    out.append("### Table 1 (%d 欄 × %d 列)" % (width, len(body)))
    out.append(mdutil.table(header, body))

    source_texts = {cell for row in grid for cell in row if cell}
    return mdutil.Result("\n\n".join(out) + "\n", warnings,
                         {"tables": 1, "rows": len(body)}, sorted(source_texts))
