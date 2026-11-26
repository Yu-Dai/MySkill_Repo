"""產生模擬的 register table 樣本（開發用，需要 openpyxl；轉檔本身不需要）。

內容全部是虛構資料，不含任何真實產品資訊。
用法：python make_sample_xlsx.py 輸出路徑.xlsx
"""

import datetime
import sys

from openpyxl import Workbook
from openpyxl.comments import Comment

book = Workbook()

reg = book.active
reg.title = "Register"
reg["A1"] = "Demo IC Register Map（模擬資料）"
reg.merge_cells("A1:F1")
for ref, text in (("A2", "Addr"), ("B2", "Name"), ("C2", "Bit"), ("D2", "Field"),
                  ("D3", "Name"), ("E3", "Default"), ("F3", "Description")):
    reg[ref] = text
for span in ("A2:A3", "B2:B3", "C2:C3", "D2:F2"):
    reg.merge_cells(span)
rows = [
    ("0x1F", "CTRL", "7:4", "MODE", "0x0", "Operating mode\n0: idle | 1: scan"),
    (None, None, "3:0", "GAIN", "0x3", "Analog gain"),
    ("0x20", "STATUS", "7", "BUSY", "0x0", "Busy flag"),
    (None, None, "6:1", "RSVD", "0x00", "Reserved"),
    (None, None, "0", "ERR", "0x0", "Error flag"),
    ("0x21", "CHIP_ID", "7:0", "ID", "0xA5", "Chip ID"),
]
for offset, row in enumerate(rows):
    for col, value in enumerate(row, 1):
        if value is not None:
            reg.cell(row=4 + offset, column=col, value=value)
for span in ("A4:A5", "B4:B5", "A6:A8", "B6:B8"):
    reg.merge_cells(span)
reg["F7"].comment = Comment("保留位元，寫入時必須為 0", "demo")

# 同一個 sheet 右側的第二張表（以空白欄隔開），測試數字格式
for col, text in zip("HIJK", ("Rev", "Date", "Yield", "Lot")):
    reg[col + "2"] = text
reg["H3"], reg["I3"], reg["J3"], reg["K3"] = 1.5, datetime.date(2026, 3, 9), 0.9731, 7
reg["H4"], reg["I4"], reg["J4"], reg["K4"] = 2, datetime.date(2026, 11, 2), 0.985, 42
for row in (3, 4):
    reg["H%d" % row].number_format = "0.0"
    reg["I%d" % row].number_format = "yyyy/m/d"
    reg["J%d" % row].number_format = "0.00%"
    reg["K%d" % row].number_format = "0000"

# 下方以空白列隔開的說明文字與第三張表
reg["A11"] = "Note: all registers reset to default on power-on."
reg["A13"], reg["B13"], reg["C13"] = "Cmd", "Length", "Total"
reg["A14"], reg["B14"], reg["C14"] = "0xA0", 4, "=B14*2"
reg["A15"], reg["B15"], reg["C15"] = "0xA1", 16, "=B15*2"

proto = book.create_sheet("Protocol")
proto.append(["Step", "Direction", "Payload"])
proto.append([1, "Host → IC", "0xA0 0x00 0x1F"])
proto.append([2, "IC → Host", "0x5A"])

book.create_sheet("tmp").sheet_state = "hidden"
book["tmp"]["A1"] = "scratch"

book.save(sys.argv[1])
