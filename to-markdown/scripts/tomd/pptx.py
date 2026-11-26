"""pptx 轉 Markdown。直接解析壓縮檔內的 XML，不依賴第三方套件。

投影片截圖需要 Windows 與已安裝的 PowerPoint，其餘功能不受限。
"""

import os
import subprocess
import zipfile

from . import CONVERTER, mdutil
from .ooxml import all_text, main_part, read_xml, rels

_LINE_SHAPES = ("line", "straightConnector", "bentConnector", "curvedConnector")
_SKIP_PLACEHOLDERS = {"sldNum", "dt", "ftr", "hdr"}
_DIAGRAM_MIN_SHAPES = 4      # 自由文字圖案達到這個數量就視為圖解
_LABEL_MAX = 40
_PS_SCRIPT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "export_slides.ps1")


# ---------- 文字 ----------

def _paragraphs(body):
    """回傳 [(層級, 文字)]。"""
    out = []
    for para in (body.findall("p") if body is not None else []):
        parts = []
        for node in para:
            if node.tag in ("r", "fld"):
                parts.extend(t.text or "" for t in node.findall("t"))
            elif node.tag == "br":
                parts.append("\n")
        text = "".join(parts).strip()
        if text:
            ppr = para.find("pPr")
            out.append((int(ppr.get("lvl", "0")) if ppr is not None else 0, text))
    return out


def _label(shape):
    if shape["paras"]:
        text = " ".join(shape["paras"][0][1].split())
        return text if len(text) <= _LABEL_MAX else text[:_LABEL_MAX] + "…"
    return "〔%s〕" % (shape["name"] or "無文字圖案")


# ---------- 座標 ----------

def _xfrm(node):
    """回傳 (x, y, w, h, flipH, flipV, 節點) 或 None。"""
    if node is None:
        return None
    off, ext = node.find("off"), node.find("ext")
    if off is None or ext is None:
        return None
    return (int(off.get("x", 0)), int(off.get("y", 0)),
            int(ext.get("cx", 0)), int(ext.get("cy", 0)),
            node.get("flipH") == "1", node.get("flipV") == "1", node)


def _group_transform(parent, xfrm_node):
    """群組內的圖案使用群組自己的座標系，這裡換算回投影片座標。"""
    geo = _xfrm(xfrm_node)
    ch_off = xfrm_node.find("chOff") if xfrm_node is not None else None
    ch_ext = xfrm_node.find("chExt") if xfrm_node is not None else None
    if geo is None or ch_off is None or ch_ext is None:
        return parent
    x, y, w, h = geo[:4]
    cx, cy = int(ch_off.get("x", 0)), int(ch_off.get("y", 0))
    cw, ch = int(ch_ext.get("cx", 0)) or 1, int(ch_ext.get("cy", 0)) or 1
    return lambda px, py: parent(x + (px - cx) * w / cw, y + (py - cy) * h / ch)


# ---------- 投影片解析 ----------

def _table_grid(tbl):
    grid, merges = [], []
    for r, row in enumerate(tbl.findall("tr")):
        line = []
        for c, cell in enumerate(row.findall("tc")):
            if cell.get("hMerge") == "1" and line:
                text = line[-1]
            elif cell.get("vMerge") == "1" and r > 0 and c < len(grid[r - 1]):
                text = grid[r - 1][c]
            else:
                text = "\n".join(t for _, t in _paragraphs(cell.find("txBody")))
                cols, rows = int(cell.get("gridSpan", "1")), int(cell.get("rowSpan", "1"))
                if cols > 1 or rows > 1:
                    merges.append((r, c, r + rows - 1, c + cols - 1))
            line.append(text)
        grid.append(line)
    if not grid or not grid[0]:
        return None
    width = max(len(line) for line in grid)
    for line in grid:
        line.extend([""] * (width - len(line)))
    return grid, merges


