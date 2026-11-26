# 相依與打包

## 各格式需要什麼

| 功能 | 需要 |
|------|------|
| xlsx、csv、docx、pptx 轉檔 | 只要 Python 3.8 以上，不需任何套件 |
| pptx 投影片截圖 | Windows、已安裝的 PowerPoint（透過 PowerShell 呼叫） |
| pdf 轉檔 | pdfplumber、pypdfium2 以及它們帶進來的套件 |
| 精準模式 | 可連到看圖 API；有安裝 Pillow 時會先把過大的圖縮小 |

## 內網電腦怎麼用

內網不能 `pip install`，所以有兩種做法：

1. **只用四種不需套件的格式：** 電腦上有 Python 即可，直接執行 `to_markdown.cmd`。
2. **需要 PDF：** 用 `tools/build_runtime.ps1` 在可連外網的 Windows 電腦建立執行環境，
   把產生的 zip 帶進內網，解壓到技能資料夾，讓資料夾內有 `runtime\python.exe`。
   `to_markdown.cmd` 會自動改用它。這個執行環境不需要安裝，也不影響電腦上原有的 Python。

`runtime` 資料夾與 zip 不進版控（執行檔放進 git 會讓倉庫越來越大），請用檔案分享的方式發佈。

**`tools/build_runtime.ps1` 尚未在 Windows 上實際執行過。**

## 第三方套件與授權

打包發佈時要把各套件的授權檔一併附上（pip 安裝後在各套件的 `.dist-info` 資料夾內）。
下表是開發時的理解，發佈前請以套件內附的授權檔為準。

| 套件 | 用途 | 授權 |
|------|------|------|
| pdfplumber | PDF 文字與表格 | MIT |
| pdfminer.six | pdfplumber 的底層解析 | MIT |
| pypdfium2 | PDF 頁面轉圖 | Apache-2.0 或 BSD-3-Clause（內含的 PDFium 為 BSD 類授權） |
| Pillow | 圖片處理 | MIT-CMU（HPND） |
| cryptography | 讀取加密的 PDF | Apache-2.0 或 BSD-3-Clause |
| charset-normalizer | 編碼偵測 | MIT |

刻意不用的套件：PyMuPDF（AGPL）。也沒有使用 MinerU 的程式碼。
