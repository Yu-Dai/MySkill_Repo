"""pdf 轉 Markdown（快速模式）。

需要第三方套件 pdfplumber 與 pypdfium2。做法：
- 有文字層的頁面：抽文字、依字級判斷標題、抽有框線的表格、把內嵌圖片存成旁檔。
- 腳本無法可靠處理的頁面（掃描、向量圖形、疑似無框線表格）：附整頁截圖連結。
"""

import collections
import io
import os
import re
import statistics

from . import CONVERTER, mdutil

_MARGIN = 0.07             # 頁面上下各 7% 視為頁首頁尾區
_MIN_IMAGE_PT = 28         # 邊長小於這個值的圖片略過
_RENDER_SCALE = 2          # 截圖解析度倍率（1 = 72 dpi）
# 字距判斷依字級比例，否則字距緊的文件（例如部分原廠 datasheet）單字會黏在一起
_TEXT = {"x_tolerance_ratio": 0.15}
_BULLET_RE = re.compile(r"^(?:[•●▪■◦‣·\-–—*\uf000-\uf8ff]|\(?\d{1,2}[.)]|\(?[a-zA-Z][.)])\s+")
_NUMBERED_RE = re.compile(r"^\d+(?:\.\d+)*\.?\s+\S")
_CJK_RE = re.compile(r"[　-鿿＀-￯]")
_DIGITS_RE = re.compile(r"\d+")
_PUA_RE = re.compile(r"[\uf000-\uf8ff]")
_LEADER_RE = re.compile(r"(?:\s*\.){4,}\s*")


def _load_libs():
    try:
        import pdfplumber
        import pypdfium2
    except ImportError:
        raise RuntimeError(
            "PDF 轉檔需要 pdfplumber 與 pypdfium2。請使用隨附的執行環境，"
            "或執行 pip install pdfplumber pypdfium2")
    return pdfplumber, pypdfium2


# ---------- 表格 ----------

def _axis(values, tolerance=1.5):
    """把相近的座標合併，回傳排序後的邊界清單。"""
    out = []
    for value in sorted(values):
        if not out or value - out[-1] > tolerance:
            out.append(value)
    return out


def _index(axis, value):
    return min(range(len(axis)), key=lambda i: abs(axis[i] - value))


def _table_grid(page, table):
    """依每個儲存格的實際範圍建立表格，合併儲存格填滿。回傳 (grid, merges) 或 None。"""
    cells = [cell for cell in table.cells if cell]
    if len(cells) < 4:
        return None
    xs = _axis([c[0] for c in cells] + [c[2] for c in cells])
    ys = _axis([c[1] for c in cells] + [c[3] for c in cells])
    n_cols, n_rows = len(xs) - 1, len(ys) - 1
    if n_cols < 2 or n_rows < 2:
        return None
    grid = [[""] * n_cols for _ in range(n_rows)]
    merges = []
    for x0, top, x1, bottom in cells:
        c1, c2 = _index(xs, x0), _index(xs, x1) - 1
        r1, r2 = _index(ys, top), _index(ys, bottom) - 1
        if c2 < c1 or r2 < r1:
            continue
        try:
            text = page.crop((x0, top, x1, bottom), strict=False).extract_text(**_TEXT) or ""
        except ValueError:
            text = ""
        text = text.strip()
        for r in range(r1, r2 + 1):
            for c in range(c1, c2 + 1):
                grid[r][c] = text
        if c2 > c1 or r2 > r1:
            merges.append((r1, c1, r2, c2))
    if sum(1 for row in grid for value in row if value) < 2:
        return None
    return grid, merges


# ---------- 文字行 ----------

def _line_info(line):
    chars = [ch for ch in line.get("chars", []) if ch.get("text", "").strip()]
    sizes = [ch["size"] for ch in chars] or [0]
    bold = sum(1 for ch in chars if "bold" in ch.get("fontname", "").lower())
    return {
        "text": line["text"].strip(), "x0": line["x0"], "x1": line["x1"],
        "top": line["top"], "bottom": line["bottom"],
        "size": statistics.median(sizes), "bold": bool(chars) and bold > len(chars) * 0.6,
    }


def _lines(region):
    try:
        raw = region.extract_text_lines(return_chars=True, **_TEXT)
    except Exception:
        return []
    return [info for info in map(_line_info, raw) if info["text"]]