class _Slide:
    def __init__(self, archive, path, assets):
        self.archive = archive
        self.assets = assets
        self.rels = rels(archive, path)
        self.root = read_xml(archive, path)
        self.shapes = []      # 有文字或被連接的圖案
        self.lines = []       # 連接線與直線
        self.tables = []
        self.pictures = []
        self.smartart = []
        self.charts = 0
        self.hidden = self.root is not None and self.root.get("show") == "0"
        tree = self.root.find("cSld/spTree") if self.root is not None else None
        if tree is not None:
            self._walk(tree, lambda px, py: (px, py))

    def _bbox(self, xfrm_node, transform):
        geo = _xfrm(xfrm_node)
        if geo is None:
            return None, None
        x, y, w, h = geo[:4]
        x1, y1 = transform(x, y)
        x2, y2 = transform(x + w, y + h)
        return (x1, y1, x2, y2), geo

    def _walk(self, tree, transform):
        for node in tree:
            tag = node.tag
            if tag in ("AlternateContent", "Choice"):
                self._walk(node, transform)
            elif tag == "grpSp":
                group = node.find("grpSpPr")
                xfrm = group.find("xfrm") if group is not None else None
                self._walk(node, _group_transform(transform, xfrm))
            elif tag in ("sp", "cxnSp"):
                self._shape(node, transform)
            elif tag == "pic":
                self._picture(node)
            elif tag == "graphicFrame":
                self._frame(node)

    def _shape(self, node, transform):
        props = node.find("spPr")
        bbox, geo = self._bbox(props.find("xfrm") if props is not None else None, transform)
        c_nv = next(node.iter("cNvPr"), None)
        placeholder = next(node.iter("ph"), None)
        geom = props.find("prstGeom") if props is not None else None
        preset = geom.get("prst", "") if geom is not None else ""
        paras = _paragraphs(node.find("txBody"))
        is_line = node.tag == "cxnSp" or (preset.startswith(_LINE_SHAPES) and not paras)

        if is_line:
            line = props.find("ln") if props is not None else None
            head = line.find("headEnd") if line is not None else None
            tail = line.find("tailEnd") if line is not None else None
            start = end = None
            if bbox and geo:
                x1, y1, x2, y2 = bbox
                flip_h, flip_v = geo[4], geo[5]
                start = (x2 if flip_h else x1, y2 if flip_v else y1)
                end = (x1 if flip_h else x2, y1 if flip_v else y2)
            st = next(node.iter("stCxn"), None)
            en = next(node.iter("endCxn"), None)
            self.lines.append({
                "start_id": st.get("id") if st is not None else None,
                "end_id": en.get("id") if en is not None else None,
                "start": start, "end": end,
                "head": head is not None and head.get("type", "none") != "none",
                "tail": tail is not None and tail.get("type", "none") != "none",
            })
            return

        self.shapes.append({
            "id": c_nv.get("id") if c_nv is not None else None,
            "name": c_nv.get("name", "") if c_nv is not None else "",
            "ph": placeholder.get("type", "body") if placeholder is not None else None,
            "bbox": bbox, "paras": paras,
        })

    def _picture(self, node):
        c_nv = next(node.iter("cNvPr"), None)
        alt = (c_nv.get("descr") or "").strip().replace("\n", " ") if c_nv is not None else ""
        for blip in node.iter("blip"):
            target = self.rels.get(blip.get("r:embed"))
            if not target:
                continue
            try:
                data = self.archive.read(target[1])
            except KeyError:
                continue
            link = self.assets.save(data, os.path.splitext(target[1])[1] or ".bin")
            self.pictures.append((alt or "圖片", link))

    def _frame(self, node):
        tbl = next(node.iter("tbl"), None)
        if tbl is not None:
            parsed = _table_grid(tbl)
            if parsed:
                self.tables.append(parsed)
            return
        diagram = next(node.iter("relIds"), None)
        if diagram is not None:
            target = self.rels.get(diagram.get("r:dm"))
            data = read_xml(self.archive, target[1]) if target else None
            if data is not None:
                self.smartart.extend(" ".join(text.split()) for text in all_text(data))
            return
        if next(node.iter("chart"), None) is not None:
            self.charts += 1

    # ---------- 連接關係 ----------

    def edges(self, tolerance):
        by_id = {shape["id"]: shape for shape in self.shapes if shape["id"]}
        candidates = [shape for shape in self.shapes
                      if shape["bbox"] and shape["paras"] and shape["ph"] is None]

        def nearest(point):
            best, best_dist = None, None
            for shape in candidates:
                x1, y1, x2, y2 = shape["bbox"]
                dx = max(x1 - point[0], 0, point[0] - x2)
                dy = max(y1 - point[1], 0, point[1] - y2)
                dist = (dx * dx + dy * dy) ** 0.5
                if dist <= tolerance and (best_dist is None or dist < best_dist):
                    best, best_dist = shape, dist
            return best

        out, unresolved = [], 0
        for line in self.lines:
            ends, guessed = [], False
            for key in ("start", "end"):
                shape = by_id.get(line[key + "_id"])
                if shape is None and line[key]:
                    shape = nearest(line[key])
                    guessed = guessed or shape is not None
                ends.append(shape)
            if ends[0] is None or ends[1] is None or ends[0] is ends[1]:
                unresolved += 1
                continue
            first, second = _label(ends[0]), _label(ends[1])
            if line["head"] and line["tail"]:
                arrow = "↔"
            elif line["head"]:
                first, second, arrow = second, first, "→"
            elif line["tail"]:
                arrow = "→"
            else:
                arrow = "—"
            text = "%s %s %s" % (first, arrow, second)
            if guessed:
                text += "（推測）"
            if text not in out:
                out.append(text)
        return out, unresolved

    def free_shapes(self, row_height):
        shapes = [s for s in self.shapes if s["ph"] is None and s["paras"]]
        def key(shape):
            if not shape["bbox"]:
                return (10 ** 9, 0)
            return (round(shape["bbox"][1] / row_height), shape["bbox"][0])
        return sorted(shapes, key=key)

    def is_diagram(self):
        free = [s for s in self.shapes if s["ph"] is None and s["paras"]]
        return bool(self.lines) or len(free) >= _DIAGRAM_MIN_SHAPES


