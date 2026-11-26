---
name: to-markdown
description: 把辦公文件轉成給 LLM 閱讀的 Markdown，用於建立知識庫。只要使用者要把 xlsx、csv、docx、pptx、pdf 轉成 Markdown，或提到轉檔、轉 md、建知識庫、整理 register table、protocol 文件、簡報、教學文件，就使用。支援 xlsx、csv、docx、pptx、pdf，並可選擇讓看圖模型描述圖片。
---

# ToMarkdown

把文件轉成 Markdown，目的是給 LLM 建知識庫時閱讀，不是給人排版。
**不要自己寫程式解析檔案，一律用這裡的腳本轉。** 腳本處理了合併儲存格、多列表頭、數字格式等容易出錯的地方。

以下 `SKILL_DIR` 代表這個 SKILL.md 所在的資料夾，執行指令時換成實際路徑。
xlsx、csv、docx、pptx 只用 Python 內建功能，不需要安裝任何套件，需要 Python 3.8 以上。
只有 pdf 需要第三方套件，內網電腦請用隨附的執行環境，做法見 `SKILL_DIR/references/dependencies.md`。

## 支援格式

| 格式 | 狀態 |
|------|------|
| xlsx、xlsm | 可用 |
| csv | 可用 |
| docx、docm | 可用 |
| pptx、pptm | 可用。投影片截圖需要 Windows 與已安裝的 PowerPoint |
| pdf | 可用。需要 PDF 套件；沒有時腳本會說明缺什麼 |

## 流程

### 1. 執行轉檔

Windows：

```
"SKILL_DIR\to_markdown.cmd" 檔案或資料夾 -o 輸出資料夾
```

其他系統，或想指定 Python 時：

```
python "SKILL_DIR/scripts/to_markdown.py" 檔案或資料夾 -o 輸出資料夾
```

`to_markdown.cmd` 會優先使用技能資料夾內隨附的執行環境（`runtime`），沒有才用系統的 Python。

- 可以一次給多個檔案或資料夾，資料夾會往下找所有支援的檔案。
- 單一檔案失敗不會中斷其他檔案。
- 預設是快速模式，只用腳本，不呼叫任何 API。使用者要求描述圖片、或文件以圖為主時，才加 `--mode precise`（見下方「精準模式」）。
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
- pdf 標有「請看整頁截圖」的頁面，腳本抽出的內容可能不完整，重要內容要對照截圖。

發現問題時告訴使用者是哪個 sheet、哪個儲存格範圍，不要手動改 Markdown 來掩蓋。

## 精準模式

```
"SKILL_DIR\to_markdown.cmd" 檔案 -o 輸出資料夾 --mode precise
```

- 會把每張圖送給看圖模型，圖多的文件需要幾分鐘。結果有快取，重轉同一份檔案不會重複呼叫。
- 需要先在 `config.json` 填好 `vision` 區塊。沒填時腳本會直接說明缺哪些欄位，照實告訴使用者，不要自己編造網址或金鑰。
- 模型寫的內容都在引言區塊內，以 `[AI 描述，請對照原圖]` 或 `[AI 轉寫，請對照原圖]` 開頭。**引用這些內容時要說明它是模型產生的**，數值與位元欄位以原圖為準。
- 呼叫失敗時腳本會列出警告，輸出仍保有腳本抽取的內容。

## 設定檔

`SKILL_DIR/config.example.json` 是範本。要改設定時複製成 `config.json` 再修改。

- `config.json` 內會有公司內部網址與 API 金鑰，**不可提交到版控，也不可貼到對話或輸出裡**。
- `vision` 區塊只有精準模式會用到：`base_url`、`model`、`api_key`，以及金鑰要放在哪個 header（`api_key_header`）、是否加前綴（`api_key_prefix`）。金鑰也可以改用環境變數 `TOMD_API_KEY`。
- `output.include_hidden_sheets`：是否輸出隱藏的工作表，預設否。
- `output.slide_images`：pptx 是否產生投影片截圖，預設是。
- `output.slide_image_width_px`：截圖寬度，預設 1600。
- `output.pdf_page_images`：pdf 是否為腳本處理不了的頁面產生整頁截圖，預設是。

## 輸出格式

完整規格與各格式的已知限制在 `SKILL_DIR/references/spec.md`。相依套件與內網打包方式在 `SKILL_DIR/references/dependencies.md`。需要解釋輸出為什麼長這樣，或判斷是不是轉錯時再讀。
