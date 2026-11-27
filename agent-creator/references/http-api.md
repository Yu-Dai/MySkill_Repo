# HTTP API

用 `npm run serve` 啟動。終端機會印出網址與測試頁連結。

## 安全

- server 只監聽 `127.0.0.1`，其他電腦連不到。這是刻意的：能呼叫這組 API 的人等於能在這台電腦執行指令。
- 所有 `/sessions` 開頭的請求都要帶 token。token 來自環境變數 `AGENT_SERVER_TOKEN`；沒設定時每次啟動隨機產生。
- token 的帶法：header `Authorization: Bearer <token>`，或網址參數 `?token=<token>`。網址參數是給瀏覽器的 `EventSource` 用的，因為它不能自訂 header。
- 介面與 API 不同來源時（例如開發時介面跑在另一個埠），把介面的來源加進 `agent.config.ts` 的 `server.corsOrigins`。
- 要讓其他電腦使用時，不要改監聽位址。在前面架一層有自己身分驗證的反向代理。

## 端點

| 方法與路徑 | 請求內容 | 成功回應 |
| --- | --- | --- |
| `POST /sessions` | `{ "message": "任務內容" }` | 201，session 資訊。任務已開始執行 |
| `GET /sessions` | 無 | 200，`{ "sessions": [...] }` |
| `GET /sessions/:id` | 無 | 200，session 資訊 |
| `GET /sessions/:id/events` | 參數 `after=序號`（可省略） | 200，事件流（SSE） |
| `GET /sessions/:id/subagents/:subagentId/events` | 參數 `after=序號`（可省略） | 200，`{ "events": [...] }`。一次回傳，不是事件流 |
| `POST /sessions/:id/messages` | `{ "text": "訊息" }` | 202，session 資訊 |
| `POST /sessions/:id/approvals/:callId` | `{ "decision": "allow" 或 "deny" }` | 200，`{ "ok": true }` |
| `POST /sessions/:id/interrupt` | 無 | 200，`{ "interrupted": true 或 false }` |
| `POST /sessions/:id/resume` | 無 | 202，session 資訊 |

session 資訊的欄位：`id`、`title`、`modelId`、`createdAt`、`updatedAt`、`status`、`lastTurnEnd`、`canResume`。

送出訊息與續跑都是立刻回應，實際結果要從事件流取得。

核准端點的 `:callId` 用 `tool.approval_requested` 事件裡的 `callId` 原樣帶入。subagent 的核准編號含有冒號，放進網址前要先做 URL 編碼（瀏覽器用 `encodeURIComponent`）。

subagent 沒有自己的事件流。它的即時進度會以 `subagent.event` 出現在主 session 的事件流裡；要補讀先前的內容，用上表的 subagent 事件端點。

## 錯誤

錯誤回應的格式固定為 `{ "error": { "code": "...", "message": "..." } }`。

| HTTP 狀態 | `code` | 意思 |
| --- | --- | --- |
| 400 | `invalid_request` | 請求內容缺欄位或格式不對 |
| 401 | `unauthorized` | token 不正確或沒帶 |
| 404 | `session_not_found` | 沒有這個 session |
| 404 | `subagent_not_found` | 這個 session 底下沒有這個 subagent |
| 404 | `approval_not_pending` | 這個工具呼叫目前沒有在等核准（可能已被回覆或已中斷） |
| 409 | `session_running` | session 正在執行，不能再送訊息或續跑 |
| 409 | `nothing_to_resume` | 沒有未完成的工作 |

## 事件流

`GET /sessions/:id/events` 回傳 Server-Sent Events。連上後先送出既有的事件，再持續送出新事件。

每則訊息：

- `event:` 事件的 `type`
- `data:` 事件的 JSON，欄位見 `events.md`
- `id:` 事件的 `seq`。只即時傳送的事件（`text.delta`、`fatal`）沒有 `id`

另外每 15 秒會有一則 `event: ping`，用來保持連線，可以忽略。

只要從某個序號之後開始，帶 `?after=序號`。瀏覽器的 `EventSource` 斷線重連時會自動送出 `Last-Event-ID`，server 會從那之後接續，不需要自己處理。

### 瀏覽器範例

```js
const token = '...';
const source = new EventSource(`/sessions/${id}/events?token=${encodeURIComponent(token)}`);

let draft = '';
source.addEventListener('text.delta', (message) => {
  draft += JSON.parse(message.data).text;
  showDraft(draft);
});
source.addEventListener('assistant.message', (message) => {
  draft = '';
  showMessage(JSON.parse(message.data));
});
source.addEventListener('tool.approval_requested', (message) => {
  const event = JSON.parse(message.data);
  askUser(event.name, event.input, (decision) => fetch(`/sessions/${id}/approvals/${encodeURIComponent(event.callId)}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ decision }),
  }));
});
```

每一種要處理的事件都要各自 `addEventListener`，`onmessage` 收不到有名稱的事件。

完整可運作的例子在專案的 `public/index.html`。
