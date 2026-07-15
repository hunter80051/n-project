from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import shlex
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import discord
from discord.ext import commands


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("CODEX_DISCORD_CONFIG", BASE_DIR / "config.json"))
DISCORD_LIMIT = 1900
RETRYABLE_STATES = {
    "failed",
    "validation_failed",
    "deployment_failed",
    "approval_failed",
    "cancelled",
}


@dataclass
class ChannelState:
    status: str = "idle"
    job_id: str = ""
    task_type: str = ""
    task: str = ""
    last_result: str = "尚無執行紀錄"
    updated_at: str = ""
    changed_files: list[str] = field(default_factory=list)
    validation_result: str = ""
    base_commit: str = ""
    preview_commit: str = ""
    preview_url: str = ""
    file_hashes: dict[str, str] = field(default_factory=dict)
    final_commit: str = ""
    process: asyncio.subprocess.Process | None = field(default=None, repr=False)


def load_config() -> dict:
    if not CONFIG_PATH.exists():
        raise RuntimeError(f"找不到設定檔：{CONFIG_PATH}（請複製 config.example.json）")
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    if not isinstance(data.get("channels"), dict):
        raise RuntimeError("config.json 必須包含 channels 物件")
    return data


CONFIG = load_config()
PREFIX = CONFIG.get("command_prefix", "!")
ALLOWED_USERS = {int(x) for x in CONFIG.get("allowed_user_ids", [])}
JOB_STORE_PATH = Path(CONFIG.get("job_store_path", BASE_DIR / "jobs.json"))
EVENT_DIR = BASE_DIR / ".job-events"


def load_states() -> dict[int, ChannelState]:
    if not JOB_STORE_PATH.exists():
        return {}
    try:
        data = json.loads(JOB_STORE_PATH.read_text(encoding="utf-8"))
        return {
            int(channel_id): ChannelState(**state)
            for channel_id, state in data.get("channels", {}).items()
        }
    except (OSError, ValueError, TypeError) as exc:
        raise RuntimeError(f"無法讀取任務狀態檔：{JOB_STORE_PATH}：{exc}") from exc


def save_states() -> None:
    JOB_STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    data = {
        "channels": {
            str(channel_id): {
                "status": state.status,
                "job_id": state.job_id,
                "task_type": state.task_type,
                "task": state.task,
                "last_result": state.last_result,
                "updated_at": state.updated_at,
                "changed_files": state.changed_files,
                "validation_result": state.validation_result,
                "base_commit": state.base_commit,
                "preview_commit": state.preview_commit,
                "preview_url": state.preview_url,
                "file_hashes": state.file_hashes,
                "final_commit": state.final_commit,
            }
            for channel_id, state in states.items()
        }
    }
    temp_path = JOB_STORE_PATH.with_suffix(JOB_STORE_PATH.suffix + ".tmp")
    temp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(JOB_STORE_PATH)


def update_state(state: ChannelState, **changes: Any) -> None:
    for key, value in changes.items():
        setattr(state, key, value)
    state.updated_at = datetime.now(timezone.utc).isoformat()
    save_states()


states: dict[int, ChannelState] = load_states()

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix=PREFIX, intents=intents, help_command=None)


def channel_config(channel_id: int) -> dict | None:
    return CONFIG["channels"].get(str(channel_id))


def get_project(channel_id: int) -> tuple[dict, Path]:
    cfg = channel_config(channel_id)
    if not cfg:
        raise commands.CheckFailure("此頻道尚未綁定專案。")
    path = Path(cfg["local_path"]).expanduser().resolve()
    if not path.is_dir():
        raise commands.CheckFailure(f"專案路徑不存在：{path}")
    return cfg, path


async def authorized(ctx: commands.Context) -> bool:
    if not channel_config(ctx.channel.id):
        raise commands.CheckFailure(
            f"此頻道不在白名單內。目前頻道 ID：{ctx.channel.id}"
        )
    if ALLOWED_USERS and ctx.author.id not in ALLOWED_USERS:
        raise commands.CheckFailure("你不在允許操作 Codex 的使用者名單內。")
    return True


def clean_mentions(text: str) -> str:
    return re.sub(r"<@!?\d+>|<@&\d+>|@everyone|@here", "", text).strip()


