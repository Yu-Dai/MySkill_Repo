# 擴充方式

所有客製都從 `agent.config.ts` 進入。這個檔案用 `export default defineConfig({...})` 匯出設定。

## 設定欄位

| 欄位 | 用途 | 預設 |
| --- | --- | --- |
| `model` | 模型端點。見下方「模型」 | 必填 |
| `systemPrompt` | agent 的角色與工作守則 | 一段通用說明 |
| `tools` | 自訂工具的陣列 | `[]` |
| `mcpServers` | 要連線的 MCP server | `{}` |
| `skillsDirs` | 放 skill 的資料夾 | `['./skills']` |
| `sessionsDir` | session 資料夾的位置 | `'./sessions'` |
| `approval.mode` | `'ask'` 寫入類工具先詢問；`'never'` 全部不問 | `'ask'` |
| `approval.allow` | 免核准的寫入類工具名稱，結尾可用 `*` | `[]` |
| `limits.maxSteps` | 一輪最多呼叫模型幾次 | 30 |
| `limits.maxTurnMs` | 一輪最長時間（毫秒） | 15 分鐘 |
| `limits.maxTurnTokens` | 一輪最多用多少 token | 400000 |
| `limits.modelRetries` | 模型呼叫失敗時重試幾次 | 2 |
| `limits.commandTimeoutMs` | `run_command` 單次指令的時限 | 2 分鐘 |
| `context.maxContextTokens` | 送給模型的內容超過這個估計值就壓縮 | 60000 |
| `context.keepRecentToolResults` | 壓縮時保留最近幾筆工具輸出 | 6 |
| `context.keepRecentMessages` | 摘要時保留最近幾則訊息原文 | 8 |
| `context.maxInlineToolOutputChars` | 工具輸出超過這個字元數就寫檔 | 8000 |
| `subagents.enabled` | 是否提供交辦給 subagent 的能力 | `true` |
| `subagents.maxParallel` | 最多同時進行幾個 subagent，超過的排隊 | 3 |
| `subagents.maxPerTurn` | 一輪最多交辦幾次，超過會被拒絕 | 10 |
| `subagents.maxSteps` | 每個 subagent 最多呼叫模型幾次 | 20 |
| `subagents.types` | 自訂的 subagent 類型 | 只有內建的 `general` |
| `server.port` | HTTP server 的埠號 | 4317 |
| `server.corsOrigins` | 允許跨來源呼叫 API 的網址 | `[]` |

相對路徑以 `agent.config.ts` 所在的資料夾為基準。

`maxContextTokens` 要設得比模型實際的上下文長度小，留空間給模型的回覆。模型上下文較短時要調低。

## 模型

```ts
model: {
  baseURL: process.env.AGENT_BASE_URL ?? '',   // OpenAI 相容端點，不含 /chat/completions
  modelId: process.env.AGENT_MODEL ?? '',
  apiKey: '...',                               // 用標準的 Authorization: Bearer 時填這個
  headers: { 'api-key': '...' },               // 金鑰放在自訂 header 時填這個
  includeUsage: true,                          // 端點不接受用量回報參數時設為 false
}
```

骨幹附的 `agent.config.ts` 已經依環境變數處理好「自訂 header 或 Bearer」兩種情況，通常只需要填 `.env`。

## 自訂工具

```ts
import { z } from '#deps';
import { defineConfig } from './src/core/config.ts';
import { defineTool } from './src/core/tools/registry.ts';

const lookupOrder = defineTool({
  name: 'lookup_order',
  description: '依訂單編號查詢訂單狀態。只在使用者提供了訂單編號時使用。',
  risk: 'read',
  inputSchema: z.object({
    orderId: z.string().describe('訂單編號'),
  }),
  async execute(input: { orderId: string }, context) {
    const response = await fetch(`http://內部服務/orders/${encodeURIComponent(input.orderId)}`, { signal: context.signal });
    if (!response.ok) throw new Error(`查詢失敗，HTTP ${response.status}`);
    return await response.json();
  },
});

