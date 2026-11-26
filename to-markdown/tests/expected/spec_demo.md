---
source: "spec_demo.pdf"
type: pdf
converter: "to-markdown 0.1.0"
mode: fast
pages: 1
---

# spec_demo.pdf

## Page 1

### Demo Touch Driver 使用說明

#### 1 概述

本文件為模擬資料，說明 demo driver 的初始化流程。

#### 1.1 初始化步驟

1. 上電並等待 10 ms

2. 讀取 CHIP_ID（0x21）

3. 寫入 CTRL = 0x30

注意事項：

• I2C 位址為 0x5D

• 中斷腳為 active low

#### 2 暫存器摘要

| Addr | Name | Field / Bit | Field / Default |
|---|---|---|---|
| 0x1F | CTRL | 7:4 | 0x0 |
| 0x1F | CTRL | 3:0 | 0x3 |
| 0x21 | CHIP_ID | 7:0 | 0xA5 |

#### 3 時序圖

圖 1：上電時序（示意）

![圖 1-1](spec_demo_assets/img-001.png)
