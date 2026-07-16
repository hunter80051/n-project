# Google Sheets 配置同步操作說明

本流程將 Google Drive 中的一份 Google Sheet 作為編輯來源，經本機檢查後更新 repository 的 `data/*.csv`。同步工具不會自動建立 Git commit、不會推送，也不會部署。

## 資料來源原則

- Google Sheet 是遊戲數值配置的唯一人工修改來源。
- OAuth 維持唯讀；Codex 不直接修改 Google Sheet。
- 收到角色、生物、技能、裝備或系統參數的數值調整任務時，Codex 先列出需要修改的分頁、穩定 ID、欄位、目前值與目標值，通知使用者修改 Google Sheet。
- 使用者確認 Sheet 已修改後，Codex 才執行 check、apply、版本檢查、預覽與後續核准流程。
- 不直接修改 repository CSV 來繞過 Sheet，以免下次同步時被舊資料覆蓋。程式碼、schema 或工具鏈修改不受此數值流程限制。

## 1. 需要準備的 Google 資源

需要：

1. 一個可建立 Google Sheet 的 Google Drive 空間。
2. 一個 Google Cloud project。
3. 在該 project 啟用 Google Sheets API。
4. 建立 OAuth 用戶端 ID，應用程式類型選「電腦版應用程式」。
5. 下載 OAuth JSON，並在首次同步時以可存取目標 Sheet 的 Google 帳號登入。

不需要：

- Google Workspace 管理員權限。
- 全網域委派。
- 服務帳戶或服務帳戶私密金鑰。
- 將 Sheet 發布成所有人可讀。

OAuth JSON 與登入後產生的 token 都是秘密檔案，不可提交到 Git。預設位置為：

```text
secrets/google-oauth-client.json
secrets/google-oauth-token.json
```

若 OAuth 同意畫面仍是「測試」狀態，請將自己的 Google 帳號加入測試使用者。

## 2. 建立 Google Sheet

1. 將 `templates/N-Project-Game-Data-Google-Sheets-Template.xlsx` 上傳到 Google Drive。
2. 以 Google 試算表開啟，選擇「檔案 → 另存為 Google 試算表」，轉換成原生 Google Sheet。僅在網頁中開啟 `.xlsx` 不算完成轉換，Sheets API 會拒絕 Office 格式。
3. 保留以下八張資料分頁名稱：
   - `balance`
   - `characters`
   - `skills`
   - `enemies`
   - `items`
   - `loot_tables`
   - `scrolls`
   - `dungeons`
4. 額外的 `使用說明` 分頁可以保留；同步工具不會讀取它。
5. 從網址取得 spreadsheet ID：

```text
https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
```

## 3. 本機首次設定

雙擊：

```text
Setup Google Sheets Sync.bat
```

它會：

- 建立 `.venv-google-sheets`。
- 安裝 Google Sheets API 所需套件。
- 從範例建立本機 `google_sheets_sync.json`。
- 建立 `secrets` 目錄。

接著編輯 `google_sheets_sync.json`：

```json
{
  "authMode": "oauth",
  "spreadsheetId": "你的試算表 ID",
  "oauthClientFile": "secrets/google-oauth-client.json",
  "oauthTokenFile": "secrets/google-oauth-token.json"
}
```

首次執行 check 時會開啟瀏覽器：

1. 使用可存取目標 Google Sheet 的帳號登入。
2. 同意 Google Sheets 唯讀權限。
3. 授權完成後，工具會建立 `secrets/google-oauth-token.json`。
4. 後續執行會重用或自動更新 token，通常不需要重新登入。

## 4. 日常同步流程

雙擊：

```text
Sync Google Sheets Data.bat
```

建議依序使用：

1. 「檢查 Google Sheet，不修改 CSV」。
2. 閱讀錯誤、警告、預計變更檔案與版本號。
3. 確認 Sheet 內容無誤後，選擇「驗證後套用」。
4. 在提示中輸入 `APPLY`。

工具會先將全部資料寫入暫存區，完成下列檢查後才更新正式 CSV：

- 八張分頁及表頭完整。
- 儲存格沒有公式。
- 必填欄位、數字、整數、布林、顏色及 enum 有效。
- ID 不空白、不重複且格式有效。
- 基本技能、技能池、掉落、敵人池與 Boss 外鍵有效。
- 數值範圍、掉落機率與數量上下限有效。
- 角色維持四人，且 effectType／slot 在目前程式支援範圍。
- 既有穩定 ID 沒有被刪除或改名。

套用成功後仍不會 commit 或 push。

### 選用：服務帳戶相容模式

若其他 Google Cloud project 允許建立服務帳戶金鑰，仍可將 `authMode` 改為 `service_account` 並提供 `credentialsFile`。目前專案因 `iam.disableServiceAccountKeyCreation` 政策禁止建立私密金鑰，因此預設使用 OAuth。

## 5. CSV 個別版本規則

`data/manifest.json` 為每張 CSV 保存：

```json
{
  "version": "20260716.2",
  "sha256": "..."
}
```

規則：

- 版本格式為 `YYYYMMDD.N`。
- 只有內容實際改變的 CSV 才遞增版本。
- 數值欄位的等值格式（例如 `3` 與 `3.0`）不視為內容變更。
- 同一天再次修改時遞增 `N`。
- 不同日期第一次修改從 `.1` 開始。
- SHA-256 用來確認 CSV 內容與版本 metadata 一致。
- 直接手動修改 CSV 而沒有更新版本時，`validate_project.py` 會失敗。
- 遊戲載入 CSV 時會把個別版本加入 URL query，降低舊快取影響。

## 6. Commit 與推送的二次確認

當 CSV 已套用，且你通知 Codex 準備 commit 或推送時，Codex 必須先執行：

```text
Sync Google Sheets Data.bat versions
```

或：

```powershell
python tools/google_sheets_sync.py versions --git-ref HEAD
```

Codex 必須先向你列出：

- 哪些 CSV 有變更。
- 每張 CSV 的舊版本與新版本。
- 舊、新 SHA-256 短碼。
- 驗證結果。

在你第二次明確確認前，不得建立 commit，也不得推送。

正式推送仍須遵守目前 Discord `!approve` 流程；Codex 對話中的確認不取代 Discord 核准。

## 7. 失敗與復原

同步套用前會備份原 manifest 與即將修改的 CSV：

```text
.sheet-sync/backups/YYYYMMDD-HHMMSS/
```

若覆寫或最終 `validate_project.py` 失敗，工具會自動復原。`.sheet-sync` 是本機工作目錄，不提交至 Git。

## 8. 本機無 Google 憑證測試

開發或測試同步工具時可改讀本機 CSV：

```powershell
python tools/google_sheets_sync.py check --source-dir data
```

這個模式不連線 Google，也不修改正式 CSV。

完整欄位規格請參閱 `GOOGLE-SHEETS-FIELD-GUIDE.md`。
