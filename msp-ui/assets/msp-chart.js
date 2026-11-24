/* MSP UI 圖表：Chart.js 薄包裝（需先載入隨附的 chart.umd.js）、迷你走勢線、節點熱圖。配色一律取自主題代號。 */
(function () {
  const MSP = window.MSP || (window.MSP = {});
  const root = document.documentElement;
  const charts = new Set();
  const tok = n => getComputedStyle(root).getPropertyValue(n).trim();
  // 序列顏色用函式提供，主題切換後重畫時會重新取值
  const T = {};
  const refresh = () => { T.series = [1, 2, 3, 4, 5].map(i => tok('--chart-' + i)); T.red = tok('--red'); };
  refresh();

  // 門檻線：紅色虛線加標籤
  const thresholdPlugin = {
    id: 'mspThreshold',
    afterDatasetsDraw(c) {
      const t = c.options.plugins.mspThreshold;
      if (!t || t.value == null) return;
      const y = c.scales.y.getPixelForValue(t.value);
      const { left, right } = c.chartArea;
      const x = c.ctx;
      x.save();
      x.strokeStyle = x.fillStyle = T.red;
      x.lineWidth = 1.5;
      x.setLineDash([5, 4]);
      x.beginPath(); x.moveTo(left, y); x.lineTo(right, y); x.stroke();
      x.setLineDash([]);
      x.font = '500 12px ' + tok('--font-sans');
      x.textAlign = 'right';
      x.fillText(t.label || '', right, y - 6);
      x.restore();
    },
  };

  function style(chart) {
    const ink2 = tok('--ink-2'), line = tok('--line');
    const o = chart.options;
    ['x', 'y'].forEach(k => {
      o.scales[k].ticks.color = ink2;
      o.scales[k].grid.color = line;
      o.scales[k].border.color = line;
      o.scales[k].title.color = ink2;
    });
    o.plugins.legend.labels.color = ink2;
    o.plugins.tooltip.backgroundColor = tok('--ink');
    o.plugins.tooltip.titleColor = o.plugins.tooltip.bodyColor = tok('--on-ink');
  }

  /* MSP.chart(canvas, { type:'line'|'bar', labels:[], series:[{name,data,highlight?}], yLabel?, yMin?, yMax?, threshold?:{value,label} })
     縱軸預設從 0 開始；數值集中在某個範圍時用 yMin、yMax 指定。 */
  MSP.chart = (canvas, cfg) => {
    if (!window.Chart) return null;
    Chart.defaults.font.family = tok('--font-sans');
    Chart.defaults.font.size = 12;
    const isBar = cfg.type === 'bar';
    const chart = new Chart(canvas, {
      type: cfg.type,
      data: {
        labels: cfg.labels,
        datasets: cfg.series.map((s, i) => {
          const color = () => (s.highlight ? T.red : T.series[i % T.series.length]);
          return {
          label: s.name, data: s.data, highlight: !!s.highlight,
          borderColor: color, backgroundColor: color, pointBackgroundColor: color, pointHoverBackgroundColor: color,
          borderWidth: isBar ? 0 : 2, tension: 0.3, pointRadius: 0, pointHoverRadius: 4,
          borderRadius: 3, maxBarThickness: 28,
        }; }),
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 300 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, border: {}, ticks: { maxRotation: 0, autoSkipPadding: 12 }, title: { display: false } },
          y: { beginAtZero: cfg.yMin == null, min: cfg.yMin, max: cfg.yMax, border: { display: false }, grid: {}, ticks: { padding: 8 }, title: { display: !!cfg.yLabel, text: cfg.yLabel || '' } },
        },
        plugins: {
          legend: { display: cfg.series.length > 1, align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 6, boxHeight: 6, padding: 16 } },
          tooltip: { padding: 10, cornerRadius: 6, usePointStyle: true, boxWidth: 8, boxHeight: 8, boxPadding: 4 },
          colors: { enabled: false },
          mspThreshold: cfg.threshold || {},
        },
      },
      plugins: [thresholdPlugin],
    });
    style(chart);
    chart.update('none');
    charts.add(chart);
    return chart;
  };
  const restyle = () => { refresh(); charts.forEach(c => { style(c); c.update('none'); }); };
  new MutationObserver(restyle).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', restyle);

  // 迷你走勢線：<svg class="spark" data-values="3,5,4,8"></svg>
  MSP.sparkline = svg => {
    const v = svg.dataset.values.split(',').map(Number);
    const W = 96, H = 28, pad = 3, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
    const pts = v.map((n, i) => [pad + (i * (W - pad * 2)) / (v.length - 1), H - pad - ((n - min) / span) * (H - pad * 2)]);
    const line = pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
    const last = pts[pts.length - 1];
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = `<path d="M${pts[0][0]},${H} L${line.replace(/ /g, ' L')} L${last[0]},${H} Z"/><polyline points="${line}"/><circle cx="${last[0].toFixed(1)}" cy="${last[1].toFixed(1)}" r="2.4"/>`;
  };
  document.querySelectorAll('svg.spark[data-values]').forEach(MSP.sparkline);

  // 熱圖：負值用藍、正值用紅，深淺代表大小
  // opt：max（顏色最深對應的絕對值，省略時取資料的最大絕對值）、rowLabel、colLabel、format(v, r, c)、readout
  MSP.heatmap = (el, matrix, opt) => {
    opt = opt || {};
    const max = opt.max || Math.max(1, ...matrix.map(row => Math.max(...row.map(Math.abs))));
    const rowLabel = opt.rowLabel || '列', colLabel = opt.colLabel || '欄';
    const format = opt.format || ((v, r, c) => `${rowLabel} ${r + 1}，${colLabel} ${c + 1}：${v > 0 ? '+' : ''}${v}`);
    el.style.gridTemplateColumns = `repeat(${matrix[0].length},1fr)`;
    el.innerHTML = '';
    matrix.forEach((row, r) => row.forEach((v, c) => {
      const cell = document.createElement('i');
      const p = Math.round(Math.min(1, Math.abs(v) / max) * 100);
      cell.style.background = `color-mix(in srgb, var(${v < 0 ? '--blue' : '--red'}) ${p}%, var(--surface))`;
      cell.dataset.t = format(v, r, c);
      el.appendChild(cell);
    }));
    if (opt.readout) {
      const idle = opt.readout.textContent;
      el.addEventListener('pointermove', e => { if (e.target.dataset.t) opt.readout.textContent = e.target.dataset.t; });
      el.addEventListener('pointerleave', () => { opt.readout.textContent = idle; });
    }
  };
})();
