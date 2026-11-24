# 常見頁面的完整做法

每個做法都是：HTML 貼到範本的「在這裡放內容」，JS 貼到範本最後的 `<script>` 內。
貼上後改文字、欄位、id，結構不要改。圖表頁的做法在 `charts.md`。

## 含篩選的資料表

範圍用分段選擇、分類用下拉、關鍵字用搜尋框。每一列用 `data-scope`、`data-cat` 標記可篩選的值。
沒有符合的資料時顯示空白畫面與「清除篩選」。

```html
<div class="panel">
  <div class="row" style="justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--line)">
    <div class="row">
      <div class="segmented" id="f-scope" role="group" aria-label="範圍">
        <button type="button" aria-pressed="true" data-value="all">全部</button>
        <button type="button" aria-pressed="false" data-value="shared">共享</button>
        <button type="button" aria-pressed="false" data-value="personal">個人</button>
      </div>
      <div class="select" id="f-cat" data-value="all" style="min-width:150px">
        <button class="select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="分類"><span class="select-value">所有分類</span><svg class="icon"><use href="#i-chevron"/></svg></button>
        <ul class="select-menu" role="listbox">
          <li role="option" data-value="all" aria-selected="true">所有分類</li>
          <li role="option" data-value="driver" aria-selected="false">驅動程式</li>
          <li role="option" data-value="fw" aria-selected="false">韌體</li>
        </ul>
      </div>
    </div>
    <div class="input-wrap" style="width:min(280px,100%)"><svg class="icon"><use href="#i-search"/></svg><input class="input" id="f-q" type="search" placeholder="搜尋代號或名稱" aria-label="搜尋"></div>
  </div>
  <div class="table-wrap" id="f-wrap">
    <table class="table" id="f-table">
      <thead><tr><th>知識庫</th><th>分類</th><th class="r">頁數</th><th>更新</th><th>狀態</th></tr></thead>
      <tbody>
        <tr data-scope="shared" data-cat="driver"><td>Linux 觸控驅動 <span class="mono faint">touch-driver-linux</span></td><td><span class="tag">驅動程式</span></td><td class="r num">214</td><td class="num">11/20</td><td><span class="status info">匯入中</span></td></tr>
        <tr data-scope="shared" data-cat="fw"><td>韌體更新流程 <span class="mono faint">fw-update-flow</span></td><td><span class="tag">韌體</span></td><td class="r num">132</td><td class="num">11/15</td><td><span class="status ok">已同步</span></td></tr>
        <tr data-scope="personal" data-cat="driver"><td>我的除錯紀錄 <span class="mono faint">my-debug-notes</span></td><td><span class="tag">驅動程式</span></td><td class="r num">114</td><td class="num">11/21</td><td><span class="status ok">已同步</span></td></tr>
      </tbody>
    </table>
  </div>
  <div class="empty" id="f-none" hidden><svg class="icon"><use href="#i-search"/></svg><b>沒有符合的資料</b><span class="muted">換一個關鍵字，或清除篩選條件。</span><button class="btn btn-secondary" id="f-reset">清除篩選</button></div>
</div>
```

```js
(function () {
  const rows = Array.from(document.querySelectorAll('#f-table tbody tr'));
  const scope = document.getElementById('f-scope'), cat = document.getElementById('f-cat');
  const q = document.getElementById('f-q'), none = document.getElementById('f-none'), wrap = document.getElementById('f-wrap');
  let s = 'all';
  function apply() {
    const c = cat.dataset.value, k = q.value.trim().toLowerCase();
    let n = 0;
    rows.forEach(r => {
      const ok = (s === 'all' || r.dataset.scope === s) && (c === 'all' || r.dataset.cat === c) && (!k || r.textContent.toLowerCase().includes(k));
      r.hidden = !ok;
      if (ok) n++;
    });
    none.hidden = n > 0;
    wrap.hidden = n === 0;
  }
  scope.addEventListener('change', e => { s = e.detail; apply(); });
  cat.addEventListener('change', apply);
  q.addEventListener('input', apply);
  document.getElementById('f-reset').addEventListener('click', () => {
    q.value = '';
    scope.querySelector('[data-value="all"]').click();
    cat.querySelector('[data-value="all"]').click();
  });
})();
```

## 設定表單

