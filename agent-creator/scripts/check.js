#!/usr/bin/env node
/*
 * AgentCreator 檢查專案：Node 版本、骨幹是否被改動、測試是否通過。只用 Node 內建模組。
 *
 *   node check.js 專案資料夾
 *   node check.js 專案資料夾 --allow-core-changes   使用者已同意修改骨幹時使用
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const TEMPLATE_DIR = path.resolve(__dirname, '..', 'templates', 'agent');
const PROTECTED_DIRS = [path.join('src', 'core'), 'vendor'];
const MIN_NODE = [22, 18];
const ALLOW_FLAG = '--allow-core-changes';
const EXIT_USAGE = 2;
const EXIT_FAILED = 1;

const args = process.argv.slice(2);
const allowCoreChanges = args.includes(ALLOW_FLAG);
const projectArg = args.find((a) => a !== ALLOW_FLAG);
if (!projectArg) {
  console.log('用法：node check.js 專案資料夾 [' + ALLOW_FLAG + ']');
  process.exit(EXIT_USAGE);
}
const project = path.resolve(projectArg);
const problems = [];

function listFiles(dir, base) {
  if (!fs.existsSync(dir)) return [];
  const found = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...listFiles(full, base));
    else found.push(path.relative(base, full));
  }
  return found;
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < MIN_NODE[0] || (major === MIN_NODE[0] && minor < MIN_NODE[1])) {
  problems.push({
    where: 'Node 版本 ' + process.versions.node,
    why: '骨幹直接執行 TypeScript，需要 Node ' + MIN_NODE.join('.') + ' 以上',
    next: '安裝最新的 Node LTS 後重新執行',
  });
}

if (!fs.existsSync(path.join(project, 'agent.config.ts'))) {
  problems.push({
    where: project,
    why: '找不到 agent.config.ts，這不是用 new.js 建立的專案資料夾',
    next: '確認路徑，或先執行 node new.js 建立專案',
  });
}

for (const dir of PROTECTED_DIRS) {
  const expected = new Set(listFiles(path.join(TEMPLATE_DIR, dir), TEMPLATE_DIR));
  const actual = new Set(listFiles(path.join(project, dir), project));
  const changed = [];
  for (const file of expected) {
    if (!actual.has(file)) changed.push(file + '（缺少）');
    else if (!fs.readFileSync(path.join(TEMPLATE_DIR, file)).equals(fs.readFileSync(path.join(project, file)))) changed.push(file + '（內容不同）');
  }
  for (const file of actual) if (!expected.has(file)) changed.push(file + '（多出來的檔案）');
  if (changed.length > 0 && !allowCoreChanges) {
    problems.push({
      where: dir + '：\n    ' + changed.join('\n    '),
      why: '骨幹與打包的依賴不應該修改，客製要寫在 agent.config.ts、自訂工具、skills 或前端',
      next: '從 SKILL_DIR/templates/agent 複製原檔還原，再改用擴充點實作（見 references/extending.md）。'
        + '若使用者已明確同意修改骨幹，加上 ' + ALLOW_FLAG + ' 重新執行',
    });
  }
}

if (problems.length === 0) {
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.ts'], { cwd: project, encoding: 'utf8' });
  const output = (result.stdout || '') + (result.stderr || '');
  const failedLine = output.split('\n').find((line) => /^# fail \d+/.test(line));
  const failed = failedLine ? Number(failedLine.replace('# fail ', '')) : null;
  if (result.status !== 0 || failed !== 0) {
    const failures = output.split('\n').filter((line) => line.startsWith('not ok')).join('\n    ');
    problems.push({
      where: '測試',
      why: failures ? '未通過的測試：\n    ' + failures : '測試無法執行：\n' + output.slice(-1500),
      next: '在專案資料夾執行 npm test 看完整訊息。若是自己新增的工具造成，修正工具；若骨幹的測試在這台電腦上失敗，把完整輸出交給使用者',
    });
  }
}

if (problems.length === 0) {
  console.log('結果：全部通過');
  process.exit(0);
}
for (const [index, problem] of problems.entries()) {
  console.log('問題 ' + (index + 1) + '\n  哪裡：' + problem.where + '\n  為什麼：' + problem.why + '\n  下一步：' + problem.next + '\n');
}
console.log('結果：' + problems.length + ' 個問題');
process.exit(EXIT_FAILED);
