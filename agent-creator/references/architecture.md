# 架構

## 分層

```
前端        src/cli.ts（終端機）    src/server.ts（HTTP）    你自己的前端
              │  指令：送訊息、核准、中斷、續跑        ▲ 事件：每筆帶序號
              ▼                                        │
core        SessionRunner ── Agent 迴圈 ── Tool Registry ── 內建工具 / MCP / Skill / Subagent
              │
磁碟        sessions/<id>/  events.jsonl、meta.json、tool-results/、workspace/、subagents/
```

- **core**（`src/core/`）不讀鍵盤、不印畫面、不開連接埠。它只認得指令與事件。
- **前端**把人的操作轉成指令，把事件畫出來。終端機與 HTTP 是同等的前端，沒有誰比較特殊。
- **磁碟**上的 `events.jsonl` 是唯一的真相來源。

## 迴圈的一圈

`src/core/loop.ts` 的迴圈不記任何狀態。每一圈都重新讀事件紀錄，判斷現在該做什麼：

1. 最後一則助理訊息還有沒做完的工具呼叫 → 逐一處理（核准、執行、記錄結果），然後回到開頭。
2. 最後一則對話是助理的純文字回覆 → 這一輪完成。
3. 否則檢查上限（步數、時間、token 預算），沒超過就呼叫模型一次，把回覆記成一筆事件，回到開頭。

因為判斷完全來自事件紀錄，行程在任何一步結束，重新啟動後呼叫續跑就會從同一個位置接下去。

## Subagent

主 agent 呼叫 `delegate` 工具時，骨幹建立一個子 session，用**同一個迴圈**跑到結束，再把它最後一則回覆當成工具結果交回主 agent。

```
sessions/<主 id>/
  events.jsonl              主 agent 的紀錄，只多出交辦的起訖
  workspace/                主與子共用
  subagents/<子 id>/
    events.jsonl            subagent 完整的過程
    tool-results/
```

| 面向 | 做法 |
| --- | --- |
| 上下文 | 各自獨立。subagent 只看到交辦內容，主 agent 只看到報告 |
| 同時進行 | 同一則回覆裡的多個 `delegate` 會同時跑，上限 `subagents.maxParallel`，超過的排隊。其他工具一律照順序執行，因為有副作用的操作順序有意義 |
| 數量上限 | 一輪最多 `subagents.maxPerTurn` 次；subagent 不能再交辦；用掉的 token 計入主 session 的預算 |
| 核准 | subagent 沒有前端，它的核准請求記在主 session 的紀錄，由主 session 的前端回覆 |
| 中斷 | 主 session 中斷時 subagent 一起停 |
| 續跑 | 子 session 的編號由呼叫位置決定，所以續跑時會找到同一個子 session 接著做。已經做完的直接取用報告 |
| 失敗 | 某個 subagent 沒完成時，它的結果記為失敗並附上原因與最後進度，其餘照常 |

成效取決於兩段文字：主 agent 寫的交辦內容夠不夠完整，以及 subagent 的報告夠不夠具體。骨幹用工具的參數欄位（目標、已知資訊、期望的回報）與固定的回報格式來約束這兩段，但最終仍看模型的能力。

## 上下文管理

完整歷史和「送給模型的內容」是兩件事。歷史永遠完整保留，送給模型的內容每一圈重新計算：

1. **過大的工具輸出**：超過 `maxInlineToolOutputChars` 時，全文寫到 `tool-results/`，事件裡只留開頭與檔案路徑。模型可以用 `read_file` 分段讀回來。
2. **省略舊輸出**：估計的 token 數超過 `maxContextTokens` 時，只保留最近 `keepRecentToolResults` 筆工具輸出，更早的換成一行說明。
3. **摘要**：省略後仍然超過時，請模型把較早的對話寫成摘要，保留最近 `keepRecentMessages` 則訊息。摘要存成一筆 `context.compacted` 事件，原本的事件不動。

token 數是用字元數估算的，只用來決定要不要壓縮，不是精確值。

## Session 的狀態

| 狀態 | 意思 |
| --- | --- |
| `idle` | 沒有在執行，可以送新訊息 |
| `running` | 正在執行一輪 |
| `waiting_approval` | 有工具在等使用者核准 |
| `interrupted` | 上一輪沒有正常結束（行程中途結束），可以續跑 |

狀態是從事件紀錄與執行鎖算出來的。`meta.json` 裡的狀態只是給列表用的快取。

同一個 session 同時只能有一個行程在執行，靠 session 資料夾裡的 `run.lock` 保證。持有鎖的行程不存在時，鎖會被視為失效。

## 續跑時怎麼處理沒做完的工具

| 中斷當下的情況 | 續跑後 |
| --- | --- |
| 工具還沒開始（包含正在等核准） | 照常處理，需要核准的會重新等待核准 |
| 工具已經開始但沒有結果 | 不重跑。記一筆「結果未知」回給模型，由模型先檢查實際狀態再決定 |
| 交辦給 subagent，但 subagent 還沒做完 | 接續同一個子 session |

不自動重跑是刻意的：有副作用的操作重複執行比少執行一次更危險。

## 停止條件

一輪會在下列任一情況結束，原因記在 `turn.finished` 事件：

| 原因 | 意思 |
| --- | --- |
| `done` | 模型回覆了文字且沒有再呼叫工具 |
| `max_steps` | 這一輪呼叫模型的次數達到 `limits.maxSteps` |
| `timeout` | 這一輪超過 `limits.maxTurnMs` |
| `token_budget` | 這一輪累計的 token 達到 `limits.maxTurnTokens` |
| `interrupted` | 使用者中斷 |
| `error` | 發生未處理的錯誤，詳情在前一筆 `error` 事件 |

除了 `done` 以外，其餘情況通常都可以續跑。

## 檔案對照

| 檔案 | 職責 |
| --- | --- |
| `src/core/agent.ts` | 組裝模型、工具、skill、MCP；建立與取得 session |
| `src/core/runner.ts` | 一個 session 的指令入口與事件發布，管理狀態與執行鎖 |
| `src/core/loop.ts` | 迴圈、工具執行、停止條件 |
| `src/core/context.ts` | 由事件算出送給模型的訊息；省略與摘要的規則 |
| `src/core/store.ts` | session 資料夾、事件的追加與讀回、執行鎖 |
| `src/core/events.ts` | 事件的型別定義 |
| `src/core/tools/` | 工具登錄、內建工具、核准規則 |
| `src/core/mcp.ts` | 連線 MCP server 並註冊工具 |
| `src/core/skills.ts` | 掃描 skill、產生索引、`load_skill` 工具 |
| `src/core/subagents.ts` | `delegate` 工具、子 session 的建立與接續、回報格式 |
| `src/core/model.ts` | 由設定建立模型 |
| `src/core/config.ts` | 設定的型別、預設值、載入 |
| `src/cli.ts` | 終端機前端 |
| `src/server.ts` | HTTP 前端 |
| `vendor/deps.mjs` | 打包好的第三方套件 |
