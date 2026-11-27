---
name: agent-creator
description: 建立 AI Agent 的骨幹與使用說明（AgentCreator）。只要使用者要建立、開發或擴充 AI agent、能呼叫工具的自動化助理、agent 的後端或 API，或提到 agent、tool calling、MCP、載入 skill、session、對話紀錄、agent 的 UI 串接，就使用。提供可直接複製的 Node.js 骨幹（依賴已打包在內，離線可用）、擴充方式、HTTP API 與檢查腳本。
---

# AgentCreator

這個 skill 提供一份已經能跑的 agent 骨幹。
做法是「複製骨幹、設定模型、只在擴充點上開發、跑檢查」。**不要從零開始寫 agent 迴圈，不要修改骨幹。**

以下 `SKILL_DIR` 代表這個 SKILL.md 所在的資料夾，執行指令時換成實際路徑。

環境前提：

- Node.js 22.18 以上，建議安裝最新的 LTS。骨幹是 TypeScript，由 Node 直接執行，不需要編譯。
- 公司內網，不能連外部網路：**不要 `npm install`**。骨幹需要的第三方套件已打包成 `vendor/deps.mjs`。
- 模型端點是 OpenAI 相容的 API。金鑰可以放在自訂 header。

## 骨幹提供什麼

| 能力 | 說明 |
| --- | --- |
| Agent 迴圈 | 呼叫模型、執行工具、回填結果，直到完成或達到上限 |
| 工具 | 內建讀檔、寫檔、列資料夾、執行指令；可加自訂工具 |
| MCP | 在設定檔列出 MCP server 就會連線並註冊它的工具 |
| Skill | 把 skill 資料夾放進 `skills/`，模型需要時才載入內容 |
| Subagent | 主 agent 把子任務交給 subagent，各自有獨立的上下文，可同時進行多個，做完只交回報告 |
| Session | 一個任務一個資料夾，可多輪對話，中斷後可續跑 |
| 紀錄 | 每一步都寫入 `events.jsonl`，出錯時有跡可循 |
| 上下文管理 | 過大的輸出寫檔、舊輸出省略、超過上限時自動摘要 |
| 核准 | 會改變東西的工具先問使用者 |
| 前端 | 終端機指令，以及給 UI 用的 HTTP API 與事件流 |

## 流程

照順序做，不要跳過。

### 1. 用腳本建立專案

```
node "SKILL_DIR/scripts/new.js" 專案資料夾
```

### 2. 設定模型

把專案裡的 `.env.example` 複製成 `.env`，請使用者填入四個值：端點網址、模型名稱、金鑰、金鑰的 header 名稱。
**不要自己讀取、列印或猜測金鑰，不要把金鑰寫進任何會進版控的檔案。**

### 3. 確認骨幹與模型都正常

在專案資料夾執行：

```
npm test          骨幹自我測試。不需要模型，不需要網路。
npm run smoke     用真實模型跑最小情境：純文字回覆、工具呼叫、工具後接續回覆。
```

`npm run smoke` 有 FAIL 時，讀 `references/troubleshooting.md`。前三項沒有全部 PASS 之前不要往下做。
第 5、6 項檢查 subagent。第 5 項 FAIL 而使用者需要 subagent 時要先解決；第 6 項 FAIL 只代表這個模型一次交辦一個，功能仍然可用。

### 4. 依使用者的需求擴充

先弄清楚使用者要這個 agent 做什麼，再決定用哪一種擴充方式。能用前面的方式解決，就不要用後面的。

| 使用者要的 | 做法 | 讀這個檔案 |
| --- | --- | --- |
| 改變 agent 的角色、語氣、工作守則 | 改 `agent.config.ts` 的 `systemPrompt` | `references/extending.md` |
| 教 agent 一套固定的工作流程 | 在 `skills/` 新增一個 skill 資料夾 | `references/extending.md` |
| 讓 agent 使用既有的 MCP server | 在 `agent.config.ts` 的 `mcpServers` 加一筆 | `references/extending.md` |
| 讓 agent 能做一件新的事（查資料庫、呼叫內部 API） | 用 `defineTool` 寫自訂工具 | `references/extending.md` |
| 讓特定類型的子任務由專門的 subagent 處理（例如只能讀取的研究員） | 在 `agent.config.ts` 的 `subagents.types` 加一種類型 | `references/extending.md` |
| 調整步數、逾時、上下文大小、哪些工具免核准 | 改 `agent.config.ts` 的 `limits`、`context`、`approval` | `references/extending.md` |
| 做網頁介面或接到別的系統 | 透過 HTTP API 與事件流 | `references/http-api.md`、`references/events.md` |
| 做 HTTP 以外的前端（例如聊天軟體機器人） | 直接使用 `Agent` 與 `SessionRunner` | `references/extending.md` |
| 想了解骨幹怎麼運作 | 不需要改程式，先讀說明 | `references/architecture.md` |

要做網頁介面時，畫面請使用 `sam-ui` skill 製作。專案內附的 `public/index.html` 只是確認 API 能通的測試頁，不是正式介面。

### 5. 跑檢查

```
node "SKILL_DIR/scripts/check.js" 專案資料夾
```

### 6. 修正到通過

檢查不通過時，每個問題會列出「哪裡、為什麼、下一步」。照「下一步」修改，然後重新執行第 5 步。
**沒有顯示「結果：全部通過」就不算完成。** 不要為了通過而刪掉測試或使用者要的功能。

## 最重要的規則

1. **不修改 `src/core/` 和 `vendor/`。** 所有客製都寫在 `agent.config.ts`、自訂工具、`skills/`、前端。擴充點做不到時，停下來告訴使用者缺什麼，由使用者決定要不要改骨幹。
2. **不 `npm install`，不新增第三方套件。** 第三方功能一律從 `#deps` 匯入：`import { z } from '#deps'`。可用的名稱列在 `references/extending.md`。能用 Node 內建模組做到的就用內建模組。
3. **金鑰只放在 `.env`。** 不寫進程式、設定檔、紀錄或回覆內容。
4. **不改寫 `events.jsonl`。** 它是唯一的真相來源，只會往後追加。要看發生什麼事就讀它，不要編輯它。
5. **前端只做兩件事：送指令、收事件。** 不要讓 UI 直接讀寫 session 資料夾，也不要在前端重做迴圈邏輯。
6. **HTTP server 只綁本機。** 這個 server 能讓呼叫者執行指令。不要把監聽位址改成對外，不要拿掉 token 驗證。
7. **自訂工具要標對風險。** 只讀取資料的標 `read`；會寫入、刪除、送出、花錢，或影響工作區以外任何東西的標 `write`。不確定就標 `write`。
8. **TypeScript 只用可直接抹除的語法。** 不用 `enum`、`namespace`、建構子參數屬性；相對路徑的 import 要寫出 `.ts` 副檔名；只當型別用的 import 寫成 `import type`。

## 指令速查

在專案資料夾執行：

```
npm run agent -- run "任務內容"        開新 session 並執行
npm run agent -- run "任務內容" --yes  所有工具都不詢問（無人值守時使用）
npm run agent -- send <id> "訊息"      對既有 session 追加訊息
npm run agent -- resume <id>           續跑中斷的 session
npm run agent -- list                  列出 session 與狀態
npm run serve                          啟動 HTTP server，終端機會印出測試頁網址
```

## 出問題時

先看該次 session 的 `sessions/<id>/events.jsonl`。每一行是一筆事件，依序記錄了模型說了什麼、呼叫了什麼工具、結果是什麼、哪裡出錯。
事件各欄位的意義在 `references/events.md`，常見問題在 `references/troubleshooting.md`。
