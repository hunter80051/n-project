# N-Project 對話串工作交接

更新日期：2026-07-16
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
- 資料以 `data/manifest.json` 與 8 張 CSV 載入；Google Sheet 是唯讀同步來源，經本機工具驗證後才更新 repository CSV。
- GitHub Pages 預覽：`https://hunter80051.github.io/n-project/`。
- 目前正式 commit：`bbfe146cb344f47a729542d1da5b119891c77b21`（`feat: refine party combat and dungeon exploration`）。
- `main` 與 `origin/main` 已同步；Discord `!approve` 已完成推送。
- GitHub Pages `preview` commit：`13eb714f721e76e392ea33ff9c49abceac252643`，入口快取版本為 `20260716a`；其 tree 與正式 commit 相同。
- Discord Bot 上一個任務已清理完成，現在狀態為 `idle`；job、preview、hash、核准與 final commit 暫存欄位皆已清空。
- worktree 目前刻意保留整套尚未提交的 Google Sheets 同步、CSV 版本及驗證工具變更；不得把這些檔案誤認成雜項、回復或刪除。
- `Game Sample/` 與 `Prototype-MVP.txt` 是本機參考輸入，已加入 `.gitignore`，不可刪除。
- 本階段沒有建立 commit、沒有推送 `main`、沒有更新 `preview`；正式 HEAD 仍是 `bbfe146`。

## 3. 已完成遊戲功能

### 大地圖

- 記憶體暫存、重新載入即清空的延展式 2.5D 組合地圖。
- 草地、道路、水面底層；樹木、灌木、地下城入口、大小石頭中層；小隊上層。
- 鏡頭跟隨小隊，隊伍維持中央，自動沿主路前往下一地下城。
- 抵達入口時顯示 1–2 個展示用怪物圖示與單一任務難度；玩家可進入或略過，略過後舊入口保留並自動延展通往下一入口的區段。
- 已攻克地下城數量與目的地序號已分離；略過不增加完成數或難度，展示情報暫不影響實際敵人與地下城規則。
- 路線可向八方向延伸，會避免緊鄰舊路與地下城，並減少連續一格即轉向。
- 草地島嶼、外圍水面與道路障礙物提供繞路的視覺理由。

### 地下城

- 三層流程；第 1、2 層程序生成，第 3 層固定 Boss 房。
- 2.5D 底層地塊／外圍厚度、中層牆門與樓梯／魔法陣、上層角色與敵人。
- 入口只揭露第一房；清區後到門前才揭露下一走廊、房間與敵人。
- 牆門有兩種等角方向；第 1、2 層使用下層樓梯，第 3 層使用 Boss 傳送魔法陣。
- 房間與走廊已調整為較大型、迷宮式分散，避免走廊穿越既有走廊或房間，並低機率包含需要折返的死路。
- 程序走廊已擴為三格寬；四名角色可依同行中心換房並在門內側集合，不會因前排占位卡住或移出地板。
- 角色與敵人使用獨立座標及碰撞；戰鬥時近戰貼近、遠程保持距離，選敵會優先反擊自己目標並保護遠程隊友。
- 遠程物理／魔法投射物、卷軸施法特效、掉落寶箱、接觸拾取及右下角待確認裝備介面均已完成。
- 大地圖成員若失速、落在無效地塊或遠離同行中心，會自動重新集結。
- 已揭露區域無存活怪物時，未接觸寶箱會在 3 秒後自動收入小隊背包；技能待選不會暫停探索或寶箱計時。
- 同一角色連升多級時，技能選擇依序排隊，同時只顯示一筆，避免重複技能。
- 冒險記錄位於 Canvas 下方左欄，縱向排列且最新置頂；技能與裝備共用右欄待處理列表，最舊優先。
- 裝備卡片整張單擊即換裝、不可略過；換裝成功提示顯示在 Canvas 右下角。
- 不同房間／走廊揭露群組之間的牆面永久保留；新區域揭露後原房間邊界不會消失，只有預定門框中央開口。

### Discord Bot