def validation_links(text: str) -> str:
    urls = []
    url_pattern = r"https?://[^\s<>\]，。；：！？]+"
    for match in re.finditer(url_pattern, text):
        url = match.group(0).rstrip("`'\".,;:!?，。；：！？)]}")
        if url and url not in urls:
            urls.append(url)
    text_without_urls = re.sub(url_pattern, "", text)
    for match in re.finditer(
        r"(?<![\w.:/])(?:localhost|127\.0\.0\.1)(?::\d+)?"
        r"(?:/[^\s<>\]，。；：！？]*)?",
        text_without_urls,
    ):
        address = match.group(0).rstrip("`'\".,;:!?，。；：！？)]}")
        url = f"http://{address}"
        if address and url not in urls:
            urls.append(url)
    if not urls:
        return ""
    links = "\n".join(f"- [{url}]({url})" for url in urls)
    return f"\n\n驗證連結：\n{links}"


async def send_long(ctx: commands.Context, text: str) -> None:
    text = text.strip() or "（Codex 沒有回傳文字）"
    for start in range(0, len(text), DISCORD_LIMIT):
        await ctx.send(text[start : start + DISCORD_LIMIT], allowed_mentions=discord.AllowedMentions.none())


async def relay_team_events(
    ctx: commands.Context, event_path: Path, communicate_task: asyncio.Task
) -> None:
    seen = 0
    while True:
        if event_path.exists():
            lines = event_path.read_text(encoding="utf-8").splitlines()
            for line in lines[seen:]:
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    break
                seen += 1
                message = clean_mentions(str(event.get("message", "")))[:900]
                files = [str(value) for value in event.get("files", [])][:10]
                file_text = f"\n允許/修改檔案：`{'`, `'.join(files)}`" if files else ""
                event_type = event.get("type")
                if event_type == "delegated":
                    text = f"📋 **Codex → Ollama 派工**\n{message}{file_text}"
                elif event_type == "started":
                    text = f"🤖 **Ollama Local Agent 開始處理**{file_text}"
                elif event_type == "completed":
                    text = f"✅ **Ollama Local Agent 完成**\n{message}{file_text}\n🔍 Codex 開始審查與驗證。"
                elif event_type == "failed":
                    text = f"❌ **Ollama Local Agent 失敗**\n{message}"
                else:
                    continue
                await ctx.send(text, allowed_mentions=discord.AllowedMentions.none())
        if communicate_task.done():
            return
        await asyncio.sleep(1)


async def run_git(path: Path, *args: str) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return (
        process.returncode,
        stdout.decode("utf-8", errors="replace").strip(),
        stderr.decode("utf-8", errors="replace").strip(),
    )


