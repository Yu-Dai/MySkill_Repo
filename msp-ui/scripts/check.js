#!/usr/bin/env node
/*
 * MSP UI 檢查腳本：檢查 HTML 檔是否違反介面規範。只用 Node 內建模組。
 *
 *   node check.js 頁面.html [其他頁面.html ...]
 *   node check.js 資料夾            檢查資料夾內所有 .html
 *   node check.js --showcase 頁面   元件展示頁專用：不檢查「一個畫面一個主要按鈕」
 *
 * 全部通過 exit 0，有違規 exit 1，用法錯誤 exit 2。
 * 每個違規輸出四段：哪裡、為什麼、正確寫法、下一步。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* ---------- 規則說明 ---------- */
const RULES = {
  'external-url': {
    why: '執行環境在公司內網，不能連外部網路。外部網址的樣式、腳本、字體、圖片都載不到，頁面會壞掉。',
    fix: '<link rel="stylesheet" href="assets/msp-ui.css">\n<script src="assets/vendor/chart.umd.js"></script>',
    next: '刪掉這個外部網址。樣式、字體、圖表函式庫都已經在 assets/ 內；圖片請存成本機檔案放在頁面旁，用相對路徑。',
  },
  'native-select': {
    why: '<select> 是瀏覽器原生外觀，每台電腦長得不一樣，也不會跟著主題變色。',
    fix: '<div class="select" data-value="a">\n  <button class="select-trigger" type="button" aria-haspopup="listbox" aria-expanded="false" aria-label="分類"><span class="select-value">選項 A</span><svg class="icon"><use href="#i-chevron"/></svg></button>\n  <ul class="select-menu" role="listbox">\n    <li role="option" data-value="a" aria-selected="true">選項 A</li>\n    <li role="option" data-value="b" aria-selected="false">選項 B</li>\n  </ul>\n</div>',
    next: '把 <select> 整段換成上面的 .select。完整片段在 references/components.md 的「下拉」。值從 元素.dataset.value 讀取。',
  },
  'native-date': {
    why: '原生日期輸入是瀏覽器原生外觀，不會跟著主題變色。',
    fix: '<div class="datepicker" data-value="2026-11-20">\n  <button class="select-trigger" type="button" aria-haspopup="dialog" aria-expanded="false" aria-label="日期"><span class="select-value mono num">2026-11-20</span><svg class="icon"><use href="#i-calendar"/></svg></button>\n  <div class="calendar" role="dialog" aria-label="選擇日期"></div>\n</div>',
    next: '把這個 <input> 換成上面的 .datepicker。完整片段在 references/components.md 的「日期選擇器」。日期區間請放兩個 .datepicker（起、迄）。',
  },
  'native-range': {
    why: 'input type="range" 是瀏覽器原生外觀，不會跟著主題變色。',
    fix: '<div class="slider" data-min="0" data-max="100" data-step="1" data-value="50" data-output="#out">\n  <div class="slider-track"></div><div class="slider-fill"></div>\n  <div class="slider-thumb" role="slider" tabindex="0" aria-label="數值"></div>\n</div>',
    next: '把這個 <input> 換成上面的 .slider。完整片段在 references/components.md 的「滑桿」。',
  },
  'native-color': {
    why: 'input type="color" 是瀏覽器原生外觀。這套介面的顏色由主題代號決定，不讓使用者任意選色。',
    fix: '需要讓使用者從幾個選項中挑一個時，用 .select 或 .segmented 列出有名稱的選項。',
    next: '刪掉這個 <input>。如果真的需要選項，改用 references/components.md 的「下拉」或「分段選擇」。',
  },
  'native-file': {
    why: '直接顯示的 input type="file" 是瀏覽器原生外觀。',
    fix: '<div class="dropzone" tabindex="0" role="button" data-list="#files">\n  <svg class="icon"><use href="#i-upload"/></svg>\n  <span><b>選擇檔案</b>，或拖放到這裡</span>\n  <input type="file" id="up" multiple>\n</div>\n<ul class="file-list" id="files"></ul>',
    next: '把這個 <input type="file"> 放進 .dropzone 內。完整片段在 references/components.md 的「檔案上傳」。',
  },
  'native-checkbox': {
    why: '沒有包在 .check 或 .switch 內的勾選框會顯示成瀏覽器原生外觀。',
    fix: '<label class="check"><input type="checkbox" id="ck1"><span class="box"></span>說明文字</label>\n<label class="switch"><input type="checkbox" id="sw1"><span class="track"></span>說明文字</label>',
    next: '把這個 <input> 包成上面的寫法：一般勾選用 .check，立即生效的設定用 .switch。',
  },
  'native-radio': {
    why: '沒有包在 .radio 內的單選鈕會顯示成瀏覽器原生外觀。',
    fix: '<label class="radio"><input type="radio" name="grp" id="rd1" checked><span class="box"></span>選項一</label>\n<label class="radio"><input type="radio" name="grp" id="rd2"><span class="box"></span>選項二</label>',
    next: '把這個 <input> 包成上面的寫法。',
  },
  'native-dialog': {
    why: 'alert()、confirm()、prompt() 是瀏覽器原生視窗，會中斷操作，外觀也不受控制。',
    fix: "MSP.toast('已儲存設定');            // 通知結果\nMSP.openDialog('dlg-confirm');       // 需要使用者確認或輸入時，開啟頁面上的 .dialog",
    next: '通知結果改用 MSP.toast(文字)。需要確認或輸入時，改用 references/components.md 的「對話框」。',
  },
  'title-attr': {
    why: 'title 屬性的提示是瀏覽器原生外觀，出現很慢，觸控裝置看不到。',
    fix: '<button class="btn btn-secondary btn-icon" aria-label="更多動作" data-tip="更多動作">…</button>',
    next: '把 title="…" 改成 data-tip="…"。只有圖示的按鈕要另外加 aria-label。',
  },
  'emoji': {
    why: '規範禁止 emoji 和符號字元當圖示：各系統顯示不一致，也不會跟著主題變色。',
    fix: '<svg class="icon"><use href="#i-check"/></svg>\n可用圖示：{ICONS}',
    next: '刪掉這個字元。需要圖示就改用上面的 SVG 寫法；狀態請用 <span class="status ok">文字</span>。',
  },
  'hard-color': {
    why: '寫死的顏色不會跟著淺色、深色主題切換，在另一個主題下會看不清楚。顏色只能透過代號取用。',
    fix: 'color:var(--ink-2); background:var(--surface); border:1px solid var(--line);\n常用代號：--ink --ink-2 --ink-3（文字） --paper --surface --sunken（底色） --line --line-strong（邊線）\n          --blue --blue-strong（操作） --red（位置與待辦） --ok --warn --bad（語意） --shadow（浮層陰影）',
    next: '把色碼換成最接近的代號 var(--代號)。完整代號表在 references/theme.md。',
  },
  'no-css': {
    why: '沒有載入 msp-ui.css，所有元件都不會有樣式。',
    fix: '<link rel="stylesheet" href="assets/msp-ui.css">',
    next: '在 <head> 內加上這一行，並確認 assets 資料夾在頁面旁邊。',
  },
  'missing-file': {
    why: '頁面引用的本機檔案不存在，離線開啟時會載不到。',
    fix: '頁面.html\nassets/msp-ui.css\nassets/msp-ui.js\nassets/msp-chart.js\nassets/vendor/chart.umd.js\nassets/fonts/…',
    next: '確認路徑沒有打錯。如果缺的是 assets/ 內的檔案，把 skill 資料夾內的 assets 整個複製到頁面旁邊（或重新執行 scripts/new.js）。',
  },
  'missing-symbol': {
    why: '用 <use href="#…"> 引用了圖示，但頁面內沒有這個 id 的 <symbol>，圖示會是空白。',
    fix: '可用圖示：{ICONS}',
    next: '改用上面清單裡的圖示名稱。如果頁面缺少整個圖示集，把 assets/icons.html 的全部內容貼在 <body> 開頭。',
  },
  'icon-set': {
    why: 'msp-ui.js 的通知、日期選擇器、檔案上傳會用到 i-check、i-chevron、i-file 圖示。頁面內缺少時這些元件的圖示會空白。',
    fix: '<body>\n<svg width="0" height="0" style="position:absolute" aria-hidden="true">\n  …assets/icons.html 的全部 <symbol>…\n</svg>',
    next: '把 assets/icons.html 的全部內容原樣貼在 <body> 開頭，不要只挑幾個。',
  },
  'multi-primary': {
    why: '每個畫面只能有一個主要按鈕（.btn-primary），使用者才看得出最重要的動作是哪一個。對話框內另外計算。',
    fix: '<button class="btn btn-primary">儲存設定</button>\n<button class="btn btn-secondary">取消</button>\n<button class="btn btn-ghost">略過</button>',
    next: '只保留最重要的那一個 .btn-primary，其他改成 .btn-secondary 或 .btn-ghost；刪除類動作用 .btn-danger。',
  },
  'canvas-label': {
    why: '<canvas> 的內容螢幕閱讀器讀不到，必須用文字說明圖表內容。',
    fix: '<div class="chart"><canvas id="ch1" role="img" aria-label="各頻率雜訊量折線圖，120 kHz 超過門檻"></canvas></div>',
    next: '在這個 <canvas> 加上 role="img" 和說明圖表內容的 aria-label。',
  },
  'raw-chartjs': {
    why: '直接呼叫 Chart.js 會略過主題配色與字體設定，圖表顏色不會跟著主題變。',
    fix: "MSP.chart(document.getElementById('ch1'), {\n  type: 'line', labels: ['一月', '二月', '三月'],\n  series: [{ name: '數量', data: [3, 5, 4] }],\n});",
    next: '把 new Chart(…) 改成 MSP.chart(canvas, 設定)。寫法在 references/charts.md。',
  },
  'need-script': {
    why: '頁面用到需要腳本的元件或 MSP 函式，但沒有載入對應的腳本，元件不會動。',
    fix: '<script src="assets/vendor/chart.umd.js"></script>   只有用到圖表才需要\n<script src="assets/msp-ui.js"></script>\n<script src="assets/msp-chart.js"></script>          只有用到圖表才需要\n<script> 頁面自己的程式 </script>',
    next: '在 </body> 之前依上面的順序補上缺少的 <script>。',
  },
  'script-order': {
    why: 'msp-ui.js 在載入當下掃描頁面並綁定元件，所以必須放在頁面內容之後；而且它會建立 MSP 物件，順序錯了 MSP.chart 會不見。',
    fix: '…頁面內容…\n<script src="assets/vendor/chart.umd.js"></script>\n<script src="assets/msp-ui.js"></script>\n<script src="assets/msp-chart.js"></script>\n<script> 頁面自己的程式 </script>\n</body>',
    next: '把這些 <script> 移到 </body> 之前，並照上面的順序排列。',
  },
  'missing-target': {
    why: '這個屬性指向另一個元素的 id，但頁面內找不到那個 id，按了不會有反應。',
    fix: '<button class="btn btn-secondary" data-open-dialog="dlg-del">…</button>\n<div class="dialog-backdrop" id="dlg-del" role="dialog" aria-modal="true">…</div>\n\n<button role="tab" data-panel="tp1">…</button>\n<div id="tp1">…</div>',
    next: '確認被指向的元素存在，而且 id 拼字完全一樣。data-open-dialog 與 data-panel 寫 id 本身；data-list 與 data-output 寫 # 加 id。',
  },
  'fixed-width': {
    why: '寫死的大寬度不會隨視窗伸縮：寬螢幕兩側留一大片空白，窄螢幕出現橫向捲軸。',
    fix: 'grid-template-columns:repeat(auto-fit,minmax(220px,1fr));   欄數隨寬度變化\nwidth:min(720px,100%);                                     有上限但不會超出容器\npadding:0 clamp(16px,3vw,48px);                            間距隨視窗伸縮',
    next: '把固定的 px 寬度改成上面其中一種寫法，或直接刪掉讓它填滿容器。整頁的內容寬度由範本的 --content-max 控制，不要另外寫。',
  },
  'no-brand-bar': {
    why: '規範要求每一頁最上方固定有一條紅藍雙色線，這是品牌識別。',
    fix: '<div class="brand-bar"></div>',
    next: '把這一行放在 <body> 內圖示集 <svg> 的後面、其他內容的前面。',
  },
};

