# 遊戲配置資料

本目錄的 CSV 是 MVP 的資料來源，也是未來 Google Sheets 各分頁的欄位定義。遊戲先讀取 `manifest.json`，再依 `tables` 內的 URL 載入每張表。

`manifest.json` 另為每張 CSV 保存獨立的 `YYYYMMDD.N` 版本與 SHA-256。遊戲載入時會將個別版本加入 URL query；`validate_project.py` 會確認 CSV 內容雜湊與 manifest 一致。

## ID 與外鍵

- ID 是穩定字串，不可依賴資料列順序，也不要在發布後任意改名。
- `characters.basicSkillId` → `skills.skillId`。
- `characters.skillPoolId` → `skills.skillPoolId`。
- `enemies.lootTableId` → `loot_tables.lootTableId`。
- `loot_tables.dropId` 依 `dropType` 指向 `items.itemId` 或 `scrolls.scrollId`。
- `dungeons.enemyPool` 使用 `|` 分隔多個 `enemies.enemyId`。
- `dungeons.bossEnemyId` → `enemies.enemyId`，且該敵人的 `isBoss` 必須為 `true`。

## 資料表用途

- `balance.csv`：全域尺寸、速度、程序生成與成長曲線。
- `characters.csv`：固定隊員基礎屬性及技能索引。
- `skills.csv`：基本技能與升級時可選技能。
- `enemies.csv`：一般敵人與 Boss 數值。
- `items.csv`：weapon／armor 裝備及評分。
- `loot_tables.csv`：敵人死亡後的候選掉落。
- `scrolls.csv`：可由玩家主動施放的卷軸。
- `dungeons.csv`：地下城主題、敵人池、每層數量及 Boss。

## Google Sheets 替換方式

建議使用 repository 根目錄的 `Setup Google Sheets Sync.bat` 與 `Sync Google Sheets Data.bat`，先將 Google Sheet 下載到暫存區並通過驗證，再更新本目錄。完整操作請參閱 `GOOGLE-SHEETS-SYNC.md`。

若不使用同步工具而要讓遊戲直接讀取公開 CSV：

1. 建立一份 Google Sheet，使用上述八個 CSV 檔名作為八個分頁名稱。
2. 將每個 CSV 的第一列欄位名稱完整複製到對應分頁，欄位名稱不可翻譯或刪除。
3. 在 Google Sheets 選擇「檔案 → 共用 → 發布到網路」，分別把每個分頁發布為 CSV。
4. 複製每個分頁的公開 CSV URL。
5. 將 `manifest.json` 中對應的本機路徑替換成公開 URL。
6. 重新整理遊戲；遊戲邏輯不需修改。

若 CSV 文字包含逗號、雙引號或換行，Google Sheets 匯出時會自動加上正確引號。機率欄位使用 0–1，小數 `0.25` 代表 25%。

直接手動修改本目錄的 CSV 會讓 SHA-256 與 manifest 不一致；正式更新應透過同步工具處理版本與雜湊。
