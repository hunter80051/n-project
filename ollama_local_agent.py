from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path


BLOCKED_NAMES = {".env", "config.json", "jobs.json", "bot.log"}
MAX_FILE_CHARS = 50_000

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")


def allowed_path(root: Path, value: str) -> Path:
    relative = Path(value)
    if relative.is_absolute() or ".." in relative.parts:
        raise ValueError(f"不允許的路徑：{value}")
    path = (root / relative).resolve()
    if not path.is_relative_to(root) or ".git" in path.parts or path.name in BLOCKED_NAMES:
        raise ValueError(f"不允許的路徑：{value}")
    return path


def request_changes(task: str, files: dict[str, str]) -> dict:
    model = os.getenv("OLLAMA_MODEL", "qwen2.5-coder:7b")
    base_url = os.getenv("OLLAMA_BASE_URL", "http://127.0.0.1:11434").rstrip("/")
    prompt = f"""你是受限的程式碼產出者。只能修改 allowedFiles 中的檔案。
不要執行 Shell、不要使用 Git、不要刪除檔案、不要產生 allowedFiles 以外的路徑。
請回傳 JSON，格式為：
{{"summary":"變更摘要","files":[{{"path":"相對路徑","content":"完整檔案內容"}}]}}

task:
{task}

allowedFiles 與目前內容：
{json.dumps(files, ensure_ascii=False)}
"""
    payload = json.dumps(
        {"model": model, "prompt": prompt, "stream": False, "format": "json"}
    ).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url}/api/generate",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=300) as response:
            result = json.loads(response.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError) as exc:
        raise RuntimeError(f"無法連線 Ollama：{exc}") from exc
    return json.loads(result["response"])


def main() -> int:
    parser = argparse.ArgumentParser(description="受限 Ollama Local Agent")
    parser.add_argument("--task", required=True)
    parser.add_argument("--file", action="append", required=True, dest="files")
    parser.add_argument("--apply", action="store_true")
    args = parser.parse_args()

    root = Path.cwd().resolve()
    allowed = {value: allowed_path(root, value) for value in dict.fromkeys(args.files)}
    current = {}
    for relative, path in allowed.items():
        content = path.read_text(encoding="utf-8") if path.exists() else ""
        if len(content) > MAX_FILE_CHARS:
            raise ValueError(f"檔案過大，拒絕交給 Local Agent：{relative}")
        current[relative] = content

    result = request_changes(args.task, current)
    outputs = result.get("files")
    if not isinstance(outputs, list):
        raise ValueError("Ollama 回傳格式缺少 files 陣列")

    prepared: list[tuple[str, Path, str]] = []
    seen = set()
    for item in outputs:
        relative = item.get("path") if isinstance(item, dict) else None
        content = item.get("content") if isinstance(item, dict) else None
        if relative not in allowed or not isinstance(content, str) or relative in seen:
            raise ValueError(f"Ollama 回傳未授權或無效的檔案：{relative}")
        seen.add(relative)
        prepared.append((relative, allowed[relative], content))

    if args.apply:
        for _, path, content in prepared:
            path.parent.mkdir(parents=True, exist_ok=True)
            temp_path = path.with_name(path.name + ".ollama.tmp")
            temp_path.write_text(content, encoding="utf-8")
            temp_path.replace(path)

    print(json.dumps(
        {
            "applied": args.apply,
            "summary": result.get("summary", ""),
            "files": [relative for relative, _, _ in prepared],
        },
        ensure_ascii=False,
    ))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1)
