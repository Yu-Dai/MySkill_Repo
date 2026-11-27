import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { Agent } from './core/agent.ts';
import { loadConfig } from './core/config.ts';
import type { StreamEvent } from './core/events.ts';
import type { SessionRunner } from './core/runner.ts';
import { startServer } from './server.ts';

const DEFAULT_CONFIG_PATH = './agent.config.ts';
const ENV_FILE = './.env';
const EXIT_OK = 0;
const EXIT_FAILED = 1;
const EXIT_INTERRUPTED = 130;
const PREVIEW_CHARS = 200;

const USAGE = `用法：
  node src/cli.ts run "<任務>"          開新 session 並執行
  node src/cli.ts send <id> "<訊息>"    對既有 session 追加訊息
  node src/cli.ts resume <id>           續跑中斷的 session
  node src/cli.ts list                  列出所有 session
  node src/cli.ts serve                 啟動 HTTP server

選項：
  --yes            所有工具都不詢問，直接執行
  --config <路徑>  設定檔位置，預設 ${DEFAULT_CONFIG_PATH}
  --port <埠號>    serve 用的埠號`;

function preview(value: unknown): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const oneLine = text.replace(/\s+/g, ' ');
  return oneLine.length > PREVIEW_CHARS ? `${oneLine.slice(0, PREVIEW_CHARS)}…` : oneLine;
}

async function askApproval(runner: SessionRunner, callId: string, name: string, input: unknown): Promise<void> {
  if (!process.stdin.isTTY) {
    process.stderr.write(`\n[需要核准 ${name}，但目前不是互動式終端機，已自動拒絕。要無人值守執行請加 --yes]\n`);
    runner.approve(callId, 'deny');
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try {
    const answer = await rl.question(`\n要執行 ${name} 嗎？\n  ${preview(input)}\n  (y 允許 / 其他鍵拒絕) > `);
    runner.approve(callId, answer.trim().toLowerCase() === 'y' ? 'allow' : 'deny');
  } catch {
    runner.approve(callId, 'deny');
  } finally {
    rl.close();
  }
}

function render(runner: SessionRunner, event: StreamEvent): void {
  switch (event.type) {
    case 'text.delta':
      process.stdout.write(event.text);
      break;
    case 'assistant.message':
      if (event.text) process.stdout.write('\n');
      for (const call of event.toolCalls) process.stderr.write(`[工具] ${call.name} ${preview(call.input)}\n`);
      break;
    case 'tool.approval_requested':
      void askApproval(runner, event.callId, event.name, event.input);
      break;
    case 'tool.result':
      process.stderr.write(`[${event.ok ? '完成' : '失敗'}] ${event.name}：${preview(event.output)}\n`);
      break;
    case 'context.compacted':
      process.stderr.write('[較早的對話已壓縮成摘要]\n');
      break;
    case 'error':
      process.stderr.write(`[錯誤] ${event.message}\n`);
      break;
    case 'fatal':
      process.stderr.write(`[嚴重錯誤] ${event.message}\n`);
      break;
    default:
      break;
  }
}

async function runUntilSettled(runner: SessionRunner, start: () => void): Promise<number> {
  const lastSeq = runner.store.events.at(-1)?.seq ?? 0;
  const unsubscribe = runner.subscribe((event) => render(runner, event), lastSeq);
  let interrupts = 0;
  const onSigint = () => {
    interrupts += 1;
    if (interrupts > 1) process.exit(EXIT_INTERRUPTED);
    process.stderr.write('\n[中斷中，再按一次 Ctrl+C 強制結束]\n');
    runner.interrupt();
  };
  process.on('SIGINT', onSigint);
  try {
    start();
    await runner.whenSettled();
  } finally {
    process.off('SIGINT', onSigint);
    unsubscribe();
  }
  const reason = runner.store.readMeta().lastTurnEnd;
  process.stderr.write(`\n[session ${runner.id}，結束原因：${reason}，紀錄在 ${runner.store.dir}]\n`);
  if (reason === 'done') return EXIT_OK;
  return reason === 'interrupted' ? EXIT_INTERRUPTED : EXIT_FAILED;
}

function requireSession(agent: Agent, id: string | undefined): SessionRunner {
  if (!id) throw new Error('請提供 session id');
  const runner = agent.getSession(id);
  if (!runner) throw new Error(`找不到 session ${id}`);
  return runner;
}

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      yes: { type: 'boolean', default: false },
      config: { type: 'string', default: DEFAULT_CONFIG_PATH },
      port: { type: 'string' },
      help: { type: 'boolean', default: false },
    },
  });
  const [command, first, second] = positionals;
  if (values.help || !command) {
    process.stdout.write(`${USAGE}\n`);
    return command ? EXIT_OK : EXIT_FAILED;
  }

  if (existsSync(ENV_FILE)) process.loadEnvFile(ENV_FILE);
  const config = await loadConfig(values.config);
  if (values.yes) config.approval.mode = 'never';
  if (values.port) config.server.port = Number(values.port);

  const agent = await Agent.create(config);
  for (const failure of agent.mcpFailures) {
    process.stderr.write(`[警告] MCP server ${failure.server} 連線失敗：${failure.message}\n`);
  }

  if (command === 'serve') {
    const server = await startServer(agent, { port: config.server.port, token: process.env.AGENT_SERVER_TOKEN });
    process.stdout.write(`HTTP server 已啟動：${server.url}\n測試頁：${server.url}/?token=${server.token}\n按 Ctrl+C 結束\n`);
    await new Promise<void>((resolve) => process.once('SIGINT', resolve));
    await server.close();
    await agent.close();
    return EXIT_OK;
  }

  try {
    switch (command) {
      case 'run': {
        if (!first) throw new Error('請提供任務內容');
        const runner = agent.createSession(first);
        return await runUntilSettled(runner, () => runner.sendMessage(first));
      }
      case 'send': {
        const runner = requireSession(agent, first);
        if (!second) throw new Error('請提供訊息內容');
        return await runUntilSettled(runner, () => runner.sendMessage(second));
      }
      case 'resume': {
        const runner = requireSession(agent, first);
        return await runUntilSettled(runner, () => runner.resume());
      }
      case 'list': {
        for (const meta of agent.listSessions()) {
          process.stdout.write(`${meta.id}  ${meta.status.padEnd(16)}  ${meta.title}\n`);
        }
        return EXIT_OK;
      }
      default:
        process.stderr.write(`不認得的指令：${command}\n\n${USAGE}\n`);
        return EXIT_FAILED;
    }
  } finally {
    await agent.close();
  }
}

main().then(
  (code) => { process.exitCode = code; },
  (err) => {
    process.stderr.write(`${(err as Error).message}\n`);
    process.exitCode = EXIT_FAILED;
  },
);
