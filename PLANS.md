# DTTO Friends Dungeon Prototype — MVP 開發計畫

最後更新：2026-07-15  
文件狀態：基礎 MVP 與第一階段大地圖重構已完成並通過驗證；後續規格變更必須先更新本文件。

## 1. 任務目標

以 `Game Sample` 的 CLICKPOCALYPSE II 為玩法與技術參考，將目前 GitHub Pages 根目錄的「32 秒點擊遊戲」替換成一款可直接展示的單機網頁 RPG Prototype。

展示版必須具備：

- 固定四人小隊，不製作選角流程。
- 大地圖與地下城之間的循環。
- 地下城共三層；前兩層為程序式房間與走廊，第三層固定 Boss 房。
- 清空當層全部敵人才可使用樓梯。
- 自動探索、自動戰鬥、HP/SP、攻擊動作切換。
- 角色升級時暫停並顯示三選一技能。
- 裝備替換提示與自動替換較佳裝備。
- 卷軸法術；不製作藥水。
- Canvas 遊戲畫面加 DOM 資訊面板。
- 靜態配置與程式碼分離，所有關聯使用穩定 ID。
- 可直接由現有 GitHub Pages workflow 部署。

## 2. 已確認前提與假設

### 2.1 技術與部署

- 現有網站是無 build step 的 `index.html + style.css + script.js`。
- GitHub Pages 從 repository 根目錄部署，因此新遊戲仍維持純靜態檔案。
- 使用原生 ES Modules，不新增 npm、Vite、React 或遊戲引擎。
- 既有 Discord/Codex/Ollama bridge、部署 workflow 及非遊戲檔案不在本次修改範圍。

### 2.2 Google Sheet

- MVP 不要求 Google API、OAuth 或私人 Sheet 權限。
- 本機資料先以 CSV 保存；CSV 欄位即預定的 Google Sheet 欄位。
- `data/manifest.json` 保存各資料表來源。未來可將本機路徑改為 Google Sheets「發布到網路」的 CSV URL。
- 遊戲不依賴資料列順序；跨表關聯全部使用 `characterId`、`skillId`、`enemyId`、`itemId`、`scrollId` 等 ID。
- 因此目前不需要使用者提供 Google Sheet 雲端空間。

### 2.3 美術與 IP

- 已唯讀檢視指定參考頁：DTTO Friends 是七名角色組成的療癒系角色品牌，視覺以簡單輪廓、粗深色描邊、圓潤比例、低細節及高辨識度配色為主。
- MVP 固定隊伍暫以 Dinu、Hoya、Lynn、Bob 的角色定位作為職能參考。
- 公開部署可能涉及角色名稱與造型授權；在未確認授權前，程式內會讓名稱與 sprite metadata 可配置，並使用低解析度原型圖形／佔位圖，不直接複製參考頁圖片。
- 若後續確認有使用權，可只替換 sprite sheet 與 CSV 名稱，不改遊戲系統。

### 2.4 Ollama 協作

- 本機 Ollama API 已確認可用，模型為 `qwen2.5-coder:7b`。
- 所有適合產碼的工作優先使用 `ollama_local_agent.py`，並限制 allowedFiles。
- Codex 負責規格、資料 schema、diff 審查、整合、測試與必要修正。
- Ollama 不操作 Git、Shell、部署或 allowedFiles 以外的檔案。

## 3. 明確不製作的內容

- 城堡系統。
- 地下城 farm／再感染。
- 藥水與藥水欄位。
- 開局選角與角色命名。
- 角色永久死亡、Game Over 或復活流程。
- Prestige、離線補算、成就及 Adventure Points。
- 多人、帳號、雲端存檔、後端 API。
- CLICKPOCALYPSE II 的數百技能、完整裝備與全部職業內容。
- Google Sheets 私人資料存取或編輯權限。

## 4. MVP 玩家流程

