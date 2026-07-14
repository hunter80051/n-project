$ErrorActionPreference = "Stop"

$projectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$logFile = Join-Path $projectDir "bot-startup.log"

function Write-StartupLog([string]$Message) {
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    Add-Content -LiteralPath $logFile -Value "[$timestamp] $Message" -Encoding UTF8
}

try {
    $botProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Name -match '^python' -and
            $_.CommandLine -like '*discord_codex_bot.py*'
        }

    if (-not $botProcesses) {
        Write-StartupLog "Stop requested, but no Discord Bot process was running."
        exit 0
    }

    foreach ($process in $botProcesses) {
        Stop-Process -Id $process.ProcessId
        Write-StartupLog "Stopped Bot process ID $($process.ProcessId)."
    }
    exit 0
}
catch {
    Write-StartupLog "Stop failed: $($_.Exception.Message)"
    exit 1
}
