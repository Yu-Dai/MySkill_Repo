---
name: example-skill
description: 範例 skill，示範 skill 的寫法。使用者要求「寫工作紀錄」或「產生工作日誌」時使用。
---

# 工作紀錄

把使用者描述的工作內容整理成固定格式的紀錄檔。

## 步驟

1. 用 `read_file` 讀取 `SKILL_DIR/template.md`，了解格式。
2. 依照範本格式，把使用者提供的內容填進去。使用者沒提到的欄位寫「無」，不要自己編。
3. 用 `write_file` 存成 `work-log.md`。
4. 回報檔案位置。
