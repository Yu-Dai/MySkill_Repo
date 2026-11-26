"""docx、xlsx、pptx 共用的壓縮檔與 XML 工具。"""

import posixpath
import xml.etree.ElementTree as ET


def strip_ns(root):
    """移除命名空間，讓一般與 Strict 兩種 OOXML 都能用同一套邏輯。

    關聯用的屬性（r:id、r:embed 等）保留 r: 前綴，避免和同名的一般屬性衝突。
    同時移除 AlternateContent 的 Fallback，否則相容用的內容會重複出現。
    """
    for node in root.iter():
        if isinstance(node.tag, str) and "}" in node.tag:
            node.tag = node.tag.split("}", 1)[1]
        for key in list(node.attrib):
            if "}" in key:
                uri, local = key[1:].split("}", 1)
                prefix = "r:" if uri.endswith("/relationships") else ""
                node.attrib[prefix + local] = node.attrib.pop(key)
    for node in root.iter("AlternateContent"):
        if node.find("Choice") is not None:
            for fallback in node.findall("Fallback"):
                node.remove(fallback)
    return root


def read_xml(archive, path):
    try:
        return strip_ns(ET.fromstring(archive.read(path)))
    except KeyError:
        return None


def rels(archive, part, external=False):
    """讀某個組件的關聯檔，回傳 {id: (type, 目標)}。

    預設略過外部連結；external=True 時一併回傳，目標為原始網址。
    """
    folder, name = posixpath.split(part)
    root = read_xml(archive, posixpath.join(folder, "_rels", name + ".rels"))
    out = {}
    if root is None:
        return out
    for rel in root.iter("Relationship"):
        target = rel.get("Target", "")
        if rel.get("TargetMode") == "External":
            if external:
                out[rel.get("Id")] = (rel.get("Type", ""), target)
            continue
        if target.startswith("/"):
            path = target.lstrip("/")
        else:
            path = posixpath.normpath(posixpath.join(folder, target))
        out[rel.get("Id")] = (rel.get("Type", ""), path)
    return out


def main_part(archive, default):
    """從根關聯找出主文件的路徑。"""
    for rel_type, target in rels(archive, "").values():
        if rel_type.endswith("/officeDocument"):
            return target
    return default


def all_text(root, tag="t"):
    """回傳某棵 XML 樹裡所有文字節點的內容，用於文字覆蓋檢查。"""
    return [node.text for node in root.iter(tag) if node.text and node.text.strip()]