```text
載入外部配置
  → 大地圖顯示固定小隊與可進入地下城
  → 點擊「進入地下城」
  → 生成第 1 層房間、走廊、敵人與樓梯
  → 小隊自動探索與戰鬥
  → 清空全部敵人後啟用樓梯
  → 第 2 層重新生成
  → 清空後進入第 3 層固定 Boss 房
  → 擊敗 Boss
  → 顯示攻克結算並回到大地圖
  → 下一座地下城提高難度後重複
```

## 5. 遊戲規則

### 5.1 地圖與階段

- Canvas 內部解析度預定 960×540，CSS 等比例縮放。
- 地下城使用 24px 方格，40×22 格可完整放入 960×540 Canvas，不在 MVP 提供設定。
- 大地圖改為執行階段生成的組合地圖：
  - 以固定尺寸的邏輯格組合，繪製時使用 2.5D 菱形投影，形成早期遊戲的拼接地圖感。
  - 地圖資料只保存在 JavaScript 記憶體；同一次開啟期間保留已生成區段，重新整理或重開遊戲後清空。
  - 每攻克一座地下城後，才生成通往下一座地下城的新區段；除上一入口周圍的延伸接縫會轉為新道路／草地外，其餘既有道路、草地與場物不重新生成。
  - 鏡頭只顯示地圖的一部分並跟隨隊伍，隊伍的投影位置維持在 Canvas 中央附近。
  - 小隊在大地圖上沿主要道路自動前進，到達下一個地下城入口後才允許進入。
- 大地圖分三個繪製層級：
  1. 底層地塊：草地、道路、水面。
  2. 中層場物：樹木、灌木叢、地下城入口、大石頭、小石頭。
  3. 上層角色：固定四人小隊。
- 大地圖區段生成順序：
  1. 確定目前地下城入口與下一個入口的位置。
  2. 以道路格建立保證連通的主要移動路線，並加入少量不影響主路的展示岔路。
  3. 用草地格填出道路周圍的大面積主要地形。
  4. 用水面格填滿目前已生成地形的外圍邊界。
  5. 在道路兩端放置地下城入口；主要道路保持淨空。
  6. 草地內部可形成樹叢與石群；道路交界只少量放置樹木或灌木；岔路終點可少量放置石頭或樹木。
- 大地圖場物使用 45 度視角的簡化圖示與較深色輪廓，先以 Canvas 程式繪圖完成，不新增外部圖片資源。
- 大地圖視覺採使用者提供的 2.5D 島嶼參考方向：
  - 水面是連續底盤，草地與道路以薄菱形拼片覆蓋其上，不製作厚重立方體地塊。
  - 相鄰同類地塊組成不規則大片地形，外緣保留亮色邊線與輕微深色側面以增加高度感。
  - 樹木、灌木、入口與石頭維持直立的 45 度視角圖示，尺寸可跨越單格視覺範圍，但邏輯占位仍為一格。
- 地下城第 1、2 層：
  - 隨機產生 5–7 個不重疊矩形房間。
  - 依房間中心建立最小連通關係，再加入少量隨機額外連線。
  - 每條連線隨機選擇「先水平後垂直」或「先垂直後水平」的 L 型走廊。
  - 起點位於第一個房間；樓梯可在生成時出現，但鎖定至敵人全滅。
- 第 3 層：固定單一大型 Boss 房，不執行一般房間生成。
- 每次進入樓層保存 seed，方便重現與除錯。

### 5.2 自動探索

- 地圖格類型：牆、地板、走廊、樓梯、入口。
- 小隊使用格狀路徑搜尋前往最近的存活敵人；沒有敵人時前往樓梯。
- MVP 可使用 BFS，因地圖尺寸小且所有可走格成本相同；不因參考遊戲使用 A* 就增加不必要複雜度。
- 小隊以單一隊伍位置移動，成員在畫面上使用小幅偏移排列，不為四人各自尋路。

### 5.3 戰鬥

- 固定四人隊伍：Tank、Healer、Caster、Striker。
- 每名角色至少有 HP、SP、attack、defense、speed、attackRange、attackCooldown。
- 敵人靠近後停止移動並進入自動戰鬥。
- 角色與敵人不死亡：
  - 角色 HP 最低鎖定為 1。
  - HP 過低時，Healer 提高治療優先級。
