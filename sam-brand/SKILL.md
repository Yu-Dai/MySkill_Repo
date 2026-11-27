---
name: sam-brand
description: SAM 的品牌識別：Logo、色票、配色角色、隨附字體，以及離線打包的資產與檢查腳本。只要產出要帶 SAM 品牌就使用，例如團隊內部工具的網頁介面、儀表板、主控台、報表頁，或要在簡報、文件、圖表套用 SAM 配色；使用者提到 SAM、SAM UI、品牌色、Logo、公司配色時也使用。版面與風格不在這裡規定，設計網頁時搭配 sam-frontend-design。不用於與 SAM 無關的對外或個人專案。
---

# SAM Brand

這個 skill 只鎖四件事，其餘（版面、字體搭配、元件造型、動態、密度）都由設計者自己決定。

| 鎖定 | 內容 |
| --- | --- |
| 色票 | 顏色只能來自 `assets/sam-brand.css` 的代號，不寫色碼 |
| Logo | 每個頁面都要出現 `assets/logo.png`，不能改圖、不能用文字代替 |
| 不連外 | 執行環境是公司內網：不用 CDN、不 `npm install`，樣式、腳本、字體、圖片都用本機相對路徑 |
| 不用原生控制項 | 下拉、日期、滑桿、勾選、單選、檔案上傳、`alert()` 都要重畫或改用自訂元件 |

以下 `SKILL_DIR` 代表這個 SKILL.md 所在的資料夾。

## 做網頁時的流程

1. 把資產放到頁面旁邊：

   ```
   node "SKILL_DIR/scripts/new.js" assets 輸出資料夾
   ```

2. 頁面 `<head>` 的第一個樣式載入品牌代號，之後才是自己的樣式：

   ```html
   <link rel="stylesheet" href="assets/sam-brand.css">
   ```

3. 設計頁面。設計流程與判斷看 `sam-frontend-design`；顏色怎麼用看下面的「色票」。
4. 檢查並修正到通過：

   ```
   node "SKILL_DIR/scripts/check.js" 輸出資料夾/檔名.html
   ```

   每個違規會列出「哪裡、為什麼、正確寫法、下一步」。**沒有顯示「結果：全部通過」就不算完成。**
   檢查只管上面四件鎖定的事，不管版面與風格。

## 色票

代號在淺色與深色主題下各有一組值，只要顏色都用代號，頁面就會自動適應兩種主題。
完整代號表與深淺色切換方式在 `references/theme.md`。

| 角色 | 代號 | 規則 |
| --- | --- | --- |
| 品牌紅 | `--red` | 點綴與標示：目前位置、待處理、需要注意的東西。不當錯誤色，不鋪大面積 |
| 品牌藍 | `--blue`、`--blue-strong`、`--blue-solid` | 所有可以操作的東西：主要按鈕、連結、焦點、已選取 |
| 品牌深藍 | `--navy`、`--navy-2` | 承載品牌的面（導覽、頁首、封面）。兩種主題下都是深藍 |
| 中性 | `--paper`、`--surface`、`--sunken`、`--line`、`--ink` 系列 | 底色、容器、邊線、文字 |
| 語意 | `--ok`、`--warn`、`--bad` | 成功、警告、錯誤。錯誤用 `--bad`，不借用品牌紅 |

- 需要色票以外的深淺時，從代號混色：`color-mix(in srgb, var(--blue) 12%, var(--surface))`。
- 不重新定義這些代號的值。可以新增自己的代號，但值要來自既有代號或 `color-mix()`。
- 紅、藍、深藍三者的比重可以自己決定（深藍為主的沉穩頁面、紙白為主的輕盈頁面都可以），角色不能互換。
- 狀態不能只靠顏色表達，要同時有文字或圖示。

## Logo

- 圖檔：`assets/logo.png`（圖形標誌，透明背景）。
- 位置與大小自己設計。放在深色或有顏色的底上時，墊一塊白底。
- 不拉伸變形、不改色、不加特效、不用文字「SAM」代替。

## 字體

- 隨附 IBM Plex Sans 與 IBM Plex Mono（只含拉丁字元），代號是 `--font-sans`、`--font-mono`。中文用系統字體。
- 字體不鎖定。想換字體時，把字體檔（woff2）連同授權檔放在頁面旁，用 `@font-face` 載入本機檔案。
- 拿不到字體檔時，用系統字體堆疊做出差異（例如襯線：`Georgia, "Noto Serif TC", PMingLiU, serif`），不要連到外部字體服務。

## 不用原生控制項

兩種做法擇一，可以混用：

- **自己設計。** 保留隱藏的 `<input>` 以支援鍵盤與表單，外觀自己畫。
- **用隨附的元件包。** `assets/sam-ui.css` 加 `assets/sam-ui.js` 提供下拉、日期選擇器、滑桿、對話框、通知、圖表等現成元件。
  適合資料密集、想省工時的工具頁。用法在 `references/components.md`，起手範本用
  `node "SKILL_DIR/scripts/new.js" page 檔名.html` 或 `app-shell 檔名.html`。
  元件包的外觀可以在頁面的 `<style>` 內覆寫，不要改 `assets/` 內的檔案。

## 套用到網頁以外的產出

簡報、文件、圖表沒有 CSS 代號可用，直接取 `references/theme.md` 的淺色色值，角色規則相同：
深藍當封面與標題底、藍色當重點、紅色只做點綴、圖表序列依 `--chart-1` 到 `--chart-5` 的順序。

## 參考文件

| 要做的事 | 讀這個檔案 |
| --- | --- |
| 查代號與色值、切換深淺色 | `references/theme.md` |
| 確認某種做法有沒有違反鎖定項目 | `references/rules.md` |
| 用元件包的元件 | `references/components.md` |
| 用元件包做含篩選的資料表、設定表單 | `references/recipes.md` |
| 用元件包畫圖表 | `references/charts.md` |
| 看元件包做出來的完整頁面 | `examples/demo.html`、`examples/components.html` |
