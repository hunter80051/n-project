@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "%~dp0start_bot.ps1"
exit /b %ERRORLEVEL%
