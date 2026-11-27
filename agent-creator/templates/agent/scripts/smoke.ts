// 用真實模型跑三個最小情境，確認模型端點、金鑰 header、工具呼叫都正常。
// 執行：npm run smoke。把完整輸出貼給協助你的人或 AI，就能判斷問題出在哪一段。
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Agent } from '../src/core/agent.ts';
import { loadConfig } from '../src/core/config.ts';
import type { AgentEvent, EventOf } from '../src/core/events.ts';

const CONFIG_PATH = './agent.config.ts';
const ENV_FILE = './.env';
const EXPECTED_FILE = 'hello.txt';
const EXPECTED_CONTENT = 'smoke-ok';

type Check = { name: string; pass: boolean; detail: string };

function summarize(events: readonly AgentEvent[]): string {
  return events.map((e) => {
    if (e.type === 'assistant.message') return `assistant(text=${e.text.length}字, tools=[${e.toolCalls.map((c) => c.name + (c.invalid ? '!invalid' : '')).join(',')}], finish=${e.finishReason}, usage=${JSON.stringify(e.usage)})`;
    if (e.type === 'tool.result') return `tool.result(${e.name}, ok=${e.ok})`;
    if (e.type === 'turn.finished') return `turn.finished(${e.reason})`;
    if (e.type === 'error') return `error(${e.message})`;
    return e.type;
  }).join(' → ');
}

async function main(): Promise<void> {
  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const config = await loadConfig(CONFIG_PATH);
  config.approval.mode = 'never';
  config.sessionsDir = mkdtempSync(join(tmpdir(), 'agent-smoke-'));
  config.mcpServers = {};
  const agent = await Agent.create(config);
  const checks: Check[] = [];

  console.log(`Node ${process.version}，平台 ${process.platform}`);
  console.log(`模型：${'modelId' in (config.model as object) ? (config.model as { modelId: string }).modelId : '(自訂)'}`);
  console.log(`紀錄資料夾：${config.sessionsDir}\n`);

  try {
    const plain = agent.createSession('smoke: 純文字');
    plain.sendMessage('請只回覆兩個字：收到');
    await plain.whenSettled();
    const reply = plain.store.events.findLast((e) => e.type === 'assistant.message') as EventOf<'assistant.message'> | undefined;
    checks.push({
      name: '1. 純文字回覆',
      pass: plain.store.readMeta().lastTurnEnd === 'done' && Boolean(reply?.text),
      detail: summarize(plain.store.events),
    });

    const tools = agent.createSession('smoke: 工具呼叫');
    tools.sendMessage(`請用 write_file 工具建立檔案 ${EXPECTED_FILE}，內容只有 ${EXPECTED_CONTENT} 這幾個字，然後告訴我完成了。`);
    await tools.whenSettled();
    const written = join(tools.store.workspaceDir, EXPECTED_FILE);
    const content = existsSync(written) ? readFileSync(written, 'utf8').trim() : null;
    checks.push({
      name: '2. 工具呼叫並寫出檔案',
      pass: content === EXPECTED_CONTENT,
      detail: `檔案內容=${JSON.stringify(content)}；${summarize(tools.store.events)}`,
    });

    const final = tools.store.events.findLast((e) => e.type === 'assistant.message') as EventOf<'assistant.message'> | undefined;
    checks.push({
      name: '3. 工具執行後模型有接著回覆文字',
      pass: tools.store.readMeta().lastTurnEnd === 'done' && Boolean(final?.text) && final?.toolCalls.length === 0,
      detail: `最後一則 assistant 文字長度=${final?.text.length ?? 0}`,
    });

    const anyUsage = [...plain.store.events, ...tools.store.events]
      .some((e) => e.type === 'assistant.message' && e.usage.inputTokens !== null);
    checks.push({
      name: '4. 模型有回報 token 用量（沒有也能運作，只是預算改用估算）',
      pass: anyUsage,
      detail: anyUsage ? '有' : '沒有。若請求被端點以 400 拒絕，試著在 agent.config.ts 的 model 加上 includeUsage: false',
    });
  } finally {
    await agent.close();
  }

  for (const check of checks) {
    console.log(`${check.pass ? 'PASS' : 'FAIL'}  ${check.name}\n      ${check.detail}\n`);
  }
  const required = checks.slice(0, 3);
  process.exitCode = required.every((c) => c.pass) ? 0 : 1;
}

main().catch((err) => {
  console.error(`冒煙測試無法執行：${(err as Error).stack ?? err}`);
  process.exitCode = 1;
});