def _gutter(words, width):
    """偵測雙欄版面。回傳 (中線 x, 雙欄起始 y) 或 None。"""
    if len(words) < 80:
        return None
    best = None
    x = width * 0.38
    while x <= width * 0.62:
        crossing = [w for w in words if w["x0"] < x + 4 and w["x1"] > x - 4]
        if best is None or len(crossing) < len(best[1]):
            best = (x, crossing)
        x += 3
    x, crossing = best
    left = sum(1 for w in words if w["x1"] <= x)
    right = sum(1 for w in words if w["x0"] >= x)
    if left < len(words) * 0.25 or right < len(words) * 0.25:
        return None
    if len(crossing) > max(3, len(words) * 0.04):
        return None
    return x, max([w["bottom"] for w in crossing], default=0)


def _columnar_lines(words):
    """估計有幾行文字看起來像多欄對齊的資料（疑似無框線表格）。"""
    rows = collections.defaultdict(list)
    for word in words:
        rows[round(word["top"] / 3)].append(word)
    count = 0
    for items in rows.values():
        items.sort(key=lambda w: w["x0"])
        groups = 1
        for prev, cur in zip(items, items[1:]):
            if cur["x0"] - prev["x1"] > 18:
                groups += 1
        if groups >= 3:
            count += 1
    return count


# ---------- 單頁分析 ----------

def _inside(obj, bbox):
    cx = (obj["x0"] + obj["x1"]) / 2
    cy = (obj["top"] + obj["bottom"]) / 2
    return bbox[0] <= cx <= bbox[2] and bbox[1] <= cy <= bbox[3]


def _analyse(page):
    record = {"blocks": [], "images": [], "reasons": [], "margin_lines": [],
              "width": page.width, "height": page.height, "words": []}
    tables = []
    try:
        found = page.find_tables()
    except Exception:
        found = []
    for table in found:
        parsed = _table_grid(page, table)
        if parsed:
            tables.append((table.bbox, parsed))
    boxes = [bbox for bbox, _ in tables]

    rest = page.filter(lambda obj: not any(_inside(obj, b) for b in boxes)) if boxes else page
    words = rest.extract_words(**_TEXT) or []
    record["words"] = words
    text_chars = sum(len(w["text"]) for w in words) + sum(
        len(v) for _, (grid, _) in tables for row in grid for v in row)

    # 文字行，必要時分成雙欄
    zone_top, zone_bottom = page.height * _MARGIN, page.height * (1 - _MARGIN)
    body_words = [w for w in words if zone_top < w["top"] and w["bottom"] < zone_bottom]
    gutter = _gutter(body_words, page.width)
    if gutter:
        # 頁首頁尾與跨欄的標題維持整行，中間才分左右兩欄
        x, split = gutter
        # 分界線要落在整行文字的下緣，否則同一行會被切成兩半
        split = max([w["bottom"] for w in body_words if w["top"] < split], default=split) + 0.5
        split = min(max(split, zone_top), zone_bottom - 1)
        regions = [
            (0, rest.crop((0, 0, page.width, split), strict=False)),
            (1, rest.crop((0, split, x, zone_bottom), strict=False)),
            (2, rest.crop((x, split, page.width, zone_bottom), strict=False)),
            (3, rest.crop((0, zone_bottom, page.width, page.height), strict=False)),
        ]
    else:
        x, split = None, 0
        regions = [(0, rest)]
    for order, region in regions:
        for line in _lines(region):
            line["order"] = order
            record["blocks"].append(("line", line))

    for bbox, parsed in tables:
        order = 0
        if gutter and bbox[1] >= split:
            order = 1 if bbox[2] <= x + 5 else (2 if bbox[0] >= x - 5 else 1.5)
        record["blocks"].append(("table", {"top": bbox[1], "order": order, "data": parsed}))

    # 圖片
    page_area = page.width * page.height
    for image in page.images:
        w, h = image["x1"] - image["x0"], image["bottom"] - image["top"]
        if w < _MIN_IMAGE_PT or h < _MIN_IMAGE_PT:
            continue
        if w * h > page_area * 0.85 and text_chars < 20:
            continue    # 整頁掃描圖，改用整頁截圖
        record["images"].append((max(image["x0"], 0), max(image["top"], 0),
                                 min(image["x1"], page.width), min(image["bottom"], page.height)))

    # 腳本處理不了的情況
    big_image = any((i["x1"] - i["x0"]) * (i["bottom"] - i["top"]) > page_area * 0.5
                    for i in page.images)
    if text_chars == 0 or (text_chars < 20 and big_image):
        if page.images or page.curves or len(page.rects) > 3:
            record["reasons"].append("沒有文字層，可能是掃描頁")
    if text_chars > 0:
        if "(cid:" in " ".join(w["text"] for w in words[:400]):
            record["reasons"].append("文字層無法解碼")
        # 頁首頁尾區的商標與裝飾線不算
        body = lambda obj: zone_top < (obj["top"] + obj["bottom"]) / 2 < zone_bottom
        curves = sum(1 for obj in rest.curves if body(obj))
        strokes = sum(1 for obj in rest.lines + rest.rects if body(obj))
        if curves >= 12 or strokes >= 60:
            record["reasons"].append("含向量圖形，可能是圖表、方塊圖或時序圖")
        if _columnar_lines(words) >= 6:
            record["reasons"].append("可能含無框線表格")
    if len(record["images"]) >= 2:
        record["reasons"].append("含多張圖片，圖片之間的位置關係要看截圖")

    for kind, line in record["blocks"]:
        if kind == "line" and (line["bottom"] <= zone_top or line["top"] >= zone_bottom):
            record["margin_lines"].append(line)
    return record


