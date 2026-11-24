# 圖表

## 規則

1. 折線與長條一律用 `SAM.chart` 建立。**不能寫 `new Chart(...)`**，也不要自己指定顏色。
2. 序列顏色自動依序取 `--chart-1` 到 `--chart-5`，第一個是品牌藍。
3. 紅色只用在門檻線（`threshold`）和需要注意的序列（`highlight: true`）。
4. 每張圖最多五個序列，超過就拆成兩張圖或改用表格。
5. 每個 `<canvas>` 都要有 `role="img"` 和說明內容的 `aria-label`。
6. `<canvas>` 一定要包在 `<div class="chart">` 裡面，高度由 `.chart` 決定（預設 240px）。
7. 頁面要載入三個腳本，順序是 `chart.umd.js`、`sam-ui.js`、`sam-chart.js`（範本已放好）。

## 介面

```
SAM.chart(canvas, {
  type: 'line' 或 'bar',
  labels: ['橫軸標籤', ...],
  series: [{ name: '序列名稱', data: [數字, ...], highlight: true（可省略） }],
  yLabel: '縱軸名稱',                      可省略
  yMin: 100, yMax: 140,                    可省略。縱軸預設從 0 開始；數值集中在某個範圍時才指定
  threshold: { value: 40, label: '門檻 40' }   可省略
})
SAM.sparkline(svg)                         讀取 data-values="1,2,3"；頁面載入時已存在的會自動畫
SAM.heatmap(element, matrix, { max, rowLabel, colLabel, readout })   全部可省略
```

`data` 的長度要和 `labels` 一樣。主題切換時圖表會自動換色，不用處理。

## 折線圖加門檻線

```html
<div class="panel">
  <div class="panel-head"><h3>各頻率雜訊量</h3><span class="status warn">2 個頻點超過門檻</span></div>
  <div class="panel-body"><div class="chart"><canvas id="ch-line" role="img" aria-label="各頻率雜訊量折線圖，接上充電器時在 120 與 130 kHz 超過門檻"></canvas></div></div>
</div>
```

```js
SAM.chart(document.getElementById('ch-line'), {
  type: 'line',
  labels: ['60 kHz', '70 kHz', '80 kHz', '90 kHz', '100 kHz', '110 kHz', '120 kHz', '130 kHz', '140 kHz', '150 kHz'],
  yLabel: '雜訊量',
  series: [
    { name: '未接充電器', data: [12, 13, 12, 14, 15, 14, 16, 15, 14, 13] },
    { name: '接上充電器', data: [18, 20, 22, 25, 31, 38, 46, 44, 33, 27], highlight: true },
  ],
  threshold: { value: 40, label: '門檻 40' },
});
```

## 長條圖

寬度會自動填滿容器。預設高度 240px，要改時在 `.chart` 寫 `style="height:200px"`。

```html
<div class="panel">
  <div class="panel-head"><h3>各韌體版本測試失敗數</h3></div>
  <div class="panel-body"><div class="chart" style="height:200px"><canvas id="ch-bar" role="img" aria-label="各韌體版本測試失敗數長條圖"></canvas></div></div>
</div>
```

```js
SAM.chart(document.getElementById('ch-bar'), {
  type: 'bar',
  labels: ['v2.4.12', 'v2.4.13', 'v2.4.14', 'v2.4.15', 'v2.4.16', 'v2.4.17'],
  series: [{ name: '失敗數', data: [3, 2, 4, 3, 8, 14] }],
});
```

## 迷你走勢線

何時用：表格內顯示一個數值的趨勢。不需要寫程式，數值放在 `data-values`。
需要注意的趨勢加 `is-alert`（變成紅色）。

```html
<div class="panel">
  <div class="table-wrap"><table class="table">
    <tbody>
      <tr><td>報點率</td><td class="r mono num">118 Hz</td><td class="r"><svg class="spark" data-values="120,119,121,120,118,119,120,118" role="img" aria-label="報點率走勢，大致持平"></svg></td></tr>
      <tr><td>測試失敗數</td><td class="r mono num">14</td><td class="r"><svg class="spark is-alert" data-values="3,2,4,3,5,8,11,14" role="img" aria-label="測試失敗數走勢，持續上升"></svg></td></tr>
    </tbody>
  </table></div>
</div>
```

## 節點熱圖

何時用：顯示二維矩陣（例如觸控節點差值）。負值是藍色，正值是紅色，深淺代表大小。
每一格是正方形；欄數少時用 `style="max-width:480px"` 限制寬度，避免格子太大。
`matrix` 是「列的陣列」。`max` 是顏色最深對應的絕對值，省略時取資料中最大的絕對值。
`rowLabel`、`colLabel` 是游標移上時顯示的列名與欄名，預設是「列」「欄」。`readout` 是顯示該數值的元素。

```html
<div class="panel">
  <div class="panel-head"><h3>節點差值</h3><span class="mono num faint" id="heat-read">4 Tx × 8 Rx</span></div>
  <div class="panel-body stack">
    <div class="heatmap" id="heat" style="max-width:480px" role="img" aria-label="觸控節點差值熱圖，右側有一個觸碰點"></div>
    <div class="heat-legend"><span class="mono">-200</span><i></i><span class="mono">+200</span></div>
  </div>
</div>
```

```js
SAM.heatmap(document.getElementById('heat'), [
  [2, -3, 1, 0, 4, 12, 8, 1],
  [0, 1, -2, 5, 40, 150, 90, 6],
  [-1, 3, 0, 8, 60, 190, 120, 9],
  [1, -80, -30, 2, 10, 35, 20, 3],
], { max: 200, rowLabel: 'Tx', colLabel: 'Rx', readout: document.getElementById('heat-read') });
```