- 攻擊動畫使用兩個 frame：idle / attack，交替顯示並配合短距離位移或閃白。
- MVP 以右側 HP/SP bar、攻擊幀與事件列呈現數值變化；Canvas 浮動數字延後至美術強化階段。
- SP 會隨時間恢復；角色技能與卷軸可消耗 SP 或卷軸次數。

### 5.4 升級選技

- 全隊共享擊殺經驗；角色達到門檻時升級。
- 升級時暫停模擬，在 Canvas 中央上方顯示 DOM modal。
- 從該角色尚未取得的技能中選出最多三項。
- 點選技能後立即加入角色技能列表並恢復遊戲。
- 若可選技能不足三項，顯示實際數量；全部學完則給予固定屬性成長。

### 5.5 裝備

- MVP 裝備欄位：weapon、armor。
- 敵人依 loot table 機率掉落裝備。
- 若新裝備的評分高於目前裝備，自動替換。
- DOM 顯示「角色：舊裝備 → 新裝備」提示，數秒後淡出。
- 裝備只提供可配置的 attack、defense、maxHp、maxSp 修正。

### 5.6 卷軸

- MVP 至少三種：Fire Burst、Chain Spark、Healing Light。
- 卷軸由敵人掉落並顯示堆疊數量。
- 玩家透過 DOM 按鈕主動施放；沒有有效目標時按鈕 disabled。
- 卷軸效果、SP 成本、傷害／治療倍率及圖示索引由 CSV 控制。
- 不製作自動施放、無限卷軸或藥水互動。

## 6. 外部資料設計

### 6.1 Manifest

`data/manifest.json`

```json
{
  "version": 1,
  "tables": {
    "balance": "data/balance.csv",
    "characters": "data/characters.csv",
    "skills": "data/skills.csv",
    "enemies": "data/enemies.csv",
    "items": "data/items.csv",
    "lootTables": "data/loot_tables.csv",
    "scrolls": "data/scrolls.csv",
    "dungeons": "data/dungeons.csv"
  }
}
```

未來可把任一 value 改成公開的 Google Sheets CSV URL。

### 6.2 balance.csv

欄位：

```text
key,value,type,description
```

範例 key：`tileSize`、`simulationStepMs`、`partyMoveSpeed`、`roomCountMin`、`roomCountMax`、`floorEnemyBase`、`xpGrowth`。

### 6.3 characters.csv

```text
characterId,name,role,color,spriteId,maxHp,maxSp,attack,defense,speed,attackRange,attackCooldownMs,basicSkillId,skillPoolId
```

### 6.4 skills.csv

```text
skillId,skillPoolId,name,description,effectType,targetType,power,spCost,cooldownMs,requiredLevel,iconId
```

### 6.5 enemies.csv

```text
enemyId,name,tier,color,spriteId,maxHp,attack,defense,speed,attackRange,attackCooldownMs,xp,lootTableId,isBoss
```

### 6.6 items.csv

```text
itemId,name,slot,rarity,iconId,attackBonus,defenseBonus,maxHpBonus,maxSpBonus,score
```

### 6.7 loot_tables.csv

一列代表一個候選掉落：

```text
lootTableId,dropType,dropId,weight,chance,minQuantity,maxQuantity
```

### 6.8 scrolls.csv

```text
scrollId,name,description,effectType,targetType,power,spCost,iconId,initialQuantity
```

### 6.9 dungeons.csv

```text
dungeonId,name,themeColor,enemyPool,floor1EnemyCount,floor2EnemyCount,bossEnemyId,difficultyScale
```

`enemyPool` MVP 使用 `|` 分隔 enemyId；之後若需要更完整權重再拆成獨立表。

## 7. 程式結構