- 支援 `!build`、`!change`、`!fix`、`!status`、`!retry`、`!approve`、`!cancel`、`!help`。
- `!fix`／`!change` 在 `waiting_approval` 狀態會安全延續目前預覽。
- `!retry` 只處理 `failed`、`validation_failed`、`deployment_failed`、`approval_failed`、`cancelled`。
- 延續預覽前會比對 changed files、base commit 與檔案 hash。
- 預覽驗證後才允許 `!approve` 建立並推送正式 commit。
- 正式推送以 Discord 頻道的 `!approve` 為主；Codex 對話中可先建立本機 commit，但未收到 Discord approve 不直接推送 `main`。
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
| `src/ui.js` | DOM UI、事件、卷軸與技能／裝備待處理列表 |
| `src/data-loader.js` | manifest、CSV 解析與跨表驗證 |
| `tools/google_sheets_sync.py` | Google Sheets 唯讀取得、驗證、CSV 套用、備份與版本報告 |
| `tools/game_data_schema.json` | 8 張表、79 個欄位的同步 schema 與文件來源 |
| `GOOGLE-SHEETS-SYNC.md` | OAuth、BAT、同步、版本與核准操作說明 |
| `GOOGLE-SHEETS-FIELD-GUIDE.md` | 8 張表逐欄用途、填寫規範與實作狀態 |
| `discord_codex_bot.py` | Discord 指令、任務狀態、預覽與核准流程 |
| `ollama_local_agent.py` | 受限 allowedFiles Local Agent |
| `validate_project.py` | HTML、ES Module、CSV schema 與外鍵驗證 |

## 6. 已知限制與待決事項

- 角色目前仍是 Canvas 原型圖形；DTTO Friends 名稱與造型公開使用權尚未確認。
- Google Sheets 原生 workbook 已完成 OAuth 唯讀連線與實際 API check；目前內容與 repository CSV 相同，因此沒有可套用的差異，首次實際 apply 延後到使用者日後修改 Sheet。
- Google API 套件對目前 Python 3.10.11 顯示未來支援警告；現階段不影響功能，但應在 2026-10-04 前升級至 Python 3.11 以上。
- Ollama 模型是 `qwen2.5-coder:7b`，複雜任務可靠度不足，只適合局部低風險派工。
- 地圖與場物仍屬程式繪圖原型，可在後續對話依使用者回饋調整比例、密度、路線與圖示。
- 不要主動刪除使用者參考資料，也不要未經要求推送或覆蓋遠端分支。
- 使用者已接受 `bbfe146` 作為本階段正式版本；目前沒有尚待修正的已知阻斷問題。

## 7. 既有驗證紀錄

- `python validate_project.py` 已多次通過：7 個 JavaScript 模組與 8 張資料表。
- 大地圖曾以多區段生成、主路連通與場物規則驗證。
- 地下城曾以 100 seeds 驗證門向、可達性、房間／走廊規則，並完成三層無頭流程。
- 三格寬走廊另以 100 seeds 檢查 35,124 個 footprint，未出現窄化、走廊交叉或不可達。
- 獨立站位以 10 個連續地下城難度／seed 組合完成三層流程；可見單位均留在地板，最小距離約 0.68 格。
- 技能待選與未拾取寶箱組合已驗證：模擬不自動暫停，寶箱在 3000 ms 自動收取；10 次完整流程皆完成。
- 同角色連升多級以 10 次完整流程驗證，每名角色 4 次技能選擇依序處理且無重複技能。
- 揭露牆面以 100 seeds 比較逐階段牆面集合；共檢查 1,053 段群組邊界，牆／門框覆蓋不會因新區域揭露而減少。
- 瀏覽器已實際比對入口房揭露前後及完整地圖揭露後畫面；房間／走廊邊界牆持續存在，Canvas 右下角換裝通知位置正常。
- GitHub Pages 已實際驗證大地圖、逐房揭露、樓梯與 Boss 傳送魔法陣。
- Google Sheets 同步單元測試共 6 項通過；涵蓋無變更、單表版本遞增、數值等值格式、穩定 ID、防呆範圍及手動 CSV／manifest 不一致。
- 實際 OAuth Google API check 已讀取 8 張表並通過 schema、型別、ID、外鍵、數值範圍與版本 metadata 驗證；結果為 CSV 無變更。
- `3` 與 `3.0`、`2` 與 `2.0` 的假差異已補測試並修正，重跑實際 API check 後正確判定無版本變更。
- 新任務仍應依修改範圍重新執行相稱驗證，不直接假設舊結果涵蓋新變更。
- 地下城自由選擇另完成連續略過 6 次流程測試；舊入口均保留且完成數維持 0，第 7 座入口仍可正常選擇。桌面與 600px 瀏覽器均已檢查情報圖示、假難度、兩個按鈕及略過後進入新地下城流程，console 無 error 或 warning。

