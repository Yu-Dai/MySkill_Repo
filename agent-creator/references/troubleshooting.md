# 常見問題

排查順序：先看終端機訊息，再看 `sessions/<id>/events.jsonl` 裡的 `error` 事件與最後幾筆事件。

## 啟動與環境

**執行 `.ts` 檔時出現語法錯誤或「Unknown file extension」**
Node 版本太舊。骨幹需要 22.18 以上。用 `node --version` 確認，安裝最新的 LTS。

**「讀取設定檔失敗」**
訊息後半段是真正的原因。常見的是 `agent.config.ts` 裡匯入的檔案路徑寫錯，或相對路徑的 import 少了 `.ts` 副檔名。

**「model.baseURL 是空的」或「model.modelId 是空的」**
`.env` 沒有建立、不在專案根目錄，或變數名稱打錯。指令要在專案根目錄執行。

**`npm test` 在這台電腦上失敗**
骨幹在 Linux、Node 22 上測試通過。Windows 專用的部分（PowerShell 指令、結束子行程）是照 Windows 的行為寫的，但需要在 Windows 上實際跑過 `npm test` 才算確認。把失敗的測試名稱與完整輸出交給使用者，不要自己改骨幹繞過。

## 模型端點

**401 或 403**
依序確認：金鑰是否正確、`AGENT_API_KEY_HEADER` 是否為端點要求的 header 名稱、`AGENT_BASE_URL` 是否為正確的環境。端點用自訂 header 時，`AGENT_API_KEY_HEADER` 不能留空，否則金鑰會被放進 `Authorization`。

**404**
`AGENT_BASE_URL` 多半寫錯。它應該是 `/chat/completions` 之前的部分。

**400，訊息提到不認得的參數**
有些端點不接受用量回報的參數。在 `agent.config.ts` 的 `model` 加上 `includeUsage: false`。少了用量回報不影響運作，token 預算會改用估算。

**模型只回文字，從不呼叫工具**
依序確認：這個模型與端點是否支援工具呼叫（function calling）；任務描述是否明確需要工具；`systemPrompt` 是否寫了阻止使用工具的內容。`npm run smoke` 的第 2 項專門檢查這件事。

**工具執行了，但之後沒有文字回覆**
看最後一筆 `assistant.message`。`text` 是空的且沒有工具呼叫，表示模型回了空內容，這是模型端的行為。可以在 `systemPrompt` 明確要求「工具執行完後一定要用文字回報結果」。

**`tool.result` 一直是「工具參數格式錯誤」**
模型產生的參數不符合定義。骨幹會把錯誤回給模型讓它重試。若反覆發生，簡化該工具的參數（減少欄位、避免巢狀物件），並把每個欄位的 `.describe()` 寫得更具體。

**回覆到一半被截斷，`finishReason` 是 `length`**
達到模型的輸出長度上限。把任務拆小，或請模型把長內容分次用 `write_file` 寫出。

## 執行過程

**一輪以 `max_steps`、`timeout`、`token_budget` 結束**
達到上限。確認 agent 不是在重複做同一件事（看事件紀錄裡的工具呼叫是否一再重複）。若是正常的長任務，調高 `limits` 的對應值，然後續跑。

**session 一直顯示執行中，但其實沒有行程在跑**
session 資料夾裡的 `run.lock` 記著持有者的行程編號。該行程已不存在時鎖會自動失效。若編號剛好被別的行程重用，確認沒有其他 agent 在跑之後刪除 `run.lock`。

**開啟 session 時出現「不是合法 JSON，且不在檔尾」**
`events.jsonl` 中間有一行損毀。檔尾的半行會自動處理，中間的損毀不會。不要自動修改這個檔案，把錯誤訊息交給使用者決定。

**`run_command` 的中文輸出是亂碼（Windows）**
骨幹已把 PowerShell 的輸出設為 UTF-8。仍然亂碼時，通常是被呼叫的程式自己用了別的編碼輸出，要在該指令上處理。

**`run_command` 找不到指令**
指令在 Windows 上由 PowerShell 執行，其他系統由 `sh` 執行，語法要對應。系統提示已告訴模型目前用的是哪一種。

**「路徑不在允許的範圍內」**
檔案工具只能寫入 session 的 `workspace/`，只能讀取 `workspace/`、`tool-results/` 與 skill 資料夾。要讓 agent 處理別處的檔案，寫一個自訂工具，在工具裡明確限定它能碰的位置。

**MCP server 連線失敗的警告**
確認 `command` 在終端機能直接執行、路徑正確、需要的環境變數有給。在 Windows 上 `command` 要是實際的執行檔，例如用 `node` 加上腳本路徑。

**事件流連上後立刻斷開，或收到 401**
`EventSource` 要把 token 放在網址參數。確認網址上的 token 與啟動時印出的一致；沒有設定 `AGENT_SERVER_TOKEN` 時，每次重啟 server token 都會變。

## 上下文

**模型端回報內容太長**
`context.maxContextTokens` 設得比模型實際上限高，或估算值偏低。調低這個值。

**agent 忘記較早的內容**
較早的對話被摘要了，事件紀錄裡會有 `context.compacted`。調高 `context.maxContextTokens` 或 `keepRecentMessages` 可以延後摘要。完整內容仍在 `events.jsonl`。
