from __future__ import annotations

import csv
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit


if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


REFERENCE_PATTERN = re.compile(r"(?:src|href)=[\"']([^\"']+)[\"']", re.IGNORECASE)
DATA_VERSION_PATTERN = re.compile(r"^\d{8}\.\d+$")
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
TABLE_FILES = {
    "balance": "balance.csv",
    "characters": "characters.csv",
    "skills": "skills.csv",
    "enemies": "enemies.csv",
    "items": "items.csv",
    "lootTables": "loot_tables.csv",
    "scrolls": "scrolls.csv",
    "dungeons": "dungeons.csv",
}
SCHEMAS = {
    "balance": ["key", "value", "type", "description"],
    "characters": [
        "characterId", "name", "role", "combatStyle", "attackType", "color", "spriteId", "maxHp", "maxSp",
        "attack", "defense", "speed", "attackRange", "attackCooldownMs",
        "basicSkillId", "skillPoolId",
    ],
    "skills": [
        "skillId", "skillPoolId", "name", "description", "effectType", "targetType",
        "power", "spCost", "cooldownMs", "requiredLevel", "iconId",
    ],
    "enemies": [
        "enemyId", "name", "tier", "color", "spriteId", "maxHp", "attack", "defense",
        "speed", "attackRange", "attackCooldownMs", "xp", "lootTableId", "isBoss",
    ],
    "items": [
        "itemId", "name", "slot", "rarity", "iconId", "attackBonus", "defenseBonus",
        "maxHpBonus", "maxSpBonus", "score",
    ],
    "lootTables": [
        "lootTableId", "dropType", "dropId", "weight", "chance", "minQuantity", "maxQuantity",
    ],
    "scrolls": [
        "scrollId", "name", "description", "effectType", "targetType", "power", "spCost",
        "iconId", "initialQuantity",
    ],
    "dungeons": [
        "dungeonId", "name", "themeColor", "enemyPool", "floor1EnemyCount",
        "floor2EnemyCount", "bossEnemyId", "difficultyScale",
    ],
}
NUMBER_FIELDS = {
    "characters": ["maxHp", "maxSp", "attack", "defense", "speed", "attackRange", "attackCooldownMs"],
    "skills": ["power", "spCost", "cooldownMs", "requiredLevel"],
    "enemies": ["tier", "maxHp", "attack", "defense", "speed", "attackRange", "attackCooldownMs", "xp"],
    "items": ["attackBonus", "defenseBonus", "maxHpBonus", "maxSpBonus", "score"],
    "lootTables": ["weight", "chance", "minQuantity", "maxQuantity"],
    "scrolls": ["power", "spCost", "initialQuantity"],
    "dungeons": ["floor1EnemyCount", "floor2EnemyCount", "difficultyScale"],
}
PRIMARY_KEYS = {
    "balance": "key",
    "characters": "characterId",
    "skills": "skillId",
    "enemies": "enemyId",
    "items": "itemId",
    "scrolls": "scrollId",
    "dungeons": "dungeonId",
}


def local_reference(value: str) -> str | None:
    if value.startswith(("#", "data:", "mailto:", "javascript:")):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    return parsed.path.lstrip("/") or None


def find_node() -> str | None:
    node = shutil.which("node")
    if node:
        return node
    if sys.platform == "win32":
        candidates = [
            Path(os.environ.get("ProgramFiles", "C:/Program Files")) / "nodejs/node.exe",
            Path.home() / ".cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe",
        ]
        for candidate in candidates:
            if candidate.is_file():
                return str(candidate)
    return None