## 8. 本次交接結論

- 本階段 Google Sheets 同步實作與驗證工作已結束，但全部成果仍在未提交 worktree；正式版本仍為 `bbfe146`，遠端 `origin/main` 未包含本次成果。
- 預覽連結：`https://hunter80051.github.io/n-project/?v=20260716a&preview=13eb714`。
- Discord 驗證連結訊息 ID：`1526986432172916858`；本機 commit 等待 approve 的通知訊息 ID：`1526993222784520546`。
- Discord 任務結束／回到 idle 的通知訊息 ID：`1526997855301144838`。
- Discord Bot 已恢復常駐執行，狀態為 `idle`，沒有等待核准、推送或可延續的舊任務。
- 新對話收到新需求後，先更新 `PLANS.md`，保留本次未提交變更，不要重做本文件列為已完成的功能。

## 9. Google Sheets 與 CSV 版本流程

- Google Sheet 使用八張固定資料分頁；本機以 `Sync Google Sheets Data.bat` 執行 check／apply，不由 Apps Script 直接操作 Git。
- Google Cloud 專案禁止建立服務帳戶金鑰；同步預設使用 OAuth 電腦版應用程式 JSON，首次 check 由使用者登入並將 token 保存於已忽略的 `secrets/`。
- Google Sheet 是遊戲數值配置的唯一人工修改來源，OAuth 維持唯讀且只有使用者修改 Sheet；Codex 不直接改 Sheet，也不直接改 CSV 繞過 Sheet。
- 收到數值調整任務時，Codex 應先列出分頁、穩定 ID、欄位、目前值與目標值，通知使用者修改 Sheet；使用者確認完成後才執行同步、驗證、版本報告與預覽流程。
- 已於 2026-07-16 完成首次 OAuth 登入及原生 Google Sheet API check；八張表的 schema、型別、ID、外鍵、數值範圍與版本 metadata 均通過，未修改 CSV。
- 同步比較已將數值欄位的 `3`／`3.0` 等等值格式視為相同，避免無意義的 CSV 版本遞增。
- 每張 CSV 的個別 `YYYYMMDD.N` 版本與 SHA-256 保存在 `data/manifest.json`；只有內容改變的 CSV 遞增版本。
- `python validate_project.py` 會檢查 CSV 雜湊；直接修改 CSV 而未更新 manifest 會驗證失敗。
- Google Sheets 同步不自動 commit、不自動 push，也不取代 Discord `!approve`。
- 使用者要求 commit 或推送前，必須先執行 `Sync Google Sheets Data.bat versions` 或 `python tools/google_sheets_sync.py versions --git-ref HEAD`。
- 回覆中必須列出每張變更 CSV 的舊版本、新版本及 SHA-256 短碼，並取得使用者二次明確確認後才能建立 commit；推送仍等待 Discord 核准。
- 完整設定見 `GOOGLE-SHEETS-SYNC.md`；欄位說明見 `GOOGLE-SHEETS-FIELD-GUIDE.md`；範本見 `templates/N-Project-Game-Data-Google-Sheets-Template.xlsx`。

## 10. 本次未提交變更盤點

- 已修改：`.gitignore`、`PLANS.md`、`README.md`、`THREAD-HANDOFF.md`、`data/README.md`、`data/manifest.json`、`src/data-loader.js`、`validate_project.py`。
- 新增：`GOOGLE-SHEETS-FIELD-GUIDE.md`、`GOOGLE-SHEETS-SYNC.md`、兩個 Google Sheets BAT、`google_sheets_sync.example.json`、`requirements-google-sheets.txt`、`templates/`、`tests/`、`tools/`。
- 8 張 CSV 的資料列內容沒有改變；`data/manifest.json` 新增每表版本與 SHA-256，初始版本皆為 `20260716.1`。
- 本機設定 `google_sheets_sync.json`、`.venv-google-sheets/`、`.sheet-sync/` 與 `secrets/` 已忽略，不得提交；OAuth client JSON 與 token 不可輸出或外洩。
- 使用者尚未要求 commit／push。本次成果未走 Discord preview／`!approve`；若未來要提交，先執行完整驗證並依 CSV 版本二次確認規則處理。
