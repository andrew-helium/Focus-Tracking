$project = Split-Path -Parent $MyInvocation.MyCommand.Path
$logDir = Join-Path $env:LOCALAPPDATA "FocusTracker"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir "startup.log"

function Write-Log([string]$message) {
  $line = "{0} {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm:ss"), $message
  Add-Content -Path $log -Value $line
}

try {
  $listening = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:19264\s+\S+\s+LISTENING\s+\d+\s*$"
  if ($listening) {
    Write-Log "Already running."
    exit 0
  }

  $env:Path = "$(${env:ProgramFiles})\nodejs;$(${env:APPDATA})\npm;" + $env:Path
  Start-Process -FilePath "cmd.exe" -ArgumentList "/d /c pnpm.cmd dev" -WorkingDirectory $project -WindowStyle Hidden
  Write-Log "Started."
} catch {
  Write-Log $_.Exception.Message
  exit 1
}
