---
source: "register_demo.xlsx"
type: xlsx
converter: "to-markdown 0.1.0"
mode: fast
sheets: ["Register", "Protocol"]
hidden_sheets_skipped: ["tmp"]
---

# register_demo.xlsx

## Sheet: Register

### Table 1 (A1:F9)

**Demo IC Register Map（模擬資料）**

| Addr | Name | Bit | Field / Name | Field / Default | Field / Description |
|---|---|---|---|---|---|
| 0x1F | CTRL | 7:4 | MODE | 0x0 | Operating mode<br>0: idle \| 1: scan |
| 0x1F | CTRL | 3:0 | GAIN | 0x3 | Analog gain |
| 0x20 | STATUS | 7 | BUSY | 0x0 | Busy flag |
| 0x20 | STATUS | 6:1 | RSVD | 0x00 | Reserved |
| 0x20 | STATUS | 0 | ERR | 0x0 | Error flag |
| 0x21 | CHIP_ID | 7:0 | ID | 0xA5 | Chip ID |

### Table 2 (H2:K4)

| Rev | Date | Yield | Lot |
|---|---|---|---|
| 1.5 | 2026-03-09 | 97.31% | 0007 |
| 2.0 | 2026-11-02 | 98.50% | 0042 |

### Text 3 (A11:A11)

Note: all registers reset to default on power-on.

### Table 4 (A13:C15)

| Cmd | Length | Total |
|---|---|---|
| 0xA0 | 4 | 8 |
| 0xA1 | 16 | 32 |

**儲存格註解**

- F7：保留位元，寫入時必須為 0

## Sheet: Protocol

### Table 1 (A1:C3)

| Step | Direction | Payload |
|---|---|---|
| 1 | Host → IC | 0xA0 0x00 0x1F |
| 2 | IC → Host | 0x5A |
