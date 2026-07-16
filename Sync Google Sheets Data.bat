@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "PYTHON=.venv-google-sheets\Scripts\python.exe"
if not exist "%PYTHON%" (
  echo 尚未建立同步環境，請先執行 Setup Google Sheets Sync.bat
  pause
  exit /b 1
)

if /I "%~1"=="check" goto check
if /I "%~1"=="apply" goto apply
if /I "%~1"=="versions" goto versions

:menu
echo.
echo ========================================
echo N-Project Google Sheets 配置同步
echo ========================================
echo [1] 檢查 Google Sheet，不修改 CSV
echo [2] 驗證後套用並更新 CSV 個別版本
echo [3] 顯示相對 HEAD 的 CSV 版本變更
echo [4] 重新執行環境安裝
echo [Q] 結束
echo.
choice /C 1234Q /N /M "請選擇："
if errorlevel 5 exit /b 0
if errorlevel 4 goto setup
if errorlevel 3 goto versions
if errorlevel 2 goto apply
if errorlevel 1 goto check

:check
"%PYTHON%" tools\google_sheets_sync.py check
goto done

:apply
"%PYTHON%" tools\google_sheets_sync.py apply
goto done

:versions
"%PYTHON%" tools\google_sheets_sync.py versions --git-ref HEAD
goto done

:setup
call "Setup Google Sheets Sync.bat"
exit /b %errorlevel%

:done
set "RESULT=%errorlevel%"
echo.
if not "%~1"=="" exit /b %RESULT%
pause
exit /b %RESULT%
