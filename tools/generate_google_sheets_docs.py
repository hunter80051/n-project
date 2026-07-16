from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = Path(__file__).resolve().parent / "game_data_schema.json"
OUTPUT_PATH = ROOT / "GOOGLE-SHEETS-FIELD-GUIDE.md"
STATUS_LABELS = {
    "implemented": "已實作",
    "partial": "部分實作",
    "not_implemented": "尚未實作",
}


def main() -> None:
    schema = json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))
    lines = [
        "# Google Sheets 遊戲配置欄位完整說明",
        "",
        "本文件由 `tools/game_data_schema.json` 產生，說明 Google Sheet 八張資料分頁的欄位、填寫規範與目前程式支援狀態。",
        "",
        "實作狀態定義：",
        "",
        "- **已實作**：目前遊戲會讀取並使用此欄位。",
        "- **部分實作**：欄位有被讀取，但只有部分值或行為已接入遊戲。",
        "- **尚未實作**：欄位目前只作為預留或文件資訊，修改不會改變遊戲行為。",
        "",
        "所有 ID 關聯都依字串比對，不依賴資料列順序；但角色顯示順序、地下城輪替順序與卷軸顯示順序仍會受到資料列順序影響。",
        "",
    ]

    for index, (_, table) in enumerate(schema["tables"].items(), start=1):
        lines.extend([
            f"## {index}. `{table['sheetName']}`",
            "",
            f"- CSV：`data/{table['fileName']}`",
            f"- 用途：{table['description']}",
            f"- 資料列識別：`{' + '.join(table['identityFields'])}`",
            "",
            "### 欄位",
            "",
        ])
        for field in table["fields"]:
            status = STATUS_LABELS[field["implementation"]]
            lines.extend([
                f"- `{field['name']}`",
                f"  - 功能：{field['function']}",
                f"  - 填寫規範：{field['rules']}",
                f"  - 實作狀態：**{status}**。",
            ])
            if field.get("note"):
                lines.append(f"  - 補充：{field['note']}")
        lines.append("")

        if table.get("currentKeys"):
            lines.extend(["### 目前 balance key 接線狀態", ""])
            for entry in table["currentKeys"]:
                status = STATUS_LABELS[entry["implementation"]]
                suffix = f"：{entry['note']}" if entry.get("note") else ""
                lines.append(f"- `{entry['key']}`：**{status}**{suffix}")
            lines.append("")

    lines.extend([
        "## 共通防呆規則",
        "",
        "- 不可修改、翻譯或重新排列第一列表頭。",
        "- 不可使用公式；同步工具只接受固定值。",
        "- 新增資料可以使用新 ID；刪除或改名既有穩定 ID 預設會阻擋。",
        "- 百分比與機率使用 0–1 小數，例如 `0.25` 代表 25%。",
        "- `enemyPool` 使用 `|` 分隔，不可使用逗號。",
        "- 只有同步檢查全部通過時，才可覆寫 repository 內的 CSV。",
        "- 未實作欄位仍必須保留，避免破壞既有 CSV schema。",
        "",
    ])
    OUTPUT_PATH.write_text("\n".join(lines), encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
