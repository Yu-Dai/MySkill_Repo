"""Markdown 輸出的共用工具。"""

import hashlib
import json
import os
import re


class Result:
    """單一檔案的轉檔結果。"""

    def __init__(self, markdown, warnings=None, stats=None, source_texts=None):
        self.markdown = markdown
        self.warnings = warnings or []
        self.stats = stats or {}
        # 來源中每一段應該出現在輸出裡的文字，用來做文字覆蓋檢查
        self.source_texts = source_texts or []


def escape_cell(text):
    """讓文字可以安全放進 Markdown 表格的儲存格。"""
    text = text.replace("\r\n", "\n").replace("\r", "\n").strip()
    text = text.replace("\\", "\\\\").replace("|", "\\|")
    return text.replace("\n", "<br>")


def front_matter(fields):
    """輸出 YAML front matter。字串與清單用 JSON 寫法，這在 YAML 裡同樣合法。"""
    lines = ["---"]
    for key, value in fields:
        if value is None:
            continue
        if isinstance(value, (list, str)) and key not in ("type", "mode"):
            value = json.dumps(value, ensure_ascii=False)
        lines.append("%s: %s" % (key, value))
    lines.append("---")
    return "\n".join(lines)


def table(header, rows):
    """header 與 rows 都是已經 escape 過的字串清單。"""
    out = ["| " + " | ".join(header) + " |",
           "|" + "|".join("---" for _ in header) + "|"]
    for row in rows:
        out.append("| " + " | ".join(row) + " |")
    return "\n".join(out)


def render_grid(grid, merges, col_label=None):
    """把二維表格整理成 (標題列文字, 表頭, 資料列)。

    grid 是已經把合併儲存格填滿的原始文字；merges 是 (列1, 欄1, 列2, 欄2)，從 0 起算。
    表格上方橫跨整張表的單一文字視為標題；多列表頭依合併儲存格判斷並壓平。
    """
    col_label = col_label or (lambda c: "欄 %d" % (c + 1))
    n_rows, n_cols = len(grid), len(grid[0])

    def covered(row):
        return any(r1 <= row <= r2 and c1 == 0 and c2 == n_cols - 1
                   for r1, c1, r2, c2 in merges)

    captions = []
    top = 0
    while top < n_rows - 1:
        values = [value for value in grid[top] if value]
        single = len(values) == 1
        merged_title = len(set(values)) == 1 and covered(top)
        if not (single or merged_title):
            break
        captions.append(escape_cell(values[0]))
        top += 1

    depth = 1
    for r1, c1, r2, c2 in merges:
        if r1 != top:
            continue
        depth = max(depth, r2 - r1 + 1)
        if r2 == r1 and c2 > c1 and top + 1 < n_rows:
            if len(set(grid[top + 1][c1:c2 + 1])) > 1:
                depth = max(depth, 2)
    depth = min(depth, n_rows - top)

    header = []
    for c in range(n_cols):
        parts = []
        for r in range(top, top + depth):
            value = escape_cell(grid[r][c])
            if value and (not parts or parts[-1] != value):
                parts.append(value)
        header.append(" / ".join(parts) if parts else col_label(c))
    rows = [[escape_cell(value) for value in row] for row in grid[top + depth:]]
    return captions, header, rows


class AssetWriter:
    """把圖片寫到 檔名_assets/ 資料夾。相同內容只存一份。"""

    def __init__(self, out_dir, stem):
        self.dir_name = stem + "_assets"
        self.dir_path = os.path.join(out_dir, self.dir_name)
        self._by_hash = {}
        self._count = 0

    def save(self, data, ext, prefix="img"):
        digest = hashlib.sha1(data).hexdigest()
        if digest in self._by_hash:
            return self._by_hash[digest]
        self._count += 1
        name = "%s-%03d%s" % (prefix, self._count, ext.lower())
        os.makedirs(self.dir_path, exist_ok=True)
        with open(os.path.join(self.dir_path, name), "wb") as handle:
            handle.write(data)
        rel = self.dir_name + "/" + name
        self._by_hash[digest] = rel
        return rel


_NOISE = re.compile(r"\s+|\\|<br>")


def _normalize(text):
    return _NOISE.sub("", text)


def check_coverage(result):
    """回傳來源中沒有出現在輸出裡的文字清單。比對時忽略空白、跳脫字元與換行標記。"""
    haystack = _normalize(result.markdown)
    missing = []
    for text in result.source_texts:
        needle = _normalize(text)
        if needle and needle not in haystack:
            missing.append(text)
    return missing
