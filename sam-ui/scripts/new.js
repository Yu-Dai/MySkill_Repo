#!/usr/bin/env node
/*
 * SAM UI 建立新頁面：複製範本，並把 assets 資料夾放到頁面旁邊。只用 Node 內建模組。
 *
 *   node new.js page 輸出路徑.html        單頁（頁首加內容區）
 *   node new.js app-shell 輸出路徑.html   側邊導覽加內容區
 *
 * 輸出檔已存在時不會覆蓋。assets 內的檔案每次都會更新成 skill 內的版本。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const [kind, out] = process.argv.slice(2);
const template = path.join(root, 'templates', kind + '.html');

if (!kind || !out || !['page', 'app-shell'].includes(kind)) {
  console.log('用法：node new.js page 輸出路徑.html\n      node new.js app-shell 輸出路徑.html');
  process.exit(2);
}
const target = path.resolve(out);
if (fs.existsSync(target)) {
  console.log('檔案已存在，沒有覆蓋：' + target + '\n下一步：直接編輯這個檔案，或換一個檔名。');
  process.exit(1);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

const dir = path.dirname(target);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(template, target);
copyDir(path.join(root, 'assets'), path.join(dir, 'assets'));

console.log('已建立：' + target);
console.log('已複製：' + path.join(dir, 'assets'));
console.log('下一步：');
console.log('  1. 編輯 ' + path.basename(target) + '，只改有「在這裡」註解的位置。');
console.log('  2. 元件片段從 references/components.md 複製。');
console.log('  3. 執行 node "' + path.join(root, 'scripts', 'check.js') + '" "' + target + '"，修正到顯示「通過」。');
