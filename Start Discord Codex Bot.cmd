@echo off
setlocal
cd /d "%~dp0"
title Discord Codex Bot

echo Starting Discord Codex Bot launcher...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start_bot.ps1"
set "BOT_EXIT_CODE=%ERRORLEVEL%"

echo.
echo Bot process ended with exit code %BOT_EXIT_CODE%.
echo This window will stay open so you can read any error above.
echo Press any key to close this window.
pause >nul
exit /b %BOT_EXIT_CODE%
