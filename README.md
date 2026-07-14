# Discord → Codex 訊息橋接

這是依據 `project_simple.md` 建立的第一階段版本：每個 Discord 頻道固定綁定一個本機專案目錄，並以 `!build` 將任務交給本機 Codex CLI 執行。

## 安裝

```powershell
python -m pip install -r requirements.txt
Copy-Item config.example.json config.json
```

編輯 `config.json`，填入你的 Discord 使用者 ID、頻道 ID，以及該頻道應綁定的專案絕對路徑。

設定 Token（只放環境變數，不要貼進 Discord 或提交 Git）：

```powershell
$env:DISCORD_BOT_TOKEN="你的 Bot Token"
python discord_codex_bot.py
```

## Discord 指令

- `!build <任務描述>`：讓 Codex 在此頻道綁定的專案中執行任務。
- `!change <任務描述>`：修改既有功能。
- `!fix <任務描述>`：修復問題。
- `!status`：查看綁定專案與目前狀態。
- `!retry [補充說明]`：重跑上一個任務。
- `!approve`：確認 GitHub Pages 預覽後核准；Bot 會再次驗證內容、建立 commit 並推送到 `main`。
- `!cancel`：中止執行中的任務。
- `!help`：顯示指令。

## 安全設計

- 僅接受 `config.json` 內的頻道與使用者。
- 頻道只能操作預先綁定的專案路徑。
- Codex 使用 `workspace-write` sandbox，不開啟危險的全權模式。
- 新任務開始前要求乾淨的 Git 工作樹。
- Codex 修改完成後先執行 `validation_command`，通過才建立受控 preview commit 並推送至 `preview` branch。
- GitHub Pages 必須部署出相同 preview commit，Bot 才會提供預覽網址並進入 `waiting_approval`。
- 收到 `!approve` 時會重新比對檔案、雜湊、base commit 與 preview tree；一致才 commit 並推送 `main`。
- Codex 可將範圍明確的產碼工作交給本機 Ollama Local Agent；Local Agent 只能修改 Codex 指定的檔案，不能操作 Git 或 Shell。
- Discord 會即時顯示 Codex 派工、Ollama 開始/完成，以及 Codex 審查驗證等協作里程碑；不顯示模型的隱藏推理內容。
- AI 小組展示模式下，凡涉及程式碼檔案的新增或修改，Codex 必須至少派發一個受限子任務給 Ollama；純查詢與 Git 管理除外。
- 一個頻道同時只執行一個 Codex 任務。
- 任務狀態會保存至 `jobs.json`，Bot 重啟後仍可用 `!status` 查詢上次任務。

## GitHub Pages 預覽

此專案使用公開 repository 的 GitHub Pages。工作流程位於 `.github/workflows/deploy-pages.yml`，由 `preview` branch 觸發部署。

頻道設定需要包含：

```json
{
  "git_remote": "origin",
  "preview_branch": "preview",
  "preview_url": "https://hunter80051.github.io/n-project/",
  "validation_command": ["python", "validate_project.py"]
}
```

第一次使用前，需將 GitHub repository visibility 改為 Public，並在 repository 的 Settings → Pages 將 Source 設為 GitHub Actions。

## 開機自動執行（第二步）

確認手動運作正常後，可用 Windows 工作排程器在登入時執行 Bot。建議先不要把 Token 寫進 `.bat`，改使用使用者層級環境變數或 Windows Credential Manager。

## 快速啟動

先將 Token 設定為 Windows 使用者環境變數 `DISCORD_BOT_TOKEN`，再直接雙擊 `Start Discord Codex Bot.cmd`。啟動器會在背景啟動 Bot，不會在工作列保留視窗，也不會顯示或寫入 Token。重複執行時會偵測既有 Bot，不會啟動第二個 process。

需要停止時，雙擊 `Stop Discord Codex Bot.cmd`。啟動、重複啟動與停止結果會記錄在 `bot-startup.log`。
