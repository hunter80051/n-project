from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlsplit


REFERENCE_PATTERN = re.compile(r"(?:src|href)=[\"']([^\"']+)[\"']", re.IGNORECASE)


def local_reference(value: str) -> str | None:
    if value.startswith(("#", "data:", "mailto:", "javascript:")):
        return None
    parsed = urlsplit(value)
    if parsed.scheme or parsed.netloc:
        return None
    return parsed.path.lstrip("/") or None


def main() -> int:
    root = Path.cwd()
    index = root / "index.html"
    if not index.is_file():
        print("驗證失敗：找不到 index.html", file=sys.stderr)
        return 1

    html = index.read_text(encoding="utf-8")
    missing: list[str] = []
    javascript: list[Path] = []
    for value in REFERENCE_PATTERN.findall(html):
        relative = local_reference(value)
        if not relative:
            continue
        target = root / relative
        if not target.is_file():
            missing.append(relative)
        elif target.suffix.lower() in {".js", ".mjs"}:
            javascript.append(target)

    if missing:
        print(f"驗證失敗：缺少引用檔案：{', '.join(sorted(set(missing)))}", file=sys.stderr)
        return 1

    node = shutil.which("node")
    if node:
        for script in sorted(set(javascript)):
            result = subprocess.run(
                [node, "--check", str(script)],
                cwd=root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
            )
            if result.returncode:
                print(result.stderr or result.stdout, file=sys.stderr)
                return result.returncode

    print(
        "驗證通過：index.html 引用完整；"
        + (
            f"已檢查 {len(set(javascript))} 個 JavaScript 檔案。"
            if node
            else "本機沒有 Node.js，已略過 JavaScript 語法檢查。"
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
