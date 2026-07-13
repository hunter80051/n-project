from __future__ import annotations

import asyncio
import json
import logging
import os
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import discord
from discord.ext import commands


BASE_DIR = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.getenv("CODEX_DISCORD_CONFIG", BASE_DIR / "config.json"))
DISCORD_LIMIT = 1900


@dataclass
class ChannelState:
    status: str = "idle"
    job_id: str = ""
    task_type: str = ""
    task: str = ""
    last_result: str = "尚無執行紀錄"
    updated_at: str = ""
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
            }
            for channel_id, state in states.items()
        }
    }
    temp_path = JOB_STORE_PATH.with_suffix(JOB_STORE_PATH.suffix + ".tmp")
    temp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    temp_path.replace(JOB_STORE_PATH)


def update_state(state: ChannelState, **changes: str) -> None:
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


async def send_long(ctx: commands.Context, text: str) -> None:
    text = text.strip() or "（Codex 沒有回傳文字）"
    for start in range(0, len(text), DISCORD_LIMIT):
        await ctx.send(text[start : start + DISCORD_LIMIT], allowed_mentions=discord.AllowedMentions.none())


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


async def require_clean_git_project(path: Path) -> str | None:
    code, _, _ = await run_git(path, "rev-parse", "--verify", "HEAD")
    if code != 0:
        return "Git 尚無初始 commit，請先建立專案基準版本。"
    code, output, error = await run_git(path, "status", "--porcelain")
    if code != 0:
        return f"無法檢查 Git 狀態：{error or output}"
    if output:
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
        f"`{PREFIX}change <任務>` 修改既有功能\n"
        f"`{PREFIX}fix <任務>` 修復問題\n"
        f"`{PREFIX}status` 查詢狀態\n"
        f"`{PREFIX}retry [補充說明]` 重跑上一個任務\n"
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
        f"目前/上次任務：{task}",
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
    )
    await ctx.send(f"📡 已連接 `{cfg.get('project_name', path.name)}`，Codex 開始處理任務。")

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

    try:
        state.process = await asyncio.create_subprocess_exec(
            *args,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            cwd=path,
        )
        stdout, stderr = await state.process.communicate(
            build_prompt(task, cfg.get("project_name", path.name)).encode("utf-8")
        )
        output = stdout.decode("utf-8", errors="replace").strip()
        error = stderr.decode("utf-8", errors="replace").strip()
        if state.process.returncode == 0:
            files = await changed_files(path)
            if files:
                update_state(state, status="waiting_approval", last_result=output)
                await send_long(
                    ctx,
                    f"✅ Codex 任務完成，等待核准\n\n{output}\n\n"
                    f"變更檔案：{', '.join(files)}\n"
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


@bot.command(name="build")
@commands.check(authorized)
async def build_command(ctx: commands.Context, *, task: str = "") -> None:
    await execute_task(ctx, task, "build")


@bot.command(name="change")
@commands.check(authorized)
async def change_command(ctx: commands.Context, *, task: str = "") -> None:
    await execute_task(ctx, task, "change")


@bot.command(name="fix")
@commands.check(authorized)
async def fix_command(ctx: commands.Context, *, task: str = "") -> None:
    await execute_task(ctx, task, "fix")


@bot.command(name="retry")
@commands.check(authorized)
async def retry_command(ctx: commands.Context, *, note: str = "") -> None:
    state = states.setdefault(ctx.channel.id, ChannelState())
    if not state.task:
        await ctx.send("此頻道尚無可重試的任務。")
        return
    task = state.task + (f"\n\n重試補充：{clean_mentions(note)}" if note.strip() else "\n\n請重新檢查並完成此任務。")
    await execute_task(ctx, task, state.task_type or "build", reuse_job=True)


@bot.command(name="approve")
@commands.check(authorized)
async def approve_command(ctx: commands.Context) -> None:
    cfg, path = get_project(ctx.channel.id)
    state = states.setdefault(ctx.channel.id, ChannelState())
    if state.status != "waiting_approval":
        await ctx.send("目前沒有等待核准的任務。")
        return

    files = await changed_files(path)
    if not files:
        update_state(state, status="completed", last_result="核准時未發現 Git 變更")
        await ctx.send("沒有可提交的 Git 變更。")
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

    summary = " ".join(state.task.split())[:72] or state.job_id
    message = f"{state.task_type or 'change'}: {summary}"
    code, output, error = await run_git(path, "commit", "-m", message)
    if code != 0:
        update_state(state, status="approval_failed", last_result=error or output)
        await ctx.send(f"❌ Git commit 失敗：`{error or output}`")
        return

    code, commit_hash, _ = await run_git(path, "rev-parse", "--short", "HEAD")
    update_state(state, status="committed", last_result=output)
    await ctx.send(
        f"✅ 已核准並建立 commit `{commit_hash if code == 0 else 'unknown'}`\n"
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
