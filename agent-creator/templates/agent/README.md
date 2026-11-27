# Agent 專案

這個專案由 AgentCreator skill 的骨幹建立。

```
npm test                              骨幹自我測試，不需要模型與網路
npm run smoke                         用真實模型確認端點、金鑰、工具呼叫
npm run agent -- run "任務內容"       執行一個任務
npm run agent -- list                 列出 session
npm run agent -- resume <id>          續跑中斷的 session
npm run serve                         啟動 HTTP server 與測試頁
```

- 模型端點與金鑰寫在 `.env`（從 `.env.example` 複製）。
- 客製內容寫在 `agent.config.ts`、`skills/`，以及你自己的前端。
- `src/core/` 與 `vendor/` 是骨幹，不要修改。
- 每次執行的完整紀錄在 `sessions/<id>/events.jsonl`。