# ---------- 投影片截圖 ----------

def _render(path, assets, numbers, width, warnings):
    """用本機的 PowerPoint 匯出指定投影片。回傳 {編號: 相對連結}。"""
    if not numbers:
        return {}
    if os.name != "nt":
        warnings.append("投影片截圖需要 Windows 與 PowerPoint，這次沒有產生截圖（%d 頁含圖解）"
                        % len(numbers))
        return {}
    os.makedirs(assets.dir_path, exist_ok=True)
    env = dict(os.environ, TOMD_PPTX=os.path.abspath(path),
               TOMD_OUT=os.path.abspath(assets.dir_path),
               TOMD_SLIDES=",".join(str(n) for n in numbers), TOMD_WIDTH=str(width))
    try:
        with open(_PS_SCRIPT, encoding="utf-8") as handle:
            script = handle.read()
        done = subprocess.run(
            ["powershell", "-NoProfile", "-NonInteractive", "-Command", "-"],
            input=script, env=env, capture_output=True, text=True, timeout=600)
        if done.returncode != 0:
            detail = (done.stderr or done.stdout or "").strip().splitlines()
            warnings.append("PowerPoint 匯出截圖失敗：%s" % (detail[-1] if detail else "未知原因"))
    except (OSError, subprocess.SubprocessError) as error:
        warnings.append("無法呼叫 PowerPoint 匯出截圖：%s" % error)
    out = {}
    for number in numbers:
        file_name = "slide-%02d.png" % number
        if os.path.exists(os.path.join(assets.dir_path, file_name)):
            out[number] = assets.dir_name + "/" + file_name
    return out


# ---------- 輸出 ----------

def _bullets(paras):
    if len(paras) == 1 and paras[0][0] == 0:
        return paras[0][1].replace("\n", "  \n")
    return "\n".join("  " * level + "- " + text.replace("\n", "<br>") for level, text in paras)


def _notes(archive, slide):
    for rel_type, target in slide.rels.values():
        if rel_type.endswith("/notesSlide"):
            root = read_xml(archive, target)
            if root is None:
                return "", []
            lines = []
            for shape in root.iter("sp"):
                placeholder = next(shape.iter("ph"), None)
                if placeholder is not None and placeholder.get("type") == "body":
                    lines.extend(text for _, text in _paragraphs(shape.find("txBody")))
            return "  \n".join(lines), lines
    return "", []


