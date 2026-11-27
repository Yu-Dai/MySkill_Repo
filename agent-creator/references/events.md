# 事件

`sessions/<id>/events.jsonl` 每一行是一筆 JSON 事件。前端收到的事件流也是同一份資料。

## 共通欄位

| 欄位 | 說明 |
| --- | --- |
| `seq` | 序號，從 1 開始遞增，不會重複也不會跳號 |
| `ts` | 寫入時間（ISO 8601，UTC） |
| `type` | 事件種類 |

## 會寫入紀錄的事件

| `type` | 其他欄位 | 發生時機 |
| --- | --- | --- |
| `session.created` | `title`、`modelId` | 建立 session |
| `user.message` | `text` | 使用者送出訊息 |
| `turn.started` | 無 | 開始一輪（含續跑） |
| `assistant.message` | `text`、`toolCalls`、`usage`、`finishReason` | 模型完成一次回覆 |
| `tool.approval_requested` | `callId`、`name`、`input` | 工具需要核准，正在等待 |
| `tool.approval_resolved` | `callId`、`decision` | 使用者回覆了 `allow` 或 `deny` |
| `tool.started` | `callId`、`name` | 工具開始執行 |
| `tool.result` | `callId`、`name`、`ok`、`output`、`durationMs`，可能有 `outputPath`、`unknownOutcome` | 工具有了結果（成功、失敗、被拒絕、被取消都算） |
| `context.compacted` | `summary`、`uptoSeq` | 較早的對話被摘要。序號小於等於 `uptoSeq` 的事件不再送給模型 |
| `turn.finished` | `reason` | 一輪結束 |
| `error` | `where`、`message`、`stack` | 發生未處理的錯誤 |

欄位補充：

- `assistant.message.toolCalls` 是陣列，每個元素有 `id`、`name`、`input`。模型給的參數不合格式時多一個 `invalid` 欄位，內容是錯誤說明。
- `assistant.message.usage` 是 `{ inputTokens, outputTokens }`。模型端沒有回報時兩者為 `null`。
- `tool.result.ok` 為 `false` 時，`output` 是回給模型的錯誤說明。
- `tool.result.outputPath` 存在時，表示完整輸出寫在那個檔案，`output` 只是開頭。
- `tool.result.unknownOutcome` 為 `true` 時，表示工具執行到一半行程就結束了，實際有沒有生效不確定。
- `turn.finished.reason` 的值見 `architecture.md` 的「停止條件」。

## 只即時傳送、不寫入紀錄的事件

這些事件沒有 `seq` 和 `ts`。

| `type` | 其他欄位 | 說明 |
| --- | --- | --- |
| `text.delta` | `text` | 模型正在生成的文字片段 |
| `fatal` | `message` | 事件無法寫入磁碟。此時紀錄已不可靠，應提示使用者檢查磁碟 |

文字片段不寫入紀錄，所以中途才連上的前端看不到正在生成的那一則的前半段。那一則完成後會有完整的 `assistant.message`。前端收到 `assistant.message` 時，應該用它的 `text` 取代先前累積的片段。

## 前端怎麼用事件

- **顯示對話**：`user.message` 與 `assistant.message`。
- **顯示工具活動**：`assistant.message.toolCalls` 列出要呼叫什麼，`tool.result` 是結果，用 `callId` 對應。
- **詢問核准**：收到 `tool.approval_requested` 時顯示詢問，之後若收到同一個 `callId` 的 `tool.approval_resolved` 或 `tool.result` 就收起來。
- **判斷是否執行中**：最後一筆 `turn.started` 之後還沒有 `turn.finished` 就是執行中。
- **斷線重連**：記住最後收到的 `seq`，重連時帶上它，只會收到之後的事件。

## 一輪的典型順序

```
user.message
turn.started
assistant.message          （含一個工具呼叫）
tool.approval_requested    （寫入類工具才有）
tool.approval_resolved
tool.started
tool.result
assistant.message          （純文字）
turn.finished              reason = done
```
