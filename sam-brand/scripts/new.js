#!/usr/bin/env node
/*
 * 把品牌資產（assets 資料夾）放到頁面旁邊，需要時一併複製元件包的範本。只用 Node 內建模組。
 *
 *   node new.js assets 輸出資料夾         只放 assets（自己設計頁面時用）
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

if (!kind || !out || !['assets', 'page', 'app-shell'].includes(kind)) {
  console.log('用法：node new.js assets 輸出資料夾\n      node new.js page 輸出路徑.html\n      node new.js app-shell 輸出路徑.html');
  process.exit(2);
}
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name), b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b); else fs.copyFileSync(a, b);
  }
}

if (kind === 'assets') {
  const to = path.join(path.resolve(out), 'assets');
  copyDir(path.join(root, 'assets'), to);
  console.log('已複製：' + to);
  console.log('下一步：');
  console.log('  1. 頁面的 <head> 第一個樣式放 <link rel="stylesheet" href="assets/sam-brand.css">。');
  console.log('  2. Logo 用 <img src="assets/logo.png" alt="">。');
  console.log('  3. 完成後執行 node "' + path.join(root, 'scripts', 'check.js') + '" 頁面.html，修正到顯示「通過」。');
  process.exit(0);
}

const target = path.resolve(out);
if (fs.existsSync(target)) {
  console.log('檔案已存在，沒有覆蓋：' + target + '\n下一步：直接編輯這個檔案，或換一個檔名。');
  process.exit(1);
}

const dir = path.dirname(target);
fs.mkdirSync(dir, { recursive: true });
fs.copyFileSync(template, target);
copyDir(path.join(root, 'assets'), path.join(dir, 'assets'));

console.log('已建立：' + target);
console.log('已複製：' + path.join(dir, 'assets'));
console.log('下一步：');
console.log('  1. 編輯 ' + path.basename(target) + '。「在這裡」註解標出常改的位置，版面與樣式可以自由調整。');
console.log('  2. 元件包的片段在 references/components.md。');
console.log('  3. 執行 node "' + path.join(root, 'scripts', 'check.js') + '" "' + target + '"，修正到顯示「通過」。');
