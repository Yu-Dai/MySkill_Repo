---
name: to-markdown
description: 把辦公文件轉成給 LLM 閱讀的 Markdown，用於建立知識庫。只要使用者要把 xlsx、csv、docx、pptx 轉成 Markdown，或提到轉檔、轉 md、建知識庫、整理 register table、protocol 文件、簡報、教學文件，就使用。目前支援 xlsx、csv、docx、pptx；pdf 尚未實作。
---

# ToMarkdown

把文件轉成 Markdown，目的是給 LLM 建知識庫時閱讀，不是給人排版。
**不要自己寫程式解析檔案，一律用這裡的腳本轉。** 腳本處理了合併儲存格、多列表頭、數字格式等容易出錯的地方。

以下 `SKILL_DIR` 代表這個 SKILL.md 所在的資料夾，執行指令時換成實際路徑。
腳本只用 Python 內建功能，不需要 `pip install` 任何套件。需要 Python 3.8 以上。

## 支援格式

| 格式 | 狀態 |
|------|------|
| xlsx、xlsm | 可用 |
| csv | 可用 |
| docx、docm | 可用 |
| pptx、pptm | 可用。投影片截圖需要 Windows 與已安裝的 PowerPoint |
| pdf | 尚未實作，腳本會略過並告知 |

## 流程

### 1. 執行轉檔

```
python "SKILL_DIR/scripts/to_markdown.py" 檔案或資料夾 -o 輸出資料夾
```

- 可以一次給多個檔案或資料夾，資料夾會往下找所有支援的檔案。
- 單一檔案失敗不會中斷其他檔案。
- pptx 含圖解的投影片會呼叫本機的 PowerPoint 轉成截圖，啟動需要幾秒。不要截圖時加 `--no-slide-images`。
- 輸出是 `輸出資料夾/檔名.md`；有圖片時另有 `輸出資料夾/檔名_assets/`。兩者必須放在一起，Markdown 內的圖片連結是相對路徑。

### 2. 讀轉檔結果

每個檔案會印出三種訊息，都要回報給使用者：

- `[檢查] 文字覆蓋通過`：來源每個儲存格的內容都出現在輸出裡。
- `[檢查] 有 N 段來源文字沒有出現在輸出`：有內容遺失，**不可當作轉檔成功**，把缺漏的文字列給使用者。
- `[警告]`：例如公式沒有儲存計算結果。照原文轉述。

### 3. 抽查輸出

打開轉出的 Markdown，確認：

- 十六進位值、位元範圍、前導零是否原樣保留（`0x1F`、`7:4`、`0007`）。
- 表頭是否合理。多列表頭會被壓平成 `上層 / 下層`。
- 一個 sheet 被切成幾張表是否符合原檔。
- pptx 的「連接關係」標有「推測」的項目，是依線條位置猜的，要對照截圖確認。

發現問題時告訴使用者是哪個 sheet、哪個儲存格範圍，不要手動改 Markdown 來掩蓋。

## 設定檔

`SKILL_DIR/config.example.json` 是範本。要改設定時複製成 `config.json` 再修改。

- `config.json` 內會有公司內部網址與 API 金鑰，**不可提交到版控，也不可貼到對話或輸出裡**。
- `vision` 區塊只有精準模式會用到（尚未實作）。
- `output.include_hidden_sheets`：是否輸出隱藏的工作表，預設否。
- `output.slide_images`：pptx 是否產生投影片截圖，預設是。
- `output.slide_image_width_px`：截圖寬度，預設 1600。

## 輸出格式

完整規格與已知限制在 `SKILL_DIR/references/spec.md`。需要解釋輸出為什麼長這樣，或判斷是不是轉錯時再讀。
