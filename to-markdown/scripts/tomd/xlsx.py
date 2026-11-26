"""xlsx 轉 Markdown。直接解析壓縮檔內的 XML，不依賴第三方套件。"""

import os
import re
import zipfile

from . import CONVERTER, mdutil, numfmt
from .ooxml import main_part, read_xml as _read_xml, rels as _rels

_REF_RE = re.compile(r"^([A-Za-z]+)(\d+)$")


# ---------- 座標工具 ----------

def col_index(letters):
    n = 0
    for ch in letters.upper():
        n = n * 26 + ord(ch) - 64
    return n


def col_letters(n):
    out = ""
    while n:
        n, rem = divmod(n - 1, 26)
        out = chr(65 + rem) + out
    return out


def _parse_ref(ref):
    match = _REF_RE.match(ref.replace("$", ""))
    return int(match.group(2)), col_index(match.group(1))


def _ref(row, col):
    return col_letters(col) + str(row)


# ---------- 活頁簿層級 ----------

def _rich_text(node):
    """讀取字串節點的文字，略過注音標示。"""
    parts = []
    for child in node:
        if child.tag == "t":
            parts.append(child.text or "")
        elif child.tag == "r":
            parts.extend(t.text or "" for t in child.iter("t"))
    return "".join(parts)


def _shared_strings(archive, path):
    root = _read_xml(archive, path) if path else None
    if root is None:
        return []
    return [_rich_text(si) for si in root.iter("si")]


def _styles(archive, path):
    """回傳每個儲存格樣式對應的 (格式編號, 格式碼)。"""
    root = _read_xml(archive, path) if path else None
    if root is None:
        return []
    custom = {}
    for fmt in root.iter("numFmt"):
        custom[int(fmt.get("numFmtId"))] = fmt.get("formatCode", "")
    xfs = root.find("cellXfs")
    out = []
    for xf in (xfs if xfs is not None else []):
        fmt_id = int(xf.get("numFmtId", "0"))
        out.append((fmt_id, custom.get(fmt_id)))
    return out


# ---------- 工作表 ----------

class Sheet:
    def __init__(self, name):
        self.name = name
        self.cells = {}       # (列, 欄) -> 顯示文字，只放非空的格子
        self.merges = []      # (列1, 欄1, 列2, 欄2)
        self.comments = []    # (儲存格, 文字)
        self.images = []      # (列, 欄, 相對連結)
        self.uncached = 0     # 沒有計算結果的公式數量


def _cell_text(cell, shared, styles, date1904, sheet):
    kind = cell.get("t", "n")
    value_node = cell.find("v")
    raw = value_node.text if value_node is not None and value_node.text else ""
    if kind == "inlineStr":
        node = cell.find("is")
        return _rich_text(node) if node is not None else ""
    if not raw:
        if cell.find("f") is not None:
            sheet.uncached += 1
        return ""
    if kind == "s":
        index = int(raw)
        return shared[index] if index < len(shared) else ""
    if kind == "b":
        return "TRUE" if raw == "1" else "FALSE"
    if kind in ("str", "e", "d"):
        return raw
    style = int(cell.get("s", "0"))
    fmt_id, code = styles[style] if style < len(styles) else (0, None)
    return numfmt.format_number(raw, fmt_id, code, date1904)


def _load_sheet(archive, path, name, shared, styles, date1904, assets):
    root = _read_xml(archive, path)
    sheet = Sheet(name)
    if root is None:
        return sheet

    data = root.find("sheetData")
    next_row = 1
    for row in (data if data is not None else []):
        row_no = int(row.get("r", next_row))
        next_row = row_no + 1
        next_col = 1
        for cell in row.iter("c"):
            ref = cell.get("r")
            col_no = _parse_ref(ref)[1] if ref else next_col
            next_col = col_no + 1
            text = _cell_text(cell, shared, styles, date1904, sheet)
            if text.strip():
                sheet.cells[(row_no, col_no)] = text

    for merge in root.iter("mergeCell"):
        ref = merge.get("ref", "")
        if ":" not in ref:
            continue
        first, last = ref.split(":")
        r1, c1 = _parse_ref(first)
        r2, c2 = _parse_ref(last)
        sheet.merges.append((r1, c1, r2, c2))
        value = sheet.cells.get((r1, c1))
        if value is None:
            continue
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                sheet.cells[(r, c)] = value

    for rel_type, target in _rels(archive, path).values():
        if rel_type.endswith("/comments"):
            _load_comments(archive, target, sheet)
        elif rel_type.endswith("/drawing"):
            _load_images(archive, target, sheet, assets)
    return sheet


def _load_comments(archive, path, sheet):
    root = _read_xml(archive, path)
    if root is None:
        return
    for comment in root.iter("comment"):
        node = comment.find("text")
        text = _rich_text(node).strip() if node is not None else ""
        if text:
            sheet.comments.append((comment.get("ref", ""), text))


def _load_images(archive, path, sheet, assets):
    root = _read_xml(archive, path)
    if root is None:
        return
    rels = _rels(archive, path)
    for anchor in root:
        if not anchor.tag.endswith("Anchor"):
            continue
        start = anchor.find("from")
        row = col = None
        if start is not None:
            row = int(start.findtext("row", "0")) + 1
            col = int(start.findtext("col", "0")) + 1
        for blip in anchor.iter("blip"):
            target = rels.get(blip.get("r:embed"))
            if not target:
                continue
            try:
                data = archive.read(target[1])
            except KeyError:
                continue
            link = assets.save(data, os.path.splitext(target[1])[1] or ".bin")
            sheet.images.append((row, col, link))


# ---------- 區塊偵測 ----------

