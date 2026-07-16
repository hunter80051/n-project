from __future__ import annotations

import argparse
import copy
import csv
import hashlib
import io
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TOOLS_DIR = Path(__file__).resolve().parent
SCHEMA_PATH = TOOLS_DIR / "game_data_schema.json"
DEFAULT_CONFIG_PATH = ROOT / "google_sheets_sync.json"
MANIFEST_PATH = ROOT / "data" / "manifest.json"
SYNC_DIR = ROOT / ".sheet-sync"
ID_PATTERN = re.compile(r"^[a-z][a-z0-9_]*$")
BALANCE_KEY_PATTERN = re.compile(r"^[A-Za-z][A-Za-z0-9]*$")
SHEETS_READONLY_SCOPE = "https://www.googleapis.com/auth/spreadsheets.readonly"

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")

sys.path.insert(0, str(ROOT))
import validate_project as project_validator  # noqa: E402


def load_json(path: Path) -> dict[str, Any]:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise RuntimeError(f"找不到設定檔：{path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"JSON 格式錯誤：{path}（{exc}）") from exc


def load_schema() -> dict[str, Any]:
    schema = load_json(SCHEMA_PATH)
    errors: list[str] = []
    if set(schema.get("tables", {})) != set(project_validator.TABLE_FILES):
        errors.append("game_data_schema.json 的資料表集合與 validate_project.py 不一致")
    for table_name, table in schema.get("tables", {}).items():
        headers = [field["name"] for field in table.get("fields", [])]
        if headers != project_validator.SCHEMAS.get(table_name):
            errors.append(f"{table_name} 欄位與 validate_project.py 不一致")
        if table.get("fileName") != project_validator.TABLE_FILES.get(table_name):
            errors.append(f"{table_name} fileName 與 validate_project.py 不一致")
    if errors:
        raise RuntimeError("Schema 定義不一致：\n- " + "\n- ".join(errors))
    return schema


def canonical_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if value.is_integer():
            return str(int(value))
        return format(value, ".15g")
    return str(value)


def rows_to_csv_bytes(
    headers: list[str], rows: list[dict[str, str]], line_terminator: str = "\n"
) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=headers, lineterminator=line_terminator, extrasaction="raise")
    writer.writeheader()
    writer.writerows(rows)
    return stream.getvalue().encode("utf-8")