```text
index.html
style.css
src/
  main.js            啟動、場景流程、主迴圈
  data-loader.js     manifest、CSV 解析、型別轉換、索引建立
  dungeon.js         房間、走廊、樓梯、Boss 房、路徑搜尋
  simulation.js      固定小隊、敵人、移動、戰鬥、掉落、升級
  renderer.js        Canvas 地圖、角色、敵人、特效與低解析度 sprite 繪製
  ui.js              DOM 狀態面板、卷軸、提示、技能 modal
data/
  manifest.json
  balance.csv
  characters.csv
  skills.csv
  enemies.csv
  items.csv
  loot_tables.csv
  scrolls.csv
  dungeons.csv
assets/
  （若原型圖形改為實體 sprite sheet，再放入此目錄）
```

## 8. UI 版面

延續樣本的 Canvas + DOM 混合設計，但不複製其固定 1024px absolute layout。

```text
┌──────────────────────────────────────────────┐
│ 標題 / 場景 / 地下城層數 / 暫停             │
├───────────────────────────────┬──────────────┤
│                               │ 隊伍狀態 x4  │
│          Canvas 960×540        │ HP / SP      │
│                               │ 技能 / 裝備  │
│                               ├──────────────┤
│                               │ 卷軸按鈕     │
├───────────────────────────────┴──────────────┤
│ 戰鬥／升級／裝備事件列                      │
└──────────────────────────────────────────────┘
```

- 桌面優先，窄螢幕時右欄移至 Canvas 下方。
- Canvas 維持像素化顯示：`image-rendering: pixelated`。
- 色彩使用柔和粉藍、粉紅、奶油黃、灰紫與深褐描邊，對應參考頁的療癒系風格。

## 9. 實作階段與驗收

### Phase 0 — 計畫與基線

- [x] 讀取 `Prototype-MVP.txt`。
- [x] 讀取 `Game Sample` 分析文件及現有網站結構。
- [x] 確認 GitHub Pages 部署方式。
- [x] 確認 Ollama API 與模型。
- [x] 檢視 DTTO Friends 參考頁及視覺方向。
- [x] 建立本 `PLANS.md`。

驗收：計畫包含範圍、資料 schema、架構、流程、測試與未知事項。

### Phase 1 — 外部配置

- [x] 建立 manifest 與八張 CSV。
- [x] 建立 CSV loader、型別轉換與 ID 索引。
- [x] 對缺欄、重複 ID、無效外鍵提供可讀錯誤。
- [x] 建立 `data/README.md` 說明 Google Sheets 替換方式。

驗收：遊戲關鍵數值不直接寫死在 simulation；改 CSV 後重新整理即可生效。

### Phase 2 — 頁面與渲染骨架

- [x] 替換目前點擊遊戲 HTML/CSS。
- [x] 建立 Canvas、右側隊伍面板、卷軸列、事件列及 modal。
- [x] 建立療癒系低解析度原型 sprite renderer。
- [x] 支援桌面與窄螢幕排版。

驗收：資料載入完成後可看到大地圖、固定四人狀態與可操作的地下城入口。

### Phase 3 — 地下城與場景流程

- [x] 大地圖 → 地下城 → 大地圖循環。
- [x] 第 1、2 層程序式房間及走廊。
- [x] 第 3 層固定 Boss 房。
- [x] 敵人全滅前樓梯鎖定。
- [x] 清層與攻克提示。

驗收：連續完成三層可回到大地圖，第二座地下城難度提高。

### Phase 4 — 小隊、戰鬥與成長

- [x] 小隊自動選敵、尋路與移動。
- [x] 雙 frame 攻擊動作與可見攻擊位移。
- [x] HP/SP 增減；角色不死亡。
- [x] 經驗、升級三選一與學習技能。
- [x] 裝備掉落、評分、替換與提示。
- [x] 三種卷軸及數量顯示。

驗收：無人工移動操作即可完成戰鬥；玩家仍可透過選技及卷軸影響展示。

### Phase 5 — 驗證與部署準備

- [x] 擴充 `validate_project.py`，檢查全部 `src/*.js`、manifest、CSV 必填欄與外鍵。
- [x] Node 語法檢查通過。
- [x] 瀏覽器完成至少一次三層地下城流程。
- [x] 無 console error。
- [x] 960×540、桌面寬度及 600px 窄螢幕各檢查一次。
- [x] 更新 README 的遊戲與本機預覽說明。
- [x] 更新本文件狀態及規格變更紀錄。

