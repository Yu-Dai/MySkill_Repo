# 元件片段

用法：找到需要的元件，把 HTML 片段整段複製到範本的「在這裡放內容」位置，再改文字與 id。
不要自己發明 class 名稱，不要改片段的結構。同一頁內每個 id 只能出現一次。
單獨的按鈕要包在 `<div class="row">` 裡面，否則會被拉成整列寬。

目錄：版面輔助、圖示、按鈕、文字輸入、下拉、日期選擇器、勾選單選開關、分段選擇、滑桿、檔案上傳、
標籤與狀態、分頁籤、麵包屑、分頁、容器、表格、訊息、進度與載入、空白畫面、通知、對話框、選單、提示、
主題切換、品牌元素、程式碼。圖表在 `charts.md`。

## 版面輔助

| class | 作用 |
| --- | --- |
| `.row` | 橫向排列，垂直置中，間距 12px，會換行 |
| `.stack` | 直向排列，間距 12px |
| `.grid` | 自動分欄的格線，每欄至少 220px（定義在範本內） |
| `.muted`、`.faint` | 次要文字、輔助文字的顏色 |
| `.mono` | 等寬字：位址、數值、版本號、檔名、指令 |
| `.num` | 等寬數字：會對齊成欄的數字 |
| `.sr` | 畫面上隱藏，只給螢幕閱讀器 |

## 圖示

只能用這 17 個，名稱不能自己編：
`i-chevron` `i-search` `i-plus` `i-check` `i-x` `i-more` `i-info` `i-alert` `i-upload` `i-file`
`i-book` `i-grid` `i-inbox` `i-pulse` `i-gear` `i-play` `i-calendar`

```html
<svg class="icon"><use href="#i-search"/></svg>
```

## 按鈕

何時用：`.btn-primary` 是這個畫面最重要的動作，**每個畫面只能一個**（對話框內另計）。
其他動作用 `.btn-secondary`，不重要的用 `.btn-ghost`，刪除類用 `.btn-danger`。
文字寫出按下去會發生的事（「儲存設定」，不是「確定」）。

```html
<div class="row">
  <button class="btn btn-primary">儲存設定</button>
  <button class="btn btn-secondary">取消</button>
  <button class="btn btn-ghost">略過</button>
  <button class="btn btn-danger">刪除知識庫</button>
</div>
<div class="row">
  <button class="btn btn-secondary"><svg class="icon"><use href="#i-plus"/></svg>新增來源</button>
  <button class="btn btn-secondary btn-sm">重新整理</button>
  <button class="btn btn-secondary btn-icon" aria-label="更多動作" data-tip="更多動作"><svg class="icon"><use href="#i-more"/></svg></button>
  <button class="btn btn-secondary" aria-disabled="true"><span class="spinner"></span>匯入中</button>
  <button class="btn btn-secondary" disabled>無法使用</button>
</div>
```

- 小尺寸加 `.btn-sm`。只有圖示加 `.btn-icon`，並且一定要有 `aria-label`。
- 處理中：加 `aria-disabled="true"` 和 `<span class="spinner"></span>`。

## 文字輸入

何時用：單行用 `.input`，多行用 `.textarea`。標籤在上方，說明（`.hint`）在下方。
錯誤時在 `.field` 加 `is-error`，並把 `.hint` 改成「哪裡不對、怎麼修正」。

```html
<div class="grid">
  <div class="field"><label class="label" for="in-name">知識庫代號</label><input class="input mono" id="in-name" value="touch-driver-linux"><span class="hint">小寫英數與連字號</span></div>
  <div class="field is-error"><label class="label" for="in-err">頁面名稱</label><input class="input mono" id="in-err" value="Reg Map"><span class="hint">不能有空白或大寫，改成 reg-map</span></div>
  <div class="field"><label class="label" for="in-search">搜尋</label><div class="input-wrap"><svg class="icon"><use href="#i-search"/></svg><input class="input" id="in-search" type="search" placeholder="關鍵字、別名或暫存器名稱"></div></div>
  <div class="field"><label class="label" for="in-dis">擁有單位</label><input class="input" id="in-dis" value="驅動一部" disabled></div>
</div>
<div class="field"><label class="label" for="in-ta">一句話描述</label><textarea class="textarea" id="in-ta">Linux 觸控驅動的移植步驟、暫存器說明與常見問題。</textarea></div>
```