export default defineConfig({
  model: { /* ... */ },
  tools: [lookupOrder],
});
```

寫工具時遵守：

- **`name`** 只能用英數字、底線、連字號，不能和既有工具重複。
- **`description`** 是寫給模型看的。說清楚這個工具做什麼、什麼時候該用、什麼時候不該用。
- **`risk`** 決定要不要先問使用者。只讀取的標 `read`；會改變任何東西的標 `write`。
- **`inputSchema`** 用 `z.object` 定義，每個欄位加 `.describe()`。模型給的參數不符合時，骨幹會自動把錯誤回給模型重試，工具裡不用再驗一次。
- **回傳值**可以是字串或可序列化的物件。太長會自動寫檔，不用自己截斷。
- **失敗時直接 `throw new Error('原因')`**。訊息會回給模型，所以要寫模型看得懂、能據以修正的內容。
- **長時間的操作要支援中斷**：把 `context.signal` 傳給 `fetch` 或子行程。
- `context` 還有 `workspaceDir`（這個 session 的工作資料夾）、`sessionDir`、`toolResultsDir`、`callId`。

較大的工具建議放在自己的檔案（例如 `tools/lookup-order.ts`），再由 `agent.config.ts` 匯入。

## MCP server

```ts
mcpServers: {
  // 本機啟動的 server（stdio）
  files: { command: 'node', args: ['C:/tools/files-mcp/index.js'], env: { ROOT: 'D:/data' } },
  // 遠端 server（HTTP）
  wiki: { url: 'http://內部主機/mcp', headers: { Authorization: 'Bearer ...' } },
},
```

- 工具會以「`server 名稱__工具名稱`」註冊，例如 `files__read`。
- MCP 工具一律視為寫入類，預設每次都要核准。信任的 server 可以加進 `approval.allow`，例如 `'wiki__*'`。
- 某個 server 連不上時 agent 仍會啟動，終端機會顯示警告，該 server 的工具不會出現。
- 金鑰不要直接寫在設定檔，用 `process.env.名稱` 從 `.env` 讀。

## Skill

在 `skills/` 底下建一個資料夾，裡面放 `SKILL.md`：

```
skills/
  weekly-report/
    SKILL.md
    template.md
```

```markdown
---
name: weekly-report
description: 產生週報。使用者要求寫週報、整理本週工作時使用。
---

# 週報

1. 用 read_file 讀取 SKILL_DIR/template.md。
2. ……
```

- 開頭的 `name` 和 `description` 各寫成一行。系統提示裡只會放這兩個欄位，所以 `description` 要寫清楚「什麼情況該用」。
- 本文只在模型呼叫 `load_skill` 時才載入。載入時會告訴模型這個 skill 資料夾的實際路徑。
- skill 資料夾裡的其他檔案，模型可以用 `read_file` 讀取。
- skill 要執行腳本時，在本文裡寫出完整指令，模型會用 `run_command` 執行（需要核准）。
- 既有的 skill 資料夾只要格式相同，直接複製進來就能用。

## Subagent

主 agent 可以用 `delegate` 工具把子任務交給 subagent。subagent 在自己的上下文裡工作，主 agent 只收到它最後的報告。模型上下文不大、任務又需要讀很多資料時，這能讓主 agent 的上下文保持乾淨。

內建一個 `general` 類型，可以使用所有工具。要加專門的類型：

```ts
subagents: {
  maxParallel: 3,
  maxPerTurn: 10,
  types: {
    researcher: {
      description: '在大量檔案中查找資料並整理結論。只會讀取，不會修改任何東西。',
      systemPrompt: '你是資料查找專員。只根據實際讀到的內容下結論，沒讀到的不要推測。',
      tools: ['read_file', 'list_dir'],
    },
  },
},
```

| 欄位 | 說明 |
| --- | --- |
| `description` | 寫給主 agent 看的，決定它什麼時候會選這個類型。要寫清楚適合什麼工作 |
| `systemPrompt` | 這個類型的角色與守則。骨幹會自動附上「如何回報」的規定，不用自己寫 |
| `tools` | 可用的工具名稱。省略表示全部。列了不存在的工具，啟動時會報錯 |
| `model` | 這個類型改用別的模型，格式和最上層的 `model` 相同。省略表示和主 agent 相同 |
| `maxSteps` | 這個類型的步數上限。省略表示用 `subagents.maxSteps` |

運作方式：

- 每個 subagent 是一個子 session，紀錄在 `sessions/<主 id>/subagents/<子 id>/events.jsonl`。
- subagent 和主 agent **共用同一個 workspace**，產出的檔案主 agent 直接讀得到。骨幹不會阻止兩個同時進行的 subagent 寫同一個檔案，只在提示中要求主 agent 分派時避開。
- subagent 不能再交辦給別的 subagent。
- subagent 的寫入類工具同樣需要核准，詢問會出現在主 session，前端不需要另外處理。
- subagent 用掉的 token 計入主 session 這一輪的 `limits.maxTurnTokens`。
- 同一則模型回覆裡有多個 `delegate` 呼叫時才會同時進行。模型一次只發一個時，就是一個接一個。
- 中斷後續跑，未完成的 subagent 會從原本的進度接續。

用不到時設 `subagents: { enabled: false }`，可以省下系統提示與工具定義佔用的上下文。

## 核准

```ts
approval: {
  mode: 'ask',
  allow: ['write_file', 'wiki__*'],
},
```

- 內建工具中，`read_file`、`list_dir`、`load_skill`、`delegate` 是讀取類，不需要核准；`write_file`、`run_command` 是寫入類。
- `run_command` 能執行任何指令，不受工作資料夾限制。除非在完全受控的環境，不要把它加進 `allow`。
- 無人值守執行時用 `--yes`，等同 `mode: 'never'`。

## 自己寫前端

HTTP 以外的前端直接使用 `Agent` 和 `SessionRunner`，方式和 `src/cli.ts` 相同：

```ts
import { Agent } from './src/core/agent.ts';
import { loadConfig } from './src/core/config.ts';

