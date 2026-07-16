@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

set "VENV=.venv-google-sheets"
set "PYTHON=%VENV%\Scripts\python.exe"

if exist "%PYTHON%" goto install

where py >nul 2>nul
if %errorlevel%==0 (
  py -3 -m venv "%VENV%"
) else (
  python -m venv "%VENV%"
)
if errorlevel 1 goto failed

:install
"%PYTHON%" -m pip install --upgrade pip
if errorlevel 1 goto failed
"%PYTHON%" -m pip install -r requirements-google-sheets.txt
if errorlevel 1 goto failed

if not exist "google_sheets_sync.json" copy /Y "google_sheets_sync.example.json" "google_sheets_sync.json" >nul
if not exist "secrets" mkdir "secrets"

echo.
echo Google Sheets 同步環境已建立。
echo 下一步：
echo 1. 將 OAuth 電腦版應用程式 JSON 放到 secrets\google-oauth-client.json
echo 2. 編輯 google_sheets_sync.json，填入 spreadsheetId
echo 3. 執行 Sync Google Sheets Data.bat；首次檢查會開啟 Google 登入授權頁
echo.
pause
exit /b 0

:failed
echo.
echo 安裝失敗，請檢查 Python 與網路連線。
pause
exit /b 1