## 下拉

何時用：選項五個以上，或空間不夠放分段選擇。**不能用 `<select>`**。需要 sam-ui.js。

```html
<div class="field">
  <span class="label" id="lb-cat">分類</span>
  <div class="select" id="sel-cat" data-value="driver">
    <button class="select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="lb-cat"><span class="select-value">驅動程式</span><svg class="icon"><use href="#i-chevron"/></svg></button>
    <ul class="select-menu" role="listbox">
      <li role="option" data-value="driver" aria-selected="true">驅動程式</li>
      <li role="option" data-value="fw" aria-selected="false">韌體</li>
      <li role="option" data-value="spec" aria-selected="false">規格文件</li>
      <li role="option" data-value="tool" aria-selected="false">工具與腳本</li>
    </ul>
  </div>
</div>
```

- 預設選項三處要一致：`.select` 的 `data-value`、`.select-value` 的文字、該 `<li>` 的 `aria-selected="true"`。
- 沒有上方標籤時，把按鈕的 `aria-labelledby` 換成 `aria-label="分類"`。

```js
const cat = document.getElementById('sel-cat');
cat.addEventListener('change', e => { console.log(e.detail, cat.dataset.value); });  // 兩者都是選到的 data-value
```

## 日期選擇器

何時用：所有日期輸入。**不能用 `input type="date"`**。值的格式是 `YYYY-MM-DD`。需要 sam-ui.js。
只支援單一日期；日期區間請放兩個（起、迄）。

```html
<div class="field">
  <span class="label" id="lb-date">量測日期</span>
  <div class="datepicker" id="dp-date" data-value="2026-11-20">
    <button class="select-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-labelledby="lb-date"><span class="select-value mono num">2026-11-20</span><svg class="icon"><use href="#i-calendar"/></svg></button>
    <div class="calendar" role="dialog" aria-label="選擇日期"></div>
  </div>
</div>
```

- `.calendar` 保持空的，內容由腳本產生。
- 還沒選日期時：拿掉 `data-value`，文字寫成 `<span class="select-value mono num faint">選擇日期</span>`。

```js
const dp = document.getElementById('dp-date');
dp.addEventListener('change', e => { console.log(e.detail, dp.dataset.value); });  // '2026-11-21'
```

## 勾選單選開關

何時用：可複選用 `.check`；互斥用 `.radio`（同一組 `name` 相同）；立即生效的設定用 `.switch`。
裡面的 `<input>` 和 `<span class="box">`（開關是 `<span class="track">`）都要保留，順序不能換。

```html
<div class="grid">
  <div class="stack">
    <label class="check"><input type="checkbox" id="ck1" checked><span class="box"></span>匯入後執行檢索測試</label>
    <label class="check"><input type="checkbox" id="ck2"><span class="box"></span>壓縮圖片</label>
  </div>
  <div class="stack">
    <label class="radio"><input type="radio" name="rd" id="rd1" checked><span class="box"></span>內部公開</label>
    <label class="radio"><input type="radio" name="rd" id="rd2"><span class="box"></span>限本單位</label>
  </div>
  <div class="stack">
    <label class="switch"><input type="checkbox" id="sw1" checked><span class="track"></span>啟動時自動同步</label>
    <label class="switch"><input type="checkbox" id="sw2"><span class="track"></span>顯示原始來源</label>
  </div>
</div>
```

讀值：`document.getElementById('ck1').checked`。事件用 input 的一般 `change`。

## 分段選擇

何時用：二到四個互斥選項，例如檢視範圍、篩選。需要 sam-ui.js。

```html
<div class="field">
  <span class="label">檢視範圍</span>
  <div class="segmented" id="seg-scope" role="group" aria-label="檢視範圍">
    <button type="button" aria-pressed="true" data-value="all">全部</button>
    <button type="button" aria-pressed="false" data-value="shared">共享</button>
    <button type="button" aria-pressed="false" data-value="personal">個人</button>
  </div>
</div>
```