驗收：`python validate_project.py` 通過，GitHub Pages 根路徑可直接遊玩。

## 10. Ollama 派工順序

每次只給明確且可審查的 allowedFiles：

1. 資料表與 `src/data-loader.js`。
2. `index.html`、`style.css`、`src/ui.js`。
3. `src/dungeon.js`。
4. `src/simulation.js`。
5. `src/renderer.js`、`src/main.js`。
6. `validate_project.py` 與 `README.md`。

每次派工後：

1. Codex 查看變更檔案與 diff。
2. 檢查是否遵守 ID 索引及 MVP 範圍。
3. 執行語法／資料驗證。
4. 不符合規格時，先把明確錯誤交回 Ollama 修正；只有結果仍不合格時由 Codex直接修正。

## 11. 測試案例

### 資料

- manifest 所有本機表格存在。
- 每張表必填欄完整。
- 主鍵不重複。
- character 的 skill ID、enemy 的 loot table、loot 的 item／scroll、dungeon 的 enemy／boss 全部可解析。
- 數值欄不可為 NaN，機率介於 0–1。

### 地圖

- 大地圖起點到下一個地下城入口存在連續道路。
- 每次完成地下城後只追加新區段；除上一入口周圍的延伸接縫外，先前道路、草地與場物維持不變。
- 大地圖主要道路沒有樹木、灌木或石頭阻擋。
- 草地與道路外圍存在連續水面邊界。
- 鏡頭移動時小隊維持在畫面中央附近，畫面只繪製視野周圍格位。
- 重新建立 `GameSimulation` 後，大地圖回到初始區段。
- 第 1、2 層至少生成指定數量房間。
- 所有房間可由起點到達。
- 樓梯位於可走格。
- 第 3 層只有 Boss 房且存在 Boss。
- 清怪前不可下樓，清怪後可下樓。

### 戰鬥

- 小隊會前往敵人並停止在攻擊範圍。
- 攻擊時 idle／attack frame 有可見變化。
- 角色 HP 不低於 1。
- SP 消耗與恢復正確。
- 敵人死亡後發放 XP 並可能掉落。

### 成長與 UI

- 升級 modal 顯示 1–3 個有效技能且模擬暫停。
- 選擇後技能生效、modal 關閉、模擬繼續。
- 較佳裝備會替換並顯示提示；較差裝備不替換。
- 卷軸數量為 0 時按鈕 disabled。
- 攻克第三層後回到大地圖並提升 dungeon run。

## 12. 風險與處理方式

| 風險 | 處理 |
| --- | --- |
| Ollama 一次產出過多導致品質不穩 | 小批次 allowedFiles、每批語法檢查與 diff 審查。 |
| CSV 外部資料載入失敗 | 啟動畫面顯示明確錯誤，不進入半初始化狀態。 |
| 程序地圖偶發不連通 | 先建立連通骨架再加隨機連線，並執行可達性檢查。 |
| 自動戰鬥卡住 | 尋路失敗時重選目標；超時後重新定位到最近可走格。 |
| 展示時間過長 | CSV 控制敵人數、HP、XP 與速度，預設每層約 1–2 分鐘。 |
| DTTO 角色公開使用授權不明 | 名稱、配色、sprite 全部可替換；MVP 不嵌入參考頁原圖。 |
| GitHub Pages 不支援本機 file:// fetch | README 使用本機 HTTP server；正式 Pages 不受影響。 |

## 13. 目前未知但不阻塞 MVP 的事項

- 最終是否有 DTTO Friends 角色與商標的公開使用授權。
- Google Sheet 未來要使用單一 workbook 多分頁，或多個公開 CSV URL。
- 最終角色名要直接使用 IP 名稱，或換成原創代稱。
- 最終 sprite sheet 是否由 Image 2.0 產生、人工繪製或由授權素材提供。

這些事項不影響目前以可替換資料與 sprite metadata 建立 Prototype。

## 14. 規格變更紀錄

