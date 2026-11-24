---
name: sam-ui
description: 團隊內部工具的網頁介面規範（SAM UI）。只要是建立或修改 HTML 網頁介面就使用，例如 AI agent 主控台、知識庫管理、測試工具、儀表板、設定表單、資料表頁、含圖表的頁面，或使用者提到 SAM UI、網頁、頁面、介面、前端、dashboard、表單、圖表。提供可直接複製的範本、元件片段、離線可用的樣式與腳本，以及檢查腳本。
---

# SAM UI

這個 skill 讓不同人、不同 AI 做出來的內部工具畫面風格一致。
做法是「複製範本、貼元件片段、跑檢查」。**不要從零開始寫 HTML，不要自己設計樣式。**

以下 `SKILL_DIR` 代表這個 SKILL.md 所在的資料夾，執行指令時換成實際路徑。
環境是公司內網，不能連外部網路：不要用 CDN，不要 `npm install`，所有需要的檔案都在 `SKILL_DIR/assets`。

## 流程

照順序做，不要跳過。

### 1. 用腳本建立頁面

```
node "SKILL_DIR/scripts/new.js" page 輸出資料夾/檔名.html
node "SKILL_DIR/scripts/new.js" app-shell 輸出資料夾/檔名.html
```

- `page`：單頁工具。上方頁首，下方內容。
- `app-shell`：有多個功能的工具。左側導覽，右側內容。

腳本會複製範本，並把 `assets` 資料夾放到頁面旁邊。頁面和 `assets` 必須在同一個資料夾。

### 2. 只改有「在這裡」註解的位置

打開新建立的檔案。可以改的位置都有 `<!-- 在這裡… -->` 註解：工具名稱、頁面標題、內容、對話框、樣式、程式。
其他部分（圖示集、雙色線、Logo、主題切換、腳本順序）不要動。

### 3. 從參考文件複製元件片段

讀 `SKILL_DIR/references/components.md`，找到需要的元件，整段複製後再改文字與 id。
不要憑記憶寫元件的 HTML，不要自己發明 class。

| 要做的東西 | 讀這個檔案 |
| --- | --- |
| 任何元件（按鈕、輸入、下拉、表格、對話框……） | `references/components.md` |
| 含篩選的資料表、設定表單 | `references/recipes.md` |
| 折線圖、長條圖、走勢線、熱圖 | `references/charts.md` |
| 頁面自己的樣式要用顏色 | `references/theme.md` |
| 不確定某種做法可不可以 | `references/rules.md` |
| 想看完整的頁面長什麼樣 | `examples/demo.html`、`examples/components.html` |

### 4. 跑檢查

```
node "SKILL_DIR/scripts/check.js" 輸出資料夾/檔名.html
```

### 5. 修正到通過

檢查不通過時，每個違規會列出「哪裡、為什麼、正確寫法、下一步」。
照「下一步」修改，然後重新執行第 4 步。重複到顯示「結果：全部通過」為止。
**沒有顯示「全部通過」就不算完成。** 不要為了通過而刪掉使用者要的功能。

## 最重要的規則

1. **不寫色碼。** 樣式裡的顏色只能寫 `var(--代號)`，例如 `color:var(--ink-2)`。不能寫 `#fff`、`rgb()`、`white`。
2. **不用瀏覽器原生控制項。** `<select>` 改用 `.select`；`input type="date"` 改用 `.datepicker`；
   `input type="range"` 改用 `.slider`；檔案上傳用 `.dropzone`；勾選、單選、開關用 `.check`、`.radio`、`.switch`。
3. **不用 `alert()`、`confirm()`、`prompt()`。** 通知用 `SAM.toast('文字')`，確認用 `.dialog`。
   提示不用 `title` 屬性，用 `data-tip="文字"`。
4. **不用 emoji 和符號字元。** 圖示只用圖示集的 SVG：`<svg class="icon"><use href="#i-check"/></svg>`。
5. **不載入外部網址。** `<link>`、`<script>`、`<img>`、`url()` 都只能用本機相對路徑。
6. **每個畫面只有一個主要按鈕（`.btn-primary`）。** 其他用 `.btn-secondary`、`.btn-ghost`。
   按鈕文字寫出會發生的事（「儲存設定」，不是「確定」）。
7. **紅色不是錯誤色。** 紅色（`--red`）只標示目前位置和待處理數量；錯誤與刪除用 `--bad`；
   可以操作的東西都是藍色。狀態一定同時有文字：`<span class="status ok">已同步</span>`。
8. **圖表用 `SAM.chart`。** 不寫 `new Chart(...)`。每個 `<canvas>` 要有 `role="img"` 和 `aria-label`。

## JS 介面

```
SAM.toast('文字')
SAM.openDialog('對話框 id')          SAM.closeDialog(對話框元素)
SAM.setTheme('light' 或 'dark')
SAM.chart(canvas, { type, labels, series, yLabel, threshold })   詳見 references/charts.md
```

`.select`、`.datepicker`、`.segmented`、`.tabs` 的值改變時會發出 `change` 事件，值在 `event.detail`：

```js
document.getElementById('sel-cat').addEventListener('change', e => { console.log(e.detail); });
```

## 常見錯誤

- 把 `sam-ui.js` 放進 `<head>`：元件不會動。腳本要留在範本原本的位置（`</body>` 前）。
- 頁面自己的程式寫在 `sam-ui.js` 前面：`SAM` 還不存在。要寫在範本最後的 `<script>` 內。
- 頁面載入後才用程式產生 `.select`、`.datepicker`、`.tabs`：不會有行為。這些元件要一開始就寫在 HTML 裡，用 `hidden` 屬性控制顯示。
- 沒有把 `assets` 放在頁面旁邊：樣式全部消失。用第 1 步的腳本建立頁面就不會發生。
- 寫死大的 px 寬度（`width:1200px`）：寬螢幕會留白、窄螢幕會出現橫向捲軸。版面預設隨視窗伸縮，寫法見 `references/theme.md` 的「寬度與尺寸」。
- 修改 `assets/` 內的檔案：不可以。要調整外觀時，在頁面的 `<style>` 內用代號寫。
