# AI Team Discord + Codex + Ollama 協作編程系統設計書

## 1. 目標

本文件整理一套適合小型網頁遊戲專案的 AI 協作開發流程。目標是讓使用者可以透過 Discord 下達指令，讓 Codex 負責規劃、審查、測試與 Git 管理，並讓 Ollama 自架模型作為受控的程式碼產出者。

核心原則：

- Discord 是指令介面與進度看板。
- Codex 是唯一 Git 管理者、驗證者與最終決策者。
- Ollama Local Agent 是受控產碼者，只處理明確、範圍有限的任務。
- Orchestrator 是任務狀態機，負責派工、記錄狀態、限制權限與回報進度。
- 所有任務都以可追蹤的 job 為單位執行。

## 2. 系統角色

| 角色 | 職責 | 權限 |
|---|---|---|
| 使用者 / PM | 在 Discord 下指令、核准、退回、查看進度 | Discord 指令 |
| Discord Bot | 接收指令、回報狀態、顯示測試結果 | Discord API |
| Orchestrator | 管理任務狀態、派工、權限、重試流程 | 讀寫任務資料庫 |
| Codex Agent | 規劃、拆任務、審查 diff、執行測試、Git commit | 檔案、Shell、Git |
| Ollama Local Agent | 根據 Codex 指定任務產生 patch 或修改指定檔案 | 限定檔案寫入 |

## 3. 為什麼需要 Orchestrator

Orchestrator 不一定要一開始就用 CrewAI 或 LangGraph。第一版可以是一個簡單的 Python 或 Node.js 程式。

它的工作不是「取代 Codex」，而是處理 Codex 與 Discord 之間容易失控的流程問題：

- 記錄每個 Discord 指令對應到哪個專案。
- 記錄任務目前狀態，例如 planning、coding、testing、waiting_approval。
- 限制不同 Agent 可以使用的工具。
- 保存任務歷史，避免 Bot 重啟後失去狀態。
- 將 Codex、Ollama、Discord 的輸入輸出整理成一致格式。

建議第一版使用 SQLite 或 JSON 檔作為 job store。等系統穩定後，再升級成 Postgres、LangGraph 或 CrewAI。

## 4. 建議架構

```text
Discord 指令
  -> Discord Bot
  -> Orchestrator 建立 Job
  -> Codex 讀取專案並產生 plan
  -> Ollama Local Agent 依照指定任務產碼
  -> Codex 檢查 diff
  -> Codex 執行測試與畫面驗證
  -> Discord 回報結果
  -> 使用者 !approve 或 !retry
  -> Codex 執行 Git commit 或修正流程
```

Discord 可以用來整理任務的下達、派發、回覆與討論，但不建議把 Discord 當成唯一的內部通訊協議。實際狀態應由 Orchestrator 保存。

## 5. Playbook 是否需要使用者設定

使用者不需要從零撰寫 Orchestrator 或複雜 playbook。第一版只需要填寫幾個設定：

- Discord bot token。
- Discord 頻道 ID 對應的專案路徑。
- 每個專案的 dev、test、build 指令。
- Ollama 或 LiteLLM 的模型位置。
- 哪些 Agent 可以使用哪些工具。

範例設定：

```json
{
  "projects": {
    "123456789012345678": {
      "name": "mini-web-game",
      "path": "C:/workspace/mini-web-game",
      "branch": "main",
      "devCommand": "npm run dev",
      "testCommand": "npm run test",
      "buildCommand": "npm run build"
    }
  },
  "models": {
    "localCoder": {
      "provider": "ollama",
      "model": "qwen2.5-coder:7b",
      "baseUrl": "http://localhost:11434"
    }
  }
}
```

展示階段先在開發電腦使用 `qwen2.5-coder:7b`，以 16 GB RAM 與 8 GB VRAM 完成工作流程驗證。正式階段預計將 Ollama 部署到獨立機器，Codex 再透過有線網路或 Wi-Fi 內網呼叫 Ollama API；屆時可依伺服器硬體升級為 14B 或更大的模型，而不需要改變 Orchestrator 的任務格式與權限邊界。

## 6. 權限設計

建議不要把 Git 寫入權限交給 Ollama Local Agent。快速驗證不等於需要 Git 權限。

