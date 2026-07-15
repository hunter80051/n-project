# N-Project 對話串工作交接

更新日期：2026-07-15  
工作區：`C:\Users\hikar\OneDrive\文件\N-Project (Vibe coding)`

## 1. 新對話起始 SOP

新對話開始後依序執行：

1. 完整讀取 `AGENTS.md`。
2. 完整讀取本文件與 `PLANS.md`。
3. 執行 `git status --short --branch` 與 `git log -5 --oneline --decorate`。
4. 不重新製作已完成的大地圖、地下城或 Discord Bot 基礎功能。
5. 收到新規格時先更新 `PLANS.md`，再做最小範圍修改。
6. 程式修改後執行 `python validate_project.py`；視修改風險追加生成器、無頭流程或瀏覽器驗證。
7. 只有使用者要求部署時才更新 `preview`；正式提交與推送遵守目前 Git／Discord 核准流程。

建議新對話第一句：

```text
請先讀取 AGENTS.md、THREAD-HANDOFF.md 與 PLANS.md，確認 git status 與最近 commits，然後等待我的下一個修改需求。
```

## 2. 目前專案狀態

- 純靜態單機網頁 RPG，原生 ES Modules，無 npm 或 build step。
- Canvas 負責遊戲世界，DOM 負責狀態、隊伍、卷軸、事件與技能選擇。
- 資料以 `data/manifest.json` 與 8 張 CSV 外部配置，可改接 Google Sheets 公開 CSV。
- GitHub Pages 預覽：`https://hunter80051.github.io/n-project/`。
- 交接前正式基準 commit：`61e31f4`；交接規則修改完成後以 `git log -1` 顯示的最新 commit 為準。
- `main` 在交接前與 `origin/main` 同步。
- `Game Sample/` 與 `Prototype-MVP.txt` 是本機參考輸入，已加入 `.gitignore`，不可刪除。
- `data/README.md` 偶爾因 Windows 行尾／stat cache 顯示 `M`；若 `git diff -- data/README.md` 為空且 worktree/index hash 相同，代表沒有實質內容差異。

## 3. 已完成遊戲功能

### 大地圖

- 記憶體暫存、重新載入即清空的延展式 2.5D 組合地圖。
- 草地、道路、水面底層；樹木、灌木、地下城入口、大小石頭中層；小隊上層。
- 鏡頭跟隨小隊，隊伍維持中央，自動沿主路前往下一地下城。
- 路線可向八方向延伸，會避免緊鄰舊路與地下城，並減少連續一格即轉向。
- 草地島嶼、外圍水面與道路障礙物提供繞路的視覺理由。

### 地下城

- 三層流程；第 1、2 層程序生成，第 3 層固定 Boss 房。
- 2.5D 底層地塊／外圍厚度、中層牆門與樓梯／魔法陣、上層角色與敵人。
- 入口只揭露第一房；清區後到門前才揭露下一走廊、房間與敵人。
- 牆門有兩種等角方向；第 1、2 層使用下層樓梯，第 3 層使用 Boss 傳送魔法陣。
- 房間與走廊已調整為較大型、迷宮式分散，避免走廊穿越既有走廊或房間，並低機率包含需要折返的死路。
- 自動探索、戰鬥、HP/SP、技能選擇、裝備替換、卷軸與無角色死亡規則均已完成。

### Discord Bot

- 支援 `!build`、`!change`、`!fix`、`!status`、`!retry`、`!approve`、`!cancel`、`!help`。
- `!fix`／`!change` 在 `waiting_approval` 狀態會安全延續目前預覽。
- `!retry` 只處理 `failed`、`validation_failed`、`deployment_failed`、`approval_failed`、`cancelled`。
- 延續預覽前會比對 changed files、base commit 與檔案 hash。
- 預覽驗證後才允許 `!approve` 建立並推送正式 commit。
- Bot 啟停使用 `start_bot.ps1` 與 `stop_bot.ps1`。

## 4. Ollama Local Agent 新規則

Ollama 不再是每個 coding 任務的強制步驟。

只有符合以下條件才派工：

- 一至數個明確 allowedFiles。
- 驗收條件具體、低耦合、容易審查。
- 常數、文案、CSS、小型純函式、重複性轉換或單檔案局部邏輯。
- 預期能實際降低 Codex 的實作與審查成本。

不派工：

- 架構、多模組重構、程序地圖核心、狀態機、跨檔案整合。
- 需要根因診斷的 bug、安全、Git、Shell、部署。
- 只是為了展示流程而拆出的形式性任務。

Ollama 失敗一次後即可由 Codex 接手；最終回報簡述未派工或接手原因。

## 5. 主要檔案

| 檔案 | 用途 |
| --- | --- |
| `PLANS.md` | 遊戲規格、決策、測試與完成紀錄 |
| `src/world-map.js` | 大地圖生成、延展與移動路徑 |
| `src/dungeon.js` | 房間、走廊、揭露群組、牆門 metadata 與尋路 |
| `src/simulation.js` | 世界／地下城狀態、探索、戰鬥與成長 |
| `src/renderer.js` | 大地圖與地下城 2.5D Canvas 渲染 |
| `src/main.js` | 遊戲迴圈與 UI 狀態同步 |
| `src/ui.js` | DOM UI、事件、裝備通知與技能 modal |
| `src/data-loader.js` | manifest、CSV 解析與跨表驗證 |
| `discord_codex_bot.py` | Discord 指令、任務狀態、預覽與核准流程 |
| `ollama_local_agent.py` | 受限 allowedFiles Local Agent |
| `validate_project.py` | HTML、ES Module、CSV schema 與外鍵驗證 |

## 6. 已知限制與待決事項

- 角色目前仍是 Canvas 原型圖形；DTTO Friends 名稱與造型公開使用權尚未確認。
- Google Sheets 尚未提供正式 workbook URL，目前使用 repository CSV。
- Ollama 模型是 `qwen2.5-coder:7b`，複雜任務可靠度不足，只適合局部低風險派工。
- 地圖與場物仍屬程式繪圖原型，可在後續對話依使用者回饋調整比例、密度、路線與圖示。
- 不要主動刪除使用者參考資料，也不要未經要求推送或覆蓋遠端分支。

## 7. 既有驗證紀錄

- `python validate_project.py` 已多次通過：7 個 JavaScript 模組與 8 張資料表。
- 大地圖曾以多區段生成、主路連通與場物規則驗證。
- 地下城曾以 100 seeds 驗證門向、可達性、房間／走廊規則，並完成三層無頭流程。
- GitHub Pages 已實際驗證大地圖、逐房揭露、樓梯與 Boss 傳送魔法陣。
- 新任務仍應依修改範圍重新執行相稱驗證，不直接假設舊結果涵蓋新變更。

