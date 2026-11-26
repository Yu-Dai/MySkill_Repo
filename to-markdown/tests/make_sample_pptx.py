"""產生模擬的 pptx 樣本（開發用，需要 python-pptx；轉檔本身不需要）。內容全部是虛構資料。
用法：python make_sample_pptx.py 輸出路徑.pptx
"""
import sys

from pptx import Presentation
from pptx.enum.shapes import MSO_CONNECTOR, MSO_SHAPE
from pptx.oxml.ns import qn
from pptx.util import Inches

prs = Presentation()

slide = prs.slides.add_slide(prs.slide_layouts[1])
slide.shapes.title.text = "Demo Driver 教學"
body = slide.placeholders[1].text_frame
body.text = "驅動程式架構"
para = body.add_paragraph(); para.text = "I2C 傳輸層"; para.level = 1
para = body.add_paragraph(); para.text = "韌體更新流程"
slide.notes_slide.notes_text_frame.text = "這頁先講整體架構，細節在後面。"


def box(slide, text, left, top):
    shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, Inches(left), Inches(top), Inches(1.8), Inches(0.8))
    shape.text_frame.text = text
    return shape


def arrow(connector):
    line = connector.line._get_or_add_ln()
    tail = line.makeelement(qn("a:tailEnd"), {"type": "triangle"})
    line.append(tail)


slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "開機流程"
power = box(slide, "Power On", 0.5, 2)
load = box(slide, "Load FW", 3.2, 2)
crc = box(slide, "Check CRC", 5.9, 2)
normal = box(slide, "Normal Mode", 5.9, 4)
fail = box(slide, "Fail", 3.2, 4)
for a, b in ((power, load), (load, crc)):
    conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, 0, 0, 0, 0)
    conn.begin_connect(a, 3); conn.end_connect(b, 1); arrow(conn)
conn = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, 0, 0, 0, 0)
conn.begin_connect(crc, 2); conn.end_connect(normal, 0); arrow(conn)
# 沒有黏在圖案上的線：只靠座標靠近 Check CRC 與 Fail
loose = slide.shapes.add_connector(MSO_CONNECTOR.STRAIGHT, Inches(5.95), Inches(2.85), Inches(4.95), Inches(4.05))
arrow(loose)

slide = prs.slides.add_slide(prs.slide_layouts[5])
slide.shapes.title.text = "命令列表"
frame = slide.shapes.add_table(3, 3, Inches(0.5), Inches(1.5), Inches(8), Inches(1.5))
for r, row in enumerate((("Cmd", "Length", "說明"), ("0xA0", "4", "讀取狀態"), ("0xA1", "16", "寫入設定"))):
    for c, text in enumerate(row):
        frame.table.cell(r, c).text = text
prs.save(sys.argv[1])
