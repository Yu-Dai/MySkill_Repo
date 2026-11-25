#!/usr/bin/env node
/*
 * SAM Smoke 檢查：確認 smoke.json 格式正確，而且每一步指到的程式碼位置真的存在。
 * 只用 Node 內建模組。
 *
 *   node check.js smoke.json --root 專案根目錄
 *
 * 每個問題會列出：哪裡、為什麼、正確寫法、下一步。
 * 結束碼：0 全部通過，1 有問題，2 用法錯誤。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const LIMITS = { title: 14, name: 14, desc: 80, reason: 80, moduleDesc: 16, steps: 40, modules: 8 };
const PHASES = ['boot', 'run', 'exit'];
const KINDS = ['step', 'end', 'dead', 'fog'];
const NEAR = 2;

const RULES = {
  'json': {
    why: '檔案讀不到，或內容不是合法的 JSON。',
    fix: '{ "project": { "name": "專案名稱" }, "modules": [...], "entries": [...] }',
    next: '確認檔案路徑正確，再照錯誤訊息的位置修正語法（常見：多了結尾逗號、字串裡的雙引號沒有加反斜線）。完整格式見 references/format.md。',
  },
  'shape': {
    why: '缺少必要欄位，或欄位型別不對。',
    fix: '完整欄位表見 references/format.md。',
    next: '補上這個欄位，或改成正確的型別。',
  },
  'id': {
    why: 'id 用來連接步驟與模組，重複或含特殊字元會連錯。',
    fix: '"id": "s3"（只用英數、底線、連字號；同一層不重複）',
    next: '改成不重複、只含英數的 id，並同步修改引用它的 from 或 module。',
  },
  'too-long': {
    why: '畫面上每一步的空間固定，文字太長會被截斷或擠壞版面。',
    fix: '"title": "驗證資料格式"（動詞加受詞，細節放 desc）',
    next: '縮短到上限以內。標題只說這一步做什麼；怎麼做放 desc；位置已經有 file 和 line，不用寫進文字。',
  },
  'too-many': {
    why: '一條旅程超過 ' + LIMITS.steps + ' 步就沒有人看得完，通常代表步驟切得太細。',
    fix: '把同一個函式內連續的小動作合併成一步；只呼叫標準函式庫或框架的動作不算一步。',
    next: '依 references/tracing.md 的「一步是什麼」重新切分。真的合併不了，就把後半段拆成另一個入口（例如「匯入檔案：寫入階段」）。',
  },
  'unknown-module': {
    why: '步驟的 module 必須是 modules 清單裡的 id，畫面才知道把這一步放在哪一列。',
    fix: '"module": "parser"',
    next: '改成 modules 裡已有的 id；如果這段程式確實屬於新的模組，先在 modules 加上它。',
  },
  'from': {
    why: 'from 指出煙從哪一步流過來。它必須是同一個入口裡、排在前面的步驟。',
    fix: '"from": "s3"',
    next: '改成排在這一步之前的步驟 id。陣列順序就是煙走的順序，先走到的排前面。',
  },
  'missing-from': {
    why: '上一步是終點、死路或霧，煙不能從那裡繼續走。這一步必須說明煙從哪裡折返再出發。',
    fix: '"from": "s3"（寫出分岔點的步驟 id）',
    next: '加上 from，指向煙折返後重新出發的那一步。',
  },
  'open-end': {
    why: '煙停在這一步，卻沒有說明為什麼停。每條路的最後一步都要有交代。',
    fix: '"kind": "end", "reason": "把結果寫入資料庫後返回"\n"kind": "dead", "reason": "回傳值沒有人使用"\n"kind": "fog", "reason": "透過函式指標呼叫，讀碼無法確定目標"',
    next: '打開這一步的函式本體往下讀：還有後續就繼續加步驟；確實結束了，就把 kind 改成 end、dead 或 fog 並寫 reason。',
  },
  'closed-end': {
    why: '終點、死路、霧都代表煙在這裡停下，後面不能再接步驟。',
    fix: '後面那一步的 from 改指向分岔點，而不是這一步。',
    next: '如果煙其實還會繼續走，把這一步的 kind 改回 step；否則修改後面步驟的 from。',
  },
  'no-reason': {
    why: '終點、死路、霧一定要說明原因，這是使用者最需要看到的資訊。',
    fix: '"reason": "validate.js 第 6 行沒有接收回傳值"',
    next: '寫出從程式碼看到的具體事實，不要寫推測。',
  },
  'path': {
    why: '位置必須是專案根目錄底下的相對路徑，畫面才能對應到檔案。',
    fix: '"file": "src/parser/read.c"',
    next: '改成相對於 --root 的路徑，用正斜線，不要以 / 或 .. 開頭。',
  },
  'no-file': {
    why: '這個檔案不存在。步驟必須對應到真的程式碼，不能憑印象寫。',
    fix: '"file": "專案內實際存在的相對路徑"',
    next: '確認 --root 是專案根目錄，再確認檔名與大小寫。找不到這個檔案就刪掉這一步。',
  },
  'no-line': {
    why: '行號超出檔案長度。',
    fix: '"line": 42',
    next: '重新打開檔案，寫出函式定義或呼叫所在的行號。',
  },
  'no-symbol': {
    why: '在這個行號附近（上下 ' + NEAR + ' 行）找不到 symbol 的文字。行號寫錯、symbol 拼錯，或這一步是憑函式名稱猜的。',
    fix: '"line": 42, "symbol": "validate"（symbol 是這一行實際出現的文字）',
    next: '重新打開檔案核對。行號以現在的檔案內容為準。',
  },
};

function check(data, root) {
  const out = [];
  const add = (rule, where, detail) => out.push({ rule, where, detail: detail || '' });
  const isStr = v => typeof v === 'string' && v.trim() !== '';
  const idOk = v => typeof v === 'string' && /^[A-Za-z0-9_-]+$/.test(v);
  /* 字數以全形字為單位：中日韓文字算 1，英數與半形符號算 0.5，和畫面上佔的寬度一致 */
  const len = v => Math.ceil(Array.from(v).reduce((n, c) => n + (c.codePointAt(0) < 0x2E80 ? 0.5 : 1), 0));
  const fileCache = new Map();

  function readLines(rel) {
    if (fileCache.has(rel)) return fileCache.get(rel);
    let lines = null;
    try {
      const abs = path.resolve(root, rel);
      if (fs.statSync(abs).isFile()) lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
    } catch (e) { lines = null; }
    fileCache.set(rel, lines);
    return lines;
  }

  function checkText(where, field, value, limit, required) {
    if (value === undefined && !required) return;
    if (!isStr(value)) return add('shape', where, field + ' 必須是非空字串。');
    if (len(value) > limit) add('too-long', where, field + ' 寬度是 ' + len(value) + ' 個全形字，上限 ' + limit + '（英數算半個字）。');
  }

  function checkLoc(where, o) {
    if (!isStr(o.file)) return add('shape', where, 'file 必須是非空字串。');
    if (!Number.isInteger(o.line) || o.line < 1) return add('shape', where, 'line 必須是大於 0 的整數。');
    if (!isStr(o.symbol)) return add('shape', where, 'symbol 必須是非空字串。');
    const rel = o.file;
    if (path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.includes('\\') || rel.split('/').includes('..')) {
      return add('path', where, '目前寫的是 ' + rel);
    }
    const lines = readLines(rel);
    if (!lines) return add('no-file', where, '找不到 ' + rel);
    if (o.line > lines.length) return add('no-line', where, rel + ' 只有 ' + lines.length + ' 行，寫的是第 ' + o.line + ' 行。');
    const lo = Math.max(1, o.line - NEAR), hi = Math.min(lines.length, o.line + NEAR);
    let found = false;
    for (let n = lo; n <= hi; n++) if (lines[n - 1].includes(o.symbol)) found = true;
    if (!found) {
      const hits = [];
      lines.forEach((t, i) => { if (t.includes(o.symbol) && hits.length < 8) hits.push(i + 1); });
      add('no-symbol', where, rel + ':' + o.line + ' 附近沒有「' + o.symbol + '」。' +
        (hits.length ? '這段文字出現在第 ' + hits.join('、') + ' 行。' : '整個檔案都沒有這段文字。'));
    }
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    add('shape', '最外層', '最外層必須是物件，包含 project、modules、entries。');
    return out;
  }
  if (!data.project || typeof data.project !== 'object') add('shape', 'project', '缺少 project 物件。');
  else checkText('project', 'name', data.project.name, 30, true);

  const moduleIds = new Set();
  if (!Array.isArray(data.modules) || data.modules.length === 0) {
    add('shape', 'modules', 'modules 必須是至少有一個模組的陣列。');
  } else {
    if (data.modules.length > LIMITS.modules) {
      add('too-many', 'modules', '有 ' + data.modules.length + ' 個模組，上限 ' + LIMITS.modules + '。把職責相近的合併成一個。');
    }
    data.modules.forEach((m, i) => {
      const where = 'modules[' + i + ']' + (m && m.id ? '（' + m.id + '）' : '');
      if (!m || typeof m !== 'object') return add('shape', where, '必須是物件。');
      if (!idOk(m.id)) add('id', where, 'id 目前是 ' + JSON.stringify(m.id));
      else if (moduleIds.has(m.id)) add('id', where, 'id「' + m.id + '」重複。');
      else moduleIds.add(m.id);
      checkText(where, 'name', m.name, LIMITS.name, true);
      checkText(where, 'desc', m.desc, LIMITS.moduleDesc, true);
    });
  }

  if (!Array.isArray(data.entries) || data.entries.length === 0) {
    add('shape', 'entries', 'entries 必須是至少有一個入口的陣列。');
    return out;
  }
  const entryIds = new Set();
  data.entries.forEach((e, ei) => {
    const ew = '入口「' + (e && (e.name || e.id) || ei) + '」';
    if (!e || typeof e !== 'object') return add('shape', ew, '必須是物件。');
    if (!idOk(e.id)) add('id', ew, 'id 目前是 ' + JSON.stringify(e.id));
    else if (entryIds.has(e.id)) add('id', ew, 'id「' + e.id + '」重複。');
    else entryIds.add(e.id);
    checkText(ew, 'name', e.name, LIMITS.name, true);
    checkText(ew, 'trigger', e.trigger, LIMITS.desc, true);
    if (!PHASES.includes(e.phase)) add('shape', ew, 'phase 必須是 boot、run、exit 其中之一，目前是 ' + JSON.stringify(e.phase));
    checkLoc(ew, e);
    if (!Array.isArray(e.steps)) return add('shape', ew, 'steps 必須是陣列。還沒追蹤的入口寫空陣列 []。');
    if (e.steps.length > LIMITS.steps) add('too-many', ew, '有 ' + e.steps.length + ' 步，上限 ' + LIMITS.steps + '。');

    const seen = new Map();
    const children = new Map();
    e.steps.forEach((s, si) => {
      const sw = ew + ' 第 ' + (si + 1) + ' 步' + (s && s.id ? '（' + s.id + '）' : '');
      if (!s || typeof s !== 'object') return add('shape', sw, '必須是物件。');
      if (!idOk(s.id)) add('id', sw, 'id 目前是 ' + JSON.stringify(s.id));
      else if (seen.has(s.id)) add('id', sw, 'id「' + s.id + '」在這個入口裡重複。');
      checkText(sw, 'title', s.title, LIMITS.title, true);
      checkText(sw, 'desc', s.desc, LIMITS.desc, true);
      if (!moduleIds.has(s.module)) add('unknown-module', sw, 'module 目前是 ' + JSON.stringify(s.module));
      const kind = s.kind === undefined ? 'step' : s.kind;
      if (!KINDS.includes(kind)) add('shape', sw, 'kind 必須是 step、end、dead、fog 其中之一，目前是 ' + JSON.stringify(s.kind));
      if (kind !== 'step') {
        if (!isStr(s.reason)) add('no-reason', sw, 'kind 是 ' + kind + '，但沒有 reason。');
        else checkText(sw, 'reason', s.reason, LIMITS.reason, true);
      }
      checkLoc(sw, s);

      let parent = null;
      if (si === 0) {
        if (s.from !== undefined) add('from', sw, '第一步是入口本身，不能有 from。');
      } else if (s.from !== undefined) {
        if (!seen.has(s.from)) add('from', sw, 'from 目前是 ' + JSON.stringify(s.from) + '，前面沒有這個步驟。');
        else parent = s.from;
      } else {
        const prev = e.steps[si - 1];
        const pk = prev && prev.kind !== undefined ? prev.kind : 'step';
        if (pk !== 'step') add('missing-from', sw, '上一步（' + (prev && prev.id) + '）的 kind 是 ' + pk + '。');
        else parent = prev && prev.id;
      }
      if (parent !== null && parent !== undefined) {
        if (!children.has(parent)) children.set(parent, []);
        children.get(parent).push(s.id);
      }
      if (idOk(s.id) && !seen.has(s.id)) seen.set(s.id, { kind, where: sw });
    });
    seen.forEach((info, id) => {
      const kids = children.get(id) || [];
      if (info.kind === 'step' && kids.length === 0) add('open-end', info.where);
      if (info.kind !== 'step' && kids.length > 0) add('closed-end', info.where, '後面接了：' + kids.join('、'));
    });
  });
  return out;
}