做這一頁時，**先刪掉範本 `.head` 裡的主要按鈕**，因為這一頁的主要按鈕是表單最下方的「儲存設定」。
驗證不通過時：在該 `.field` 加 `is-error`，把 `.hint` 改成怎麼修正，並把焦點移到該欄位。
儲存成功用 `MSP.toast`。

```html
<form class="panel" id="s-form" novalidate>
  <div class="panel-head"><h3>掃描設定</h3><span class="status ok" id="s-state">已儲存</span></div>
  <div class="panel-body stack" style="gap:20px">
    <div class="grid">
      <div class="field" id="s-f-name"><label class="label" for="s-name">設定檔名稱</label><input class="input mono" id="s-name" value="scan-default" autocomplete="off"><span class="hint">小寫英數與連字號</span></div>
      <div class="field">
        <span class="label" id="s-lb-mode">掃描模式</span>
        <div class="select" id="s-mode" data-value="normal">
          <button class="select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="s-lb-mode"><span class="select-value">一般</span><svg class="icon"><use href="#i-chevron"/></svg></button>
          <ul class="select-menu" role="listbox">
            <li role="option" data-value="normal" aria-selected="true">一般</li>
            <li role="option" data-value="lowpower" aria-selected="false">省電</li>
            <li role="option" data-value="glove" aria-selected="false">手套</li>
          </ul>
        </div>
      </div>
      <div class="field">
        <span class="label">報點率上限 <span class="mono num faint"><span id="s-hz-out">120</span> Hz</span></span>
        <div class="slider" data-min="60" data-max="240" data-step="10" data-value="120" data-output="#s-hz-out">
          <div class="slider-track"></div><div class="slider-fill"></div>
          <div class="slider-thumb" role="slider" tabindex="0" aria-label="報點率上限"></div>
        </div>
      </div>
    </div>
    <div class="stack">
      <label class="switch"><input type="checkbox" id="s-sync" checked><span class="track"></span>啟動時自動同步</label>
      <label class="check"><input type="checkbox" id="s-test"><span class="box"></span>儲存後執行檢索測試</label>
    </div>
    <div class="row" style="justify-content:flex-end">
      <button type="button" class="btn btn-secondary" id="s-reset">還原預設值</button>
      <button type="submit" class="btn btn-primary">儲存設定</button>
    </div>
  </div>
</form>
```

```js
(function () {
  const form = document.getElementById('s-form'), name = document.getElementById('s-name');
  const field = document.getElementById('s-f-name'), hint = field.querySelector('.hint'), hint0 = hint.textContent;
  const state = document.getElementById('s-state');
  const dirty = () => { state.className = 'status warn'; state.textContent = '尚未儲存'; };
  form.addEventListener('input', dirty);
  form.addEventListener('change', dirty);
  name.addEventListener('input', () => { field.classList.remove('is-error'); hint.textContent = hint0; });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const v = name.value.trim();
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(v)) {
      field.classList.add('is-error');
      hint.textContent = v ? '只能用小寫英數與連字號，例如 scan-default' : '請輸入設定檔名稱';
      name.focus();
      return;
    }
    const data = {
      name: v,
      mode: document.getElementById('s-mode').dataset.value,
      rate: Number(document.getElementById('s-hz-out').textContent),
      sync: document.getElementById('s-sync').checked,
      test: document.getElementById('s-test').checked,
    };
    console.log(data);  // 在這裡把 data 送到後端或存檔
    state.className = 'status ok'; state.textContent = '已儲存';
    MSP.toast('已儲存設定 ' + v);
  });
  document.getElementById('s-reset').addEventListener('click', () => { MSP.openDialog('s-dlg'); });
  document.getElementById('s-dlg-ok').addEventListener('click', () => { location.reload(); });
})();
```

「還原預設值」會丟掉修改，所以先用對話框確認。這段放在範本標示的對話框位置：

```html
<div class="dialog-backdrop" id="s-dlg" role="dialog" aria-modal="true" aria-labelledby="s-dlg-t">
  <div class="dialog">
    <div class="dialog-head"><h3 id="s-dlg-t">還原預設值？</h3><button class="btn btn-ghost btn-icon btn-sm" data-close aria-label="關閉"><svg class="icon"><use href="#i-x"/></svg></button></div>
    <div class="dialog-body"><p class="muted">尚未儲存的修改會被丟棄。</p></div>
    <div class="dialog-foot"><button class="btn btn-secondary" data-close>繼續編輯</button><button class="btn btn-danger" id="s-dlg-ok" data-close>還原預設值</button></div>
  </div>
</div>
```