def check_html_and_javascript(root: Path, errors: list[str]) -> int:
    index = root / "index.html"
    if not index.is_file():
        errors.append("找不到 index.html")
        return 0

    html = index.read_text(encoding="utf-8")
    javascript: set[Path] = set()
    for value in REFERENCE_PATTERN.findall(html):
        relative = local_reference(value)
        if not relative:
            continue
        target = root / relative
        if not target.is_file():
            errors.append(f"index.html 引用不存在：{relative}")
        elif target.suffix.lower() in {".js", ".mjs"}:
            javascript.add(target)

    source_root = root / "src"
    if source_root.is_dir():
        javascript.update(source_root.rglob("*.js"))
        javascript.update(source_root.rglob("*.mjs"))

    node = find_node()
    if not node:
        errors.append("找不到 Node.js，無法執行 JavaScript 語法檢查")
        return 0
    for script in sorted(javascript):
        result = subprocess.run(
            [node, "--check", str(script)],
            cwd=root,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if result.returncode:
            detail = (result.stderr or result.stdout).strip()
            errors.append(f"JavaScript 語法錯誤：{script.relative_to(root)}\n{detail}")
    return len(javascript)


def read_manifest(root: Path, errors: list[str]) -> dict:
    path = root / "data/manifest.json"
    if not path.is_file():
        errors.append("找不到 data/manifest.json")
        return {}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as exc:
        errors.append(f"manifest.json 格式錯誤：{exc}")
        return {}

    tables = manifest.get("tables")
    if not isinstance(tables, dict):
        errors.append("manifest.json 的 tables 必須是物件")
        return manifest
    expected = set(TABLE_FILES)
    actual = set(tables)
    if actual != expected:
        missing = sorted(expected - actual)
        extra = sorted(actual - expected)
        if missing:
            errors.append(f"manifest 缺少資料表：{', '.join(missing)}")
        if extra:
            errors.append(f"manifest 含未知資料表：{', '.join(extra)}")

    versions = manifest.get("versions")
    if not isinstance(versions, dict):
        errors.append("manifest.json 的 versions 必須是物件")
        return manifest
    version_keys = set(versions)
    if version_keys != expected:
        missing = sorted(expected - version_keys)
        extra = sorted(version_keys - expected)
        if missing:
            errors.append(f"manifest versions 缺少資料表：{', '.join(missing)}")
        if extra:
            errors.append(f"manifest versions 含未知資料表：{', '.join(extra)}")
    for table_name, metadata in versions.items():
        if not isinstance(metadata, dict):
            errors.append(f"manifest versions.{table_name} 必須是物件")
            continue
        version = metadata.get("version")
        digest = metadata.get("sha256")
        if not isinstance(version, str) or not DATA_VERSION_PATTERN.fullmatch(version):
            errors.append(f"manifest versions.{table_name}.version 必須符合 YYYYMMDD.N")
        if not isinstance(digest, str) or not SHA256_PATTERN.fullmatch(digest):
            errors.append(f"manifest versions.{table_name}.sha256 必須是 64 位小寫 SHA-256")
    return manifest


def read_tables(root: Path, manifest: dict, errors: list[str]) -> dict[str, list[dict[str, str]]]:
    rows_by_table: dict[str, list[dict[str, str]]] = {}
    for table_name, expected_file in TABLE_FILES.items():
        value = manifest.get("tables", {}).get(table_name)
        if not isinstance(value, str) or not value:
            continue
        parsed = urlsplit(value)
        if parsed.scheme in {"http", "https"}:
            continue
        relative = parsed.path.lstrip("/")
        path = root / relative
        if not path.is_file():
            errors.append(f"{table_name} 對應檔案不存在：{relative}")
            continue
        if path.name != expected_file:
            errors.append(f"{table_name} 應指向 {expected_file}，目前為 {path.name}")
        try:
            digest = hashlib.sha256(path.read_bytes()).hexdigest()
            expected_digest = manifest.get("versions", {}).get(table_name, {}).get("sha256")
            if expected_digest and digest != expected_digest:
                errors.append(
                    f"{relative} 內容雜湊與 manifest 不符；"
                    f"目前 {digest[:12]}，manifest {expected_digest[:12]}。請透過同步工具更新版本。"
                )
            with path.open("r", encoding="utf-8", newline="") as stream:
                reader = csv.DictReader(stream)
                actual_fields = reader.fieldnames or []
                if actual_fields != SCHEMAS[table_name]:
                    errors.append(
                        f"{relative} 欄位不符；預期 {','.join(SCHEMAS[table_name])}；"
                        f"實際 {','.join(actual_fields)}"
                    )
                rows_by_table[table_name] = list(reader)
        except (OSError, csv.Error) as exc:
            errors.append(f"無法讀取 {relative}：{exc}")
    return rows_by_table


def check_numbers(rows_by_table: dict[str, list[dict[str, str]]], errors: list[str]) -> None:
    for table_name, fields in NUMBER_FIELDS.items():
        for row_number, row in enumerate(rows_by_table.get(table_name, []), start=2):
            for field in fields:
                try:
                    float(row.get(field, ""))
                except (TypeError, ValueError):
                    errors.append(f"{table_name} 第 {row_number} 列 {field} 不是數字：{row.get(field)!r}")

    for row_number, row in enumerate(rows_by_table.get("balance", []), start=2):
        if row.get("type") == "number":
            try:
                float(row.get("value", ""))
            except (TypeError, ValueError):
                errors.append(f"balance 第 {row_number} 列 value 不是數字：{row.get('value')!r}")


def build_ids(rows_by_table: dict[str, list[dict[str, str]]], errors: list[str]) -> dict[str, set[str]]:
    ids: dict[str, set[str]] = {}
    for table_name, key in PRIMARY_KEYS.items():
        seen: set[str] = set()
        for row_number, row in enumerate(rows_by_table.get(table_name, []), start=2):
            value = (row.get(key) or "").strip()
            if not value:
                errors.append(f"{table_name} 第 {row_number} 列 {key} 為空白")
            elif value in seen:
                errors.append(f"{table_name} 主鍵重複：{value}")
            seen.add(value)
        ids[table_name] = seen
    return ids


def check_foreign_keys(
    rows_by_table: dict[str, list[dict[str, str]]],
    ids: dict[str, set[str]],
    errors: list[str],
) -> None:
    skill_pools = {row.get("skillPoolId", "") for row in rows_by_table.get("skills", [])}
    loot_table_ids = {row.get("lootTableId", "") for row in rows_by_table.get("lootTables", [])}
    enemy_rows = {row.get("enemyId", ""): row for row in rows_by_table.get("enemies", [])}

    for row in rows_by_table.get("characters", []):
        character_id = row.get("characterId", "")
        if row.get("combatStyle") not in {"melee", "ranged"}:
            errors.append(f"characters.{character_id} combatStyle 必須是 melee 或 ranged")
        if row.get("attackType") not in {"physical", "magic"}:
            errors.append(f"characters.{character_id} attackType 必須是 physical 或 magic")
        if row.get("basicSkillId") not in ids.get("skills", set()):
            errors.append(f"characters.{character_id} 找不到 basicSkillId：{row.get('basicSkillId')}")
        if row.get("skillPoolId") not in skill_pools:
            errors.append(f"characters.{character_id} 找不到 skillPoolId：{row.get('skillPoolId')}")

    for row in rows_by_table.get("enemies", []):
        if row.get("lootTableId") not in loot_table_ids:
            errors.append(f"enemies.{row.get('enemyId')} 找不到 lootTableId：{row.get('lootTableId')}")
        if row.get("isBoss", "").lower() not in {"true", "false"}:
            errors.append(f"enemies.{row.get('enemyId')} 的 isBoss 必須是 true 或 false")

    for row in rows_by_table.get("lootTables", []):
        try:
            chance = float(row.get("chance", ""))
            if not 0 <= chance <= 1:
                errors.append(f"loot_tables chance 超出 0–1：{chance}")
        except (TypeError, ValueError):
            pass
        drop_type = row.get("dropType")
        drop_id = row.get("dropId")
        if drop_type == "item" and drop_id not in ids.get("items", set()):
            errors.append(f"loot_tables 找不到 item：{drop_id}")
        elif drop_type == "scroll" and drop_id not in ids.get("scrolls", set()):
            errors.append(f"loot_tables 找不到 scroll：{drop_id}")
        elif drop_type not in {"item", "scroll"}:
            errors.append(f"loot_tables 使用未知 dropType：{drop_type}")

    for row in rows_by_table.get("dungeons", []):
        dungeon_id = row.get("dungeonId", "")
        for enemy_id in filter(None, (value.strip() for value in row.get("enemyPool", "").split("|"))):
            if enemy_id not in ids.get("enemies", set()):
                errors.append(f"dungeons.{dungeon_id} 找不到 enemyPool 成員：{enemy_id}")
        boss_id = row.get("bossEnemyId", "")
        boss = enemy_rows.get(boss_id)
        if not boss:
            errors.append(f"dungeons.{dungeon_id} 找不到 bossEnemyId：{boss_id}")
        elif boss.get("isBoss", "").lower() != "true":
            errors.append(f"dungeons.{dungeon_id} 的 Boss 未標記 isBoss=true")


def main() -> int:
    root = Path.cwd()
    errors: list[str] = []
    js_count = check_html_and_javascript(root, errors)
    manifest = read_manifest(root, errors)
    rows_by_table = read_tables(root, manifest, errors) if manifest else {}
    check_numbers(rows_by_table, errors)
    ids = build_ids(rows_by_table, errors)
    check_foreign_keys(rows_by_table, ids, errors)

    if errors:
        print("驗證失敗：", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(
        f"驗證通過：index.html 引用完整；已檢查 {js_count} 個 JavaScript 檔案；"
        f"已檢查 {len(rows_by_table)} 張資料表；主鍵、數字欄與外鍵均有效。"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