```js
document.getElementById('seg-scope').addEventListener('change', e => { console.log(e.detail); });  // 'shared'
```

## 滑桿

何時用：在範圍內調整數值。**不能用 `input type="range"`**。需要 sam-ui.js。
`data-output` 指向顯示目前數值的元素。

```html
<div class="field">
  <span class="label">報點率上限 <span class="mono num faint"><span id="hz-out">120</span> Hz</span></span>
  <div class="slider" id="sl-hz" data-min="60" data-max="240" data-step="10" data-value="120" data-output="#hz-out">
    <div class="slider-track"></div><div class="slider-fill"></div>
    <div class="slider-thumb" role="slider" tabindex="0" aria-label="報點率上限"></div>
  </div>
</div>
```

讀值：`Number(document.getElementById('hz-out').textContent)`。滑桿不會發出 `change` 事件。

## 檔案上傳

何時用：選擇或拖放檔案。`<input type="file">` 一定要放在 `.dropzone` 裡面。需要 sam-ui.js。
`data-list` 指向顯示檔名的清單。

```html
<div class="dropzone" tabindex="0" role="button" data-list="#files">
  <svg class="icon"><use href="#i-upload"/></svg>
  <span><b>選擇檔案</b>，或拖放到這裡</span>
  <span class="hint">只接受文字檔：.md .txt .c .h .cs .html .csv</span>
  <input type="file" id="up" multiple>
</div>
<ul class="file-list" id="files"><li><svg class="icon"><use href="#i-file"/></svg><span class="mono">nt36xxx_spec.md</span></li></ul>
```

讀檔：`document.getElementById('up').files`（點選時）。

## 標籤與狀態

何時用：`.status` 顯示狀態，一定要有文字；`.tag` 是分類標籤；`.count` 是待處理數量（紅色，只用在這裡）。

```html
<div class="row">
  <span class="status ok">已同步</span>
  <span class="status info">匯入中</span>
  <span class="status warn">需檢查</span>
  <span class="status bad">匯入失敗</span>
  <span class="status">未掛載</span>
</div>
<div class="row">
  <span class="tag">驅動程式</span><span class="tag">韌體</span><span class="tag mono">schema v1</span>
  <span class="row">待處理來源 <span class="count">3</span></span>
</div>
```

## 分頁籤

何時用：同一頁內切換幾個面板。`data-panel` 填面板的 id；沒選中的面板加 `hidden`。需要 sam-ui.js。

```html
<div>
  <div class="tabs" role="tablist">
    <button role="tab" aria-selected="true" data-panel="tp1">頁面</button>
    <button role="tab" aria-selected="false" data-panel="tp2">原始來源</button>
    <button role="tab" aria-selected="false" data-panel="tp3">匯入紀錄</button>
  </div>
  <div id="tp1" class="stack"><p class="muted">214 頁，分成 6 個分類。</p></div>
  <div id="tp2" class="stack" hidden><p class="muted">38 份原始來源，全部為文字檔。</p></div>
  <div id="tp3" class="stack" hidden><p class="muted">最近一次匯入在 11 月 20 日。</p></div>
</div>
```

## 麵包屑

```html
<nav class="crumbs" aria-label="路徑"><a href="#">知識庫</a><span>/</span><a href="#">touch-driver-linux</a><span>/</span><span aria-current="page">匯入紀錄</span></nav>
```

## 分頁

```html
<div class="row">
  <span class="faint num">第 21 到 40 筆，共 214 筆</span>
  <div class="pager" role="navigation" aria-label="分頁"><button>1</button><button aria-current="page">2</button><button>3</button><button>4</button><button>11</button></div>
</div>
```

目前頁加 `aria-current="page"`。換頁的行為要自己寫。

## 容器

何時用：把相關內容框成一塊。標題列 `.panel-head` 可省略。內容放 `.panel-body`。不要加陰影。

