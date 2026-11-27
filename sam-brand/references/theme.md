# 主題與設計代號

所有顏色都定義在 `assets/sam-brand.css`。頁面自己的樣式只能寫 `var(--代號)`，不能寫色碼（`#fff`、`rgb()`、`white`）。
不要在頁面裡重新定義這些代號。需要其他深淺時用 `color-mix()` 從代號混色，例如
`color-mix(in srgb, var(--blue) 12%, var(--surface))`；混出來的顏色可以存成自己的代號。

## 主題

- 只有淺色與深色。預設跟隨系統設定。
- 切換方式：`<html data-theme="light">` 或 `<html data-theme="dark">`。
  - 用元件包時：範本裡的主題切換開關（`.segmented` 加 `data-theme-toggle`），或 `SAM.setTheme('light')`、`SAM.setTheme('dark')`，選擇會記在 localStorage。
  - 自己設計時：自己在 `<html>` 上設定這個屬性。
- `--navy` 在兩種主題下都是深藍。
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
| 位置與待辦 | `--red` | 點綴與標示：目前位置、待處理數量、圖表門檻線。不用在錯誤、大面積底色 |
| 品牌面 | `--navy`、`--navy-2` | 承載品牌的面：導覽、頁首、封面 |
| | `--on-navy`、`--on-navy-2` | 深藍底上的文字、次要文字 |
| 語意 | `--ok`、`--ok-tint` | 成功 |
| | `--warn`、`--warn-tint` | 警告 |
| | `--bad`、`--bad-tint` | 錯誤、刪除 |
| 反白 | `--on-ink` | 深色底（`--ink`、`--ok`、`--bad`）上的文字 |
| 圖表 | `--chart-1` 到 `--chart-5` | 序列依序取用；`SAM.chart` 會自動處理 |
| 浮層 | `--shadow` | 陰影，只給選單、對話框、通知 |
| | `--overlay` | 對話框背後的遮罩 |

## 色值

給簡報、文件、圖片這類沒有 CSS 代號可用的產出。網頁一律用代號，不要抄這裡的色碼。

| 代號 | 淺色 | 深色 |
| --- | --- | --- |
| `--red` | `#CC1018` | `#E5343B` |
| `--blue` | `#547CBC` | `#7FA2DB` |
| `--blue-strong` | `#3B5F9E` | `#9DB9E6` |
| `--blue-solid` | `#456DAE` | `#7FA2DB` |
| `--blue-tint` | `#EAF0F9` | `#1C2740` |
| `--navy` | `#1C2B4A` | `#131C30` |
| `--navy-2` | `#2A3F68` | `#22304F` |
| `--ink` | `#161B26` | `#E8EBF1` |
| `--ink-2` | `#4A5262` | `#A9B1C0` |
| `--ink-3` | `#7A8292` | `#737C8D` |
| `--paper` | `#F5F6F8` | `#0F1218` |
| `--surface` | `#FFFFFF` | `#171B23` |
| `--sunken` | `#ECEEF2` | `#0B0E13` |
| `--line` | `#DDE1E8` | `#272D39` |
| `--line-strong` | `#C3C9D4` | `#3A4252` |
| `--ok` | `#1F8A63` | `#4CC08F` |
| `--warn` | `#A86E0A` | `#E0A63A` |
| `--bad` | `#B3261E` | `#F0736B` |
| `--chart-1` 到 `--chart-5` | `#547CBC` `#1C2B4A` `#8A93A3` `#2A9D8F` `#C98A1B` | `#7FA2DB` `#D5DDEE` `#7A8292` `#4FC3B4` `#E0A63A` |

## 其他代號

圓角與控制項高度是元件包使用的預設值，自己設計時可以不用。

| 代號 | 值 | 用途 |
| --- | --- | --- |
| `--font-sans` | IBM Plex Sans 加系統中文字體 | 內文 |
| `--font-mono` | IBM Plex Mono | 等寬（也可用 class `mono`） |
| `--r-control` | 6px | 控制項圓角（按鈕、輸入框） |
| `--r-box` | 10px | 容器圓角 |
| `--h-control` | 36px | 控制項高度 |

對話框圓角 12px、狀態標籤全圓，已寫在元件樣式內。

## 寬度與尺寸（元件包範本）

元件包的範本預設隨視窗伸縮。以下是範本內調整寬度的寫法，自己設計的版面不受限。

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

元件包的內文是 14px。字級與字體可以自己決定。

## Logo

Logo 圖檔是 `assets/logo.png`（圖形標誌，透明背景）。位置與大小自由；放在深色底上時墊白底（元件包的 `.logo-chip`），不要換成文字。