async def run_command(path: Path, command: list[str]) -> tuple[int, str, str]:
    process = await asyncio.create_subprocess_exec(
        *command,
        cwd=path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await process.communicate()
    return (
        process.returncode,
        stdout.decode("utf-8", errors="replace").strip(),
        stderr.decode("utf-8", errors="replace").strip(),
    )


async def current_commit(path: Path) -> str:
    code, value, error = await run_git(path, "rev-parse", "HEAD")
    if code != 0:
        raise RuntimeError(error or value or "無法讀取目前 commit")
    return value


async def hash_files(path: Path, files: list[str]) -> dict[str, str]:
    hashes: dict[str, str] = {}
    for file in files:
        if not (path / file).is_file():
            hashes[file] = "<deleted>"
            continue
        code, value, error = await run_git(path, "hash-object", "--", file)
        if code != 0:
            raise RuntimeError(f"無法計算檔案雜湊 {file}：{error or value}")
        hashes[file] = value
    return hashes


def validation_command(cfg: dict) -> list[str]:
    value = cfg.get("validation_command", ["python", "validate_project.py"])
    if isinstance(value, str):
        return shlex.split(value, posix=False)
    if isinstance(value, list) and value and all(isinstance(part, str) for part in value):
        return value
    raise ValueError("validation_command 必須是非空字串陣列")


async def validate_project(path: Path, cfg: dict) -> tuple[bool, str]:
    command = validation_command(cfg)
    code, output, error = await run_command(path, command)
    detail = "\n".join(value for value in (output, error) if value).strip()
    return code == 0, detail or f"驗證指令完成：{' '.join(command)}"


async def create_preview_commit(
    path: Path, files: list[str], base_commit: str, job_id: str
) -> str:
    code, output, error = await run_git(path, "add", "--", *files)
    if code != 0:
        raise RuntimeError(error or output or "無法暫存預覽檔案")
    try:
        code, tree, error = await run_git(path, "write-tree")
        if code != 0:
            raise RuntimeError(error or tree or "無法建立預覽 tree")
        code, commit, error = await run_git(
            path,
            "commit-tree",
            tree,
            "-p",
            base_commit,
            "-m",
            f"preview: {job_id}",
        )
        if code != 0:
            raise RuntimeError(error or commit or "無法建立預覽 commit")
        return commit
    finally:
        await run_git(path, "reset", "HEAD", "--", *files)


async def push_preview(path: Path, cfg: dict, commit: str) -> tuple[bool, str]:
    remote = cfg.get("git_remote", "origin")
    branch = cfg.get("preview_branch", "preview")
    code, output, error = await run_git(
        path, "push", "--force", remote, f"{commit}:refs/heads/{branch}"
    )
    return code == 0, error or output


def fetch_text(url: str) -> str:
    request = urllib.request.Request(url, headers={"User-Agent": "N-Project-Preview-Check"})
    with urllib.request.urlopen(request, timeout=15) as response:
        return response.read().decode("utf-8", errors="replace").strip()


async def wait_for_preview(url: str, commit: str, attempts: int = 24) -> tuple[bool, str]:
    if not url:
        return False, "config.json 尚未設定 preview_url"
    version_url = f"{url.rstrip('/')}/preview-version.txt"
    last_error = ""
    for _ in range(attempts):
        try:
            deployed_commit = await asyncio.to_thread(fetch_text, version_url)
            if deployed_commit == commit:
                return True, version_url
            last_error = f"目前部署版本是 {deployed_commit[:8] or '未知'}"
        except (OSError, urllib.error.URLError) as exc:
            last_error = str(exc)
        await asyncio.sleep(5)
    return False, f"等待 GitHub Pages 部署逾時：{last_error}"


async def require_clean_git_project(path: Path) -> str | None:
    code, _, _ = await run_git(path, "rev-parse", "--verify", "HEAD")
    if code != 0:
        return "Git 尚無初始 commit，請先建立專案基準版本。"
    code, _, error = await run_git(path, "diff", "--quiet", "HEAD", "--")
    if code not in (0, 1):
        return f"無法檢查 Git 變更：{error}"
    untracked_code, untracked, error = await run_git(
        path, "ls-files", "--others", "--exclude-standard"
    )
    if untracked_code != 0:
        return f"無法檢查未追蹤檔案：{error or untracked}"
    if code == 1 or untracked:
        return "Git 工作樹目前有未提交變更，請先處理後再建立新任務。"
    return None


async def changed_files(path: Path) -> list[str]:
    _, tracked, _ = await run_git(path, "diff", "--name-only", "HEAD")
    _, untracked, _ = await run_git(path, "ls-files", "--others", "--exclude-standard")
    return sorted({line for line in (tracked + "\n" + untracked).splitlines() if line})


def build_prompt(task: str, project_name: str) -> str:
    return f"""你正在由 Discord 頻道接收任務，專案名稱是 {project_name}。

使用者任務：
{task}

請直接在目前工作目錄內完成任務。先檢查現有檔案與規範，再進行必要修改並執行適當驗證。
此專案可使用 AI 小組協作模式，但 Ollama Local Agent 並非每個 coding 任務的強制步驟。先判斷是否存在適合派工的獨立子任務；只有同時符合以下條件時才派工：範圍可限制在少量明確檔案、驗收條件具體、與其他模組耦合低、不需要架構決策／根因診斷／Git／Shell／部署，且預期能降低 Codex 的實作成本。
適合派工的例子：常數或文案調整、CSS 局部修改、小型純函式、重複性資料轉換、單檔案內邊界清楚的局部邏輯。
不適合派工的例子：多模組重構、狀態機、程序地圖核心演算法、跨檔案整合、除錯根因分析、安全或部署流程。沒有合適子任務時由 Codex 直接完成，並在最終回報簡述未派工原因。
使用受限 Local Agent：
python ollama_local_agent.py --task "明確任務" --file "允許修改的相對路徑" --apply
為避免 Windows 命令列編碼問題，傳給 `--task` 的子任務內容必須使用簡潔英文；Discord 最終回報仍使用繁體中文。
你必須明確指定每個允許檔案，Local Agent 完成後仍由你檢查 git diff 並執行測試。
不可為了展示流程而拆出沒有實際價值的形式性派工；若 Local Agent 失敗一次，保留失敗事件後即可由 Codex 接手，不強制重派。
不要存取目前專案以外的檔案，不要提交 git commit，不要推送遠端，不要刪除使用者資料。
最後以繁體中文簡潔回報：完成內容、驗證結果、以及任何仍需使用者處理的事項。
"""


@bot.event
async def on_ready() -> None:
    logging.info("Discord Bot 已登入：%s (%s)", bot.user, bot.user.id if bot.user else "?")


@bot.command(name="help")
@commands.check(authorized)
async def help_command(ctx: commands.Context) -> None:
    await ctx.send(
        f"`{PREFIX}build <任務>` 指派新任務\n"
        f"`{PREFIX}change <任務>` 修改功能；等待核准時調整目前預覽\n"
        f"`{PREFIX}fix <任務>` 修復問題；等待核准時修正目前預覽\n"
        f"`{PREFIX}status` 查詢狀態\n"
        f"`{PREFIX}retry [補充說明]` 重跑失敗或取消的上一個任務\n"
        f"`{PREFIX}approve` 核准變更並建立 Git commit\n"
        f"`{PREFIX}cancel` 中止目前任務"
    )


@bot.command(name="status")
@commands.check(authorized)
async def status_command(ctx: commands.Context) -> None:
    cfg, path = get_project(ctx.channel.id)
    state = states.setdefault(ctx.channel.id, ChannelState())
    task = state.task[:500] if state.task else "無"
    await ctx.send(
        f"專案：`{cfg.get('project_name', path.name)}`\n"
        f"路徑：`{path}`\n"
        f"Job：`{state.job_id or '無'}`\n"
        f"類型：`{state.task_type or '無'}`\n"
        f"狀態：`{state.status}`\n"
        f"更新時間：`{state.updated_at or '無'}`\n"
        f"目前/上次任務：{task}\n"
        f"預覽：{state.preview_url or '無'}\n"
        f"預覽 commit：`{state.preview_commit or '無'}`\n"
        f"最終 commit：`{state.final_commit or '無'}`",
        allowed_mentions=discord.AllowedMentions.none(),
    )


async def execute_task(
    ctx: commands.Context, task: str, task_type: str = "build", *, reuse_job: bool = False
) -> None:
    cfg, path = get_project(ctx.channel.id)
    state = states.setdefault(ctx.channel.id, ChannelState())
    if state.process and state.process.returncode is None:
        await ctx.send(f"此頻道已有任務執行中。可用 `{PREFIX}status` 或 `{PREFIX}cancel`。")
        return

    task = clean_mentions(task)
    if not task:
        await ctx.send(f"請提供任務內容，例如：`{PREFIX}build 新增登入頁面`。")
        return

    if not reuse_job:
        git_error = await require_clean_git_project(path)
        if git_error:
            await ctx.send(f"⛔ {git_error}")
            return

    job_id = state.job_id if reuse_job and state.job_id else datetime.now(timezone.utc).strftime("job-%Y%m%d-%H%M%S")
    update_state(
        state,
        status="running",
        job_id=job_id,
        task_type=task_type,
        task=task,
        last_result="執行中",
        changed_files=[],
        validation_result="",
        base_commit="",
        preview_commit="",
        preview_url="",
        file_hashes={},
        final_commit="",
    )
    await ctx.send(
        f"📡 已連接 `{cfg.get('project_name', path.name)}`\n"
        f"🧭 **Codex 開始分析與拆分任務**\nJob：`{job_id}`"
    )

    args = [
        CONFIG.get("codex_command", "codex"),
        "--ask-for-approval", "never",
        "exec", "-",
        "--cd", str(path),
        "--sandbox", CONFIG.get("sandbox", "workspace-write"),
        "--color", "never",
    ]
    if CONFIG.get("skip_git_repo_check", True):
        args.append("--skip-git-repo-check")

    process_env = os.environ.copy()
    local_agent = CONFIG.get("local_agent", {})
    process_env["OLLAMA_MODEL"] = local_agent.get("model", "qwen2.5-coder:7b")
    process_env["OLLAMA_BASE_URL"] = local_agent.get("base_url", "http://127.0.0.1:11434")
    EVENT_DIR.mkdir(parents=True, exist_ok=True)
    event_path = EVENT_DIR / f"{ctx.channel.id}-{job_id}.jsonl"
    event_path.unlink(missing_ok=True)
    process_env["AI_TEAM_EVENT_FILE"] = str(event_path)

    try:
        state.process = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=path,
            env=process_env,
        )
        communicate_task = asyncio.create_task(
            state.process.communicate(
                build_prompt(task, cfg.get("project_name", path.name)).encode("utf-8")
            )
        )
        await relay_team_events(ctx, event_path, communicate_task)
        stdout, stderr = await communicate_task
        output = stdout.decode("utf-8", errors="replace").strip()
        error = stderr.decode("utf-8", errors="replace").strip()
        if state.process.returncode == 0:
            files = await changed_files(path)
            if files:
                base_commit = await current_commit(path)
                update_state(state, status="validating", changed_files=files, base_commit=base_commit)
                valid, validation_result = await validate_project(path, cfg)
                if not valid:
                    update_state(
                        state,
                        status="validation_failed",
                        validation_result=validation_result,
                        last_result=output,
                    )
                    await send_long(
                        ctx,
                        f"❌ Codex 修改完成，但自動驗證失敗\n\n{validation_result}\n\n{output}",
                    )
                    return

                file_hashes = await hash_files(path, files)
                preview_commit = await create_preview_commit(path, files, base_commit, job_id)
                update_state(
                    state,
                    status="deploying_preview",
                    validation_result=validation_result,
                    preview_commit=preview_commit,
                    file_hashes=file_hashes,
                )
                pushed, push_result = await push_preview(path, cfg, preview_commit)
                if not pushed:
                    update_state(state, status="deployment_failed", last_result=push_result)
                    await send_long(
                        ctx,
                        f"❌ 驗證通過，但預覽分支推送失敗\n\n{push_result}\n\n"
                        f"本機變更仍保留，未建立正式 commit。",
                    )
                    return

                preview_url = cfg.get("preview_url", "")
                deployed, deployment_result = await wait_for_preview(preview_url, preview_commit)
                if not deployed:
                    update_state(
                        state,
                        status="deployment_failed",
                        last_result=deployment_result,
                        preview_url=preview_url,
                    )
                    await send_long(
                        ctx,
                        f"❌ 預覽分支已推送，但無法確認 GitHub Pages 已部署相同版本\n\n"
                        f"{deployment_result}\n\n預覽分支 commit：`{preview_commit[:8]}`",
                    )
                    return
                update_state(
                    state,
                    status="waiting_approval",
                    last_result=output,
                    preview_url=preview_url,
                )
                link_text = validation_links("\n".join((output, preview_url)))
                await send_long(
                    ctx,
                    f"✅ Codex 任務完成並已推送預覽，等待核准\n\n{output}\n\n"
                    f"變更檔案：{', '.join(files)}\n"
                    f"自動驗證：{validation_result}\n"
                    f"預覽 commit：`{preview_commit[:8]}`\n"
                    f"{link_text}\n"
                    f"確認後請輸入 `{PREFIX}approve`。",
                )
            else:
                update_state(state, status="completed", last_result=output)
                await send_long(ctx, f"✅ Codex 任務完成，沒有 Git 變更\n\n{output}")
        else:
            update_state(state, status="failed", last_result=error or output)
            await send_long(ctx, f"❌ Codex 執行失敗（exit {state.process.returncode}）\n\n{error or output}")
    except Exception as exc:
        logging.exception("Codex task failed")
        update_state(state, status="failed", last_result=str(exc))
        await ctx.send(f"❌ 無法啟動 Codex：`{exc}`")
    finally:
        state.process = None