```html
<div class="panel">
  <div class="panel-head"><h3>匯入進度</h3><span class="mono faint num">58%</span></div>
  <div class="panel-body stack">
    <p class="muted">內容放在這裡。</p>
  </div>
</div>
```

## 表格

何時用：列出多筆資料。表格直接放在 `.panel` 內（不要再包 `.panel-body`）。
數字欄加 `.r`（靠右）和 `.num`；位址、代號、數值加 `.mono`。

```html
<div class="panel">
  <div class="panel-head"><h3>暫存器對照</h3><button class="btn btn-secondary btn-sm">匯出 CSV</button></div>
  <div class="table-wrap">
    <table class="table">
      <thead><tr><th>位址</th><th>名稱</th><th>說明</th><th class="r">預設值</th><th>狀態</th></tr></thead>
      <tbody>
        <tr><td class="mono">0x3E</td><td class="mono">REG_SCAN_RATE</td><td>掃描頻率設定</td><td class="r mono">0x5A</td><td><span class="status ok">已驗證</span></td></tr>
        <tr><td class="mono">0x41</td><td class="mono">REG_GESTURE_EN</td><td>手勢喚醒開關</td><td class="r mono">0x00</td><td><span class="status ok">已驗證</span></td></tr>
        <tr><td class="mono">0x52</td><td class="mono">REG_NOISE_TH</td><td>雜訊門檻</td><td class="r mono">0x1C</td><td><span class="status warn">待確認</span></td></tr>
      </tbody>
    </table>
  </div>
</div>
```

含篩選的完整做法在 `recipes.md`。

## 訊息

何時用：頁面內的說明、警告、錯誤。一定同時有圖示和文字。錯誤要說明哪裡不對、怎麼修正。
`info` 與 `ok` 用 `i-info`、`i-check`；`warn` 與 `bad` 用 `i-alert`。

```html
<div class="stack">
  <div class="alert info"><svg class="icon"><use href="#i-info"/></svg><div>共享知識庫為唯讀，要修改請聯絡擁有單位。</div></div>
  <div class="alert ok"><svg class="icon"><use href="#i-check"/></svg><div>索引已更新，共 214 頁。</div></div>
  <div class="alert warn"><svg class="icon"><use href="#i-alert"/></svg><div>本機快取是 3 天前的版本。連上共享資料夾後會自動更新。</div></div>
  <div class="alert bad"><svg class="icon"><use href="#i-alert"/></svg><div><b>匯入失敗：</b><span class="mono">spec_v3.pdf</span> 不是文字檔。先用 toMarkdown 轉檔再放進 raw 資料夾。</div></div>
</div>
```

## 進度與載入

`.progress` 內的 `<i>` 寬度就是進度，這是少數可以寫 `style` 的地方（只寫 `width`）。
`.skeleton` 是資料載入中的佔位。

```html
<div class="grid">
  <div class="stack"><div class="row"><span>產生頁面</span><span class="mono num faint">7 / 12</span></div><div class="progress"><i style="width:58%"></i></div></div>
  <div class="stack" aria-label="載入中"><div class="skeleton" style="width:70%"></div><div class="skeleton"></div><div class="skeleton" style="width:45%"></div></div>
</div>
```

## 空白畫面

何時用：清單沒有資料，或篩選後沒有結果。一定要提供開始的動作。

```html
<div class="empty"><svg class="icon"><use href="#i-inbox"/></svg><b>還沒有任何來源</b><span class="muted">把文字檔放進 raw 資料夾，或從這裡新增。</span><button class="btn btn-secondary">新增來源</button></div>
```

## 通知

何時用：動作完成後的簡短回報，3.6 秒後自動消失。**不能用 `alert()`**。需要 sam-ui.js。

```html
<div class="row"><button class="btn btn-secondary" data-toast="已重新建立索引，共 214 頁">重新建立索引</button></div>
```

```js
SAM.toast('已儲存設定');
```

文字較長時可以指定停留的毫秒數：`SAM.toast('文字', 8000)`。

## 對話框