/* ---------- HTML 解析（只做檢查需要的程度） ---------- */
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function makeLineOf(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return off => {
    let lo = 0, hi = starts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= off) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
}

function parseHtml(html) {
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'<>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>]+))?)*)\s*(\/?)>/y;
  const attrRe = /([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/g;
  const els = [];
  let stack = [];
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) break;
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt + 4); i = e < 0 ? html.length : e + 3; continue; }
    tagRe.lastIndex = lt;
    const m = tagRe.exec(html);
    if (!m) { i = lt + 1; continue; }
    i = tagRe.lastIndex;
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.map(e => e.name).lastIndexOf(name);
      if (at >= 0) stack = stack.slice(0, at);
      continue;
    }
    const attrs = {};
    let a;
    attrRe.lastIndex = 0;
    while ((a = attrRe.exec(m[3]))) attrs[a[1].toLowerCase()] = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
    const el = { name, attrs, offset: lt, raw: m[0], parent: stack[stack.length - 1] || null, text: null, textOffset: 0 };
    els.push(el);
    if (name === 'script' || name === 'style') {
      const closeRe = new RegExp('</' + name + '\\s*>', 'ig');
      closeRe.lastIndex = i;
      const c = closeRe.exec(html);
      const end = c ? c.index : html.length;
      el.text = html.slice(i, end);
      el.textOffset = i;
      i = c ? closeRe.lastIndex : html.length;
      continue;
    }
    if (!VOID.has(name) && !m[4]) stack.push(el);
  }
  return els;
}