| 權限 | Codex Agent | Ollama Local Agent |
|---|---:|---:|
| 讀取專案檔案 | 可以 | 可以，限專案目錄 |
| 修改檔案 | 可以 | 可以，限指定檔案或工作區 |
| 執行測試 | 可以 | 可選，建議第一版不給 |
| 查看 git diff/status | 可以 | 可選，只讀 |
| git add/commit/reset/checkout/merge | 可以 | 不可以 |
| 安裝套件 | Codex 經核准 | 不可以 |
| 刪除檔案 | Codex 經核准 | 不可以 |
| 任意 Shell 指令 | Codex 經核准 | 不可以 |

更安全的流程是：

1. Ollama Local Agent 只產生 patch 或修改指定檔案。
2. Codex 執行 `git diff` 檢查變更。
3. Codex 執行測試、build 與畫面驗證。
4. 通過後由 Codex commit。
5. 失敗時由 Codex 將錯誤摘要交給 Ollama 修正。

## 7. Discord 指令設計

基本指令：

| 指令 | 用途 |
|---|---|
| `!build [描述]` | 從乾淨工作樹建立新功能或新專案 |
| `!change [描述]` | 修改既有功能；`waiting_approval` 時延續並調整目前預覽 |
| `!fix [描述]` | 修復 bug；`waiting_approval` 時延續並修正目前預覽 |
| `!status` | 查看目前任務與專案狀態 |
| `!preview` | 啟動或回報預覽網址 |
| `!retry [補充]` | 僅在執行、驗證、部署失敗或取消後重跑上一個任務 |
| `!approve` | 核准目前變更並交給 Codex commit |
| `!rollback last` | 回復上一個已核准變更 |

範例：

```text
!change 新增本次得分排行榜：
- 遊戲結束時顯示 ID 輸入框
- ID 僅允許 A-Z，長度 1 到 6
- 輸入時自動轉大寫
- 儲存本次 score 與 ID
- 排行榜依 score 由高到低排序
- 顯示前 10 名
- 資料先存在 localStorage
```

## 8. 任務狀態機

建議每個任務有固定狀態：

```text
queued
 -> planning
 -> coding
 -> reviewing
 -> testing
 -> waiting_approval
 -> approved
 -> committed
```

預覽調整流程：

```text
waiting_approval
 -> !fix / !change
 -> coding
 -> testing
 -> waiting_approval
 -> !approve
```

`!retry` 不處理已成功的預覽；成功預覽要調整時使用 `!fix` 或 `!change`。

錯誤流程：

```text
testing_failed
 -> retrying
 -> coding
```

超過重試上限：

```text
blocked
 -> waiting_human_input
```

每個 job 建議保存：

- job id
- Discord channel id
- Discord message id
- 專案名稱
- 專案路徑
- 使用者原始指令
- Codex plan
- Local Agent 修改摘要
- git diff 摘要
- 測試結果
- 最終 commit hash

## 9. 小型網頁遊戲專案建議

第一版建議使用：

- Vite
- React
- TypeScript
- CSS Modules 或單純 CSS
- localStorage
- Playwright 或簡單瀏覽器驗證

如果遊戲有碰撞、動畫、場景、物理需求，可以改用 Phaser。若只是快速小遊戲，例如點擊、閃避、分數、排行榜，React + Canvas 或 React DOM 即可。

建議專案結構：

```text
mini-web-game/
  src/
    App.tsx
    game/
      gameState.ts
      scoring.ts
      leaderboard.ts
    components/
      GameCanvas.tsx
      ScorePanel.tsx
      Leaderboard.tsx
      PlayerIdInput.tsx
    styles/
      app.css
  tests/
    leaderboard.test.ts
  package.json
```

## 10. 排行榜功能規格

功能需求：

- 遊戲結束後顯示分數提交區。
- 玩家可以輸入 1 到 6 個大寫英文字母作為 ID。
- 輸入時自動轉成大寫。
- 非 A-Z 字元不得輸入或提交。
- 儲存 ID、score、createdAt。
- 使用 localStorage 保存本機排行榜。
- 依 score 由高到低排序。
- 同分時較新的紀錄可排在前面或後面，但需明確定義。
- UI 顯示前 10 名。
- 提交後立即更新排行榜。

驗證規則：

```ts
const PLAYER_ID_PATTERN = /^[A-Z]{1,6}$/;
```

資料格式：

```ts
type LeaderboardEntry = {
  id: string;
  score: number;
  createdAt: string;
};
```

## 11. Local Agent 任務格式

Codex 派給 Ollama Local Agent 的任務應該盡量具體，避免開放式描述。

建議格式：

