# 主題與設計代號

所有顏色都定義在 `assets/msp-ui.css`。頁面自己的樣式只能寫 `var(--代號)`，不能寫色碼（`#fff`、`rgb()`、`white`）。
不要在頁面裡重新定義這些代號，也不要新增顏色代號。

## 主題

- 只有淺色與深色。預設跟隨系統設定。
- 切換方式：`<html data-theme="light">` 或 `<html data-theme="dark">`。不要自己寫，用下面兩種方法之一：
  - 範本裡的主題切換開關（`.segmented` 加 `data-theme-toggle`）。
  - `MSP.setTheme('light')` 或 `MSP.setTheme('dark')`。選擇會記在 localStorage。
- 導覽列與頁首在兩種主題下都是深藍底。
- 只要顏色都用代號，元件會自動適應兩種主題，不需要寫 `@media (prefers-color-scheme)`。

## 顏色代號

| 用途 | 代號 | 說明 |
| --- | --- | --- |
| 文字 | `--ink` | 主要文字 |
| | `--ink-2` | 次要文字（也可用 class `muted`） |
| | `--ink-3` | 輔助文字、說明（也可用 class `faint`） |
| 底色 | `--paper` | 頁面底色 |
| | `--surface` | 容器、卡片、輸入框 |
| | `--sunken` | 凹陷區、游標移上的底色 |
| 邊線 | `--line` | 一般分隔線、容器邊框 |
| | `--line-strong` | 輸入框邊框 |
| 操作 | `--blue` | 焦點外框、已選取、開關、進度 |
| | `--blue-strong` | 連結文字 |
| | `--blue-solid`、`--on-blue` | 主要按鈕的底色與文字 |
| | `--blue-tint` | 淡藍底 |
| 位置與待辦 | `--red` | 目前導覽項目、分頁底線、待處理數量、圖表門檻線。不用在按鈕、錯誤、大面積底色 |
| 品牌面 | `--navy`、`--navy-2` | 只用在導覽列與頁首 |
| | `--on-navy`、`--on-navy-2` | 深藍底上的文字、次要文字 |
| 語意 | `--ok`、`--ok-tint` | 成功 |
| | `--warn`、`--warn-tint` | 警告 |
| | `--bad`、`--bad-tint` | 錯誤、刪除 |
| 反白 | `--on-ink` | 深色底（`--ink`、`--ok`、`--bad`）上的文字 |
| 圖表 | `--chart-1` 到 `--chart-5` | 由 `MSP.chart` 自動取用，不要手動指定 |
| 浮層 | `--shadow` | 陰影，只給選單、對話框、通知 |
| | `--overlay` | 對話框背後的遮罩 |

## 其他代號

| 代號 | 值 | 用途 |
| --- | --- | --- |
| `--font-sans` | IBM Plex Sans 加系統中文字體 | 內文 |
| `--font-mono` | IBM Plex Mono | 等寬（也可用 class `mono`） |
| `--r-control` | 6px | 控制項圓角（按鈕、輸入框） |
| `--r-box` | 10px | 容器圓角 |
| `--h-control` | 36px | 控制項高度 |

對話框圓角 12px、狀態標籤全圓，已寫在元件樣式內。

## 寬度與尺寸

版面預設隨視窗伸縮，寬螢幕不會在兩側留白。**不要寫死大的 px 寬度**（例如 `width:1200px`、`max-width:960px`）。

| 要做的事 | 寫法 |
| --- | --- |
| 限制整頁內容的最大寬度（以閱讀長文為主的頁面） | 範本 `<style>` 開頭的 `--content-max`，把 `none` 改成 `1280px` |
| 欄數隨寬度變化 | `grid-template-columns:repeat(auto-fit,minmax(220px,1fr))`，或直接用 class `grid` |
| 兩欄，右欄較窄 | `grid-template-columns:minmax(0,2.4fr) minmax(300px,1fr)` |
| 有上限但不超出容器 | `width:min(720px,100%)` |
| 隨視窗伸縮的間距 | `padding:0 clamp(16px,3vw,48px)` |
| 下拉、輸入框的寬度 | 用 `min-width`，不用 `width`，文字較長時才撐得開 |
| 對話框寬度 | `.dialog` 上寫 `style="--dialog-w:720px"`（預設 480px） |
| 圖表高度 | `.chart` 上寫 `style="height:200px"`（預設 240px） |

## 頁面自訂樣式的寫法

```css
.summary{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:1px solid var(--line);border-radius:var(--r-box);background:var(--surface)}
.summary b{font-size:26px;font-weight:600;color:var(--ink)}
.summary span{font-size:13px;color:var(--ink-2)}
```

字級只用 12、13、14、16、20、26、34（px）。內文是 14px，不用另外指定。

## Logo

Logo 圖檔是 `assets/logo.png`（圖形標誌，透明背景）。範本已經放在白底的 `.logo-chip` 內，不要移動、不要換成文字。
