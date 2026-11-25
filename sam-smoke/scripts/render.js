#!/usr/bin/env node
/*
 * SAM Smoke 產生報告：先檢查 smoke.json，全部通過才把資料放進固定範本，輸出單一 HTML 檔。
 * 只用 Node 內建模組。輸出檔不需要其他檔案，可以離線開啟、直接傳給別人。
 *
 *   node render.js smoke.json --root 專案根目錄 --out smoke.html
 *
 * 結束碼：0 已輸出，1 檢查沒過（不輸出），2 用法錯誤。
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { check, report, load, parseArgs } = require('./check.js');

const MARK = '/*__SMOKE_DATA__*/null';
const args = parseArgs(process.argv.slice(2));
if (args._.length !== 1 || !args.root || !args.out) {
  console.log('用法：node render.js smoke.json --root 專案根目錄 --out smoke.html');
  process.exit(2);
}

const loaded = load(args._[0]);
const problems = loaded.problems || check(loaded.data, path.resolve(args.root));
if (problems.length) {
  console.log(report(problems));
  console.log('沒有輸出 HTML。下一步：照上面每個問題的「下一步」修改 ' + args._[0] + '，再重新執行同一個指令。');
  process.exit(1);
}

const template = fs.readFileSync(path.join(__dirname, '..', 'assets', 'template.html'), 'utf8');
if (!template.includes(MARK)) {
  console.log('範本 assets/template.html 少了資料標記，可能被修改過。下一步：從 skill 原始位置還原這個檔案。');
  process.exit(2);
}
const json = JSON.stringify(loaded.data)
  .replace(/</g, '\\u003c')
  .replace(new RegExp(String.fromCharCode(0x2028), 'g'), '\\u2028')
  .replace(new RegExp(String.fromCharCode(0x2029), 'g'), '\\u2029');
const target = path.resolve(args.out);
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, template.split(MARK).join(json));

const entries = loaded.data.entries;
const traced = entries.filter(e => e.steps.length > 0);
const count = kind => traced.reduce((n, e) => n + e.steps.filter(s => s.kind === kind).length, 0);
console.log('結果：全部通過');
console.log('已輸出：' + target);
console.log('入口 ' + entries.length + ' 個，已灌煙 ' + traced.length + ' 個；死路 ' + count('dead') + ' 處，霧 ' + count('fog') + ' 處。');
const todo = entries.filter(e => e.steps.length === 0).map(e => e.name);
if (todo.length) console.log('尚未灌煙：' + todo.join('、'));