const agent = await Agent.create(await loadConfig('./agent.config.ts'));
const runner = agent.createSession('任務標題');

const unsubscribe = runner.subscribe((event) => {
  if (event.type === 'text.delta') process.stdout.write(event.text);
  if (event.type === 'tool.approval_requested') runner.approve(event.callId, 'allow');
});

runner.sendMessage('任務內容');
await runner.whenSettled();
unsubscribe();
await agent.close();
```

| 方法 | 用途 |
| --- | --- |
| `agent.createSession(標題)` | 建立新 session，回傳 runner |
| `agent.getSession(id)` | 取得既有 session，找不到回傳 `null` |
| `agent.listSessions()` | 列出所有 session |
| `agent.close()` | 中斷執行中的 session 並關閉 MCP 連線 |
| `runner.sendMessage(文字)` | 送出訊息並開始一輪。執行中會丟出 `SessionRunningError` |
| `runner.resume()` | 續跑。沒有可續跑的工作會丟出 `NothingToResumeError` |
| `runner.approve(callId, 'allow' 或 'deny')` | 回覆核准。該呼叫不在等待中時回傳 `false` |
| `runner.interrupt()` | 中斷目前這一輪 |
| `runner.subscribe(函式, 起始序號)` | 先重播該序號之後的事件，再接收新事件。回傳取消訂閱的函式 |
| `runner.whenSettled()` | 等目前這一輪結束 |
| `runner.subagentEvents(子 id, 起始序號)` | 讀取某個 subagent 的事件，找不到回傳 `null` |
| `runner.status`、`runner.canResume` | 目前狀態 |

`sendMessage` 和 `resume` 會立刻返回，執行在背景進行，結果透過事件送出。

## `#deps` 提供的名稱

| 名稱 | 來源 | 用途 |
| --- | --- | --- |
| `z` | zod | 定義工具參數 |
| `streamText`、`generateText`、`tool`、`jsonSchema` | ai | 呼叫模型（骨幹內部使用） |
| `createOpenAICompatible` | @ai-sdk/openai-compatible | 建立模型 |
| `createMCPClient`、`StdioMCPTransport` | @ai-sdk/mcp | MCP 連線 |
| `Hono`、`streamSSE`、`cors`、`serve` | hono | HTTP server |

各套件的版本記在 `vendor/VERSIONS.json`。

需要這份清單以外的第三方套件時，必須重新打包，而且要在能連外部網路的電腦上進行：

1. 在 `SKILL_DIR/scripts/vendor/` 執行 `npm install`，再安裝需要的套件。
2. 在 `SKILL_DIR/scripts/vendor/entry.ts` 加上要匯出的名稱。
3. 執行 `npm run build`，會重新產生 `SKILL_DIR/templates/agent/vendor/` 的內容。
4. 把新的 `vendor/` 複製到專案。

這會改動骨幹，先取得使用者同意再做。