function report(problems) {
  if (problems.length === 0) return '結果：全部通過';
  const lines = [];
  problems.forEach((p, i) => {
    const r = RULES[p.rule];
    lines.push('問題 ' + (i + 1) + '／' + problems.length + '［' + p.rule + '］');
    lines.push('  哪裡：' + p.where + (p.detail ? '　' + p.detail : ''));
    lines.push('  為什麼：' + r.why);
    lines.push('  正確寫法：' + r.fix.split('\n').join('\n            '));
    lines.push('  下一步：' + r.next);
    lines.push('');
  });
  lines.push('結果：有 ' + problems.length + ' 個問題。修正後重新執行。');
  return lines.join('\n');
}

function load(file) {
  let text;
  try { text = fs.readFileSync(file, 'utf8'); }
  catch (e) { return { problems: [{ rule: 'json', where: file, detail: '讀不到檔案：' + e.message }] }; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  try { return { data: JSON.parse(text) }; }
  catch (e) { return { problems: [{ rule: 'json', where: file, detail: e.message }] }; }
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--root' || argv[i] === '--out') args[argv[i].slice(2)] = argv[++i];
    else args._.push(argv[i]);
  }
  return args;
}

module.exports = { check, report, load, parseArgs, LIMITS };

if (require.main === module) {
  const args = parseArgs(process.argv.slice(2));
  if (args._.length !== 1 || !args.root) {
    console.log('用法：node check.js smoke.json --root 專案根目錄');
    process.exit(2);
  }
  const loaded = load(args._[0]);
  const problems = loaded.problems || check(loaded.data, path.resolve(args.root));
  console.log(report(problems));
  process.exit(problems.length ? 1 : 0);
}
