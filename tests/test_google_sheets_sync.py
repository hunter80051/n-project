from __future__ import annotations

import copy
import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "google_sheets_sync.py"
SPEC = importlib.util.spec_from_file_location("google_sheets_sync", MODULE_PATH)
assert SPEC and SPEC.loader
sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(sync)


class GoogleSheetsSyncTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.schema = sync.load_schema()
        cls.manifest = json.loads((ROOT / "data" / "manifest.json").read_text(encoding="utf-8"))
        cls.current_rows = sync.read_csv_source(ROOT / "data", cls.schema)

    def test_noop_does_not_increment_versions(self) -> None:
        _, proposed, changes = sync.prepare_payloads(
            copy.deepcopy(self.current_rows), self.current_rows, self.schema, self.manifest
        )
        self.assertEqual(changes, [])
        self.assertEqual(proposed["versions"], self.manifest["versions"])

    def test_equivalent_number_format_does_not_increment_versions(self) -> None:
        rows = copy.deepcopy(self.current_rows)
        character = next(row for row in rows["characters"] if row["characterId"] == "char_lynn")
        character["speed"] = "3"
        enemy = next(row for row in rows["enemies"] if row["enemyId"] == "boss_pillow")
        enemy["attackRange"] = "2"
        _, proposed, changes = sync.prepare_payloads(
            rows, self.current_rows, self.schema, self.manifest
        )
        self.assertEqual(changes, [])
        self.assertEqual(proposed["versions"], self.manifest["versions"])

    def test_only_changed_table_increments_version(self) -> None:
        rows = copy.deepcopy(self.current_rows)
        rows["balance"][0]["value"] = "25"
        _, proposed, changes = sync.prepare_payloads(rows, self.current_rows, self.schema, self.manifest)
        self.assertEqual([change["table"] for change in changes], ["balance"])
        self.assertNotEqual(
            proposed["versions"]["balance"]["version"],
            self.manifest["versions"]["balance"]["version"],
        )
        self.assertEqual(
            proposed["versions"]["characters"], self.manifest["versions"]["characters"]
        )

    def test_removed_stable_id_is_blocked(self) -> None:
        rows = copy.deepcopy(self.current_rows)
        rows["items"] = rows["items"][1:]
        errors, _ = sync.validate_strict(
            rows, self.schema, self.current_rows, allow_id_changes=False
        )
        self.assertTrue(any("移除或改名既有 ID" in error for error in errors))

    def test_invalid_probability_is_blocked(self) -> None:
        rows = copy.deepcopy(self.current_rows)
        rows["lootTables"][0]["chance"] = "1.2"
        errors, _ = sync.validate_strict(
            rows, self.schema, self.current_rows, allow_id_changes=False
        )
        self.assertTrue(any("chance 不可大於 1" in error for error in errors))

    def test_manual_csv_edit_without_version_update_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            temporary_root = Path(temporary)
            shutil.copytree(ROOT / "data", temporary_root / "data")
            balance = temporary_root / "data" / "balance.csv"
            balance.write_bytes(balance.read_bytes() + b"\n")
            errors: list[str] = []
            manifest = sync.project_validator.read_manifest(temporary_root, errors)
            sync.project_validator.read_tables(temporary_root, manifest, errors)
            self.assertTrue(any("內容雜湊與 manifest 不符" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
