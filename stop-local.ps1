$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
foreach ($name in @('frontend','backend')) {
    $pidFile = Join-Path $projectRoot ".local/$name.json"
    if (!(Test-Path -LiteralPath $pidFile)) { continue }
    $state = Get-Content -Raw -LiteralPath $pidFile | ConvertFrom-Json
    $process = Get-CimInstance Win32_Process -Filter "ProcessId = $($state.pid)" -ErrorAction SilentlyContinue
    if ($process -and $process.CommandLine -and $process.CommandLine.Contains($projectRoot)) {
        Stop-Process -Id $state.pid
        Write-Host "$name stopped."
    } elseif ($process) { Write-Warning "PID $($state.pid) is no longer this project's service; it was not stopped." }
}
