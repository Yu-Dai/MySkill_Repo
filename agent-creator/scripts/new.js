#!/usr/bin/env node
/*
 * AgentCreator 建立新專案：把 agent 骨幹複製到指定資料夾。只用 Node 內建模組。
 *
 *   node new.js 輸出資料夾
 *
 * 輸出資料夾已有內容時不會覆蓋。
 */
'use strict';
const fs = require('fs');
const path = require('path');

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates', 'agent');
const SKIP_NAMES = new Set(['sessions', '.env', 'node_modules']);
const EXIT_USAGE = 2;
const EXIT_EXISTS = 1;

const out = process.argv[2];
if (!out) {
  console.log('用法：node new.js 輸出資料夾');
  process.exit(EXIT_USAGE);
}
const target = path.resolve(out);
if (fs.existsSync(target) && fs.readdirSync(target).length > 0) {
  console.log('資料夾已有內容，沒有覆蓋：' + target + '\n下一步：換一個資料夾名稱，或直接在既有專案上開發。');
  process.exit(EXIT_EXISTS);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (SKIP_NAMES.has(entry.name)) continue;
    const source = path.join(from, entry.name);
    const destination = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, destination);
    else fs.copyFileSync(source, destination);
  }
}

copyDir(TEMPLATE_DIR, target);
console.log([
  '已建立：' + target,
  '',
  '下一步：',
  '  1. 進入資料夾，把 .env.example 複製成 .env，填入模型端點與金鑰',
  '  2. 執行 npm test        確認骨幹在這台電腦上正常（不需要模型，不需要網路）',
  '  3. 執行 npm run smoke   確認真實模型能回覆、能呼叫工具',
  '  4. 執行 npm run agent -- run "你的任務"',
].join('\n'));