async def preview_continuation_error(path: Path, state: ChannelState) -> str | None:
    if not state.base_commit or not state.changed_files or not state.file_hashes:
        return "目前預覽缺少完整驗證資料，請使用 !retry 重新產生預覽。"

    files = await changed_files(path)
    if files != state.changed_files:
        return "目前變更檔案與預覽版本不一致，請先還原額外修改或使用 !retry。"

    head = await current_commit(path)
    if head != state.base_commit:
        return "main 已在預覽後改變，不能直接延續這份預覽，請使用 !retry。"

    hashes = await hash_files(path, files)
    if hashes != state.file_hashes:
        return "目前檔案內容與已部署預覽不一致，請先還原額外修改或使用 !retry。"
    return None


async def continue_preview_task(
    ctx: commands.Context, task: str, task_type: str
) -> bool:
    state = states.setdefault(ctx.channel.id, ChannelState())
    if state.status != "waiting_approval":
        return False

    task = clean_mentions(task)
    if not task:
        await ctx.send(f"請描述要調整的預覽內容，例如：`{PREFIX}{task_type} 修正按鈕位置`。")
        return True

    _, path = get_project(ctx.channel.id)
    error = await preview_continuation_error(path, state)
    if error:
        await ctx.send(f"⛔ {error}")
        return True

    label = "預覽問題修正" if task_type == "fix" else "預覽需求調整"
    combined_task = f"{state.task}\n\n{label}：{task}"
    await execute_task(ctx, combined_task, task_type, reuse_job=True)
    return True


