$listening = netstat -ano | Select-String -Pattern "^\s*TCP\s+\S+:19264\s+\S+\s+LISTENING\s+(\d+)\s*$"
if (-not $listening) {
  Write-Host "Focus Tracker is not running."
  exit 0
}

$processIds = $listening | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -Unique
foreach ($processId in $processIds) {
  & taskkill.exe /F /T /PID $processId | Out-Null
}

Write-Host "Focus Tracker stopped."