# ---------- 輸出 ----------

def _join(previous, current):
    if _CJK_RE.match(previous[-1:]) and _CJK_RE.match(current[:1]):
        return previous + current
    return previous + " " + current


def _render_page(record, body_size, repeated, out, kept_ranges):
    def sort_key(block):
        kind, item = block
        return (item["order"], item["top"])

    paragraph, last = [], None

    def flush():
        if paragraph:
            out.append(paragraph[0] if len(paragraph) == 1 else
                       _reduce(paragraph))
            del paragraph[:]

    for kind, item in sorted(record["blocks"], key=sort_key):
        if kind == "table":
            flush()
            last = None
            grid, merges = item["data"]
            captions, header, rows = mdutil.render_grid(grid, merges)
            out.extend("**%s**" % caption for caption in captions)
            out.append(mdutil.table(header, rows))
            continue

        text = _LEADER_RE.sub(" … ", item["text"]).strip()
        # 符號字型的項目符號會變成無法顯示的私用字元，統一換成 •
        text = _PUA_RE.sub("•", text)
        if item in record["margin_lines"] and _DIGITS_RE.sub("#", text) in repeated:
            kept_ranges.append((item["top"] - 1, item["bottom"] + 1))
            continue

        ratio = item["size"] / body_size if body_size else 1
        short = len(text) <= 120
        heading = short and (ratio >= 1.15 or (
            item["bold"] and ratio >= 0.98 and len(text) <= 80 and _NUMBERED_RE.match(text)))
        if heading:
            flush()
            out.append(("### " if ratio >= 1.35 else "#### ") + text)
            last = None
            continue

        gap = item["top"] - last["bottom"] if last else 0
        height = max(item["bottom"] - item["top"], 1)
        # 目錄的每一行（帶點線）各自成段
        leader = " … " in text or (bool(paragraph) and " … " in paragraph[-1])
        new_paragraph = (last is None or item["order"] != last["order"]
                         or gap > height * 0.65 or gap < -height
                         or _BULLET_RE.match(text) or leader)
        if new_paragraph:
            flush()
        paragraph.append(text)
        last = item
    flush()


def _reduce(lines):
    text = lines[0]
    for line in lines[1:]:
        text = _join(text, line)
    return text