def _groups(values):
    """把排序後的整數切成連續區段。"""
    out = []
    for value in sorted(values):
        if out and value == out[-1][1] + 1:
            out[-1][1] = value
        else:
            out.append([value, value])
    return out


def _split_blocks(keys, by_rows=True, depth=0):
    """以整列空白、整欄空白遞迴切開，回傳每個區塊的儲存格座標集合。"""
    if not keys:
        return []
    axis = 0 if by_rows else 1
    spans = _groups({key[axis] for key in keys})
    parts = [{key for key in keys if low <= key[axis] <= high} for low, high in spans]
    if len(parts) == 1 and depth > 0:
        return parts
    if depth >= 6:
        return parts
    out = []
    for part in parts:
        out.extend(_split_blocks(part, not by_rows, depth + 1))
    return out


def _bounds(keys):
    rows = [r for r, _ in keys]
    cols = [c for _, c in keys]
    return min(rows), min(cols), max(rows), max(cols)


def _render_block(sheet, keys, number, out, source_texts):
    r1, c1, r2, c2 = _bounds(keys)
    esc = mdutil.escape_cell
    cell = lambda r, c: sheet.cells.get((r, c), "")
    span = "%s:%s" % (_ref(r1, c1), _ref(r2, c2))

    if c1 == c2:
        # 只有一欄：視為說明文字
        out.append("### Text %d (%s)" % (number, span))
        for r in range(r1, r2 + 1):
            if cell(r, c1):
                out.append(esc(cell(r, c1)))
        return {"kind": "text", "range": span}

    out.append("### Table %d (%s)" % (number, span))
    grid = [[cell(r, c) for c in range(c1, c2 + 1)] for r in range(r1, r2 + 1)]
    merges = [(m_r1 - r1, m_c1 - c1, m_r2 - r1, m_c2 - c1)
              for m_r1, m_c1, m_r2, m_c2 in sheet.merges
              if m_r1 >= r1 and m_r2 <= r2 and m_c1 >= c1 and m_c2 <= c2]
    captions, header, rows = mdutil.render_grid(
        grid, merges, lambda c: "欄 " + col_letters(c1 + c))
    out.extend("**%s**" % text for text in captions)
    out.append(mdutil.table(header, rows))
    return {"kind": "table", "range": span, "rows": len(rows), "cols": len(header)}


def _render_sheet(sheet, out, source_texts, stats):
    out.append("## Sheet: %s" % sheet.name)
    if not sheet.cells and not sheet.images:
        out.append("（空白工作表）")
        return

    blocks = _split_blocks(set(sheet.cells))
    blocks.sort(key=lambda keys: _bounds(keys)[:2])
    pending = list(sheet.images)
    for number, keys in enumerate(blocks, 1):
        stats.append(_render_block(sheet, keys, number, out, source_texts))
        r1, c1, r2, c2 = _bounds(keys)
        inside = [img for img in pending
                  if img[0] is not None and r1 <= img[0] <= r2 and c1 <= img[1] <= c2]
        for img in inside:
            pending.remove(img)
            out.append("![圖片（錨定 %s）](%s)" % (_ref(img[0], img[1]), img[2]))

    for row, col, link in pending:
        where = "錨定 " + _ref(row, col) if row else "未錨定"
        out.append("![圖片（%s）](%s)" % (where, link))

    if sheet.comments:
        out.append("**儲存格註解**")
        out.append("\n".join("- %s：%s" % (ref, mdutil.escape_cell(text))
                             for ref, text in sheet.comments))

    source_texts.extend(mdutil.escape_cell(text) for text in set(sheet.cells.values()))


# ---------- 進入點 ----------

def convert(path, out_dir, options):
    name = os.path.basename(path)
    stem = os.path.splitext(name)[0]
    assets = mdutil.AssetWriter(out_dir, stem)
    warnings = []

    with zipfile.ZipFile(path) as archive:
        book_path = main_part(archive, "xl/workbook.xml")
        book = _read_xml(archive, book_path)
        if book is None:
            raise ValueError("找不到活頁簿內容，檔案可能損毀或不是 xlsx")
        rels = _rels(archive, book_path)
        by_type = {rel_type.rsplit("/", 1)[-1]: target for rel_type, target in rels.values()}
        shared = _shared_strings(archive, by_type.get("sharedStrings"))
        styles = _styles(archive, by_type.get("styles"))
        props = book.find("workbookPr")
        date1904 = props is not None and props.get("date1904") in ("1", "true")

        sheets, skipped = [], []
        for node in book.iter("sheet"):
            sheet_name = node.get("name", "")
            hidden = node.get("state", "visible") != "visible"
            if hidden and not options.get("include_hidden_sheets"):
                skipped.append(sheet_name)
                continue
            target = rels.get(node.get("r:id"))
            if not target:
                continue
            sheets.append(_load_sheet(archive, target[1], sheet_name, shared,
                                      styles, date1904, assets))

    out = [mdutil.front_matter([
        ("source", name), ("type", "xlsx"), ("converter", CONVERTER),
        ("mode", options.get("mode", "fast")),
        ("sheets", [sheet.name for sheet in sheets]),
        ("hidden_sheets_skipped", skipped or None),
    ]), "# " + name]

    source_texts, stats = [], []
    for sheet in sheets:
        _render_sheet(sheet, out, source_texts, stats)
        if sheet.uncached:
            warnings.append("工作表「%s」有 %d 個公式沒有儲存計算結果，該格輸出為空"
                            % (sheet.name, sheet.uncached))

    tables = [item for item in stats if item["kind"] == "table"]
    return mdutil.Result(
        "\n\n".join(out) + "\n", warnings,
        {"sheets": len(sheets), "tables": len(tables),
         "rows": sum(item["rows"] for item in tables)},
        source_texts)