```yaml
taskId: "job-20260713-001-step-02"
project: "mini-web-game"
allowedFiles:
  - "src/game/leaderboard.ts"
  - "src/components/Leaderboard.tsx"
  - "src/components/PlayerIdInput.tsx"
requirements:
  - "新增 localStorage leaderboard helper"
  - "ID 僅允許 A-Z，長度 1 到 6"
  - "排行榜顯示前 10 名"
forbidden:
  - "不要執行 git 指令"
  - "不要修改 package.json"
  - "不要刪除檔案"
output:
  - "修改檔案"
  - "變更摘要"
  - "建議測試方式"
```

## 12. Codex 驗證流程

Codex 在 Local Agent 修改後應執行：

1. 檢查修改範圍是否符合 allowedFiles。
2. 執行 `git diff`。
3. 檢查是否有危險操作，例如刪除大量檔案、修改設定檔、加入可疑腳本。
4. 執行 `npm run build`。
5. 執行 `npm run test`。
6. 啟動 dev server 並用瀏覽器驗證 UI。
7. 在 Discord 回報測試結果與畫面截圖。
8. 等待 `!approve`。
9. 收到核准後才執行 Git commit。

## 13. Git 流程

不建議自動執行 `git add .` 後直接 commit。建議改成：

```text
Codex 建立 task branch
 -> Local Agent 修改檔案
 -> Codex review diff
 -> Codex test/build
 -> Discord 等待 approve
 -> Codex git add 指定檔案
 -> Codex commit
```

commit message 範例：

```text
feat(game): add local leaderboard with player id validation
```

如果要保守一點，可以每次任務開始前建立 anchor：

```text
git status
git branch task/job-20260713-001
```

任務失敗或使用者輸入 `!rollback last` 時，由 Codex 根據最後一個已知安全 commit 進行回復。

## 14. 第一版最小可行實作

建議第一版不要一次做太大。可以依序完成：

1. 建立 Discord Bot，支援 `!status` 與 `!change`。
2. 建立 config.json，完成 channel id 到 project path 的映射。
3. 建立簡單 Orchestrator，使用 JSON 或 SQLite 保存 job 狀態。
4. Codex 手動或半自動讀取 job，產生 plan。
5. Ollama Local Agent 只負責產生指定檔案修改。
6. Codex 執行 diff、build、test。
7. Discord 回報結果並等待 `!approve`。
8. Codex commit。

第一版可以先不用 CrewAI 或 LangGraph。等流程穩定後，再把狀態機升級成正式框架。

### 目前完成狀態（2026-07-14）

- [x] Discord Bot 支援 `!status`、`!build`、`!change`、`!fix`、`!retry`、`!approve`。
- [x] `config.json` 完成單一 Discord channel 到本專案路徑的映射。
- [x] 使用 `jobs.json` 保存 Job 狀態。
- [x] Codex 可接收 Discord Job，並將限定檔案的產碼工作交給 Ollama Local Agent。
- [x] Local Agent 禁止 Git、Shell、敏感檔案與 allowedFiles 以外的寫入。
- [x] Codex 修改後執行專案驗證；驗證失敗不進入核准階段。
- [x] 驗證通過後建立 preview commit，推送 `preview` branch 並由 GitHub Pages 部署。
- [x] Discord 只在確認 Pages 部署的是相同 preview commit 後提供預覽網址。
- [x] `!approve` 重新比對 base commit、變更檔案、檔案雜湊與 preview tree，再 commit 並推送 `main`。
- [x] Job 保存變更檔案、驗證結果、預覽網址、preview commit 與最終 commit hash。

目前使用情境是單一使用者與單一專案，因此第一版不實作多人任務佇列、每個 Job 的 task branch、CrewAI、LangGraph、Playwright 自動操作或 `!rollback last`。

目前簡化狀態流程：

```text
running
 -> validating
 -> deploying_preview
 -> waiting_approval
 -> committed
```

錯誤狀態保留 `validation_failed`、`deployment_failed`、`commit_pending_push`、`failed` 與 `cancelled`。

## 15. 結論

這套設計的重點是把風險集中管理：

- 使用者透過 Discord 操作，降低使用門檻。
- Orchestrator 負責保存狀態，避免流程混亂。
- Ollama Local Agent 負責低成本產碼，但不碰 Git、不碰任意 Shell。
- Codex 負責規劃、驗證、測試、Git 與最終判斷。

這樣可以保留快速產出的優點，同時避免自架模型因錯誤指令、幻覺或過度修改造成不可逆的專案損害。
