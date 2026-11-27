/* SAM UI 互動：自訂下拉、選單、分段、分頁籤、滑桿、對話框、提示訊息、檔案放置區。無外部相依。 */
(function () {
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const SAM = (window.SAM = {});

  function closeAll(except) {
    $$('.select.is-open,.menu-wrap.is-open,.datepicker.is-open').forEach(el => {
      if (el !== except) {
        el.classList.remove('is-open');
        const t = el.querySelector('[aria-expanded]');
        if (t) t.setAttribute('aria-expanded', 'false');
      }
    });
  }
  document.addEventListener('click', e => {
    if (!e.target.closest('.select,.menu-wrap,.datepicker')) closeAll();
  });
  // 浮層預設位置超出視窗時，改靠另一側
  function fit(pop) {
    if (!pop) return;
    pop.classList.remove('is-flip');
    const r = pop.getBoundingClientRect();
    if (r.left < 0 || r.right > document.documentElement.clientWidth) pop.classList.add('is-flip');
  }

  // 自訂下拉
  $$('.select').forEach(sel => {
    const trigger = sel.querySelector('.select-trigger');
    const label = sel.querySelector('.select-value');
    const opts = $$('[role="option"]', sel);
    let active = Math.max(0, opts.findIndex(o => o.getAttribute('aria-selected') === 'true'));
    const mark = () => opts.forEach((o, i) => o.classList.toggle('is-active', i === active));
    const open = on => {
      closeAll(sel);
      sel.classList.toggle('is-open', on);
      trigger.setAttribute('aria-expanded', String(on));
      if (on) { mark(); fit(sel.querySelector('.select-menu')); }
    };
    const pick = i => {
      opts.forEach((o, j) => o.setAttribute('aria-selected', String(i === j)));
      label.textContent = opts[i].textContent;
      sel.dataset.value = opts[i].dataset.value || opts[i].textContent;
      active = i;
      open(false);
      sel.dispatchEvent(new CustomEvent('change', { detail: sel.dataset.value }));
    };
    trigger.addEventListener('click', () => open(!sel.classList.contains('is-open')));
    opts.forEach((o, i) => o.addEventListener('click', () => pick(i)));
    trigger.addEventListener('keydown', e => {
      const isOpen = sel.classList.contains('is-open');
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (!isOpen) return open(true);
        active = (active + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length;
        mark();
      } else if ((e.key === 'Enter' || e.key === ' ') && isOpen) {
        e.preventDefault();
        pick(active);
      } else if (e.key === 'Escape') open(false);
    });
  });

  // 日期選擇器：值為 YYYY-MM-DD，放在 data-value
  $$('.datepicker').forEach(dp => {
    const trigger = dp.querySelector('.select-trigger'), label = dp.querySelector('.select-value'), pop = dp.querySelector('.calendar');
    const pad = n => String(n).padStart(2, '0');
    const fmt = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const parse = t => { const [y, m, d] = t.split('-').map(Number); return new Date(y, m - 1, d); };
    let sel = dp.dataset.value ? parse(dp.dataset.value) : null;
    let view = new Date((sel || new Date()).getFullYear(), (sel || new Date()).getMonth(), 1);
    const arrow = (dir, name, deg) => `<button type="button" class="btn btn-ghost btn-icon btn-sm" data-nav="${dir}" aria-label="${name}"><svg class="icon" style="transform:rotate(${deg}deg)"><use href="#i-chevron"/></svg></button>`;
    function render() {
      const y = view.getFullYear(), m = view.getMonth(), today = fmt(new Date());
      let h = `<div class="calendar-head">${arrow(-1, '上個月', 90)}<b>${y} 年 ${m + 1} 月</b>${arrow(1, '下個月', -90)}</div><div class="calendar-grid">`;
      '日一二三四五六'.split('').forEach(w => { h += `<span>${w}</span>`; });
      for (let i = 0; i < new Date(y, m, 1).getDay(); i++) h += '<i></i>';
      for (let d = 1; d <= new Date(y, m + 1, 0).getDate(); d++) {
        const v = fmt(new Date(y, m, d));
        h += `<button type="button" data-day="${v}"${v === today ? ' class="is-today"' : ''}${sel && v === fmt(sel) ? ' aria-pressed="true"' : ''}>${d}</button>`;
      }
      pop.innerHTML = h + '</div><div class="calendar-foot"><button type="button" class="btn btn-ghost btn-sm" data-today>今天</button></div>';
    }
    const open = on => {
      closeAll(dp);
      dp.classList.toggle('is-open', on);
      trigger.setAttribute('aria-expanded', String(on));
      if (on) { if (sel) view = new Date(sel.getFullYear(), sel.getMonth(), 1); render(); fit(pop); }
    };
    const pick = d => {
      sel = d;
      dp.dataset.value = label.textContent = fmt(d);
      label.classList.remove('faint');
      open(false);
      trigger.focus();
      dp.dispatchEvent(new CustomEvent('change', { detail: fmt(d) }));
    };
    trigger.addEventListener('click', () => open(!dp.classList.contains('is-open')));
    pop.addEventListener('click', e => {
      e.stopPropagation();
      const nav = e.target.closest('[data-nav]'), day = e.target.closest('[data-day]');
      if (nav) { view = new Date(view.getFullYear(), view.getMonth() + Number(nav.dataset.nav), 1); render(); }
      else if (day) pick(parse(day.dataset.day));
      else if (e.target.closest('[data-today]')) pick(new Date());
    });
    pop.addEventListener('keydown', e => {
      const b = e.target.closest('[data-day]');
      const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
      if (!b || !step) return;
      e.preventDefault();
      const d = parse(b.dataset.day);
      d.setDate(d.getDate() + step);
      view = new Date(d.getFullYear(), d.getMonth(), 1);
      render();
      const t = pop.querySelector(`[data-day="${fmt(d)}"]`);
      if (t) t.focus();
    });
    if (sel) label.textContent = fmt(sel);
  });

  // 選單
  $$('.menu-wrap').forEach(w => {
    const t = w.querySelector('[data-menu]');
    t.addEventListener('click', () => {
      const on = !w.classList.contains('is-open');
      closeAll(w);
      w.classList.toggle('is-open', on);
      t.setAttribute('aria-expanded', String(on));
      if (on) fit(w.querySelector('.menu'));
    });
    $$('.menu button', w).forEach(b => b.addEventListener('click', () => closeAll()));
  });

  // 分段選擇
  $$('.segmented').forEach(g => {
    const bs = $$('button', g);
    bs.forEach(b => b.addEventListener('click', () => {
      bs.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      g.dispatchEvent(new CustomEvent('change', { detail: b.dataset.value || b.textContent }));
    }));
  });

  // 分頁籤
  $$('.tabs').forEach(t => {
    const bs = $$('[role="tab"]', t);
    bs.forEach(b => b.addEventListener('click', () => {
      bs.forEach(x => {
        const on = x === b;
        x.setAttribute('aria-selected', String(on));
        const p = x.dataset.panel && document.getElementById(x.dataset.panel);
        if (p) p.hidden = !on;
      });
      t.dispatchEvent(new CustomEvent('change', { detail: b.dataset.value || b.textContent }));
    }));
  });

  // 滑桿
  $$('.slider').forEach(s => {
    const min = +s.dataset.min || 0, max = +s.dataset.max || 100, step = +s.dataset.step || 1;
    const fill = s.querySelector('.slider-fill'), thumb = s.querySelector('.slider-thumb');
    const out = s.dataset.output && document.querySelector(s.dataset.output);
    let v = +s.dataset.value || min;
    const set = n => {
      v = Math.min(max, Math.max(min, Math.round(n / step) * step));
      const p = ((v - min) / (max - min)) * 100;
      fill.style.width = p + '%';
      thumb.style.left = p + '%';
      thumb.setAttribute('aria-valuenow', v);
      if (out) out.textContent = v;
    };
    const fromX = x => {
      const r = s.getBoundingClientRect();
      set(min + ((x - r.left) / r.width) * (max - min));
    };
    s.addEventListener('pointerdown', e => {
      s.setPointerCapture(e.pointerId);
      fromX(e.clientX);
      thumb.focus();
    });
    s.addEventListener('pointermove', e => { if (s.hasPointerCapture(e.pointerId)) fromX(e.clientX); });
    thumb.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(v + step); }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(v - step); }
    });
    thumb.setAttribute('aria-valuemin', min);
    thumb.setAttribute('aria-valuemax', max);
    set(v);
  });

  // 對話框
  let lastFocus = null;
  SAM.openDialog = id => {
    const d = document.getElementById(id);
    if (!d) return;
    lastFocus = document.activeElement;
    d.classList.add('is-open');
    const f = d.querySelector('input,button,[tabindex]');
    if (f) f.focus();
  };
  SAM.closeDialog = d => {
    d.classList.remove('is-open');
    if (lastFocus) lastFocus.focus();
  };
  $$('[data-open-dialog]').forEach(b => b.addEventListener('click', () => SAM.openDialog(b.dataset.openDialog)));
  $$('.dialog-backdrop').forEach(d => {
    d.addEventListener('click', e => {
      if (e.target === d || e.target.closest('[data-close]')) SAM.closeDialog(d);
    });
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const d = document.querySelector('.dialog-backdrop.is-open');
    if (d) SAM.closeDialog(d); else closeAll();
  });

  // 提示訊息
  SAM.toast = (msg, ms) => {
    let stack = document.querySelector('.toast-stack');
    if (!stack) {
      stack = document.createElement('div');
      stack.className = 'toast-stack';
      stack.setAttribute('role', 'status');
      document.body.appendChild(stack);
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = '<svg class="icon"><use href="#i-check"/></svg><span></span>';
    t.querySelector('span').textContent = msg;
    stack.appendChild(t);
    setTimeout(() => t.remove(), ms > 0 ? ms : 3600);
  };
  $$('[data-toast]').forEach(b => b.addEventListener('click', () => SAM.toast(b.dataset.toast)));

  // 主題：只有 light 與 dark。順序：使用者選過的 > 頁面指定的 > 系統設定
  const root = document.documentElement;
  const currentTheme = () => root.getAttribute('data-theme') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const syncTheme = () => $$('[data-theme-toggle] button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.value === currentTheme())));
  SAM.setTheme = t => {
    root.setAttribute('data-theme', t === 'dark' ? 'dark' : 'light');
    try { localStorage.setItem('sam-theme', currentTheme()); } catch (e) {}
    syncTheme();
  };
  try { const saved = localStorage.getItem('sam-theme'); if (saved) root.setAttribute('data-theme', saved); } catch (e) {}
  $$('[data-theme-toggle] button').forEach(b => b.addEventListener('click', () => SAM.setTheme(b.dataset.value)));
  syncTheme();

  // 檔案放置區
  $$('.dropzone').forEach(z => {
    const input = z.querySelector('input');
    const list = z.dataset.list && document.querySelector(z.dataset.list);
    const show = files => {
      if (!list) return;
      list.innerHTML = '';
      Array.from(files).forEach(f => {
        const li = document.createElement('li');
        li.innerHTML = '<svg class="icon"><use href="#i-file"/></svg><span class="mono"></span>';
        li.querySelector('span').textContent = f.name;
        list.appendChild(li);
      });
    };
    z.addEventListener('click', () => input.click());
    z.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); } });
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('change', () => show(input.files));
    z.addEventListener('dragover', e => { e.preventDefault(); z.classList.add('is-over'); });
    z.addEventListener('dragleave', () => z.classList.remove('is-over'));
    z.addEventListener('drop', e => { e.preventDefault(); z.classList.remove('is-over'); show(e.dataTransfer.files); });
  });
})();
