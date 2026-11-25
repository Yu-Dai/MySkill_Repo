# smoke.json 格式

完整範例見 `examples/sample.json`，對應的專案在 `examples/sample-project/`。

```json
{
  "project": { "name": "專案名稱", "commit": "abc1234", "date": "2026-11-25" },
  "modules": [
    { "id": "parser", "name": "解析", "desc": "讀檔與驗證" }
  ],
  "entries": [
    {
      "id": "import",
      "name": "匯入檔案",
      "phase": "run",
      "trigger": "使用者按下匯入按鈕",
      "file": "ui/import.js", "line": 7, "symbol": "addEventListener",
      "steps": [
        { "id": "s1", "module": "ui", "title": "收到按鈕點擊", "desc": "從按鈕屬性取出檔案路徑。",
          "file": "ui/import.js", "line": 10, "symbol": "onImportClick" },
        { "id": "s2", "module": "parser", "title": "驗證資料格式", "desc": "濾掉欄位不足的列。",
          "file": "parser/validate.js", "line": 4, "symbol": "validate" },
        { "id": "s3", "module": "parser", "title": "轉換舊版格式", "desc": "去掉每列的第一欄後回傳。",
          "file": "parser/legacy.js", "line": 3, "symbol": "convertLegacy",
          "kind": "dead", "reason": "validate.js 第 6 行沒有接收回傳值。" },
        { "id": "s4", "module": "store", "title": "寫入暫存區", "desc": "放進 pending 陣列。",
          "file": "store/save.js", "line": 6, "symbol": "save",
          "from": "s2", "kind": "end", "reason": "返回事件迴圈。" }
      ]
    }
  ]
}
```

## 欄位

字數以全形字為單位：中文字算 1，英數與半形符號算 0.5。

### project

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `name` | 是 | 專案名稱，上限 30 |
| `commit` | 否 | 灌煙當下的版本（`git rev-parse --short HEAD`）。不是 git 專案就省略 |
| `date` | 否 | 灌煙日期，`YYYY-MM-DD` |

### modules（1 到 8 個）

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | 是 | 英數、底線、連字號，不重複 |
| `name` | 是 | 顯示名稱，上限 14 |
| `desc` | 是 | 一句話職責，上限 16 |

陣列順序就是畫面由上到下的順序。把入口所在的模組排前面，資料最後落地的模組排後面，煙會大致由左上流向右下。

### entries

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | 是 | 英數、底線、連字號，不重複 |
| `name` | 是 | 使用者看得懂的事件名稱，上限 14 |
| `phase` | 是 | `boot`、`run`、`exit` |
| `trigger` | 是 | 什麼情況會觸發，上限 80 |
| `file`、`line`、`symbol` | 是 | 入口註冊的位置 |
| `steps` | 是 | 步驟陣列。還沒灌煙寫 `[]`，上限 40 步 |

### steps

| 欄位 | 必填 | 說明 |
| --- | --- | --- |
| `id` | 是 | 英數、底線、連字號，同一個入口內不重複 |
| `module` | 是 | `modules` 裡的 `id` |
| `title` | 是 | 這一步做了什麼，上限 14 |
| `desc` | 是 | 怎麼做的，上限 80 |
| `file` | 是 | 相對於專案根目錄的路徑，用正斜線 |
| `line` | 是 | 行號，從 1 開始 |
| `symbol` | 是 | 那一行（上下 2 行內）實際出現的文字 |
| `kind` | 否 | `step`（預設）、`end` 終點、`dead` 死路、`fog` 霧 |
| `reason` | `kind` 不是 `step` 時必填 | 為什麼停在這裡，上限 80 |
| `from` | 見下方 | 煙從哪一步過來，寫那一步的 `id` |

## from 的規則

- 不寫 `from`：煙從上一步（陣列裡的前一個）過來。
- 第一步不能有 `from`。
- 上一步是 `end`、`dead`、`fog` 時，一定要寫 `from`，指向煙折返後重新出發的那一步。
- `from` 只能指向排在前面的步驟。
- `end`、`dead`、`fog` 後面不能再接步驟；`step` 後面一定要有步驟。
