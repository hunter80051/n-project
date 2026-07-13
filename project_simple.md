# 專案計畫書：基於通訊頻道隔離的混合型雙 AI Agent 協作編程系統 (Multi-Project Edition)

## 1. 核心理念與願景 (Core Concept)
本專案旨在通訊軟體（Discord 或 Slack）中建立一個自動化的「AI 聯合辦公室」。透過串聯兩個不同特性的 AI 智能體（Agent），達成兼顧「高智能架構規劃」與「低成本、無審查大量碼農產出」的黃金平衡，並讓人類主管（PM）能在頻道中隨時追蹤、干預並核准進度。

本系統採用**「頻道即專案」**的隔離架構，由負責架構的 Claude Agent 擔任頻道總管。當不同的通訊頻道（Channel）收到指令時，系統會自動切換並對應到伺服器上不同的專案資料夾目錄，實現單一系統、多專案獨立併發管理。

*   **智能體 A (Claude Agent - 總架構師、頻道管理員、質檢員)**：負責高難度的專案規劃、任務拆解、環境部署、終端機測試、頻道專案目錄映射，與最終 Debug 驗證。
*   **智能體 B (OpenCode/Local Agent - 高產碼農)**：調用本地開源越獄模型（如 Qwen 2.5 Coder Abliterated），專注於高內聚、單一任務的爆量程式碼編寫，負責實作 Claude 拆解出的具體檔案。

---

## 2. 工具需求與技術棧 (Stack & Tools)

### A. 基礎運行環境
*   **Python 3.10+**：核心邏輯與智能體框架的運行環境。
*   **Git**：版本控制工具，用於在雙 AI 切換任務時進行代碼狀態錨定（Commit & Rollback）。
*   **Ollama / LM Studio**：用於在本地託管與運行開源越獄模型。

### B. 核心 AI 模型
*   **雲端模型（專案規劃/驗證/頻道管理）**：`anthropic/claude-3-7-sonnet` (或最新版本)，需配置 API Key。
*   **本地模型（代碼編寫）**：`qwen2.5-coder-abliterated:32b` (或 14b)，透過 Ollama 本地 API 暴露。

### C. 開發框架與套件
*   **智能體編排框架**：`CrewAI` 或 `LangGraph` (用於定義 Agent 角色、任務流與工具權限)。
*   **模型轉譯網關**：`LiteLLM` (若需要將本地模型的 API 格式統一封裝為 OpenAI/Anthropic 標準格式)。
*   **通訊整合套件**：`discord.py` 或 `@slack/bolt` (用於監聽頻道訊息與透過 Webhook 發送進度)。

---

## 3. 系統架構與「頻道-目錄」動態映射

為了達成多專案隔離，系統需維護一個組態設定檔（如 `config.json`），將通訊軟體的頻道 ID 與本地/伺服器上的專案路徑進行靜態或動態綁定：

```json
{
  "channels": {
    "123456789012345678": {
      "project_name": "ecommerce-frontend",
      "local_path": "/home/workspace/ecommerce-frontend",
      "branch": "main"
    },
    "987654321098765432": {
      "project_name": "payment-gateway-api",
      "local_path": "/home/workspace/payment-api",
      "branch": "develop"
    }
  }
}
```

### 工具權限劃分 (Security & Privilege)

| 智能體角色 | 核心 LLM 底座 | 獲配工具權限 (Tools) | 核心職責與目錄限制 |
| :--- | :--- | :--- | :--- |
| **Claude-Architect** | Claude 3.7 Sonnet | 1. 檔案讀取 (`FileRead`) <br>2. 終端機執行 (`CLI_Command`) <br>3. 目錄映射切換工具 | 分析專案、撰寫 `plan.md`、運行測試腳本。根據**當前觸發的頻道 ID**，將當前工作目錄（CWD）切換至目標路徑。 |
| **OpenCode-Worker** | Qwen 2.5 Coder | 1. 檔案寫入/修改 (`FileEdit`) <br>*(嚴禁給予 CLI 執行權限)* | 僅能在 Claude 切換好的目標專案目錄內，依據 `plan.md` 規格專注編寫特定檔案，無法越權執行指令。 |

---

## 4. 四階段標準作業程序與文字指令集 (SOP & Text Commands)

任何負責實作本專案的 AI Agent，必須依照以下狀態機邏輯編寫程式碼，全流程透過**文字指令**驅動：

### 核心文字指令定義
*   `!build [功能描述]`：開始全新開發任務。
*   `!approve`：人類核准測試結果，觸發 Git 合併/保存。
*   `!retry`：人類拒絕當前成果，要求 Claude 重新檢視報錯並修正。
*   `!status`：查詢當前頻道綁定的專案路徑與 Agent 執行狀態。

### 四階段 SOP 執行邏輯
1.  **規劃與路由階段 (Routing)**：
    *   人類在特定頻道輸入 `!build 新增功能描述`。
    *   **Claude 總管**讀取該頻道 ID，比對 `config.json`，將系統 CWD 切換至對應的 `local_path`。
    *   Claude 掃描該目錄，輸出 `plan.md`，將任務拆解為獨立代碼模組。
2.  **編寫階段 (Coding)**：
    *   系統自動觸發 OpenCode Local Agent 讀取 `plan.md`。
    *   OpenCode 在該專案路徑下生成或修改程式碼檔案。
3.  **錨定階段 (Git Anchor)**：
    *   修改完成後，系統在該專案目錄背景自動執行 `git add .` 與 `git commit -m "feat: boded by local open_coder"`，確保版本安全。
4.  **驗證與文字審查階段 (Verification & Approval)**：
    *   喚醒 Claude，由 Claude 在該專案目錄執行測試指令（如 `pytest` 或 `npm test`）。
    *   若測試失敗，Claude 自動讀取報錯並修正代碼，重跑直到成功（上限 3 次，超過則在頻道 `@人類` 尋求人工介入）。
    *   測試成功後，系統暫停並於頻道提示：`請輸入 !approve 核准 或 !retry 重試`。
    *   人類輸入 `!approve` 後，完成此階段任務。

---

## 5. Discord / Slack 互動介面與運作模擬

[#專案A-前端開發 頻道]
[User] !build 新增登入頁面 RWD 樣式
[Claude-Agent] 📡 偵測到頻道 [#專案A-前端開發]，已自動切換工作目錄至
 /workspace/ecommerce-frontend。
[Claude-Agent] 📝 已生成 plan.md。劃分 1 個任務。@Open-Coder 請執行任務 (修改 Login.tsx)
[Open-Coder-Agent] 🛠️ 任務完成。已重構 src/components/Login.tsx。@Claude-Agent 請驗證。
[Claude-Agent] 🔍 執行 npm test 中... ✅ 綠燈通過！
[Claude-Agent] 🔔 專案A 測試已成功。請人類主管輸入 !approve 進行確認，或 !retry 重新調整。
[User] !approve
[Claude-Agent] 🚀 收到核准！專案代碼已成功錨定並儲存。
 
 ***
 
[#專案B-支付後台 頻道]
[User] !build 修復金流 Webhook 驗證失敗的 Bug
[Claude-Agent] 📡 偵測到頻道 [#專案B-支付後台]，已自動切換工作目錄至
 /workspace/payment-api。
 ... (以下重複專案 B 獨立目錄的 SOP)