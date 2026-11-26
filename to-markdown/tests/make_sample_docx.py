"""產生模擬的 docx 樣本（開發用，需要 python-docx；轉檔本身不需要）。內容全部是虛構資料。
用法：python make_sample_docx.py 輸出路徑.docx
"""
import struct
import sys
import tempfile
import zlib

from docx import Document
from docx.shared import Inches


def tiny_png(path):
    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body))
    raw = b"".join(b"\x00" + b"\x20\x80\xc0" * 8 for _ in range(8))
    with open(path, "wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


doc = Document()
doc.add_heading("Demo Touch Driver 使用說明", 0)
doc.add_heading("1 概述", 1)
doc.add_paragraph("本文件為模擬資料，說明 demo driver 的初始化流程。")
doc.add_heading("1.1 初始化步驟", 2)
for step in ("上電並等待 10 ms", "讀取 CHIP_ID（0x21）", "寫入 CTRL = 0x30"):
    doc.add_paragraph(step, style="List Number")
doc.add_paragraph("注意事項：", style="Normal")
doc.add_paragraph("I2C 位址為 0x5D", style="List Bullet")
doc.add_paragraph("中斷腳為 active low", style="List Bullet")

doc.add_heading("2 暫存器摘要", 1)
table = doc.add_table(rows=5, cols=4)
table.style = "Table Grid"
cells = [
    ("Addr", "Name", "Field", ""),
    ("", "", "Bit", "Default"),
    ("0x1F", "CTRL", "7:4", "0x0"),
    ("", "", "3:0", "0x3"),
    ("0x21", "CHIP_ID", "7:0", "0xA5"),
]
for r, row in enumerate(cells):
    for c, text in enumerate(row):
        table.cell(r, c).text = text
table.cell(0, 0).merge(table.cell(1, 0))
table.cell(0, 1).merge(table.cell(1, 1))
table.cell(0, 2).merge(table.cell(0, 3))
table.cell(2, 0).merge(table.cell(3, 0))
table.cell(2, 1).merge(table.cell(3, 1))

doc.add_heading("3 時序圖", 1)
with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
    png = handle.name
tiny_png(png)
doc.add_picture(png, width=Inches(1))
doc.add_paragraph("圖 1：上電時序（示意）")
doc.save(sys.argv[1])