何時用：需要使用者確認或填資料才能繼續。**不能用 `confirm()`、`prompt()`**。需要 sam-ui.js。
整段 `.dialog-backdrop` 放在範本標示的對話框位置（內容區之後），不要放在 `.panel` 裡面。
確認按鈕重複動作名稱（「撤銷匯入」，不是「確定」）。

```html
<div class="row"><button class="btn btn-secondary" data-open-dialog="dlg-del">撤銷上次匯入</button></div>

<div class="dialog-backdrop" id="dlg-del" role="dialog" aria-modal="true" aria-labelledby="dlg-del-t">
  <div class="dialog">
    <div class="dialog-head"><h3 id="dlg-del-t">撤銷上次匯入？</h3><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="關閉"><svg class="icon"><use href="#i-x"/></svg></button></div>
    <div class="dialog-body"><p class="muted">會移除 <span class="mono">nt36xxx_spec.md</span> 產生的 12 個頁面，並還原索引。原始來源會保留。</p></div>
    <div class="dialog-foot"><button class="btn btn-secondary" data-close>保留</button><button class="btn btn-danger" id="dlg-del-ok" data-close>撤銷匯入</button></div>
  </div>
</div>
```

- 開啟：按鈕加 `data-open-dialog="對話框 id"`，或 `SAM.openDialog('dlg-del')`。
- 關閉：按鈕加 `data-close`，或 `SAM.closeDialog(document.getElementById('dlg-del'))`。按 Esc 或點背景也會關。
- 預設寬度 480px，內容較多時在 `.dialog` 上寫 `style="--dialog-w:720px"`。視窗比它窄時會自動縮小。
- 確認後要做的事，綁在確認按鈕的 `click`：

```js
document.getElementById('dlg-del-ok').addEventListener('click', () => { SAM.toast('已撤銷上次匯入'); });
```

含表單與驗證的對話框寫法見 `examples/demo.html` 的「建立知識庫」。

## 選單

何時用：一個按鈕收納多個次要動作。需要 sam-ui.js。

```html
<div class="row"><button class="btn btn-secondary">重新整理</button><div class="menu-wrap">
  <button class="btn btn-secondary" data-menu aria-haspopup="menu" aria-expanded="false">動作選單<svg class="icon"><use href="#i-chevron"/></svg></button>
  <div class="menu" role="menu"><button role="menuitem" id="m-reindex">重新建立索引</button><button role="menuitem">執行檢查</button><hr><button role="menuitem" class="is-danger">撤銷上次匯入</button></div>
</div></div>
```

每個項目的行為綁在該 `<button>` 的 `click`。選單預設靠右對齊按鈕，超出視窗時會自動改靠左。

## 提示

何時用：補充說明，游標移上才顯示。**不能用 `title` 屬性**。必要資訊不要只放在提示裡。

```html
<div class="row"><button class="btn btn-secondary" data-tip="快取日期：11 月 20 日">查看快取</button></div>
```

## 主題切換

範本已經放好，不用再加。class 與屬性不能改。

```html
<div class="segmented" data-theme-toggle role="group" aria-label="主題"><button type="button" data-value="light" aria-pressed="true">淺色</button><button type="button" data-value="dark" aria-pressed="false">深色</button></div>
```

## 品牌元素

範本已經放好，不用再加。`.brand-bar` 是頁面最上方的紅藍雙色線；Logo 放在白底的 `.logo-chip` 內。

```html
<div class="row"><div class="logo-chip"><div class="logo-slot"><img src="assets/logo.png" alt=""></div></div></div>
```

## 程式碼

何時用：多行程式碼用 `pre.code`；句子裡的檔名、指令用 `code.inline`。
`.c` 是註解，`.k` 是關鍵字，`.v` 是常數。內容裡的 `<` 要寫成 `&lt;`。

```html
<p>設定檔在 <code class="inline">config/scan.json</code>。</p>
<pre class="code"><span class="c">// 讀取掃描頻率</span>
<span class="k">static int</span> ts_read_scan_rate(<span class="k">struct</span> ts_data *ts)
{
    <span class="k">return</span> ts_reg_read(ts, <span class="v">REG_SCAN_RATE</span>);  <span class="c">/* 0x3E */</span>
}</pre>
```