@bot.command(name="build")
@commands.check(authorized)
async def build_command(ctx: commands.Context, *, task: str = "") -> None:
    await execute_task(ctx, task, "build")


@bot.command(name="change")
@commands.check(authorized)
async def change_command(ctx: commands.Context, *, task: str = "") -> None:
    if await continue_preview_task(ctx, task, "change"):
        return
    await execute_task(ctx, task, "change")


@bot.command(name="fix")
@commands.check(authorized)
async def fix_command(ctx: commands.Context, *, task: str = "") -> None:
    if await continue_preview_task(ctx, task, "fix"):
        return
    await execute_task(ctx, task, "fix")


@bot.command(name="retry")
@commands.check(authorized)
async def retry_command(ctx: commands.Context, *, note: str = "") -> None:
    state = states.setdefault(ctx.channel.id, ChannelState())
    if not state.task:
        await ctx.send("此頻道尚無可重試的任務。")
        return
    if state.status == "waiting_approval":
        await ctx.send(
            f"目前預覽已成功並等待核准。請使用 `{PREFIX}fix <問題>` 修正 bug，"
            f"或 `{PREFIX}change <調整>` 修改需求。"
        )
        return
    if state.status not in RETRYABLE_STATES:
        await ctx.send(
            f"目前狀態 `{state.status}` 不需要重試；`{PREFIX}retry` 僅用於執行、驗證、部署失敗或取消的任務。"
        )
        return
    task = state.task + (f"\n\n重試補充：{clean_mentions(note)}" if note.strip() else "\n\n請重新檢查並完成此任務。")
    await execute_task(ctx, task, state.task_type or "build", reuse_job=True)


