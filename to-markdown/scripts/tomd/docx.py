"""docx 轉 Markdown。直接解析壓縮檔內的 XML，不依賴第三方套件。"""

import os
import re
import zipfile

from . import CONVERTER, mdutil
from .ooxml import all_text, main_part, read_xml, rels

_HEADING_RE = re.compile(r"^(?:heading|標題)\s*(\d)", re.I)
_TOC_RE = re.compile(r"^(?:toc|目錄|table of figures)", re.I)
_SKIP_TAGS = {"pPr", "rPr", "del", "moveFrom", "instrText", "delText",
              "commentReference", "footnoteReference", "endnoteReference"}


class _Doc:
    def __init__(self, archive, path, assets):
        self.archive = archive
        self.assets = assets
        self.rels = rels(archive, path, external=True)
        self.styles = {}      # styleId -> {name, based, outline, num}
        self.bullets = {}     # (numId, ilvl) -> 是否為項目符號
        self.warnings = []
        self.images = 0
        by_type = {rel_type.rsplit("/", 1)[-1]: target
                   for rel_type, target in self.rels.values()}
        self._load_styles(by_type.get("styles"))
        self._load_numbering(by_type.get("numbering"))

    def _load_styles(self, path):
        root = read_xml(self.archive, path) if path else None
        for style in (root.iter("style") if root is not None else []):
            name = style.find("name")
            based = style.find("basedOn")
            ppr = style.find("pPr")
            outline = ppr.find("outlineLvl") if ppr is not None else None
            numpr = ppr.find("numPr") if ppr is not None else None
            self.styles[style.get("styleId")] = {
                "name": name.get("val", "") if name is not None else "",
                "based": based.get("val") if based is not None else None,
                "outline": int(outline.get("val")) if outline is not None else None,
                "num": numpr,
            }

    def _load_numbering(self, path):
        root = read_xml(self.archive, path) if path else None
        if root is None:
            return
        abstract = {}
        for node in root.iter("abstractNum"):
            levels = {}
            for lvl in node.iter("lvl"):
                fmt = lvl.find("numFmt")
                levels[int(lvl.get("ilvl", "0"))] = (
                    fmt is not None and fmt.get("val") == "bullet")
            abstract[node.get("abstractNumId")] = levels
        for num in root.iter("num"):
            ref = num.find("abstractNumId")
            levels = abstract.get(ref.get("val") if ref is not None else None, {})
            for ilvl, is_bullet in levels.items():
                self.bullets[(num.get("numId"), ilvl)] = is_bullet

    def style_chain(self, style_id):
        seen = 0
        while style_id in self.styles and seen < 10:
            yield self.styles[style_id]
            style_id = self.styles[style_id]["based"]
            seen += 1

    # ---------- 段落內容 ----------

    def _image(self, rel_id, alt):
        target = self.rels.get(rel_id)
        if not target:
            return ""
        try:
            data = self.archive.read(target[1])
        except KeyError:
            return ""
        link = self.assets.save(data, os.path.splitext(target[1])[1] or ".bin")
        self.images += 1
        return "![%s](%s)" % (alt or "圖片", link)

    def _graphic(self, node, extras):
        """處理圖片與文字方塊。圖片回傳成行內文字，文字方塊的段落放進 extras。"""
        alt = ""
        for props in node.iter("docPr"):
            alt = (props.get("descr") or "").strip().replace("\n", " ")
        parts = []
        for box in node.iter("txbxContent"):
            for para in box.iter("p"):
                text = self.inline(para, extras)
                if text.strip():
                    extras.append(text.strip())
        for blip in node.iter("blip"):
            parts.append(self._image(blip.get("r:embed"), alt))
        for image in node.iter("imagedata"):
            parts.append(self._image(image.get("r:id"), alt))
        return " ".join(part for part in parts if part)

    def inline(self, node, extras):
        """把段落或其子節點轉成一行文字。"""
        out = []
        for child in node:
            tag = child.tag
            if tag in _SKIP_TAGS:
                continue
            if tag == "t":
                out.append(child.text or "")
            elif tag in ("tab", "ptab"):
                out.append(" ")
            elif tag in ("br", "cr"):
                if child.get("type") not in ("page", "column"):
                    out.append("\n")
            elif tag == "noBreakHyphen":
                out.append("-")
            elif tag in ("drawing", "pict", "object"):
                out.append(self._graphic(child, extras))
            elif tag == "txbxContent":
                continue
            elif tag == "hyperlink":
                text = self.inline(child, extras)
                target = self.rels.get(child.get("r:id"))
                if target and text.strip() and "\n" not in text:
                    out.append("[%s](%s)" % (text.strip(), target[1]))
                else:
                    out.append(text)
            else:
                out.append(self.inline(child, extras))
        return "".join(out)

    # ---------- 段落類型 ----------

    def classify(self, para):
        """回傳 (類型, 層級)。類型為 heading、title、toc、bullet、number、text。"""
        ppr = para.find("pPr")
        style_node = ppr.find("pStyle") if ppr is not None else None
        style_id = style_node.get("val") if style_node is not None else None
        chain = list(self.style_chain(style_id))
        names = [style["name"] for style in chain]

        if names and _TOC_RE.match(names[0]):
            return "toc", 0
        for name in names:
            match = _HEADING_RE.match(name)
            if match:
                return "heading", int(match.group(1))
        outline = ppr.find("outlineLvl") if ppr is not None else None
        level = int(outline.get("val")) if outline is not None else None
        if level is None:
            level = next((s["outline"] for s in chain if s["outline"] is not None), None)
        if level is not None and level < 9:
            return "heading", level + 1
        if names and names[0].lower() in ("title", "標題", "大標題"):
            return "title", 0

        numpr = ppr.find("numPr") if ppr is not None else None
        if numpr is None:
            numpr = next((s["num"] for s in chain if s["num"] is not None), None)
        if numpr is not None:
            num = numpr.find("numId")
            ilvl = numpr.find("ilvl")
            num_id = num.get("val") if num is not None else "0"
            depth = int(ilvl.get("val")) if ilvl is not None else 0
            if num_id != "0":
                bullet = self.bullets.get((num_id, depth), True)
                return ("bullet" if bullet else "number"), depth
        return "text", 0

    # ---------- 表格 ----------

    def cell_text(self, cell):
        lines = []
        for para in cell.iter("p"):
            extras = []
            text = self.inline(para, extras).strip()
            lines.extend(extras)
            if text:
                lines.append(text)
        return "\n".join(lines)

    def table(self, tbl):
        grid, merges, open_merge = [], [], {}
        for r, row in enumerate(tbl.findall("tr")):
            line, col = [], 0
            trpr = row.find("trPr")
            before = trpr.find("gridBefore") if trpr is not None else None
            for _ in range(int(before.get("val", "0")) if before is not None else 0):
                line.append("")
                col += 1
            cells = list(row.findall("tc"))
            for sdt in row.findall("sdt"):
                cells.extend(sdt.iter("tc"))
            for cell in cells:
                tcpr = cell.find("tcPr")
                span_node = tcpr.find("gridSpan") if tcpr is not None else None
                span = int(span_node.get("val", "1")) if span_node is not None else 1
                vmerge = tcpr.find("vMerge") if tcpr is not None else None
                continued = vmerge is not None and vmerge.get("val", "continue") == "continue"
                if continued and col in open_merge and r > 0 and col < len(grid[r - 1]):
                    text = grid[r - 1][col]
                    open_merge[col][1] = r
                else:
                    text = self.cell_text(cell)
                    if col in open_merge:
                        start, end, width = open_merge.pop(col)
                        if end > start:
                            merges.append((start, col, end, col + width - 1))
                    if vmerge is not None:
                        open_merge[col] = [r, r, span]
                if span > 1 and vmerge is None:
                    merges.append((r, col, r, col + span - 1))
                line.extend([text] * span)
                col += span
            grid.append(line)
        for col, (start, end, width) in open_merge.items():
            if end > start:
                merges.append((start, col, end, col + width - 1))
        if not grid:
            return None
        width = max(len(line) for line in grid)
        if width == 0:
            return None
        for line in grid:
            line.extend([""] * (width - len(line)))
        return grid, merges