def read_csv_source(source_dir: Path, schema: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    result: dict[str, list[dict[str, str]]] = {}
    for table_name, table in schema["tables"].items():
        path = source_dir / table["fileName"]
        if not path.is_file():
            raise RuntimeError(f"本機來源缺少：{path}")
        with path.open("r", encoding="utf-8", newline="") as stream:
            reader = csv.DictReader(stream)
            headers = reader.fieldnames or []
            expected = [field["name"] for field in table["fields"]]
            if headers != expected:
                raise RuntimeError(
                    f"{path.name} 表頭不符；預期 {','.join(expected)}；實際 {','.join(headers)}"
                )
            result[table_name] = [
                {header: canonical_cell(row.get(header, "")) for header in headers}
                for row in reader
                if any(canonical_cell(row.get(header, "")).strip() for header in headers)
            ]
    return result


def column_name(count: int) -> str:
    value = count
    result = ""
    while value:
        value, remainder = divmod(value - 1, 26)
        result = chr(65 + remainder) + result
    return result


def resolve_project_path(value: str) -> Path:
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def build_google_credentials(config: dict[str, Any], config_path: Path) -> Any:
    auth_mode = str(config.get("authMode", "oauth")).strip().lower()
    try:
        from googleapiclient.discovery import build  # noqa: F401
    except ImportError as exc:
        raise RuntimeError("尚未安裝 Google Sheets 同步套件，請先執行 Setup Google Sheets Sync.bat") from exc

    if auth_mode == "oauth":
        try:
            from google.auth.exceptions import RefreshError
            from google.auth.transport.requests import Request
            from google.oauth2.credentials import Credentials
            from google_auth_oauthlib.flow import InstalledAppFlow
        except ImportError as exc:
            raise RuntimeError("OAuth 套件不完整，請重新執行 Setup Google Sheets Sync.bat") from exc

        client_value = str(config.get("oauthClientFile", "secrets/google-oauth-client.json")).strip()
        token_value = str(config.get("oauthTokenFile", "secrets/google-oauth-token.json")).strip()
        if not client_value or not token_value:
            raise RuntimeError(f"請在 {config_path.name} 填入 oauthClientFile 與 oauthTokenFile")
        client_path = resolve_project_path(client_value)
        token_path = resolve_project_path(token_value)
        if not client_path.is_file():
            raise RuntimeError(f"找不到 OAuth 桌面應用程式 JSON：{client_path}")
        client_config = load_json(client_path)
        if not isinstance(client_config.get("installed"), dict):
            raise RuntimeError(f"{client_path.name} 不是 OAuth 電腦版應用程式 JSON")

        credentials = None
        if token_path.is_file():
            try:
                credentials = Credentials.from_authorized_user_file(
                    str(token_path), [SHEETS_READONLY_SCOPE]
                )
            except (ValueError, json.JSONDecodeError):
                credentials = None
        if credentials and credentials.expired and credentials.refresh_token:
            try:
                credentials.refresh(Request())
            except RefreshError:
                credentials = None
        if not credentials or not credentials.valid:
            flow = InstalledAppFlow.from_client_secrets_file(
                str(client_path), [SHEETS_READONLY_SCOPE]
            )
            print("即將開啟瀏覽器進行 Google 唯讀授權；請使用可存取目標 Sheet 的帳號登入。")
            credentials = flow.run_local_server(
                host="localhost",
                port=0,
                open_browser=True,
                authorization_prompt_message="請在瀏覽器完成 Google Sheets 唯讀授權：{url}",
                success_message="Google Sheets 唯讀授權完成，可以關閉此頁面並返回同步視窗。",
            )
        token_path.parent.mkdir(parents=True, exist_ok=True)
        token_path.write_text(credentials.to_json() + "\n", encoding="utf-8")
        return credentials

    if auth_mode == "service_account":
        try:
            from google.oauth2 import service_account
        except ImportError as exc:
            raise RuntimeError("服務帳戶套件不完整，請重新執行 Setup Google Sheets Sync.bat") from exc
        credentials_value = str(config.get("credentialsFile", "")).strip()
        if not credentials_value:
            raise RuntimeError(f"請在 {config_path.name} 填入 credentialsFile")
        credentials_path = resolve_project_path(credentials_value)
        if not credentials_path.is_file():
            raise RuntimeError(f"找不到 Google 服務帳戶憑證：{credentials_path}")
        return service_account.Credentials.from_service_account_file(
            str(credentials_path), scopes=[SHEETS_READONLY_SCOPE]
        )

    raise RuntimeError(f"不支援的 authMode：{auth_mode}；請使用 oauth 或 service_account")


def read_google_sheets(config_path: Path, schema: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    config = load_json(config_path)
    spreadsheet_id = str(config.get("spreadsheetId", "")).strip()
    if not spreadsheet_id or spreadsheet_id == "PASTE_SPREADSHEET_ID_HERE":
        raise RuntimeError(f"請在 {config_path.name} 填入 spreadsheetId")

    try:
        from googleapiclient.discovery import build
    except ImportError as exc:
        raise RuntimeError("尚未安裝 Google Sheets 同步套件，請先執行 Setup Google Sheets Sync.bat") from exc

    credentials = build_google_credentials(config, config_path)
    service = build("sheets", "v4", credentials=credentials, cache_discovery=False)
    table_entries = list(schema["tables"].items())
    ranges = []
    for _, table in table_entries:
        end_column = column_name(len(table["fields"]))
        ranges.append(f"'{table['sheetName']}'!A:{end_column}")

    formula_response = service.spreadsheets().values().batchGet(
        spreadsheetId=spreadsheet_id,
        ranges=ranges,
        majorDimension="ROWS",
        valueRenderOption="FORMULA",
    ).execute()
    value_response = service.spreadsheets().values().batchGet(
        spreadsheetId=spreadsheet_id,
        ranges=ranges,
        majorDimension="ROWS",
        valueRenderOption="UNFORMATTED_VALUE",
        dateTimeRenderOption="SERIAL_NUMBER",
    ).execute()

    formula_ranges = formula_response.get("valueRanges", [])
    value_ranges = value_response.get("valueRanges", [])
    if len(formula_ranges) != len(table_entries) or len(value_ranges) != len(table_entries):
        raise RuntimeError("Google Sheets API 未回傳完整的 8 張分頁")

    result: dict[str, list[dict[str, str]]] = {}
    errors: list[str] = []
    for index, (table_name, table) in enumerate(table_entries):
        expected = [field["name"] for field in table["fields"]]
        formula_values = formula_ranges[index].get("values", [])
        values = value_ranges[index].get("values", [])
        if not values:
            errors.append(f"分頁 {table['sheetName']} 沒有表頭")
            continue
        headers = [canonical_cell(value).strip() for value in values[0]]
        if headers != expected:
            errors.append(
                f"分頁 {table['sheetName']} 表頭不符；預期 {','.join(expected)}；實際 {','.join(headers)}"
            )
            continue
        for row_number, formula_row in enumerate(formula_values[1:], start=2):
            for column_index, cell in enumerate(formula_row):
                if isinstance(cell, str) and cell.startswith("="):
                    field_name = expected[column_index] if column_index < len(expected) else f"第 {column_index + 1} 欄"
                    errors.append(f"分頁 {table['sheetName']} 第 {row_number} 列 {field_name} 不可使用公式")

        rows: list[dict[str, str]] = []
        for row_number, row in enumerate(values[1:], start=2):
            if len(row) > len(expected):
                errors.append(f"分頁 {table['sheetName']} 第 {row_number} 列超出預期欄位數")
                continue
            normalized = [canonical_cell(value) for value in row]
            normalized.extend([""] * (len(expected) - len(normalized)))
            if not any(value.strip() for value in normalized):
                continue
            rows.append(dict(zip(expected, normalized, strict=True)))
        result[table_name] = rows

    if errors:
        raise RuntimeError("Google Sheet 讀取失敗：\n- " + "\n- ".join(errors))
    return result


def parse_number(value: str) -> float | None:
    try:
        return float(value)
    except ValueError:
        return None


def rows_equal_for_sync(
    incoming_rows: list[dict[str, str]],
    current_rows: list[dict[str, str]],
    fields: list[dict[str, Any]],
) -> bool:
    if len(incoming_rows) != len(current_rows):
        return False
    for incoming_row, current_row in zip(incoming_rows, current_rows, strict=True):
        for field in fields:
            name = field["name"]
            incoming = incoming_row.get(name, "")
            current = current_row.get(name, "")
            if field.get("kind") in {"number", "integer"}:
                incoming_number = parse_number(incoming)
                current_number = parse_number(current)
                if incoming_number is not None and incoming_number == current_number:
                    continue
            if incoming != current:
                return False
    return True


def validate_strict(
    rows_by_table: dict[str, list[dict[str, str]]],
    schema: dict[str, Any],
    current_rows: dict[str, list[dict[str, str]]],
    allow_id_changes: bool,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    for table_name, table in schema["tables"].items():
        rows = rows_by_table.get(table_name, [])
        exact_rows = table.get("exactRows")
        if exact_rows is not None and len(rows) != exact_rows:
            errors.append(f"{table['sheetName']} 必須正好有 {exact_rows} 筆資料，目前為 {len(rows)}")
        identities: set[tuple[str, ...]] = set()
        for row_number, row in enumerate(rows, start=2):
            for field in table["fields"]:
                name = field["name"]
                value = row.get(name, "")
                stripped = value.strip()
                if field.get("required") and stripped == "":
                    errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 不可空白")
                    continue
                if stripped == "":
                    continue
                kind = field.get("kind")
                if kind == "id":
                    if value != stripped or not ID_PATTERN.fullmatch(stripped):
                        errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 必須是小寫英數底線 ID")
                elif kind == "balanceKey":
                    if value != stripped or not BALANCE_KEY_PATTERN.fullmatch(stripped):
                        errors.append(f"balance 第 {row_number} 列 key 必須是英數 camelCase")
                elif kind == "color" and not re.fullmatch(r"#[0-9A-Fa-f]{6}", stripped):
                    errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 必須是 #RRGGBB")
                elif kind == "boolean" and stripped.lower() not in {"true", "false"}:
                    errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 只可填 true 或 false")
                elif kind == "enum" and stripped not in field.get("enum", []):
                    errors.append(
                        f"{table['sheetName']} 第 {row_number} 列 {name} 必須是：{', '.join(field.get('enum', []))}"
                    )
                elif kind in {"number", "integer"}:
                    number = parse_number(stripped)
                    if number is None:
                        errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 不是有效數字")
                    else:
                        if kind == "integer" and not number.is_integer():
                            errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 必須是整數")
                        if field.get("min") is not None and number < field["min"]:
                            errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 不可小於 {field['min']}")
                        if field.get("max") is not None and number > field["max"]:
                            errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 不可大於 {field['max']}")
                elif kind == "idList":
                    members = [member.strip() for member in stripped.split("|") if member.strip()]
                    if not members or any(not ID_PATTERN.fullmatch(member) for member in members):
                        errors.append(f"{table['sheetName']} 第 {row_number} 列 {name} 必須是以 | 分隔的有效 ID")

            identity = tuple(row.get(field, "").strip() for field in table["identityFields"])
            if identity in identities:
                errors.append(f"{table['sheetName']} 第 {row_number} 列識別欄位重複：{' / '.join(identity)}")
            identities.add(identity)

        if table.get("stableIds") and not allow_id_changes:
            old_ids = {
                tuple(row.get(field, "").strip() for field in table["identityFields"])
                for row in current_rows.get(table_name, [])
            }
            new_ids = {
                tuple(row.get(field, "").strip() for field in table["identityFields"])
                for row in rows
            }
            removed = sorted(old_ids - new_ids)
            if removed:
                errors.append(
                    f"{table['sheetName']} 移除或改名既有 ID："
                    + ", ".join("/".join(value) for value in removed)
                    + "；如確定要變更，請由 Codex 審查並使用 --allow-id-changes"
                )

    loot_rows = rows_by_table.get("lootTables", [])
    for row_number, row in enumerate(loot_rows, start=2):
        minimum = parse_number(row.get("minQuantity", ""))
        maximum = parse_number(row.get("maxQuantity", ""))
        if minimum is not None and maximum is not None and minimum > maximum:
            errors.append(f"loot_tables 第 {row_number} 列 minQuantity 不可大於 maxQuantity")

    balance_rows = rows_by_table.get("balance", [])
    required_balance = {entry["key"] for entry in schema["tables"]["balance"].get("currentKeys", [])}
    actual_balance = {row.get("key", "").strip() for row in balance_rows}
    missing_balance = sorted(required_balance - actual_balance)
    if missing_balance:
        errors.append(f"balance 缺少既有參數：{', '.join(missing_balance)}")
    extra_balance = sorted(actual_balance - required_balance)
    if extra_balance:
        warnings.append(f"balance 新增參數尚未確認程式有讀取：{', '.join(extra_balance)}")

    for table_name, table in schema["tables"].items():
        unused = [field["name"] for field in table["fields"] if field.get("implementation") == "not_implemented"]
        if unused:
            warnings.append(f"{table['sheetName']} 未接入遊戲的欄位：{', '.join(unused)}")
    return errors, warnings


def next_version(current: str, date_prefix: str) -> str:
    match = re.fullmatch(r"(\d{8})\.(\d+)", current or "")
    if match and match.group(1) == date_prefix:
        return f"{date_prefix}.{int(match.group(2)) + 1}"
    return f"{date_prefix}.1"


def prepare_payloads(
    rows_by_table: dict[str, list[dict[str, str]]],
    current_rows: dict[str, list[dict[str, str]]],
    schema: dict[str, Any],
    manifest: dict[str, Any],
) -> tuple[dict[str, bytes], dict[str, Any], list[dict[str, str]]]:
    payloads: dict[str, bytes] = {}
    proposed_manifest = copy.deepcopy(manifest)
    proposed_manifest.setdefault("versions", {})
    changes: list[dict[str, str]] = []
    date_prefix = datetime.now().strftime("%Y%m%d")
    for table_name, table in schema["tables"].items():
        headers = [field["name"] for field in table["fields"]]
        current_path = ROOT / "data" / table["fileName"]
        current_payload = current_path.read_bytes() if current_path.is_file() else b""
        line_terminator = "\r\n" if b"\r\n" in current_payload else "\n"
        payload = (
            current_payload
            if rows_equal_for_sync(
                rows_by_table[table_name], current_rows.get(table_name, []), table["fields"]
            )
            else rows_to_csv_bytes(headers, rows_by_table[table_name], line_terminator)
        )
        payloads[table_name] = payload
        changed = payload != current_payload
        old_metadata = manifest.get("versions", {}).get(table_name, {})
        old_version = old_metadata.get("version", "")
        new_version = next_version(old_version, date_prefix) if changed else old_version
        digest = hashlib.sha256(payload).hexdigest()
        proposed_manifest["versions"][table_name] = {"version": new_version, "sha256": digest}
        if changed:
            changes.append({
                "table": table_name,
                "file": f"data/{table['fileName']}",
                "oldVersion": old_version,
                "newVersion": new_version,
                "oldHash": old_metadata.get("sha256", ""),
                "newHash": digest,
            })
    return payloads, proposed_manifest, changes


def validate_staged(
    payloads: dict[str, bytes], proposed_manifest: dict[str, Any], schema: dict[str, Any]
) -> tuple[tempfile.TemporaryDirectory[str], Path, list[str]]:
    SYNC_DIR.mkdir(parents=True, exist_ok=True)
    temp_context = tempfile.TemporaryDirectory(prefix="staging-", dir=SYNC_DIR)
    temp_root = Path(temp_context.name)
    data_dir = temp_root / "data"
    data_dir.mkdir(parents=True)
    (data_dir / "manifest.json").write_text(
        json.dumps(proposed_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    for table_name, table in schema["tables"].items():
        (data_dir / table["fileName"]).write_bytes(payloads[table_name])

    errors: list[str] = []
    staged_manifest = project_validator.read_manifest(temp_root, errors)
    staged_rows = project_validator.read_tables(temp_root, staged_manifest, errors) if staged_manifest else {}
    project_validator.check_numbers(staged_rows, errors)
    ids = project_validator.build_ids(staged_rows, errors)
    project_validator.check_foreign_keys(staged_rows, ids, errors)
    return temp_context, temp_root, errors


def print_change_report(changes: list[dict[str, str]], warnings: list[str]) -> None:
    if changes:
        print("預計更新的 CSV 與版本：")
        for change in changes:
            print(
                f"- {change['file']}: {change['oldVersion'] or '(無)'} -> {change['newVersion']} "
                f"({change['oldHash'][:12] or '-'} -> {change['newHash'][:12]})"
            )
    else:
        print("CSV 內容與目前版本完全相同，不需要更新。")
    if warnings:
        print("\n提醒：")
        for warning in warnings:
            print(f"- {warning}")


def backup_current(schema: dict[str, Any], changes: list[dict[str, str]]) -> Path:
    backup_dir = SYNC_DIR / "backups" / datetime.now().strftime("%Y%m%d-%H%M%S")
    (backup_dir / "data").mkdir(parents=True, exist_ok=True)
    shutil.copy2(MANIFEST_PATH, backup_dir / "data" / "manifest.json")
    changed_tables = {change["table"] for change in changes}
    for table_name, table in schema["tables"].items():
        if table_name in changed_tables:
            shutil.copy2(ROOT / "data" / table["fileName"], backup_dir / "data" / table["fileName"])
    return backup_dir


def restore_backup(backup_dir: Path, schema: dict[str, Any], changes: list[dict[str, str]]) -> None:
    shutil.copy2(backup_dir / "data" / "manifest.json", MANIFEST_PATH)
    changed_tables = {change["table"] for change in changes}
    for table_name, table in schema["tables"].items():
        if table_name in changed_tables:
            shutil.copy2(backup_dir / "data" / table["fileName"], ROOT / "data" / table["fileName"])


def apply_changes(
    staged_root: Path,
    schema: dict[str, Any],
    changes: list[dict[str, str]],
    proposed_manifest: dict[str, Any],
) -> None:
    backup_dir = backup_current(schema, changes)
    try:
        changed_tables = {change["table"] for change in changes}
        for table_name, table in schema["tables"].items():
            if table_name not in changed_tables:
                continue
            target = ROOT / "data" / table["fileName"]
            temporary = target.with_suffix(target.suffix + ".sync-tmp")
            shutil.copy2(staged_root / "data" / table["fileName"], temporary)
            os.replace(temporary, target)
        manifest_temp = MANIFEST_PATH.with_suffix(".json.sync-tmp")
        manifest_temp.write_text(
            json.dumps(proposed_manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )
        os.replace(manifest_temp, MANIFEST_PATH)
        validation = subprocess.run(
            [sys.executable, "validate_project.py"],
            cwd=ROOT,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        if validation.returncode:
            raise RuntimeError((validation.stderr or validation.stdout).strip())
        print(validation.stdout.strip())
    except Exception:
        restore_backup(backup_dir, schema, changes)
        raise

    result = {
        "appliedAt": datetime.now().astimezone().isoformat(timespec="seconds"),
        "changes": changes,
        "backupDirectory": str(backup_dir.relative_to(ROOT)),
    }
    SYNC_DIR.mkdir(parents=True, exist_ok=True)
    (SYNC_DIR / "last_result.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"備份位置：{backup_dir.relative_to(ROOT)}")


def load_rows(args: argparse.Namespace, schema: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    if args.source_dir:
        return read_csv_source(Path(args.source_dir).resolve(), schema)
    return read_google_sheets(Path(args.config).resolve(), schema)


def run_sync(args: argparse.Namespace) -> int:
    schema = load_schema()
    manifest = load_json(MANIFEST_PATH)
    current_rows = read_csv_source(ROOT / "data", schema)
    rows = load_rows(args, schema)
    strict_errors, warnings = validate_strict(rows, schema, current_rows, args.allow_id_changes)
    payloads, proposed_manifest, changes = prepare_payloads(rows, current_rows, schema, manifest)
    temp_context, staged_root, staged_errors = validate_staged(payloads, proposed_manifest, schema)
    try:
        errors = [*strict_errors, *staged_errors]
        print_change_report(changes, warnings)
        if errors:
            print("\n同步檢查失敗：", file=sys.stderr)
            for error in errors:
                print(f"- {error}", file=sys.stderr)
            return 1
        print("\n同步檢查通過：欄位、型別、ID、外鍵、數值範圍與版本 metadata 均有效。")
        if args.command == "check" or not changes:
            return 0
        if not args.yes:
            confirmation = input("輸入 APPLY 才會覆寫 data/*.csv：").strip()
            if confirmation != "APPLY":
                print("已取消，未修改任何 CSV。")
                return 2
        apply_changes(staged_root, schema, changes, proposed_manifest)
        print("CSV 已更新；尚未建立 commit，也尚未推送。")
        return 0
    finally:
        temp_context.cleanup()


def load_manifest_from_git(git_ref: str) -> dict[str, Any] | None:
    result = subprocess.run(
        ["git", "show", f"{git_ref}:data/manifest.json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    if result.returncode:
        return None
    return json.loads(result.stdout)


def show_versions(args: argparse.Namespace) -> int:
    schema = load_schema()
    current = load_json(MANIFEST_PATH)
    previous = load_manifest_from_git(args.git_ref)
    if previous is None:
        print(f"無法讀取 {args.git_ref}:data/manifest.json", file=sys.stderr)
        return 1
    changes = []
    for table_name, table in schema["tables"].items():
        old = previous.get("versions", {}).get(table_name, {})
        new = current.get("versions", {}).get(table_name, {})
        if old != new:
            changes.append((table["fileName"], old, new))
    if not changes:
        print(f"相對於 {args.git_ref} 沒有 CSV 版本變更。")
        return 0
    print(f"相對於 {args.git_ref} 的 CSV 版本變更：")
    for file_name, old, new in changes:
        print(
            f"- data/{file_name}: {old.get('version', '(無)')} -> {new.get('version', '(無)')} "
            f"({old.get('sha256', '')[:12] or '-'} -> {new.get('sha256', '')[:12] or '-'})"
        )
    print("\n依專案規則，commit／push 前必須把以上清單提供給使用者並取得二次確認。")
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="同步 Google Sheets 遊戲配置到 data/*.csv")
    subparsers = parser.add_subparsers(dest="command", required=True)
    for command in ("check", "apply"):
        subparser = subparsers.add_parser(command)
        subparser.add_argument("--config", default=str(DEFAULT_CONFIG_PATH))
        subparser.add_argument("--source-dir", help="測試用：改由本機 CSV 目錄讀取，不連線 Google")
        subparser.add_argument("--allow-id-changes", action="store_true")
        subparser.add_argument("--yes", action="store_true", help="略過 APPLY 文字確認；只供受控自動化使用")
        subparser.set_defaults(handler=run_sync)
    versions = subparsers.add_parser("versions", help="列出相對指定 Git ref 的 CSV 版本變更")
    versions.add_argument("--git-ref", default="HEAD")
    versions.set_defaults(handler=show_versions)
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.handler(args)
    except KeyboardInterrupt:
        print("已取消。", file=sys.stderr)
        return 130
    except Exception as exc:
        print(f"執行失敗：{exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