def convert(path, out_dir, options):
    pdfplumber, pdfium = _load_libs()
    name, stem = mdutil.names(path, options)
    assets = mdutil.AssetWriter(out_dir, stem)
    warnings = []
    page_images = options.get("pdf_page_images", True)

    with open(path, "rb") as handle:
        if b"%PDF" not in handle.read(1024):
            raise ValueError("這個檔案的內容不是 PDF（可能是存成 .pdf 的網頁或其他格式）")
    try:
        pdf = pdfplumber.open(path)
    except Exception as error:
        raise ValueError("無法開啟 PDF（可能已加密或損毀）：%s" % error)

    with pdf:
        records = [_analyse(page) for page in pdf.pages]

    n_pages = len(records)
    sizes = collections.Counter()
    margin_counts = collections.Counter()
    for record in records:
        for kind, item in record["blocks"]:
            if kind == "line" and item["size"]:
                sizes[round(item["size"] * 2) / 2] += len(item["text"])
        for text in {_DIGITS_RE.sub("#", line["text"]) for line in record["margin_lines"]}:
            margin_counts[text] += 1
    body_size = sizes.most_common(1)[0][0] if sizes else 0
    # 奇偶頁的頁首頁尾常常不同，所以門檻取三成而不是一半
    threshold = max(3, n_pages * 0.3)
    repeated = {text for text, count in margin_counts.items() if count >= threshold}

    # 圖片與整頁截圖
    renderer = pdfium.PdfDocument(path)
    image_links = [[] for _ in records]
    page_links = {}
    link_pages = collections.Counter()
    try:
        for index, record in enumerate(records):
            need_page = bool(record["reasons"]) and page_images
            if not record["images"] and not need_page:
                continue
            try:
                picture = renderer[index].render(scale=_RENDER_SCALE).to_pil()
            except Exception as error:
                warnings.append("第 %d 頁無法轉成圖片：%s" % (index + 1, error))
                continue
            for x0, top, x1, bottom in record["images"]:
                crop = picture.crop(tuple(int(v * _RENDER_SCALE) for v in (x0, top, x1, bottom)))
                if crop.width < 8 or crop.height < 8:
                    continue
                buffer = io.BytesIO()
                crop.save(buffer, "PNG")
                link = assets.save(buffer.getvalue(), ".png")
                if link not in image_links[index]:
                    image_links[index].append(link)
                    link_pages[link] += 1
            if need_page:
                os.makedirs(assets.dir_path, exist_ok=True)
                file_name = "page-%03d.png" % (index + 1)
                picture.save(os.path.join(assets.dir_path, file_name), "PNG")
                page_links[index] = assets.dir_name + "/" + file_name
    finally:
        renderer.close()
    logos = {link for link, count in link_pages.items() if n_pages >= 4 and count >= threshold}

    problem_pages = [index + 1 for index, record in enumerate(records) if record["reasons"]]
    out = [mdutil.front_matter([
        ("source", name), ("type", "pdf"), ("converter", CONVERTER),
        ("mode", options.get("mode", "fast")), ("pages", n_pages),
        ("pages_with_screenshot", str(problem_pages) if problem_pages else None),
    ]), "# " + name]

    source_texts = set()
    for index, record in enumerate(records):
        out.append("## Page %d" % (index + 1))
        before = len(out)
        removed = []
        _render_page(record, body_size, repeated, out, removed)
        for number, link in enumerate(l for l in image_links[index] if l not in logos):
            out.append("![圖 %d-%d](%s)" % (index + 1, number + 1, link))
        if record["reasons"]:
            reason = "；".join(record["reasons"])
            if index in page_links:
                out.append("> [此頁%s，腳本抽取的內容可能不完整，請看整頁截圖](%s)"
                           % (reason, page_links[index]))
            else:
                out.append("> 此頁%s，腳本抽取的內容可能不完整。" % reason)
        if len(out) == before:
            out.append("（空白頁）")
        for word in record["words"]:
            if not any(low <= word["top"] <= high for low, high in removed):
                source_texts.add(_PUA_RE.sub("•", _LEADER_RE.sub(" … ", word["text"])).strip(". "))

    if problem_pages:
        warnings.append("有 %d 頁含腳本無法可靠抽取的內容，已附整頁截圖：第 %s 頁"
                        % (len(problem_pages), "、".join(map(str, problem_pages[:30]))
                           + ("…" if len(problem_pages) > 30 else "")))
    return mdutil.Result(
        "\n\n".join(out) + "\n", warnings,
        {"pages": n_pages, "tables": sum(1 for r in records for k, _ in r["blocks"] if k == "table"),
         "images": sum(len(links) for links in image_links),
         "page_screenshots": len(page_links)},
        sorted(source_texts))