def _blocks(doc, container, out, stats):
    """依原順序走過段落與表格。out 是 (類型, 文字) 的清單。"""
    for node in container:
        if node.tag == "p":
            kind, level = doc.classify(node)
            if kind == "toc":
                node.set("_skipped", "1")
                continue
            extras = []
            text = doc.inline(node, extras).strip()
            for extra in extras:
                out.append(("text", extra))
            if not text:
                continue
            if kind == "heading":
                out.append(("text", "#" * min(level + 1, 6) + " " + text.replace("\n", " ")))
            elif kind == "title":
                out.append(("text", "**%s**" % text.replace("\n", " ")))
            elif kind in ("bullet", "number"):
                marker = "- " if kind == "bullet" else "1. "
                out.append(("list", "  " * level + marker + text.replace("\n", "<br>")))
            else:
                out.append(("text", text.replace("\n", "  \n")))
        elif node.tag == "tbl":
            parsed = doc.table(node)
            if not parsed:
                continue
            grid, merges = parsed
            stats["tables"] += 1
            if len(grid[0]) == 1:
                # 單欄表格通常是版面用的外框，直接輸出內容
                for line in grid:
                    if line[0]:
                        out.append(("text", line[0].replace("\n", "  \n")))
                continue
            captions, header, rows = mdutil.render_grid(grid, merges)
            for caption in captions:
                out.append(("text", "**%s**" % caption))
            out.append(("text", mdutil.table(header, rows)))
        elif node.tag in ("sdt", "sdtContent", "AlternateContent", "Choice",
                          "ins", "customXml", "smartTag"):
            _blocks(doc, node, out, stats)


def convert(path, out_dir, options):
    name = os.path.basename(path)
    stem = os.path.splitext(name)[0]
    assets = mdutil.AssetWriter(out_dir, stem)

    with zipfile.ZipFile(path) as archive:
        doc_path = main_part(archive, "word/document.xml")
        root = read_xml(archive, doc_path)
        if root is None or root.find("body") is None:
            raise ValueError("找不到文件內容，檔案可能損毀或不是 docx")
        doc = _Doc(archive, doc_path, assets)
        blocks, stats = [], {"tables": 0}
        _blocks(doc, root.find("body"), blocks, stats)

        # 文字覆蓋檢查用：獨立再掃一次所有文字節點（略過目錄與刪除的修訂）
        for para in root.iter("p"):
            if para.get("_skipped"):
                for node in list(para.iter("t")):
                    node.text = ""
        for deleted in list(root.iter("del")) + list(root.iter("moveFrom")):
            for node in deleted.iter("t"):
                node.text = ""
        source_texts = all_text(root)

    parts = [mdutil.front_matter([
        ("source", name), ("type", "docx"), ("converter", CONVERTER),
        ("mode", options.get("mode", "fast")),
    ]), "# " + name]
    body = ""
    previous = None
    for kind, text in blocks:
        joiner = "\n" if (kind == "list" and previous == "list") else "\n\n"
        body += (joiner if body else "") + text
        previous = kind
    if body:
        parts.append(body)

    stats["paragraphs"] = len(blocks)
    stats["images"] = doc.images
    return mdutil.Result("\n\n".join(parts) + "\n", doc.warnings, stats, source_texts)
