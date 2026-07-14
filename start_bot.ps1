$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$botFile = Join-Path $projectDir "discord_codex_bot.py"
$configFile = Join-Path $projectDir "config.json"
$logFile = Join-Path $projectDir "bot-startup.log"

function Write-StartupLog([string]$Message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message" -Encoding UTF8
}

try {
    Write-StartupLog "Launcher started."
    if (-not (Test-Path -LiteralPath $botFile)) {
        throw "discord_codex_bot.py was not found: $botFile"
    }
    if (-not (Test-Path -LiteralPath $configFile)) {
        throw "config.json was not found. Complete the channel configuration first."
    }

    $python = Get-Command python -ErrorAction SilentlyContinue
    if (-not $python) {
        throw "Python was not found. Install Python and ensure the python command is available."
    }

    $token = [Environment]::GetEnvironmentVariable("DISCORD_BOT_TOKEN", "User")
    if ([string]::IsNullOrWhiteSpace($token)) {
        throw "DISCORD_BOT_TOKEN was not found in the Windows user environment variables."
    }

    $runningBot = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match '^python' -and
            $_.CommandLine -like '*discord_codex_bot.py*'
        } |
        Select-Object -First 1
    if ($runningBot) {
        Write-StartupLog "Bot is already running with process ID $($runningBot.ProcessId)."
        exit 0
    }

    $env:DISCORD_BOT_TOKEN = $token
    $env:CODEX_DISCORD_CONFIG = $configFile
    $quotedBotFile = '"' + $botFile + '"'
    $process = Start-Process `
        -FilePath $python.Source `
        -ArgumentList $quotedBotFile `
        -WorkingDirectory $projectDir `
        -WindowStyle Hidden `
        -PassThru
    Write-StartupLog "Bot started in background with process ID $($process.Id)."
    $env:DISCORD_BOT_TOKEN = $null
    exit 0
}
catch {
    $env:DISCORD_BOT_TOKEN = $null
    Write-StartupLog "Startup failed: $($_.Exception.Message)"
    [System.Windows.Forms.MessageBox]::Show(
        $_.Exception.Message,
        "Discord Codex Bot startup failed",
        [System.Windows.Forms.MessageBoxButtons]::OK,
        [System.Windows.Forms.MessageBoxIcon]::Error
    ) | Out-Null
    Write-Error $_.Exception.Message
    exit 1
}
