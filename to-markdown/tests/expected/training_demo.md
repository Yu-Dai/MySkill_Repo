---
source: "training_demo.pptx"
type: pptx
converter: "to-markdown 0.1.0"
mode: fast
slides: 3
---

# training_demo.pptx

## Slide 1: Demo Driver 教學

- 驅動程式架構
  - I2C 傳輸層
- 韌體更新流程

**講者備註：** 這頁先講整體架構，細節在後面。

## Slide 2: 開機流程

**圖中文字：** Power On、Load FW、Check CRC、Fail、Normal Mode

**連接關係：** Power On → Load FW；Load FW → Check CRC；Check CRC → Normal Mode；Check CRC → Fail（推測）

## Slide 3: 命令列表

| Cmd | Length | 說明 |
|---|---|---|
| 0xA0 | 4 | 讀取狀態 |
| 0xA1 | 16 | 寫入設定 |