def convert(path, out_dir, options):
    name, stem = mdutil.names(path, options)
    assets = mdutil.AssetWriter(out_dir, stem)
    warnings, source_texts = [], []

    with zipfile.ZipFile(path) as archive:
        pres_path = main_part(archive, "ppt/presentation.xml")
        pres = read_xml(archive, pres_path)
        if pres is None:
            raise ValueError("找不到簡報內容，檔案可能損毀或不是 pptx")
        pres_rels = rels(archive, pres_path)
        size = pres.find("sldSz")
        slide_w = int(size.get("cx", "9144000")) if size is not None else 9144000
        slide_h = int(size.get("cy", "6858000")) if size is not None else 6858000

        slides = []
        for item in pres.iter("sldId"):
            target = pres_rels.get(item.get("r:id"))
            if target:
                slide = _Slide(archive, target[1], assets)
                if slide.root is not None:
                    slide.notes, note_lines = _notes(archive, slide)
                    source_texts.extend(all_text(slide.root))
                    source_texts.extend(note_lines)
                    slides.append(slide)

    wanted = [n for n, slide in enumerate(slides, 1) if slide.is_diagram()]
    rendered = {}
    if options.get("slide_images", True):
        rendered = _render(path, assets, wanted,
                           int(options.get("slide_image_width_px", 1600)), warnings)

    out = [mdutil.front_matter([
        ("source", name), ("type", "pptx"), ("converter", CONVERTER),
        ("mode", options.get("mode", "fast")), ("slides", len(slides)),
    ]), "# " + name]

    charts = 0
    for number, slide in enumerate(slides, 1):
        titles = [s for s in slide.shapes if s["ph"] in ("title", "ctrTitle") and s["paras"]]
        heading = "## Slide %d" % number
        if titles:
            heading += ": " + " ".join(" ".join(t.split()) for _, t in titles[0]["paras"])
        if slide.hidden:
            heading += "（隱藏）"
        out.append(heading)
        if number in rendered:
            out.append("![slide-%02d](%s)" % (number, rendered[number]))

        for shape in slide.shapes:
            if shape["ph"] and shape["ph"] not in _SKIP_PLACEHOLDERS and shape["paras"] \
                    and shape not in titles[:1]:
                out.append(_bullets(shape["paras"]))

        free = slide.free_shapes(slide_h / 20)
        if slide.is_diagram():
            if free:
                texts = [" / ".join(text.replace("\n", " ") for _, text in s["paras"]) for s in free]
                out.append("**圖中文字：** " + "、".join(texts))
            edges, unresolved = slide.edges(slide_w * 0.025)
            if edges:
                out.append("**連接關係：** " + "；".join(edges))
            if unresolved:
                out.append("（另有 %d 條線無法判定連接對象）" % unresolved)
        else:
            for shape in free:
                out.append(_bullets(shape["paras"]))

        for grid, merges in slide.tables:
            if len(grid[0]) == 1:
                out.extend(line[0].replace("\n", "  \n") for line in grid if line[0])
                continue
            captions, header, rows = mdutil.render_grid(grid, merges)
            out.extend("**%s**" % caption for caption in captions)
            out.append(mdutil.table(header, rows))
        if slide.smartart:
            out.append("**SmartArt 文字：** " + "、".join(slide.smartart))
            source_texts.extend(slide.smartart)
        for alt, link in slide.pictures:
            out.append("![%s](%s)" % (alt, link))
        if slide.charts:
            charts += slide.charts
            out.append("（此頁含 %d 個圖表，資料尚未輸出）" % slide.charts)
        if slide.notes:
            out.append("**講者備註：** " + slide.notes)

    if charts:
        warnings.append("共有 %d 個圖表的資料沒有輸出" % charts)

    # 圖片只能依序列出，彼此與文字之間的相對位置不會保留
    layout_slides = [number for number, slide in enumerate(slides, 1)
                     if len(slide.pictures) >= 2
                     or (slide.pictures and slide.is_diagram())]
    result = mdutil.Result(
        "\n\n".join(out) + "\n", warnings,
        {"slides": len(slides), "diagram_slides": len(wanted), "screenshots": len(rendered)},
        source_texts)
    if layout_slides:
        pages = "、".join(map(str, layout_slides[:20])) + ("…" if len(layout_slides) > 20 else "")
        result.notices.append(
            "這份簡報有 %d 張投影片貼了多張圖片或圖文混排（第 %s 張），轉出後圖片只會依序列出，"
            "不會保留彼此的相對位置。請提醒使用者打開輸出檔確認這幾張投影片；"
            "如果位置關係很重要，請使用者在 PowerPoint 用「另存新檔」存成 PDF，再把那個 PDF 拿來轉。"
            % (len(layout_slides), pages))
    return result