@bot.command(name="approve")
@commands.check(authorized)
async def approve_command(ctx: commands.Context) -> None:
    cfg, path = get_project(ctx.channel.id)
    state = states.setdefault(ctx.channel.id, ChannelState())
    if state.status == "commit_pending_push" and state.final_commit:
        branch = cfg.get("branch", "main")
        remote = cfg.get("git_remote", "origin")
        code, output, error = await run_git(path, "push", remote, f"HEAD:{branch}")
        if code != 0:
            await ctx.send(f"❌ Git push 仍然失敗：`{error or output}`")
            return
        update_state(state, status="committed", last_result=output)
        await ctx.send(f"✅ commit `{state.final_commit[:8]}` 已推送至 `{remote}/{branch}`。")
        return

    if state.status != "waiting_approval":
        await ctx.send("目前沒有等待核准的任務。")
        return

    files = await changed_files(path)
    if files != state.changed_files:
        await ctx.send("⛔ 目前變更檔案與預覽版本不一致，請使用 `!retry` 重新產生預覽。")
        return

    head = await current_commit(path)
    if head != state.base_commit:
        await ctx.send("⛔ main 已在等待核准期間改變，請使用 `!retry` 重新產生預覽。")
        return

    hashes = await hash_files(path, files)
    if hashes != state.file_hashes:
        await ctx.send("⛔ 檔案內容與預覽版本不一致，請使用 `!retry` 重新產生預覽。")
        return

    valid, validation_result = await validate_project(path, cfg)
    if not valid:
        update_state(state, status="validation_failed", validation_result=validation_result)
        await ctx.send(f"❌ 核准前重新驗證失敗：`{validation_result}`")
        return

    for key in ("user.name", "user.email"):
        code, value, _ = await run_git(path, "config", "--get", key)
        if code != 0 or not value:
            await ctx.send(f"⛔ Git 尚未設定 `{key}`，無法建立 commit。")
            return

    code, output, error = await run_git(path, "add", "--", *files)
    if code != 0:
        update_state(state, status="approval_failed", last_result=error or output)
        await ctx.send(f"❌ Git 暫存失敗：`{error or output}`")
        return

    code, tree, error = await run_git(path, "write-tree")
    if code != 0:
        await run_git(path, "reset", "HEAD", "--", *files)
        await ctx.send(f"❌ 無法檢查正式提交內容：`{error or tree}`")
        return
    code, preview_tree, error = await run_git(path, "rev-parse", f"{state.preview_commit}^{{tree}}")
    if code != 0 or tree != preview_tree:
        await run_git(path, "reset", "HEAD", "--", *files)
        await ctx.send("⛔ 正式提交內容與已部署的預覽版本不一致。")
        return

    summary = " ".join(state.task.split())[:72] or state.job_id
    message = f"{state.task_type or 'change'}: {summary}"
    code, output, error = await run_git(path, "commit", "-m", message)
    if code != 0:
        update_state(state, status="approval_failed", last_result=error or output)
        await ctx.send(f"❌ Git commit 失敗：`{error or output}`")
        return

    code, commit_hash, _ = await run_git(path, "rev-parse", "--short", "HEAD")
    full_code, full_commit, _ = await run_git(path, "rev-parse", "HEAD")
    final_commit = full_commit if full_code == 0 else commit_hash
    remote = cfg.get("git_remote", "origin")
    branch = cfg.get("branch", "main")
    push_code, push_output, push_error = await run_git(path, "push", remote, f"HEAD:{branch}")
    if push_code != 0:
        update_state(
            state,
            status="commit_pending_push",
            last_result=push_error or push_output,
            validation_result=validation_result,
            final_commit=final_commit,
        )
        await ctx.send(
            f"⚠️ 已建立 commit `{commit_hash}`，但推送失敗：`{push_error or push_output}`\n"
            f"修正連線或權限後再次輸入 `{PREFIX}approve` 重試推送。"
        )
        return
    update_state(
        state,
        status="committed",
        last_result=push_output or output,
        validation_result=validation_result,
        final_commit=final_commit,
    )
    await ctx.send(
        f"✅ 已核准、建立並推送 commit `{commit_hash if code == 0 else 'unknown'}`\n"
        f"專案：`{cfg.get('project_name', path.name)}`"
    )