const classes = el => (el.attrs.class || '').split(/\s+/).filter(Boolean);
const hasClass = (el, c) => classes(el).includes(c);
function closest(el, pred) { for (let e = el; e; e = e.parent) if (pred(e)) return e; return null; }
const short = s => { s = s.replace(/\s+/g, ' ').trim(); return s.length > 110 ? s.slice(0, 107) + '...' : s; };

/* ---------- 樣式與腳本的檢查 ---------- */
const EXTERNAL = /^\s*(?:https?:)?\/\//i;
const HEX = /#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})(?![\w-])/;
const COLOR_FN = /(?<![\w-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\s*\(/i;
const NAMED = /(?<![\w#.-])(?:(?:light|dark|medium|pale|deep|dim)?(?:white|black|red|green|blue|yellow|orange|purple|pink|gray|grey|cyan|magenta|brown|violet|salmon|coral)|silver|navy|teal|aqua|lime|maroon|olive|gold|indigo|crimson|tomato|beige|ivory|khaki|lavender|whitesmoke|gainsboro|royalblue|steelblue|skyblue|dodgerblue|firebrick|orangered|limegreen|seagreen|forestgreen|slategray|slategrey)(?![\w(-])/i;
const COLOR_PROP = /color|background|border|outline|fill|stroke|shadow|caret|accent|decoration|^--/i;

function colorIn(prop, value) {
  const v = value.replace(/url\([^)]*\)/gi, '').replace(/"[^"]*"|'[^']*'/g, '');
  let m = HEX.exec(v) || COLOR_FN.exec(v);
  if (m) return m[0].replace(/\s*\($/, '(');
  if (COLOR_PROP.test(prop) && (m = NAMED.exec(v))) return m[0];
  return null;
}

function checkCss(css, lineAt, add, checkColors) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, c => c.replace(/[^\n]/g, ' '));
  let m;
  const imp = /@import\s+(?:url\(\s*)?["']?([^"')\s;]+)/gi;
  while ((m = imp.exec(clean))) if (EXTERNAL.test(m[1])) add('external-url', lineAt(m.index), '@import ' + m[1], '外部網址：' + m[1]);
  const rest = clean.replace(imp, c => c.replace(/[^\n]/g, ' '));
  const url = /url\(\s*["']?\s*((?:https?:)?\/\/[^"')\s]+)/gi;
  while ((m = url.exec(rest))) add('external-url', lineAt(m.index), 'url(' + m[1] + ')', '外部網址：' + m[1]);
  if (!checkColors) return;
  const wide = /(?<![\w-])((?:max-|min-)?width)\s*:\s*(\d+)px\s*(?=[;}])/g;
  while ((m = wide.exec(clean + ';'))) if (Number(m[2]) >= 600) add('fixed-width', lineAt(m.index), m[1] + ':' + m[2] + 'px', '寫死的寬度：' + m[2] + 'px');
  const decl = /([\w-]+)\s*:\s*([^;{}]+?)\s*(?=[;}])/g;
  while ((m = decl.exec(clean + ';'))) {
    const hit = colorIn(m[1], m[2]);
    if (hit) add('hard-color', lineAt(m.index), m[1] + ':' + m[2], '寫死的顏色：' + hit);
  }
}

function checkJs(js, lineAt, add) {
  let m;
  const dlg = /(?:(?<![\w$.])|\b(?:window|self|globalThis)\.)(alert|confirm|prompt)\s*\(/g;
  while ((m = dlg.exec(js))) add('native-dialog', lineAt(m.index), js.slice(m.index, m.index + 60).split('\n')[0], '用了 ' + m[1] + '()');
  const ch = /\bnew\s+Chart\s*\(/g;
  while ((m = ch.exec(js))) add('raw-chartjs', lineAt(m.index), js.slice(m.index, m.index + 60).split('\n')[0]);
}

/* emoji 與常被拿來當圖示的符號字元 */
const EMOJI = /\p{Emoji_Presentation}|\p{Extended_Pictographic}\uFE0F|[\u{1F000}-\u{1FAFF}\u2600-\u27BF\u2B50\u2B55\u2B1B\u2B1C]/u;

/* ---------- 檢查一個檔案 ---------- */
function checkFile(file, opts) {
  const found = [];
  const html = fs.readFileSync(file, 'utf8');
  const dir = path.dirname(file);
  const lineOf = makeLineOf(html);
  const inAssets = path.resolve(file).split(path.sep).includes('assets');
  const add = (rule, line, snippet, detail, src) => found.push({ rule, file: src || file, line, snippet: short(snippet || ''), detail: detail || '' });
  const addEl = (rule, el, detail) => add(rule, lineOf(el.offset), el.raw, detail);
  const els = parseHtml(html);
  const baseName = u => path.basename(String(u || '').split(/[?#]/)[0]).toLowerCase();

  // emoji
  html.split('\n').forEach((ln, n) => {
    const m = EMOJI.exec(ln);
    if (m) add('emoji', n + 1, ln, '字元：' + m[0] + '（U+' + m[0].codePointAt(0).toString(16).toUpperCase() + '）');
  });

  const ids = new Set();
  const uses = [];
  const scripts = [];
  let cssLoaded = false, brandBar = false;
  const localRefs = [];
  const jsTexts = [];

  for (const el of els) {
    const A = el.attrs;
    if (A.id) ids.add(A.id);
    if (hasClass(el, 'brand-bar')) brandBar = true;

    // 外部資源
    const res = [];
    if (el.name === 'link' && A.href !== undefined) res.push(A.href);
    if (el.name !== 'a' && A.src !== undefined) res.push(A.src);
    if (A.srcset !== undefined) res.push(A.srcset);
    if (A.poster !== undefined) res.push(A.poster);
    if (el.name === 'object' && A.data !== undefined) res.push(A.data);
    if (el.name === 'use' || el.name === 'image') res.push(A.href || A['xlink:href'] || '');
    for (const u of res) {
      if (EXTERNAL.test(u)) addEl('external-url', el, '外部網址：' + u);
      else if (u && !/^\s*(#|data:|blob:|about:|javascript:)/i.test(u) && el.name !== 'use' && !/[{}$]/.test(u)) localRefs.push({ el, u });
    }
    if (el.name === 'link' && baseName(A.href) === 'msp-ui.css') cssLoaded = true;

    // 原生控制項
    if (el.name === 'select') addEl('native-select', el);
    if (el.name === 'input') {
      const t = (A.type || 'text').toLowerCase();
      if (['date', 'datetime-local', 'month', 'week'].includes(t)) addEl('native-date', el, 'type="' + t + '"');
      if (t === 'range') addEl('native-range', el);
      if (t === 'color') addEl('native-color', el);
      if (t === 'file' && !closest(el, e => hasClass(e, 'dropzone'))) addEl('native-file', el);
      if (t === 'checkbox' && !closest(el, e => hasClass(e, 'check') || hasClass(e, 'switch'))) addEl('native-checkbox', el);
      if (t === 'radio' && !closest(el, e => hasClass(e, 'radio'))) addEl('native-radio', el);
    }
    if (A.title !== undefined) addEl('title-attr', el, 'title="' + A.title + '"');

    // 圖示引用
    if (el.name === 'use') {
      const h = A.href || A['xlink:href'] || '';
      if (h.startsWith('#')) uses.push({ id: h.slice(1), line: lineOf(el.offset), snippet: el.raw });
    }

    // canvas
    if (el.name === 'canvas' && (!A['aria-label'] || !A['aria-label'].trim() || A.role !== 'img')) {
      addEl('canvas-label', el, !A['aria-label'] || !A['aria-label'].trim() ? '缺少 aria-label' : '缺少 role="img"');
    }

    // 樣式
    const elLine = lineOf(el.offset);
    if (A.style) checkCss(A.style, () => elLine, (r, l, s, d) => add(r, l, 'style="' + s + '"', d), !inAssets);
    if (!inAssets) {
      for (const k of ['fill', 'stroke', 'color', 'bgcolor', 'stop-color', 'flood-color']) {
        if (A[k] && colorIn('color', A[k])) addEl('hard-color', el, '寫死的顏色：' + k + '="' + A[k] + '"');
      }
    }
    if (el.name === 'style') checkCss(el.text, off => lineOf(el.textOffset + off), add, !inAssets);

    // 腳本
    for (const k of Object.keys(A)) if (/^on[a-z]+$/.test(k)) checkJs(A[k], () => elLine, (r, l, s, d) => add(r, l, k + '="' + s + '"', d));
    if (el.name === 'script') {
      scripts.push(el);
      if (!A.src && (!A.type || /javascript|module/i.test(A.type))) {
        checkJs(el.text, off => lineOf(el.textOffset + off), add);
        jsTexts.push(el.text);
        let m;
        const re = /<use[^>]*?href=\\?["']#([\w:-]+)/g;
        while ((m = re.exec(el.text))) uses.push({ id: m[1], line: lineOf(el.textOffset + m.index), snippet: m[0] });
      }
    }
  }

  // 本機檔案：是否存在；頁面自己的 .css 與 .js 也一起檢查
  for (const { el, u } of localRefs) {
    const rel = decodeURI(u.split(/[?#]/)[0].trim().split(/\s+/)[0]);
    const p = path.resolve(dir, rel);
    if (!fs.existsSync(p)) { addEl('missing-file', el, '找不到：' + rel); continue; }
    const own = !path.resolve(p).split(path.sep).includes('assets');
    if (!own || !fs.statSync(p).isFile()) continue;
    if (el.name === 'link' && /\.css$/i.test(p)) {
      const css = fs.readFileSync(p, 'utf8'), lo = makeLineOf(css);
      checkCss(css, lo, (r, l, s, d) => add(r, l, s, d, p), true);
    }
    if (el.name === 'script' && /\.m?js$/i.test(p)) {
      const js = fs.readFileSync(p, 'utf8'), lo = makeLineOf(js);
      checkJs(js, lo, (r, l, s, d) => add(r, l, s, d, p));
      jsTexts.push(js);
    }
  }

  if (!cssLoaded) add('no-css', 1, '', '找不到 <link rel="stylesheet" href="…msp-ui.css">');
  if (!brandBar && els.some(e => e.name === 'body')) add('no-brand-bar', lineOf((els.find(e => e.name === 'body') || { offset: 0 }).offset), '<body>');

  // 指向其他元素的屬性
  for (const el of els) {
    for (const [k, hash] of [['data-open-dialog', false], ['data-panel', false], ['data-list', true], ['data-output', true]]) {
      const v = el.attrs[k];
      if (v === undefined) continue;
      const id = hash ? (/^#[\w-]+$/.test(v) ? v.slice(1) : null) : v;
      if (hash && id === null) continue;
      if (!ids.has(id)) addEl('missing-target', el, k + '="' + v + '"，但頁面內沒有 id="' + id + '" 的元素');
    }
  }

  // 圖示
  const seen = new Set();
  for (const u of uses) {
    if (ids.has(u.id) || seen.has(u.id)) continue;
    seen.add(u.id);
    add('missing-symbol', u.line, u.snippet, '頁面內沒有 <symbol id="' + u.id + '">');
  }

  // 腳本載入
  const allJs = jsTexts.join('\n');
  const find = n => scripts.find(s => baseName(s.attrs.src) === n);
  const sUi = find('msp-ui.js'), sChart = find('msp-chart.js'), sLib = find('chart.umd.js');
  const interactive = els.find(e => ['select', 'datepicker', 'segmented', 'tabs', 'slider', 'dropzone', 'menu-wrap'].some(c => hasClass(e, c)) ||
    ['data-open-dialog', 'data-toast', 'data-theme-toggle', 'data-menu'].some(k => e.attrs[k] !== undefined));
  const usesMsp = /\bMSP\.\w+/.test(allJs);
  const canvas = els.find(e => e.name === 'canvas');
  const spark = els.find(e => hasClass(e, 'spark') || hasClass(e, 'heatmap'));
  const body = els.find(e => e.name === 'body') || els[0] || { offset: 0, raw: '' };
  if (!sUi && (interactive || usesMsp)) add('need-script', lineOf((interactive || body).offset), (interactive || body).raw, '沒有載入 assets/msp-ui.js');
  if (!sChart && (spark || /\bMSP\.(chart|sparkline|heatmap)\s*\(/.test(allJs))) add('need-script', lineOf((spark || canvas || body).offset), (spark || canvas || body).raw, '用到圖表，但沒有載入 assets/msp-chart.js');
  if (!sLib && (canvas || /\bMSP\.chart\s*\(/.test(allJs))) add('need-script', lineOf((canvas || body).offset), (canvas || body).raw, '用到圖表，但沒有載入 assets/vendor/chart.umd.js');
  if (sUi) {
    if (closest(sUi, e => e.name === 'head')) addEl('script-order', sUi, 'msp-ui.js 放在 <head> 內');
    else {
      const late = els.find(e => e.offset > sUi.offset && (hasClass(e, 'brand-bar') || ['main', 'header', 'nav', 'aside', 'section', 'table', 'form'].includes(e.name)));
      if (late) addEl('script-order', sUi, 'msp-ui.js 後面還有頁面內容（第 ' + lineOf(late.offset) + ' 行），那些元件不會被綁定');
    }
    if (sChart && sChart.offset < sUi.offset) addEl('script-order', sChart, 'msp-chart.js 排在 msp-ui.js 前面');
    if (sLib && sChart && sLib.offset > sChart.offset) addEl('script-order', sLib, 'chart.umd.js 排在 msp-chart.js 後面');
    const early = scripts.find(s => !s.attrs.src && s.offset < sUi.offset && /\bMSP\.\w+/.test(s.text || ''));
    if (early) addEl('script-order', early, '頁面自己的程式排在 msp-ui.js 前面，這時 MSP 還不存在');
    for (const id of ['i-check', 'i-chevron', 'i-file']) {
      if (!ids.has(id)) { add('icon-set', lineOf(body.offset), '<body>', '缺少 <symbol id="' + id + '">'); break; }
    }
  }

  // 主要按鈕：每個畫面一個，對話框各自計算，隱藏中的區塊不計
  if (!opts.showcase) {
    const groups = new Map();
    for (const el of els) {
      if (!hasClass(el, 'btn-primary') || closest(el, e => e.attrs.hidden !== undefined)) continue;
      const key = closest(el, e => hasClass(e, 'dialog-backdrop') || hasClass(e, 'dialog'));
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(el);
    }
    for (const [key, list] of groups) {
      if (list.length < 2) continue;
      addEl('multi-primary', list[1], (key ? '同一個對話框' : '同一個畫面') + '有 ' + list.length + ' 個 .btn-primary，在第 ' + list.map(e => lineOf(e.offset)).join('、') + ' 行');
    }
  }

  found.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file === file ? -1 : 1));
  return found;
}

/* ---------- 輸出 ---------- */
function iconNames() {
  try {
    const t = fs.readFileSync(path.join(__dirname, '..', 'assets', 'icons.html'), 'utf8');
    return (t.match(/<symbol id="[^"]+"/g) || []).map(s => s.slice(12, -1)).join(' ');
  } catch (e) { return '見 assets/icons.html'; }
}

function main() {
  const args = process.argv.slice(2);
  const opts = { showcase: args.includes('--showcase') };
  const inputs = args.filter(a => !a.startsWith('--'));
  if (!inputs.length) {
    console.log('用法：node check.js 頁面.html [其他頁面.html ...]');
    process.exit(2);
  }
  const files = [];
  for (const p of inputs) {
    if (!fs.existsSync(p)) { console.log('找不到檔案：' + p + '\n下一步：確認路徑正確，路徑有空白時用引號包起來。'); process.exit(2); }
    if (fs.statSync(p).isDirectory()) fs.readdirSync(p).filter(f => /\.html?$/i.test(f)).sort().forEach(f => files.push(path.join(p, f)));
    else files.push(p);
  }
  const icons = iconNames();
  const indent = s => s.replace('{ICONS}', icons).split('\n').map(l => '      ' + l).join('\n');
  let total = 0;
  for (const f of files) {
    const v = checkFile(f, opts);
    if (!v.length) { console.log('通過：' + f); continue; }
    total += v.length;
    console.log('不通過：' + f + '（' + v.length + ' 個違規）\n');
    v.forEach((x, n) => {
      const r = RULES[x.rule];
      console.log('違規 ' + (n + 1) + '/' + v.length + '  [' + x.rule + ']');
      console.log('  哪裡：' + x.file + ':' + x.line + (x.detail ? '  ' + x.detail : ''));
      if (x.snippet) console.log('      ' + x.snippet);
      console.log('  為什麼：' + r.why);
      console.log('  正確寫法：\n' + indent(r.fix));
      console.log('  下一步：' + r.next.replace('{ICONS}', icons) + '\n');
    });
  }
  if (total) {
    console.log('結果：共 ' + total + ' 個違規。照每一項的「下一步」修正後，重新執行同一個指令，直到全部顯示「通過」。');
    process.exit(1);
  }
  console.log('結果：全部通過。');
}

if (require.main === module) main();
module.exports = { checkFile, RULES };