| 日期 | 變更 | 原因 | 影響 |
| --- | --- | --- | --- |
| 2026-07-15 | 初版計畫；採純靜態 ES Modules | 沿用現有 GitHub Pages，避免新增 build 成本 | 新增 `src/` 模組，不新增 npm |
| 2026-07-15 | 採 manifest + CSV，不直接接 Google API | Google Sheet 空間尚未提供且 MVP 不需要私人權限 | 未來只需替換 manifest URL |
| 2026-07-15 | 自動尋路 MVP 採 BFS | 小地圖等權格不需要 A* 複雜度 | 保持簡單、容易驗證 |
| 2026-07-15 | 未確認授權前使用可替換原型角色圖形 | 指定角色是既有 IP，且網站將公開部署 | 系統與資料仍以 DTTO 職能／色彩方向設計 |
| 2026-07-15 | 固定 24px tile、40×22 地圖、房間邊長 4–7 | 同時容納 5–7 個房間並完整顯示於 960×540 Canvas | 不需要 camera 或地圖捲動 |
| 2026-07-15 | 升級佇列改為顯示時才產生技能選項 | Boss XP 可造成連升多級，預先產生會重複技能 | 四人共 16 次選技已驗證無重複 |
| 2026-07-15 | Ollama 產出經兩次回派仍不合格的模組由 Codex 接手 | 多次出現空 class、錯誤 import、未定義變數與語法錯誤 | 保留受限派工紀錄，最終模組皆由驗證器與瀏覽器驗收 |
| 2026-07-15 | 浮動傷害字改由 HP/SP bar、攻擊幀與事件列取代 | 使用者要求 HP/SP 增減表現，但未強制浮動字；MVP 優先完成可讀且穩定的循環 | 浮動字保留為後續視覺強化 |
| 2026-07-15 | 大地圖改為記憶體暫存的延展式 2.5D 組合地圖 | 展示早期遊戲由固定地塊與圖示持續拼接的探索感 | 新增大地圖生成模組、鏡頭跟隨、三層繪製與世界移動狀態；地下城規則不變 |
| 2026-07-15 | 大地圖採薄菱形島嶼拼片與連續水面底盤 | 使用者提供 2.5D OpenGL 地圖參考圖 | 地塊側面保持輕薄、場物直立並以深色輪廓營造層次 |

## 15. MVP 完成結果

- `python validate_project.py` 通過：6 個 ES Module、8 張 CSV、HTML 引用、數字欄、主鍵與外鍵全部有效。
- 地圖生成以 100 個 seed 驗證房間數、全房間連通、入口到樓梯路徑及 Boss 房。
- 無頭模擬在 517 個固定步長內完成三層地下城，四名角色皆保持 HP ≥ 1，且技能 ID 無重複。
- 卷軸測試確認 Fire Burst 造成 288 總傷害、Healing Light 恢復 208 總 HP。
- 瀏覽器實際完成 Cozy Cellar 三層與 Boss，執行 16 次升級選技後回到大地圖，下一站切換為 Midnight Workshop。
- 瀏覽器 console 沒有 error 或 warning。
- 600px viewport 時 body 無水平溢出，主畫面與 sidebar 都切換為單欄。

### 大地圖第一階段重構

- 新增執行階段 `Map` 暫存的延展式世界地圖；重建 `GameSimulation` 即回到初始地圖。
- 連續生成 8 個區段測試通過：共 2,434 格、139 格主路，所有主路逐格連通且沒有非地下城場物阻擋。
- 測試結果包含 182 道路、1,389 草地、863 水面，以及樹木、灌木、地下城、大石頭、小石頭五類場物。
- 無頭流程在 59 個世界移動步長後抵達入口，並在 517 個地下城步長後回到大地圖；地圖由 1 區延展為 2 區且開始前往下一入口。
- 瀏覽器確認隊伍保持 Canvas 中央、地圖隨隊伍移動、抵達前隱藏入口按鈕、抵達後顯示按鈕，且可正常進入地下城第 1 層。
- 大地圖視覺依參考圖調整為薄菱形島嶼、連續水面底盤、亮色地形外緣及直立深色描邊場物。