@bot.command(name="cancel")
@commands.check(authorized)
async def cancel_command(ctx: commands.Context) -> None:
    state = states.setdefault(ctx.channel.id, ChannelState())
    if not state.process or state.process.returncode is not None:
        await ctx.send("目前沒有執行中的任務。")
        return
    state.process.terminate()
    update_state(state, status="cancelled", last_result="使用者要求中止")
    await ctx.send("🛑 已要求中止目前任務。")


@bot.event
async def on_command_error(ctx: commands.Context, error: commands.CommandError) -> None:
    if isinstance(error, commands.CommandNotFound):
        await ctx.send(f"❓ 找不到這個指令。請輸入 `{PREFIX}help` 查看可用指令。")
        return
    if isinstance(error, commands.CheckFailure):
        await ctx.send(f"⛔ {error}")
        return
    logging.exception("Discord command failed", exc_info=error)
    await ctx.send(f"❌ 指令發生錯誤：`{error}`")


def main() -> None:
    token = os.getenv("DISCORD_BOT_TOKEN")
    if not token:
        raise RuntimeError("尚未設定 DISCORD_BOT_TOKEN 環境變數")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[
            logging.FileHandler(BASE_DIR / "bot.log", encoding="utf-8"),
            logging.StreamHandler(),
        ],
    )
    try:
        bot.run(token, log_handler=None)
    except Exception:
        logging.exception("Discord Bot 啟動失敗")
        raise


if __name__ == "__main__":
    main()
